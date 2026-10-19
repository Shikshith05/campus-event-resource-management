-- =====================================================================
-- CERMS - booking validation and priority-based conflict resolution
--
-- Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/booking_logic.sql
--
-- resolve_booking_conflict() must be called inside the same transaction
-- that accepts a pending booking. It locks the venue and required
-- resources until the transaction ends.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Validate one booking against venue capacity and confirmed resources.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_booking_capacity(p_booking_id INT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    booking_record RECORD;
BEGIN
    SELECT
        b.booking_id,
        b.venue_id,
        v.capacity AS venue_capacity,
        e.expected_footfall
    INTO booking_record
    FROM booking AS b
    JOIN event AS e ON e.event_id = b.event_id
    JOIN venue AS v ON v.venue_id = b.venue_id
    WHERE b.booking_id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking % does not exist', p_booking_id;
    END IF;

    IF booking_record.expected_footfall > booking_record.venue_capacity THEN
        RAISE EXCEPTION
            'Booking % requires capacity %, but venue % only holds %',
            p_booking_id,
            booking_record.expected_footfall,
            booking_record.venue_id,
            booking_record.venue_capacity;
    END IF;
END;
$$;


CREATE OR REPLACE FUNCTION validate_booking_resources(p_booking_id INT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    booking_record RECORD;
    resource_record RECORD;
    requested_quantity INT;
    confirmed_quantity INT;
BEGIN
    SELECT booking_id, venue_id, start_time, end_time
    INTO booking_record
    FROM booking
    WHERE booking_id = p_booking_id
      AND status = 'CONFIRMED';

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Lock in resource_id order so concurrent bookings using multiple
    -- resources acquire locks consistently and do not deadlock.
    FOR resource_record IN
        SELECT DISTINCT br.resource_id
        FROM booking_resource AS br
        WHERE br.booking_id = p_booking_id
        ORDER BY br.resource_id
    LOOP
        PERFORM pg_advisory_xact_lock(2100000000 + resource_record.resource_id);

        SELECT
            r.resource_id,
            r.total_quantity,
            br.quantity
        INTO resource_record
        FROM booking_resource AS br
        JOIN resource AS r ON r.resource_id = br.resource_id
        WHERE br.booking_id = p_booking_id
          AND br.resource_id = resource_record.resource_id;

        requested_quantity := resource_record.quantity;

        SELECT COALESCE(SUM(br.quantity), 0)
        INTO confirmed_quantity
        FROM booking_resource AS br
        JOIN booking AS b ON b.booking_id = br.booking_id
        WHERE br.resource_id = resource_record.resource_id
          AND b.status = 'CONFIRMED'
          AND b.booking_id <> p_booking_id
          AND b.start_time < booking_record.end_time
          AND booking_record.start_time < b.end_time;

        IF confirmed_quantity + requested_quantity > resource_record.total_quantity THEN
            RAISE EXCEPTION
                'Resource % is overbooked for booking %: requested %, already confirmed %, total %',
                resource_record.resource_id,
                p_booking_id,
                requested_quantity,
                confirmed_quantity,
                resource_record.total_quantity;
        END IF;
    END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION validate_confirmed_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'CONFIRMED' THEN
        PERFORM validate_booking_capacity(NEW.booking_id);
        PERFORM validate_booking_resources(NEW.booking_id);
    END IF;
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_confirmed_booking ON booking;
CREATE TRIGGER trg_validate_confirmed_booking
AFTER INSERT OR UPDATE OF event_id, venue_id, start_time, end_time, status
ON booking
FOR EACH ROW
EXECUTE FUNCTION validate_confirmed_booking();


CREATE OR REPLACE FUNCTION validate_booking_resource_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM booking
        WHERE booking_id = NEW.booking_id
          AND status = 'CONFIRMED'
    ) THEN
        PERFORM validate_booking_resources(NEW.booking_id);
    END IF;
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_booking_resource_change ON booking_resource;
CREATE TRIGGER trg_validate_booking_resource_change
AFTER INSERT OR UPDATE OF resource_id, quantity
ON booking_resource
FOR EACH ROW
EXECUTE FUNCTION validate_booking_resource_change();


-- ---------------------------------------------------------------------
-- Calculate the documented priority score for a booking.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_booking_priority(p_booking_id INT)
RETURNS NUMERIC(6,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    score NUMERIC(6,2);
BEGIN
    SELECT
        CASE e.category
            WHEN 'ACADEMIC' THEN 40
            WHEN 'DEPARTMENT' THEN 30
            WHEN 'CLUB' THEN 20
            WHEN 'PERSONAL' THEN 10
        END
        + (r.hierarchy_level * 5)
        + LEAST(
            15,
            GREATEST(
                0,
                EXTRACT(EPOCH FROM (b.start_time - b.requested_at)) / 86400.0 * 0.5
            )
        )
        - (
            SELECT COUNT(*) * 5
            FROM booking AS penalty_booking
            JOIN event AS penalty_event
                ON penalty_event.event_id = penalty_booking.event_id
            WHERE penalty_event.organizer_id = e.organizer_id
              AND penalty_booking.status IN ('CANCELLED', 'NO_SHOW')
              AND penalty_booking.end_time >= b.requested_at - INTERVAL '180 days'
              AND penalty_booking.booking_id <> b.booking_id
        )
    INTO score
    FROM booking AS b
    JOIN event AS e ON e.event_id = b.event_id
    JOIN app_user AS u ON u.user_id = e.organizer_id
    JOIN role AS r ON r.role_id = u.role_id
    WHERE b.booking_id = p_booking_id;

    IF score IS NULL THEN
        RAISE EXCEPTION 'Booking % does not exist', p_booking_id;
    END IF;

    RETURN ROUND(score, 2);
END;
$$;


-- ---------------------------------------------------------------------
-- Resolve all pending requests overlapping the supplied booking.
-- Confirmed bookings always remain winners; pending bookings compete by
-- score and requested_at. Returns the resulting status and score.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_booking_conflict(p_booking_id INT)
RETURNS TABLE (
    resolved_booking_id INT,
    resolved_status VARCHAR(20),
    priority_score NUMERIC(6,2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    target_booking RECORD;
    contender RECORD;
    winner_id INT;
    winner_score NUMERIC(6,2);
    contender_score NUMERIC(6,2);
BEGIN
    SELECT booking_id, venue_id, start_time, end_time, status
    INTO target_booking
    FROM booking
    WHERE booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking % does not exist', p_booking_id;
    END IF;

    IF target_booking.status NOT IN ('PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION
            'Booking % has status %, expected PENDING or CONFIRMED',
            p_booking_id,
            target_booking.status;
    END IF;

    -- A venue lock serializes conflict resolution for this venue.
    PERFORM pg_advisory_xact_lock(2000000000 + target_booking.venue_id);

    SELECT b.booking_id
    INTO winner_id
    FROM booking AS b
    WHERE b.venue_id = target_booking.venue_id
      AND b.status = 'CONFIRMED'
      AND b.start_time < target_booking.end_time
      AND target_booking.start_time < b.end_time
    ORDER BY b.start_time, b.booking_id
    LIMIT 1
    FOR UPDATE;

    IF winner_id IS NOT NULL THEN
        winner_score := calculate_booking_priority(winner_id);

        FOR contender IN
            SELECT b.booking_id
            FROM booking AS b
            WHERE b.venue_id = target_booking.venue_id
              AND b.status = 'PENDING'
              AND b.start_time < target_booking.end_time
              AND target_booking.start_time < b.end_time
            ORDER BY b.booking_id
            FOR UPDATE
        LOOP
            contender_score := calculate_booking_priority(contender.booking_id);
            UPDATE booking SET status = 'REJECTED'
            WHERE booking_id = contender.booking_id;

            INSERT INTO booking_conflict_log (
                winning_booking_id,
                losing_booking_id,
                winner_score,
                loser_score,
                reason
            )
            VALUES (
                winner_id,
                contender.booking_id,
                winner_score,
                contender_score,
                'Confirmed booking already occupied the requested venue and time.'
            )
            ON CONFLICT (winning_booking_id, losing_booking_id) DO NOTHING;
        END LOOP;
    ELSE
        SELECT b.booking_id
        INTO winner_id
        FROM booking AS b
        WHERE b.venue_id = target_booking.venue_id
          AND b.status = 'PENDING'
          AND b.start_time < target_booking.end_time
          AND target_booking.start_time < b.end_time
        ORDER BY
            calculate_booking_priority(b.booking_id) DESC,
            b.requested_at ASC,
            b.booking_id ASC
        LIMIT 1
        FOR UPDATE;

        IF winner_id IS NULL THEN
            RAISE EXCEPTION 'No pending contender exists for booking %', p_booking_id;
        END IF;

        winner_score := calculate_booking_priority(winner_id);
        UPDATE booking SET status = 'CONFIRMED'
        WHERE booking_id = winner_id;

        FOR contender IN
            SELECT b.booking_id
            FROM booking AS b
            WHERE b.venue_id = target_booking.venue_id
              AND b.status = 'PENDING'
              AND b.booking_id <> winner_id
              AND b.start_time < target_booking.end_time
              AND target_booking.start_time < b.end_time
            ORDER BY b.booking_id
            FOR UPDATE
        LOOP
            contender_score := calculate_booking_priority(contender.booking_id);
            UPDATE booking SET status = 'REJECTED'
            WHERE booking_id = contender.booking_id;

            INSERT INTO booking_conflict_log (
                winning_booking_id,
                losing_booking_id,
                winner_score,
                loser_score,
                reason
            )
            VALUES (
                winner_id,
                contender.booking_id,
                winner_score,
                contender_score,
                'Higher-priority pending request selected for the venue and time.'
            )
            ON CONFLICT (winning_booking_id, losing_booking_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN QUERY
    SELECT b.booking_id, b.status, calculate_booking_priority(b.booking_id)
    FROM booking AS b
    WHERE b.venue_id = target_booking.venue_id
      AND b.start_time < target_booking.end_time
      AND target_booking.start_time < b.end_time
      AND b.status IN ('CONFIRMED', 'REJECTED')
    ORDER BY b.booking_id;
END;
$$;
