-- =====================================================================
-- CERMS - database-level role-based access control (RBAC) and
-- row-level security (RLS)
--
-- Run LAST, after seed.sql, as the database owner (superuser):
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/rbac.sql
-- Re-runnable: roles are created only if missing, privileges are
-- revoked and granted again, and policies are dropped and recreated.
--
-- Who connects to the database?
--   * The Next.js app connects as cerms_app. For every request it runs
--       BEGIN; SET LOCAL ROLE cerms_student|cerms_faculty|cerms_admin;
--       SET LOCAL app.current_user_id = <logged-in user>; ... COMMIT;
--     (app/lib/db.ts, withUserTransaction). So the database itself
--     enforces what each user may do, not just the user interface.
--   * cerms_test_student / _faculty / _admin are LOGIN roles for trying
--     the rules out in psql (password: password123, DEVELOPMENT ONLY).
--
-- App role (app_user.role_id)  ->  database role
--   STUDENT, CLUB_COORDINATOR  ->  cerms_student
--   FACULTY, HOD               ->  cerms_faculty
--   ADMIN                      ->  cerms_admin
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r TEXT;
BEGIN
    -- Group roles: hold privileges, cannot log in.
    FOREACH r IN ARRAY ARRAY['cerms_student', 'cerms_faculty', 'cerms_admin'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
    END LOOP;

    -- Login roles: the web app and one test user per group.
    FOREACH r IN ARRAY ARRAY['cerms_app', 'cerms_test_student',
                             'cerms_test_faculty', 'cerms_test_admin'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I LOGIN', r);
        END IF;
    END LOOP;
END $$;

-- Development passwords only. Change them for any shared deployment.
-- NOINHERIT: cerms_app gets NO privileges from its group memberships by
-- itself. It must SET ROLE to one group per request.
ALTER ROLE cerms_app          LOGIN NOINHERIT PASSWORD 'cerms_app_dev';
ALTER ROLE cerms_test_student LOGIN PASSWORD 'password123';
ALTER ROLE cerms_test_faculty LOGIN PASSWORD 'password123';
ALTER ROLE cerms_test_admin   LOGIN PASSWORD 'password123';

-- Hierarchy, like the app roles: faculty can do everything a student
-- can (and more); admin can do everything faculty can (and more).
GRANT cerms_student TO cerms_faculty;
GRANT cerms_faculty TO cerms_admin;

-- The app may switch to any of the three groups.
GRANT cerms_student, cerms_faculty, cerms_admin TO cerms_app;

-- Test logins.
GRANT cerms_student TO cerms_test_student;
GRANT cerms_faculty TO cerms_test_faculty;
GRANT cerms_admin   TO cerms_test_admin;


-- ---------------------------------------------------------------------
-- 2. Helper functions
-- ---------------------------------------------------------------------

-- The logged-in CERMS user for this transaction, or NULL when the app
-- did not set it. NULL matches no row, so "not set" means "see nothing".
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS INT
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::INT;
$$;

-- Login lookup used by POST /api/auth/login. cerms_app cannot read
-- app_user at all; it can only call this function, which returns the one
-- row for the given email (including the bcrypt hash to compare).
CREATE OR REPLACE FUNCTION find_user_for_login(p_email TEXT)
RETURNS TABLE (
    user_id        INT,
    full_name      VARCHAR(100),
    email          VARCHAR(120),
    password_hash  TEXT,
    role_name      VARCHAR(30),
    is_active      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.user_id, u.full_name, u.email, u.password_hash, r.role_name, u.is_active
    FROM app_user AS u
    JOIN role AS r ON r.role_id = u.role_id
    WHERE u.email = lower(p_email);
$$;


-- ---------------------------------------------------------------------
-- 3. Start from zero (makes the script re-runnable)
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM cerms_student, cerms_faculty, cerms_admin, cerms_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM cerms_student, cerms_faculty, cerms_admin, cerms_app;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM cerms_student, cerms_faculty, cerms_admin, cerms_app;
-- SECURITY DEFINER routines must not be callable by everyone (PUBLIC).
REVOKE EXECUTE ON FUNCTION find_user_for_login(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE submit_booking_request(
    INT, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT, INT,
    TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], INT, INT, VARCHAR
) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO cerms_student, cerms_faculty, cerms_admin, cerms_app;


-- ---------------------------------------------------------------------
-- 4. GRANTs (least privilege)
-- ---------------------------------------------------------------------

-- cerms_app: only the login lookup. Everything else happens after
-- SET ROLE to the user's group.
GRANT EXECUTE ON FUNCTION find_user_for_login(TEXT) TO cerms_app;

-- cerms_student ---------------------------------------------------------
-- Reference data and the public calendar.
GRANT SELECT ON department, venue, resource, club, club_member,
                event_venue_preference, guest_lecture_details
             TO cerms_student;
GRANT SELECT ON venue_booking_schedule, resource_booking_usage, event_request_summary
             TO cerms_student;
-- Users: every column EXCEPT password_hash (column-level privilege).
GRANT SELECT (user_id, university_id, full_name, email, role_id,
              department_id, is_active, created_at)
             ON app_user TO cerms_student;
-- Their own requests. Which rows count as "own" is decided by the RLS
-- policies in section 5; which columns may change is decided here.
GRANT SELECT, INSERT, DELETE ON event TO cerms_student;
GRANT UPDATE (title, description, expected_footfall, status) ON event TO cerms_student;
GRANT SELECT, INSERT ON booking TO cerms_student;
GRANT UPDATE (status) ON booking TO cerms_student;
-- Routines.
GRANT EXECUTE ON PROCEDURE submit_booking_request(
    INT, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT, INT,
    TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], INT, INT, VARCHAR
) TO cerms_student;
GRANT EXECUTE ON FUNCTION suggest_alternate_venues(INT), app_current_user_id()
             TO cerms_student;

-- cerms_faculty (also has everything granted to cerms_student) ----------
GRANT SELECT ON booking_resource, booking_status_history,
                requester_booking_history, venue_utilization,
                event_statistics, resource_utilization
             TO cerms_faculty;
-- Approve / reject: faculty may change the STATUS of any event or booking.
GRANT UPDATE (status) ON event, booking TO cerms_faculty;

-- cerms_admin (also has everything granted to faculty) -------------------
-- Full control, including the only access to role and
-- booking_conflict_log, and to app_user.password_hash.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO cerms_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO cerms_admin;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO cerms_admin;
REVOKE EXECUTE ON FUNCTION find_user_for_login(TEXT) FROM cerms_admin;  -- app login only

-- Result: role and booking_conflict_log are granted to cerms_admin only.

-- event_request_summary (views.sql) normally runs with its owner's rights.
-- security_invoker makes it run with the CALLER's rights, so the RLS
-- below also applies through the view: a student sees only their own
-- requests in it. venue_booking_schedule stays owner-rights on purpose:
-- everyone may see what is booked when, to find a free slot.
ALTER VIEW event_request_summary SET (security_invoker = true);


-- ---------------------------------------------------------------------
-- 5. Row-level security (RLS) on event and booking
--    A student sees and edits only rows where they are the organizer.
--    Faculty and admin (members of cerms_faculty) see every row.
--    The table owner (superuser running seed.sql) is not affected.
-- ---------------------------------------------------------------------
ALTER TABLE event   ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_student_select   ON event;
DROP POLICY IF EXISTS event_student_insert   ON event;
DROP POLICY IF EXISTS event_student_update   ON event;
DROP POLICY IF EXISTS event_student_delete   ON event;
DROP POLICY IF EXISTS event_staff_all        ON event;
DROP POLICY IF EXISTS booking_student_select ON booking;
DROP POLICY IF EXISTS booking_student_insert ON booking;
DROP POLICY IF EXISTS booking_student_update ON booking;
DROP POLICY IF EXISTS booking_staff_all      ON booking;

-- event -----------------------------------------------------------------
-- USING decides which existing rows are visible / changeable.
-- WITH CHECK decides what a new or changed row may look like.
CREATE POLICY event_student_select ON event
    FOR SELECT TO cerms_student
    USING (organizer_id = app_current_user_id());

CREATE POLICY event_student_insert ON event
    FOR INSERT TO cerms_student
    WITH CHECK (organizer_id = app_current_user_id()
                AND status IN ('DRAFT', 'PENDING_APPROVAL'));

-- A student may edit or cancel their own request, but never approve it.
CREATE POLICY event_student_update ON event
    FOR UPDATE TO cerms_student
    USING (organizer_id = app_current_user_id())
    WITH CHECK (organizer_id = app_current_user_id()
                AND status IN ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED'));

CREATE POLICY event_student_delete ON event
    FOR DELETE TO cerms_student
    USING (organizer_id = app_current_user_id() AND status = 'DRAFT');

CREATE POLICY event_staff_all ON event
    FOR ALL TO cerms_faculty
    USING (TRUE) WITH CHECK (TRUE);

-- booking ---------------------------------------------------------------
-- A booking is "own" when its event is own.
CREATE POLICY booking_student_select ON booking
    FOR SELECT TO cerms_student
    USING (EXISTS (SELECT 1 FROM event AS e
                   WHERE e.event_id = booking.event_id
                     AND e.organizer_id = app_current_user_id()));

CREATE POLICY booking_student_insert ON booking
    FOR INSERT TO cerms_student
    WITH CHECK (status = 'PENDING'
                AND EXISTS (SELECT 1 FROM event AS e
                            WHERE e.event_id = booking.event_id
                              AND e.organizer_id = app_current_user_id()));

-- A student may cancel their own booking, but never confirm it.
CREATE POLICY booking_student_update ON booking
    FOR UPDATE TO cerms_student
    USING (EXISTS (SELECT 1 FROM event AS e
                   WHERE e.event_id = booking.event_id
                     AND e.organizer_id = app_current_user_id()))
    WITH CHECK (status IN ('PENDING', 'CANCELLED'));

CREATE POLICY booking_staff_all ON booking
    FOR ALL TO cerms_faculty
    USING (TRUE) WITH CHECK (TRUE);


-- ---------------------------------------------------------------------
-- 6. Tests: the SAME statements, different roles, different results.
--    Runs in a transaction that is rolled back. Statements that must
--    fail run inside a SAVEPOINT with ON_ERROR_STOP switched off.
-- ---------------------------------------------------------------------
BEGIN;

-- T1. The same SELECT as three different users.
SET LOCAL ROLE cerms_student;
SELECT set_config('app.current_user_id', '1', TRUE);       -- Student One
SELECT 'T1 student, user 1' AS test, event_id, title FROM event ORDER BY event_id;

SELECT set_config('app.current_user_id', '4', TRUE);       -- Coordinator Two
SELECT 'T1 student, user 4' AS test, event_id, title FROM event ORDER BY event_id;

SET LOCAL ROLE cerms_faculty;
SELECT set_config('app.current_user_id', '5', TRUE);       -- Faculty One
SELECT 'T1 faculty, user 5' AS test, event_id, title FROM event ORDER BY event_id;

-- T2. Bookings follow the same rule (only user 1's own bookings: 2, 3, 5).
SET LOCAL ROLE cerms_student;
SELECT set_config('app.current_user_id', '1', TRUE);
SELECT 'T2 student, user 1' AS test, booking_id, event_id, status FROM booking ORDER BY booking_id;

-- T3. A student editing someone else's event changes nothing: the row is
--     invisible to them, so the UPDATE matches 0 rows (no error).
UPDATE event SET title = 'Hijacked' WHERE event_id = 1;

-- T4. A student may create their own DRAFT event (RLS WITH CHECK passes).
INSERT INTO event (title, category, event_type, organizer_id, expected_footfall, status)
VALUES ('T4 own draft', 'PERSONAL', 'OTHER', 1, 10, 'DRAFT');

-- T5. FORBIDDEN: a student UPDATE on a table they have no privilege on.
--     Expected: ERROR permission denied for table venue
SAVEPOINT t5;
\set ON_ERROR_STOP off
UPDATE venue SET capacity = 1 WHERE venue_id = 1;
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT t5;

-- T6. FORBIDDEN: a student approving their own event.
--     Expected: ERROR new row violates row-level security policy for table "event"
SAVEPOINT t6;
SET LOCAL ROLE cerms_student;
SELECT set_config('app.current_user_id', '1', TRUE);
\set ON_ERROR_STOP off
UPDATE event SET status = 'APPROVED' WHERE event_id = 3;
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT t6;

-- T7. FORBIDDEN: a student creating an event in someone else's name.
--     Expected: ERROR new row violates row-level security policy for table "event"
SAVEPOINT t7;
SET LOCAL ROLE cerms_student;
SELECT set_config('app.current_user_id', '1', TRUE);
\set ON_ERROR_STOP off
INSERT INTO event (title, category, event_type, organizer_id, expected_footfall)
VALUES ('Fake request', 'PERSONAL', 'OTHER', 2, 10);
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT t7;

-- T8. FORBIDDEN: a student reading password hashes (column privilege).
--     Expected: ERROR permission denied for table app_user
SAVEPOINT t8;
SET LOCAL ROLE cerms_student;
\set ON_ERROR_STOP off
SELECT password_hash FROM app_user;
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT t8;

-- T9. Faculty may change a booking's status (approve booking 7).
SET LOCAL ROLE cerms_faculty;
SELECT set_config('app.current_user_id', '5', TRUE);
UPDATE booking SET status = 'CONFIRMED' WHERE booking_id = 7;

-- T10. FORBIDDEN: faculty reading the priority decisions directly.
--      Expected: ERROR permission denied for table booking_conflict_log
SAVEPOINT t10;
SET LOCAL ROLE cerms_faculty;
\set ON_ERROR_STOP off
SELECT * FROM booking_conflict_log;
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT t10;

-- T11. Admin may read it.
SET LOCAL ROLE cerms_admin;
SELECT 'T11 admin' AS test, conflict_id, winning_booking_id, losing_booking_id
FROM booking_conflict_log;

ROLLBACK;
