-- =====================================================================
-- CERMS - DML demonstration (INSERT / UPDATE / DELETE)
--
-- Run AFTER seed.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/dml.sql
--
-- The whole file is ONE transaction that is rolled back at the end, so
-- it can be re-run on the seed data and queries.sql still sees the
-- original rows. Change the last line to COMMIT to keep the changes.
-- Every step prints a small SELECT so you can see what changed.
-- Dates assume the Aug-Dec 2026 semester (same as seed.sql).
-- =====================================================================

BEGIN;


-- ---------------------------------------------------------------------
-- 1. Submit a new event request: event + venue preferences + booking +
--    resources. In the app these run between BEGIN and COMMIT, so either
--    all four rows exist or none do (atomicity).
--    Student Two (user 2) is a member of the Music Club (club 3).
-- ---------------------------------------------------------------------

-- INSERT the event. Exercises trg_validate_event_submission (organizer is
-- active and is a member of club 3) and chk_event_club / chk_event_department.
INSERT INTO event (title, description, category, event_type, organizer_id,
                   department_id, club_id, expected_footfall, status)
VALUES ('Music Club Open Mic', 'Evening open mic', 'CLUB', 'CULTURAL', 2,
        2, 3, 80, 'PENDING_APPROVAL')
RETURNING event_id AS openmic_event_id \gset

-- INSERT ... SELECT: rank every active venue that fits 80 people as a
-- preference, smallest suitable venue first. Exercises the composite PK
-- and uq_event_venue_preference_order.
INSERT INTO event_venue_preference (event_id, venue_id, preference_order)
SELECT :openmic_event_id,
       v.venue_id,
       ROW_NUMBER() OVER (ORDER BY v.capacity, v.venue_id)
FROM venue AS v
WHERE v.is_active
  AND v.capacity >= 80;

-- INSERT the booking (PENDING by default). Exercises chk_booking_time,
-- chk_booking_lead_time and trg_validate_booking_request.
INSERT INTO booking (event_id, venue_id, start_time, end_time)
VALUES (:openmic_event_id, 5, '2026-12-05 17:00+05:30', '2026-12-05 20:00+05:30')
RETURNING booking_id AS openmic_booking_id \gset

-- INSERT the resources (multi-row insert). Exercises quantity > 0 and the
-- (booking_id, resource_id) primary key.
INSERT INTO booking_resource (booking_id, resource_id, quantity) VALUES
    (:openmic_booking_id, 2, 2),    -- 2 wireless microphones
    (:openmic_booking_id, 3, 1);    -- 1 PA system

SELECT e.event_id, e.title, e.status, b.booking_id, v.name AS venue, b.status AS booking_status
FROM event AS e
JOIN booking AS b ON b.event_id = e.event_id
JOIN venue AS v ON v.venue_id = b.venue_id
WHERE e.event_id = :openmic_event_id;


-- ---------------------------------------------------------------------
-- 2. Approve a booking: the Coding Club Hackathon (event 3) in its
--    alternate venue, Seminar Hall B (booking 3).
-- ---------------------------------------------------------------------

-- UPDATE the event's final approval status.
UPDATE event SET status = 'APPROVED' WHERE event_id = 3;

-- UPDATE the booking to CONFIRMED. Exercises trg_validate_confirmed_booking
-- (footfall 100 <= capacity 120, projectors/generator still free) and the
-- excl_booking_no_overlap exclusion constraint.
UPDATE booking SET status = 'CONFIRMED' WHERE booking_id = 3;

SELECT booking_id, event_id, venue_id, status FROM booking WHERE booking_id = 3;


-- ---------------------------------------------------------------------
-- 3. Cancel an event: the ECE Technical Symposium (event 2).
-- ---------------------------------------------------------------------

-- UPDATE one event row; trg_cancel_event_bookings then cancels its
-- PENDING/CONFIRMED bookings automatically (booking 7).
UPDATE event SET status = 'CANCELLED' WHERE event_id = 2;

SELECT booking_id, event_id, status AS status_after_trigger FROM booking WHERE event_id = 2;


-- ---------------------------------------------------------------------
-- 4. Mark a past booking NO_SHOW.
-- ---------------------------------------------------------------------

-- INSERT a back-filled CONFIRMED booking for a session that already took
-- place (requested_at is given explicitly, so chk_booking_lead_time holds).
INSERT INTO booking (event_id, venue_id, start_time, end_time, status, requested_at)
VALUES (4, 4, '2026-10-20 14:00+05:30', '2026-10-20 17:00+05:30', 'CONFIRMED',
        '2026-10-01 10:00+05:30')
RETURNING booking_id AS past_booking_id \gset

