-- =====================================================================
-- CERMS - sample data
--
-- PLACEHOLDER: replace after campus survey
-- Names, capacities, quantities, people and dates below are made up.
-- Only the ROLE rows are real design data.
--
-- Run AFTER schema.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/seed.sql
--
-- IDs are written explicitly so the foreign keys are easy to follow.
-- The identity counters are moved past them at the end of the file.
-- Re-runnable: the TRUNCATE below wipes all CERMS data first.
-- =====================================================================

BEGIN;

TRUNCATE booking_conflict_log, booking_resource, booking, event,
         resource, venue, club_member, club, app_user, role, department
RESTART IDENTITY;


-- ---------------------------------------------------------------------
-- role  (CORE DATA - not a placeholder; levels may be tuned later)
-- ---------------------------------------------------------------------
INSERT INTO role (role_id, role_name, hierarchy_level, description) VALUES
    (1, 'STUDENT',          1, 'Can submit personal and club event requests'),
    (2, 'CLUB_COORDINATOR', 2, 'Leads a club; first approver for club events'),
    (3, 'FACULTY',          3, 'Faculty member / club faculty advisor'),
    (4, 'HOD',              4, 'Head of Department; approves department-level events'),
    (5, 'ADMIN',            5, 'Admin office / Dean; final approval and overrides');


-- ---------------------------------------------------------------------
-- department
-- PLACEHOLDER: replace after campus survey
-- ---------------------------------------------------------------------
INSERT INTO department (department_id, code, name) VALUES
    (1, 'CSE',  'Computer Science and Engineering'),
    (2, 'ECE',  'Electronics and Communication Engineering'),
    (3, 'AIML', 'Computer Science and Engineering (AI and ML)'),
    (4, 'EEE',  'Electrical and Electronics Engineering'),
    (5, 'ME',   'Mechanical Engineering');


-- ---------------------------------------------------------------------
-- app_user
-- PLACEHOLDER: replace after campus survey (fake people, fake hashes)
-- ---------------------------------------------------------------------
INSERT INTO app_user (user_id, university_id, full_name, email, password_hash, role_id, department_id) VALUES
    (1, 'STU001', 'Student One',     'student.one@campus.example',     'PLACEHOLDER_HASH', 1, 1),
    (2, 'STU002', 'Student Two',     'student.two@campus.example',     'PLACEHOLDER_HASH', 1, 2),
    (3, 'STU003', 'Coordinator One', 'coordinator.one@campus.example', 'PLACEHOLDER_HASH', 2, 1),
    (4, 'STU004', 'Coordinator Two', 'coordinator.two@campus.example', 'PLACEHOLDER_HASH', 2, 2),
    (5, 'FAC001', 'Faculty One',     'faculty.one@campus.example',     'PLACEHOLDER_HASH', 3, 1),
    (6, 'FAC002', 'Faculty Two',     'faculty.two@campus.example',     'PLACEHOLDER_HASH', 3, 2),
    (7, 'FAC003', 'HOD One',         'hod.cse@campus.example',         'PLACEHOLDER_HASH', 4, 1),
    (8, 'FAC004', 'HOD Two',         'hod.ece@campus.example',         'PLACEHOLDER_HASH', 4, 2),
    (9, 'ADM001', 'Admin One',       'admin.one@campus.example',       'PLACEHOLDER_HASH', 5, NULL);


-- ---------------------------------------------------------------------
-- club
-- PLACEHOLDER: replace after campus survey
-- ---------------------------------------------------------------------
INSERT INTO club (club_id, name, description, department_id, faculty_advisor_id) VALUES
    (1, 'Coding Club',      'Placeholder description', 1,    5),
    (2, 'Robotics Club',    'Placeholder description', 2,    6),
    (3, 'Music Club',       'Placeholder description', NULL, 6),
    (4, 'Photography Club', 'Placeholder description', NULL, 5),
    (5, 'Drama Club',       'Placeholder description', NULL, 6);


