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
-- Cross-table validation for event and booking lifecycle rules.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_event_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    organizer_active BOOLEAN;
BEGIN
    SELECT is_active
    INTO organizer_active
    FROM app_user
    WHERE user_id = NEW.organizer_id;

    IF NOT COALESCE(organizer_active, FALSE) THEN
        RAISE EXCEPTION 'Event organizer % must be an active user', NEW.organizer_id;
    END IF;

    IF NEW.category = 'CLUB' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM club_member AS cm
            WHERE cm.club_id = NEW.club_id
              AND cm.user_id = NEW.organizer_id
        ) THEN
            RAISE EXCEPTION
                'Organizer % must be a member of club %',
                NEW.organizer_id,
                NEW.club_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_event_submission ON event;
CREATE TRIGGER trg_validate_event_submission
BEFORE INSERT OR UPDATE OF organizer_id, category, club_id
ON event
FOR EACH ROW
EXECUTE FUNCTION validate_event_submission();


CREATE OR REPLACE FUNCTION validate_club_advisor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM app_user AS u
        JOIN role AS r ON r.role_id = u.role_id
        WHERE u.user_id = NEW.faculty_advisor_id
          AND u.is_active
          AND r.hierarchy_level >= (
              SELECT hierarchy_level
              FROM role
              WHERE role_name = 'FACULTY'
          )
    ) THEN
        RAISE EXCEPTION
            'Club advisor % must be an active FACULTY or higher user',
            NEW.faculty_advisor_id;
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_club_advisor ON club;
CREATE TRIGGER trg_validate_club_advisor
BEFORE INSERT OR UPDATE OF faculty_advisor_id
ON club
FOR EACH ROW
EXECUTE FUNCTION validate_club_advisor();


CREATE OR REPLACE FUNCTION validate_booking_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_status VARCHAR(20);
    venue_active BOOLEAN;
BEGIN
    SELECT status
    INTO event_status
    FROM event
    WHERE event_id = NEW.event_id;

    IF event_status IS NULL THEN
        RAISE EXCEPTION 'Booking % references an invalid event', NEW.booking_id;
    END IF;

    IF NEW.status IN ('PENDING', 'CONFIRMED')
       AND event_status IN ('REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION
            'Cannot create or modify a booking for event % with status %',
            NEW.event_id,
            event_status;
    END IF;

    SELECT is_active
    INTO venue_active
    FROM venue
    WHERE venue_id = NEW.venue_id;

    IF NEW.status IN ('PENDING', 'CONFIRMED') AND NOT COALESCE(venue_active, FALSE) THEN
        RAISE EXCEPTION 'Venue % must be active for a new booking', NEW.venue_id;
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_booking_request ON booking;
CREATE TRIGGER trg_validate_booking_request
BEFORE INSERT OR UPDATE OF event_id, venue_id, status
ON booking
FOR EACH ROW
EXECUTE FUNCTION validate_booking_request();


CREATE OR REPLACE FUNCTION cancel_event_bookings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
        UPDATE booking
        SET status = 'CANCELLED'
        WHERE event_id = NEW.event_id
          AND status IN ('PENDING', 'CONFIRMED');
    END IF;
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_cancel_event_bookings ON event;
CREATE TRIGGER trg_cancel_event_bookings
AFTER UPDATE OF status
ON event
FOR EACH ROW
EXECUTE FUNCTION cancel_event_bookings();


CREATE OR REPLACE FUNCTION validate_conflict_log_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    winner RECORD;
    loser RECORD;
BEGIN
    SELECT venue_id, start_time, end_time
    INTO winner
    FROM booking
    WHERE booking_id = NEW.winning_booking_id;

    SELECT venue_id, start_time, end_time
    INTO loser
    FROM booking
    WHERE booking_id = NEW.losing_booking_id;

    IF NOT FOUND OR winner.venue_id IS NULL THEN
        RAISE EXCEPTION 'Conflict log refers to a missing winning booking';
    END IF;

    IF NOT FOUND OR loser.venue_id IS NULL THEN
        RAISE EXCEPTION 'Conflict log refers to a missing losing booking';
    END IF;

    IF winner.venue_id <> loser.venue_id
       OR winner.start_time >= loser.end_time
       OR loser.start_time >= winner.end_time THEN
        RAISE EXCEPTION
            'Conflict bookings % and % must use the same overlapping venue slot',
            NEW.winning_booking_id,
            NEW.losing_booking_id;
    END IF;

    IF NEW.decided_by IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM app_user AS u
           JOIN role AS r ON r.role_id = u.role_id
           WHERE u.user_id = NEW.decided_by
             AND u.is_active
             AND r.role_name = 'ADMIN'
       ) THEN
        RAISE EXCEPTION 'Conflict override user % must be an active ADMIN', NEW.decided_by;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM booking_conflict_log AS existing
        WHERE existing.winning_booking_id = NEW.losing_booking_id
          AND existing.losing_booking_id = NEW.winning_booking_id
          AND existing.conflict_id <> COALESCE(NEW.conflict_id, -1)
    ) THEN
        RAISE EXCEPTION
            'Conflict pair %/% is already logged in reverse order',
            NEW.winning_booking_id,
            NEW.losing_booking_id;
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_conflict_log_entry ON booking_conflict_log;
CREATE TRIGGER trg_validate_conflict_log_entry
BEFORE INSERT OR UPDATE OF winning_booking_id, losing_booking_id, decided_by
ON booking_conflict_log
FOR EACH ROW
EXECUTE FUNCTION validate_conflict_log_entry();


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
