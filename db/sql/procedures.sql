-- =====================================================================
-- CERMS - stored procedure, alternate-venue function and audit trigger
--
-- Run after schema.sql, views.sql and booking_logic.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/procedures.sql
--
-- Contents:
--   1. trg_log_booking_status        -> writes booking_status_history
--   2. suggest_alternate_venues()    -> function using a CTE
--   3. submit_booking_request        -> real PROCEDURE, called with CALL
-- Usage examples are in db/sql/dml.sql, section 8.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Audit trigger: one booking_status_history row for every new
--    booking (old_status NULL) and every status change.
--    SECURITY DEFINER: the function runs with its owner's rights, so no
--    application role needs INSERT on the history table. Users can
--    change a booking, but they can never write or fake audit rows.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_booking_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO booking_status_history (booking_id, old_status, new_status)
        VALUES (NEW.booking_id, NULL, NEW.status);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO booking_status_history (booking_id, old_status, new_status)
        VALUES (NEW.booking_id, OLD.status, NEW.status);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_booking_status ON booking;
CREATE TRIGGER trg_log_booking_status
AFTER INSERT OR UPDATE OF status
ON booking
FOR EACH ROW
EXECUTE FUNCTION log_booking_status_change();


-- ---------------------------------------------------------------------
-- 2. suggest_alternate_venues(booking_id)
--    For a booking (typically one that lost a clash), list active venues
--    that are big enough and have no CONFIRMED booking overlapping its
--    time slot. Closest capacity first, so big halls are not wasted.
--
--    The overlap check reads venue_booking_schedule (a view that sees
--    every booking), while the target booking is read from the booking
--    table with the caller's rights. Under row-level security a student
--    can therefore only ask for suggestions for their own booking.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION suggest_alternate_venues(p_booking_id INT)
RETURNS TABLE (
    venue_id     INT,
    venue_name   VARCHAR(100),
    capacity     INT,
    spare_seats  INT
)
LANGUAGE sql
STABLE
AS $$
    WITH target AS (                         -- the booking that needs a new venue
        SELECT b.venue_id, b.start_time, b.end_time, e.expected_footfall
        FROM booking AS b
        JOIN event AS e ON e.event_id = b.event_id
        WHERE b.booking_id = p_booking_id
    ),
    busy AS (                                -- venues already confirmed in that slot
        SELECT DISTINCT s.venue_id
        FROM venue_booking_schedule AS s, target AS t
        WHERE s.booking_status = 'CONFIRMED'
          AND s.start_time < t.end_time
          AND t.start_time < s.end_time
    )
    SELECT v.venue_id, v.name, v.capacity, v.capacity - t.expected_footfall
    FROM venue AS v, target AS t
    WHERE v.is_active
      AND v.capacity IS NOT NULL
      AND v.capacity >= t.expected_footfall
      AND v.venue_id <> t.venue_id           -- an *alternate* venue
      AND v.venue_id NOT IN (SELECT busy.venue_id FROM busy)
    ORDER BY v.capacity - t.expected_footfall, v.name;
$$;