-- ---------------------------------------------------------------------
-- club_member
-- PLACEHOLDER: replace after campus survey
-- ---------------------------------------------------------------------
INSERT INTO club_member (club_id, user_id, club_position, joined_on) VALUES
    (1, 3, 'COORDINATOR', '2025-08-01'),
    (1, 1, 'MEMBER',      '2025-08-10'),
    (2, 4, 'COORDINATOR', '2025-08-01'),
    (2, 2, 'MEMBER',      '2025-09-01'),
    (3, 1, 'MEMBER',      '2026-01-15'),
    (3, 2, 'MEMBER',      '2026-01-15');


-- ---------------------------------------------------------------------
-- venue
-- PLACEHOLDER: replace after campus survey (names and capacities)
-- ---------------------------------------------------------------------
INSERT INTO venue (venue_id, name, venue_type, building, capacity, department_id) VALUES
    (1, 'Auditorium 1',     'AUDITORIUM',   'Main Block',   500, NULL),
    (2, 'Seminar Hall A',   'SEMINAR_HALL', 'Block A',      150, 1),
    (3, 'Seminar Hall B',   'SEMINAR_HALL', 'Block B',      120, 2),
    (4, 'Classroom 101',    'CLASSROOM',    'Block A',       60, 1),
    (5, 'Open Air Theatre', 'OPEN_AIR',     'Central Lawn', 800, NULL);


-- ---------------------------------------------------------------------
-- resource
-- PLACEHOLDER: replace after campus survey (quantities)
-- ---------------------------------------------------------------------
INSERT INTO resource (resource_id, name, resource_type, total_quantity) VALUES
    (1, 'Projector',           'AV',         10),
    (2, 'Wireless Microphone', 'AV',         20),
    (3, 'PA System',           'AV',          4),
    (4, 'Chair',               'FURNITURE', 500),
    (5, 'Generator',           'POWER',       2);


-- ---------------------------------------------------------------------
-- event
-- PLACEHOLDER: replace after campus survey
-- Story behind the rows:
--   1 vs 3 : both wanted Seminar Hall A on 12 Nov -> see conflict log
--   4, 5, 6: past events, used for history (completed / no-show / cancelled)
-- ---------------------------------------------------------------------
INSERT INTO event (event_id, title, description, category, event_type, organizer_id,
                   department_id, club_id, expected_footfall, status, created_at) VALUES
    (1, 'Guest Lecture (placeholder topic)', 'Placeholder', 'ACADEMIC',   'GUEST_LECTURE', 5, 1, NULL, 120, 'APPROVED',         '2026-10-01 10:00+05:30'),
    (2, 'ECE Technical Symposium',           'Placeholder', 'DEPARTMENT', 'SEMINAR',       6, 2, NULL, 300, 'PENDING_APPROVAL', '2026-10-10 10:00+05:30'),
    (3, 'Coding Club Hackathon',             'Placeholder', 'CLUB',       'COMPETITION',   1, 1, 1,    100, 'PENDING_APPROVAL', '2026-10-05 09:00+05:30'),
    (4, 'Robotics Workshop',                 'Placeholder', 'CLUB',       'WORKSHOP',      4, 2, 2,     50, 'APPROVED',         '2026-09-01 11:00+05:30'),
    (5, 'Study Group Session',               'Placeholder', 'PERSONAL',   'OTHER',         1, NULL, NULL, 20, 'APPROVED',       '2026-09-18 12:00+05:30'),
    (6, 'Coding Club Meetup',                'Placeholder', 'CLUB',       'CLUB_MEET',     3, 1, 1,     40, 'CANCELLED',        '2026-09-10 10:00+05:30');