-- UPDATE: nobody turned up, so the confirmed booking that has already
-- ended becomes NO_SHOW. It now counts as a penalty for the organizer.
UPDATE booking
SET status = 'NO_SHOW'
WHERE booking_id = :past_booking_id
  AND status = 'CONFIRMED'
  AND end_time < now();

SELECT user_id, full_name, no_show_bookings, total_penalties
FROM requester_booking_history
WHERE user_id = 4;


-- ---------------------------------------------------------------------
-- 5. UPDATE ... FROM (a join inside an UPDATE): the faculty advisor
--    rejects the Open Mic, then every still-PENDING booking whose event
--    is REJECTED is rejected too.
-- ---------------------------------------------------------------------

UPDATE event SET status = 'REJECTED' WHERE event_id = :openmic_event_id;

-- UPDATE ... FROM joins booking to event. Exercises the booking status CHECK
-- and trg_validate_booking_request.
UPDATE booking AS b
SET status = 'REJECTED'
FROM event AS e
WHERE e.event_id = b.event_id
  AND e.status = 'REJECTED'
  AND b.status = 'PENDING';

SELECT booking_id, event_id, status FROM booking WHERE event_id = :openmic_event_id;


-- ---------------------------------------------------------------------
-- 6. Delete a DRAFT event: deleting the event removes its booking,
--    booking resources and venue preferences (ON DELETE CASCADE).
-- ---------------------------------------------------------------------

INSERT INTO event (title, category, event_type, organizer_id, expected_footfall, status)
VALUES ('Draft Study Session', 'PERSONAL', 'OTHER', 1, 15, 'DRAFT')
RETURNING event_id AS draft_event_id \gset

INSERT INTO event_venue_preference (event_id, venue_id, preference_order)
VALUES (:draft_event_id, 4, 1);

INSERT INTO booking (event_id, venue_id, start_time, end_time)
VALUES (:draft_event_id, 4, '2026-12-02 15:00+05:30', '2026-12-02 17:00+05:30')
RETURNING booking_id AS draft_booking_id \gset

INSERT INTO booking_resource (booking_id, resource_id, quantity)
VALUES (:draft_booking_id, 1, 1);

-- DELETE only if it is still a draft. CASCADE removes the child rows in
-- booking, booking_resource and event_venue_preference.
DELETE FROM event WHERE event_id = :draft_event_id AND status = 'DRAFT';

SELECT
    (SELECT COUNT(*) FROM booking                WHERE event_id   = :draft_event_id)   AS bookings_left,
    (SELECT COUNT(*) FROM booking_resource       WHERE booking_id = :draft_booking_id) AS resources_left,
    (SELECT COUNT(*) FROM event_venue_preference WHERE event_id   = :draft_event_id)   AS preferences_left;


-- ---------------------------------------------------------------------
-- 7. Statements that are EXPECTED TO FAIL.
--    Each one runs inside a SAVEPOINT; after the error we roll back to
--    the savepoint so the transaction (and this file) can continue.
--    ON_ERROR_STOP is switched off only around the failing statement.
-- ---------------------------------------------------------------------

-- 7a. Double booking: a second CONFIRMED booking for Seminar Hall A that
--     overlaps booking 1 (12 Nov, 10:00-12:00).
--     Expected: ERROR ... violates exclusion constraint "excl_booking_no_overlap"
SAVEPOINT expect_double_booking;
\set ON_ERROR_STOP off
INSERT INTO booking (event_id, venue_id, start_time, end_time, status)
VALUES (3, 2, '2026-11-12 11:00+05:30', '2026-11-12 13:00+05:30', 'CONFIRMED');
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_double_booking;

-- 7b. End before start.
--     Expected: ERROR ... violates check constraint "chk_booking_time"
SAVEPOINT expect_end_before_start;
\set ON_ERROR_STOP off
INSERT INTO booking (event_id, venue_id, start_time, end_time)
VALUES (3, 5, '2026-12-10 18:00+05:30', '2026-12-10 16:00+05:30');
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_end_before_start;

-- 7c. CLUB event without a club.
--     Expected: ERROR Organizer 3 must be a member of club <NULL>
--     The BEFORE trigger trg_validate_event_submission runs before CHECK
--     constraints, so it rejects the row first. Without the trigger,
--     chk_event_club would reject it.
SAVEPOINT expect_club_without_club;
\set ON_ERROR_STOP off
INSERT INTO event (title, category, event_type, organizer_id, department_id, expected_footfall)
VALUES ('Club event with no club', 'CLUB', 'CLUB_MEET', 3, 1, 30);
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_club_without_club;

SELECT 'all expected failures were caught; transaction still usable' AS result;


-- Undo everything above so the seed data is unchanged.
ROLLBACK;