-- ---------------------------------------------------------------------
-- 3. submit_booking_request: a real PROCEDURE (CREATE PROCEDURE + CALL).
--    In one transaction it:
--      a. inserts the event (status PENDING_APPROVAL),
--      b. inserts its booking (status PENDING),
--      c. inserts the requested resources,
--      d. calls resolve_booking_conflict() to allocate the venue.
--    If anything fails, every row from a-d is undone and one clear error
--    is raised that keeps the original SQLSTATE (e.g. 23P01, 23514).
--
--    Resources are passed as two parallel arrays:
--      p_resource_ids = ARRAY[1, 3], p_quantities = ARRAY[2, 1]
--      means 2 x resource 1 and 1 x resource 3.
--
--    The new IDs and final booking status come back through INOUT
--    parameters, so CALL prints them as a result row.
--
--    SECURITY DEFINER: resolve_booking_conflict() may reject OTHER
--    users' pending bookings and writes booking_conflict_log, which a
--    student is not allowed to do directly (see rbac.sql). So the
--    procedure runs with its owner's rights, and checks the caller's
--    identity itself first: app.current_user_id (set by the web app for
--    each request) must be the organizer, or an ADMIN.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE submit_booking_request(
    p_organizer_id         INT,
    p_title                VARCHAR(150),
    p_category             VARCHAR(20),
    p_event_type           VARCHAR(20),
    p_department_id        INT,
    p_club_id              INT,
    p_expected_footfall    INT,
    p_venue_id             INT,
    p_start_time           TIMESTAMPTZ,
    p_end_time             TIMESTAMPTZ,
    p_resource_ids         INT[],
    p_quantities           INT[],
    p_guest_name           VARCHAR(150) DEFAULT NULL,
    p_guest_affiliation    VARCHAR(200) DEFAULT NULL,
    p_talk_topic           VARCHAR(250) DEFAULT NULL,
    INOUT p_event_id       INT DEFAULT NULL,
    INOUT p_booking_id     INT DEFAULT NULL,
    INOUT p_booking_status VARCHAR(20) DEFAULT NULL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id INT := NULLIF(current_setting('app.current_user_id', TRUE), '')::INT;
BEGIN
    -- Who is calling? Students may only submit for themselves.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'app.current_user_id is not set; the caller is unknown';
    END IF;

    IF v_caller_id <> p_organizer_id AND NOT EXISTS (
        SELECT 1
        FROM app_user AS u
        JOIN role AS r ON r.role_id = u.role_id
        WHERE u.user_id = v_caller_id
          AND r.role_name = 'ADMIN'
    ) THEN
        RAISE EXCEPTION 'User % may not submit a request on behalf of user %',
            v_caller_id, p_organizer_id;
    END IF;

    IF p_department_id IS NULL THEN
        RAISE EXCEPTION 'A department is required so every proposal can be routed to its HOD stage';
    END IF;

    IF cardinality(COALESCE(p_resource_ids, '{}')) <> cardinality(COALESCE(p_quantities, '{}')) THEN
        RAISE EXCEPTION 'p_resource_ids and p_quantities must have the same length';
    END IF;

    -- a. the event
    INSERT INTO event (title, category, event_type, organizer_id, department_id,
                       club_id, expected_footfall, status)
    VALUES (p_title, p_category, p_event_type, p_organizer_id, p_department_id,
            p_club_id, p_expected_footfall, 'PENDING_APPROVAL')
    RETURNING event_id INTO p_event_id;

    IF p_event_type = 'GUEST_LECTURE' THEN
        IF NOT EXISTS (
            SELECT 1 FROM app_user AS u
            JOIN role AS r ON r.role_id = u.role_id
            WHERE u.user_id = v_caller_id
              AND r.role_name IN ('FACULTY', 'HOD', 'ADMIN')
              AND u.is_active
        ) THEN
            RAISE EXCEPTION 'Guest lectures may only be submitted by faculty, HOD, or admin accounts';
        END IF;
        IF NULLIF(btrim(p_guest_name), '') IS NULL
           OR NULLIF(btrim(p_guest_affiliation), '') IS NULL
           OR NULLIF(btrim(p_talk_topic), '') IS NULL THEN
            RAISE EXCEPTION
                'Guest lectures require guest name, affiliation, and talk topic';
        END IF;
        INSERT INTO guest_lecture_details (event_id, guest_name, guest_affiliation, talk_topic)
        VALUES (p_event_id, btrim(p_guest_name), btrim(p_guest_affiliation), btrim(p_talk_topic));
    ELSIF p_guest_name IS NOT NULL OR p_guest_affiliation IS NOT NULL OR p_talk_topic IS NOT NULL THEN
        RAISE EXCEPTION 'Guest lecture details are only valid for GUEST_LECTURE events';
    END IF;

    -- b. its booking
    INSERT INTO booking (event_id, venue_id, start_time, end_time)
    VALUES (p_event_id, p_venue_id, p_start_time, p_end_time)
    RETURNING booking_id INTO p_booking_id;

    -- c. its resources (unnest turns the two arrays into rows)
    INSERT INTO booking_resource (booking_id, resource_id, quantity)
    SELECT p_booking_id, r.resource_id, r.quantity
    FROM unnest(p_resource_ids, p_quantities) AS r (resource_id, quantity);

    -- d. allocate the venue with the existing priority logic
    PERFORM * FROM resolve_booking_conflict(p_booking_id);

    SELECT status INTO p_booking_status
    FROM booking
    WHERE booking_id = p_booking_id;

    IF p_booking_status = 'REJECTED' THEN
        RAISE NOTICE 'Booking % lost the venue to a higher-priority booking. Alternates: %',
            p_booking_id,
            COALESCE((SELECT string_agg(s.venue_name, ', ')
                      FROM suggest_alternate_venues(p_booking_id) AS s), 'none');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        -- The EXCEPTION block has already undone steps a-d. Re-raise one
        -- readable message, keeping the original error code.
        RAISE EXCEPTION 'submit_booking_request failed for "%": %', p_title, SQLERRM
            USING ERRCODE = SQLSTATE;
END;
$$;

-- Functions and procedures are executable by everyone (PUBLIC) by
-- default. A SECURITY DEFINER routine must not be, so this one is locked
-- down here and granted to the application roles in rbac.sql.
REVOKE EXECUTE ON PROCEDURE submit_booking_request(
    INT, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT, INT,
    TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], VARCHAR, VARCHAR, VARCHAR,
    INT, INT, VARCHAR
) FROM PUBLIC;