-- ---------------------------------------------------------------------
-- booking
-- PLACEHOLDER: replace after campus survey
-- ---------------------------------------------------------------------
INSERT INTO booking (booking_id, event_id, venue_id, start_time, end_time, status, requested_at) VALUES
    -- Clash on Seminar Hall A, 12 Nov: booking 1 won, booking 2 lost
    (1, 1, 2, '2026-11-12 10:00+05:30', '2026-11-12 12:00+05:30', 'CONFIRMED', '2026-10-01 10:00+05:30'),
    (2, 3, 2, '2026-11-12 09:00+05:30', '2026-11-12 17:00+05:30', 'REJECTED',  '2026-10-05 09:00+05:30'),
    -- The hackathon accepted the suggested alternate (Seminar Hall B)
    (3, 3, 3, '2026-11-12 09:00+05:30', '2026-11-12 17:00+05:30', 'PENDING',   '2026-10-05 09:30+05:30'),
    -- Past bookings (history used by the cancellation / no-show penalty)
    (4, 4, 4, '2026-09-15 14:00+05:30', '2026-09-15 17:00+05:30', 'COMPLETED', '2026-09-01 11:00+05:30'),
    (5, 5, 4, '2026-09-20 16:00+05:30', '2026-09-20 18:00+05:30', 'NO_SHOW',   '2026-09-18 12:00+05:30'),
    (6, 6, 2, '2026-09-25 15:00+05:30', '2026-09-25 17:00+05:30', 'CANCELLED', '2026-09-10 10:00+05:30'),
    -- Upcoming department event, still going through approval
    (7, 2, 1, '2026-11-20 09:00+05:30', '2026-11-20 16:00+05:30', 'PENDING',   '2026-10-10 10:00+05:30');


-- ---------------------------------------------------------------------
-- booking_resource
-- PLACEHOLDER: replace after campus survey
-- ---------------------------------------------------------------------
INSERT INTO booking_resource (booking_id, resource_id, quantity) VALUES
    (1, 1,   1),    -- guest lecture: 1 projector
    (1, 2,   2),    --                2 mics
    (2, 1,   2),    -- hackathon (rejected booking): 2 projectors
    (2, 5,   1),    --                               1 generator
    (3, 1,   2),    -- hackathon (alternate venue): same needs
    (3, 5,   1),
    (4, 1,   1),    -- robotics workshop: 1 projector
    (7, 2,   4),    -- symposium: 4 mics
    (7, 3,   1),    --            1 PA system
    (7, 4, 100);    --            100 extra chairs


-- ---------------------------------------------------------------------
-- booking_conflict_log
-- PLACEHOLDER: scores use the placeholder formula in
-- docs/schema-explanation.md (section "Priority score"):
--   booking 1: ACADEMIC 40 + FACULTY 15 + lead time 15 - penalty 0 = 70
--   booking 2: CLUB     20 + STUDENT  5 + lead time 15 - penalty 5 = 35
--   (the student had 1 no-show: booking 5)
-- ---------------------------------------------------------------------
INSERT INTO booking_conflict_log (conflict_id, winning_booking_id, losing_booking_id,
                                  winner_score, loser_score, reason, decided_by, decided_at) VALUES
    (1, 1, 2, 70.00, 35.00,
     'Seminar Hall A, 12 Nov: ACADEMIC beats CLUB; FACULTY outranks STUDENT; loser had 1 no-show. Alternate suggested: Seminar Hall B.',
     NULL, '2026-10-05 09:00:05+05:30');


-- ---------------------------------------------------------------------
-- Move every identity counter past the explicit IDs used above, so the
-- next INSERT without an ID does not collide.
-- ---------------------------------------------------------------------
SELECT setval(pg_get_serial_sequence('role',                 'role_id'),       (SELECT MAX(role_id)       FROM role));
SELECT setval(pg_get_serial_sequence('department',           'department_id'), (SELECT MAX(department_id) FROM department));
SELECT setval(pg_get_serial_sequence('app_user',             'user_id'),       (SELECT MAX(user_id)       FROM app_user));
SELECT setval(pg_get_serial_sequence('club',                 'club_id'),       (SELECT MAX(club_id)       FROM club));
SELECT setval(pg_get_serial_sequence('venue',                'venue_id'),      (SELECT MAX(venue_id)      FROM venue));
SELECT setval(pg_get_serial_sequence('resource',             'resource_id'),   (SELECT MAX(resource_id)   FROM resource));
SELECT setval(pg_get_serial_sequence('event',                'event_id'),      (SELECT MAX(event_id)      FROM event));
SELECT setval(pg_get_serial_sequence('booking',              'booking_id'),    (SELECT MAX(booking_id)    FROM booking));
SELECT setval(pg_get_serial_sequence('booking_conflict_log', 'conflict_id'),   (SELECT MAX(conflict_id)   FROM booking_conflict_log));

COMMIT;
