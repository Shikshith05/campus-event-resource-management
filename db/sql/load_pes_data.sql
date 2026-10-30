-- =====================================================================
-- CERMS - load real PES University data from data/pes/*.csv
--
-- Run from the REPOSITORY ROOT (the \copy paths are relative to it),
-- after a full reset (schema ... guest_lecture.sql):
--
--   psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/load_pes_data.sql
--
-- Options (psql variables):
--   -v replace=1         first delete ALL placeholder data (departments,
--                        users, clubs, venues, resources, events, bookings)
--                        so only the CSV data remains. The 5 role rows are
--                        never touched.
--   -v allow_examples=1  allow rows marked EXAMPLE (any field starting with
--                        "EXAMPLE"). Without it they are refused, so example
--                        rows cannot end up in a real load by accident.
--
-- Everything runs in ONE transaction: if any check or insert fails,
-- nothing is loaded. All problems are reported together, with the CSV
-- line number (line 1 is the header). Step-by-step guide:
-- docs/real-data-guide.md.
-- =====================================================================

\set ON_ERROR_STOP on
\if :{?replace}
  \set replace_mode true
\else
  \set replace_mode false
\endif
\if :{?allow_examples}
  \set examples_allowed true
\else
  \set examples_allowed false
\endif

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Staging tables: every column as text, plus the CSV line number
--    (the identity counts rows in file order; header = line 1).
-- ---------------------------------------------------------------------
CREATE TEMP TABLE stg_departments (row_no INT GENERATED ALWAYS AS IDENTITY, code TEXT, name TEXT) ON COMMIT DROP;
CREATE TEMP TABLE stg_users (row_no INT GENERATED ALWAYS AS IDENTITY, university_id TEXT, full_name TEXT, email TEXT,
                             role TEXT, department_code TEXT, password_hash TEXT) ON COMMIT DROP;
CREATE TEMP TABLE stg_venues (row_no INT GENERATED ALWAYS AS IDENTITY, name TEXT, venue_type TEXT, building TEXT,
                              capacity TEXT, managing_department_code TEXT) ON COMMIT DROP;
CREATE TEMP TABLE stg_resources (row_no INT GENERATED ALWAYS AS IDENTITY, name TEXT, resource_type TEXT,
                                 total_quantity TEXT) ON COMMIT DROP;
CREATE TEMP TABLE stg_clubs (row_no INT GENERATED ALWAYS AS IDENTITY, name TEXT, department_code TEXT,
                             advisor_email TEXT) ON COMMIT DROP;
CREATE TEMP TABLE stg_club_members (row_no INT GENERATED ALWAYS AS IDENTITY, club_name TEXT, member_email TEXT,
                                    club_position TEXT) ON COMMIT DROP;
CREATE TEMP TABLE load_problems (file TEXT, line INT, problem TEXT) ON COMMIT DROP;

\copy stg_departments (code, name) FROM 'data/pes/departments.csv' WITH (FORMAT csv, HEADER true)
\copy stg_users (university_id, full_name, email, role, department_code, password_hash) FROM 'data/pes/users.csv' WITH (FORMAT csv, HEADER true)
\copy stg_venues (name, venue_type, building, capacity, managing_department_code) FROM 'data/pes/venues.csv' WITH (FORMAT csv, HEADER true)
\copy stg_resources (name, resource_type, total_quantity) FROM 'data/pes/resources.csv' WITH (FORMAT csv, HEADER true)
\copy stg_clubs (name, department_code, advisor_email) FROM 'data/pes/clubs.csv' WITH (FORMAT csv, HEADER true)
\copy stg_club_members (club_name, member_email, club_position) FROM 'data/pes/club_members.csv' WITH (FORMAT csv, HEADER true)

-- Tidy the text: trim spaces, empty cell -> NULL, codes upper case,
-- emails lower case (app_user requires lowercase emails).
UPDATE stg_departments  SET code = upper(NULLIF(btrim(code), '')), name = NULLIF(btrim(name), '');
UPDATE stg_users        SET university_id = NULLIF(btrim(university_id), ''), full_name = NULLIF(btrim(full_name), ''),
                            email = lower(NULLIF(btrim(email), '')), role = upper(NULLIF(btrim(role), '')),
                            department_code = upper(NULLIF(btrim(department_code), '')),
                            password_hash = NULLIF(btrim(password_hash), '');
UPDATE stg_venues       SET name = NULLIF(btrim(name), ''), venue_type = upper(NULLIF(btrim(venue_type), '')),
                            building = NULLIF(btrim(building), ''), capacity = NULLIF(btrim(capacity), ''),
                            managing_department_code = upper(NULLIF(btrim(managing_department_code), ''));
UPDATE stg_resources    SET name = NULLIF(btrim(name), ''), resource_type = upper(NULLIF(btrim(resource_type), '')),
                            total_quantity = NULLIF(btrim(total_quantity), '');
UPDATE stg_clubs        SET name = NULLIF(btrim(name), ''), department_code = upper(NULLIF(btrim(department_code), '')),
                            advisor_email = lower(NULLIF(btrim(advisor_email), ''));
UPDATE stg_club_members SET club_name = NULLIF(btrim(club_name), ''), member_email = lower(NULLIF(btrim(member_email), '')),
                            club_position = upper(NULLIF(btrim(club_position), ''));

SELECT 'rows read' AS step,
       (SELECT count(*) FROM stg_departments)  AS departments,
       (SELECT count(*) FROM stg_users)        AS users,
       (SELECT count(*) FROM stg_venues)       AS venues,
       (SELECT count(*) FROM stg_resources)    AS resources,
       (SELECT count(*) FROM stg_clubs)        AS clubs,
       (SELECT count(*) FROM stg_club_members) AS club_members;

-- ---------------------------------------------------------------------
-- 2. Optional: remove the placeholder data (roles stay).
-- ---------------------------------------------------------------------
\if :replace_mode
  \echo 'replace=1: deleting placeholder departments, users, clubs, venues, resources, events and bookings (roles are kept)'
  TRUNCATE booking_status_history, booking_conflict_log, booking_resource, booking,
           event_venue_preference, guest_lecture_details, event,
           club_member, club, resource, venue, app_user, department
  RESTART IDENTITY;
\endif

-- ---------------------------------------------------------------------
-- 3. Checks. Every problem is collected first, so one run reports all
--    of them. "Known" means already in the database OR in the CSVs.
-- ---------------------------------------------------------------------

-- 3a. EXAMPLE rows (refused unless -v allow_examples=1).
INSERT INTO load_problems
SELECT file, row_no + 1, 'row is marked EXAMPLE: delete it, or run with -v allow_examples=1 for a test load'
FROM (
    SELECT 'departments.csv' AS file, row_no, concat_ws('|', code, name) AS r FROM stg_departments
    UNION ALL SELECT 'users.csv', row_no, concat_ws('|', university_id, full_name, email) FROM stg_users
    UNION ALL SELECT 'venues.csv', row_no, concat_ws('|', name, building) FROM stg_venues
    UNION ALL SELECT 'resources.csv', row_no, name FROM stg_resources
    UNION ALL SELECT 'clubs.csv', row_no, name FROM stg_clubs
    UNION ALL SELECT 'club_members.csv', row_no, club_name FROM stg_club_members
) AS all_rows
WHERE NOT :examples_allowed
  AND ('|' || r) ~* '\|EXAMPLE';

-- 3b. departments.csv
INSERT INTO load_problems
SELECT 'departments.csv', row_no + 1, problem FROM (
    SELECT row_no, 'code and name are required' AS problem FROM stg_departments WHERE code IS NULL OR name IS NULL
    UNION ALL SELECT row_no, format('code "%s" is longer than 10 characters', code) FROM stg_departments WHERE length(code) > 10
    UNION ALL SELECT row_no, format('code "%s" appears more than once in the file', code) FROM stg_departments s
              WHERE (SELECT count(*) FROM stg_departments t WHERE t.code = s.code) > 1
    UNION ALL SELECT row_no, format('name "%s" appears more than once in the file', name) FROM stg_departments s
              WHERE (SELECT count(*) FROM stg_departments t WHERE t.name = s.name) > 1
    UNION ALL SELECT row_no, format('department "%s" / "%s" already exists in the database', code, name) FROM stg_departments s
              WHERE EXISTS (SELECT 1 FROM department d WHERE d.code = s.code OR d.name = s.name)
) AS p;

-- 3c. users.csv
INSERT INTO load_problems
SELECT 'users.csv', row_no + 1, problem FROM (
    SELECT row_no, 'university_id, full_name, email, role and password_hash are required' AS problem FROM stg_users
     WHERE university_id IS NULL OR full_name IS NULL OR email IS NULL OR role IS NULL OR password_hash IS NULL
    UNION ALL SELECT row_no, format('email "%s" is not a valid email address', email) FROM stg_users WHERE email !~ '^[^@\s]+@[^@\s]+$'
    UNION ALL SELECT row_no, format('unknown role "%s" (use STUDENT, CLUB_COORDINATOR, FACULTY, HOD or ADMIN)', role) FROM stg_users s
              WHERE role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role r WHERE r.role_name = s.role)
    UNION ALL SELECT row_no, format('unknown department_code "%s"', department_code) FROM stg_users s
              WHERE department_code IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM department d WHERE d.code = s.department_code)
                AND NOT EXISTS (SELECT 1 FROM stg_departments d WHERE d.code = s.department_code)
    UNION ALL SELECT row_no, 'department_code is required for every role except ADMIN' FROM stg_users
              WHERE department_code IS NULL AND role IS DISTINCT FROM 'ADMIN'
    UNION ALL SELECT row_no, 'password_hash must be a bcrypt hash (see docs/real-data-guide.md, "Passwords")' FROM stg_users
              WHERE password_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
    UNION ALL SELECT row_no, format('university_id "%s" appears more than once in the file', university_id) FROM stg_users s
              WHERE (SELECT count(*) FROM stg_users t WHERE t.university_id = s.university_id) > 1
    UNION ALL SELECT row_no, format('email "%s" appears more than once in the file', email) FROM stg_users s
              WHERE (SELECT count(*) FROM stg_users t WHERE t.email = s.email) > 1
    UNION ALL SELECT row_no, format('user "%s" / "%s" already exists in the database', university_id, email) FROM stg_users s
              WHERE EXISTS (SELECT 1 FROM app_user u WHERE u.university_id = s.university_id OR u.email = s.email)
) AS p;

-- 3d. venues.csv
INSERT INTO load_problems
SELECT 'venues.csv', row_no + 1, problem FROM (
    SELECT row_no, 'name, venue_type and capacity are required' AS problem FROM stg_venues
     WHERE name IS NULL OR venue_type IS NULL OR capacity IS NULL
    UNION ALL SELECT row_no, format('unknown venue_type "%s" (use AUDITORIUM, SEMINAR_HALL, CLASSROOM, LAB, OPEN_AIR or OTHER)', venue_type)
              FROM stg_venues WHERE venue_type NOT IN ('AUDITORIUM', 'SEMINAR_HALL', 'CLASSROOM', 'LAB', 'OPEN_AIR', 'OTHER')
    -- CASE: only cast after the text is known to be digits (SQL does not
    -- promise to evaluate OR from left to right).
    UNION ALL SELECT row_no, format('capacity "%s" must be a whole number greater than 0', capacity) FROM stg_venues
              WHERE CASE WHEN capacity ~ '^[0-9]{1,7}$' THEN capacity::INT = 0 ELSE capacity IS NOT NULL END
    UNION ALL SELECT row_no, format('unknown managing_department_code "%s"', managing_department_code) FROM stg_venues s
              WHERE managing_department_code IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM department d WHERE d.code = s.managing_department_code)
                AND NOT EXISTS (SELECT 1 FROM stg_departments d WHERE d.code = s.managing_department_code)
    UNION ALL SELECT row_no, format('name "%s" appears more than once in the file', name) FROM stg_venues s
              WHERE (SELECT count(*) FROM stg_venues t WHERE t.name = s.name) > 1
    UNION ALL SELECT row_no, format('venue "%s" already exists in the database', name) FROM stg_venues s
              WHERE EXISTS (SELECT 1 FROM venue v WHERE v.name = s.name)
) AS p;

-- 3e. resources.csv
INSERT INTO load_problems
SELECT 'resources.csv', row_no + 1, problem FROM (
    SELECT row_no, 'name, resource_type and total_quantity are required' AS problem FROM stg_resources
     WHERE name IS NULL OR resource_type IS NULL OR total_quantity IS NULL
    UNION ALL SELECT row_no, format('unknown resource_type "%s" (use AV, FURNITURE, POWER, DECOR or OTHER)', resource_type)
              FROM stg_resources WHERE resource_type NOT IN ('AV', 'FURNITURE', 'POWER', 'DECOR', 'OTHER')
    UNION ALL SELECT row_no, format('total_quantity "%s" must be a whole number, 0 or more', total_quantity) FROM stg_resources
              WHERE total_quantity !~ '^[0-9]{1,7}$'
    UNION ALL SELECT row_no, format('name "%s" appears more than once in the file', name) FROM stg_resources s
              WHERE (SELECT count(*) FROM stg_resources t WHERE t.name = s.name) > 1
    UNION ALL SELECT row_no, format('resource "%s" already exists in the database', name) FROM stg_resources s
              WHERE EXISTS (SELECT 1 FROM resource r WHERE r.name = s.name)
) AS p;

-- 3f. clubs.csv (the advisor must be an active FACULTY/HOD/ADMIN user,
-- the same rule as trigger trg_validate_club_advisor).
INSERT INTO load_problems
SELECT 'clubs.csv', row_no + 1, problem FROM (
    SELECT row_no, 'name and advisor_email are required' AS problem FROM stg_clubs WHERE name IS NULL OR advisor_email IS NULL
    UNION ALL SELECT row_no, format('unknown department_code "%s"', department_code) FROM stg_clubs s
              WHERE department_code IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM department d WHERE d.code = s.department_code)
                AND NOT EXISTS (SELECT 1 FROM stg_departments d WHERE d.code = s.department_code)
    UNION ALL SELECT row_no, format('advisor_email "%s" is not a FACULTY, HOD or ADMIN user', advisor_email) FROM stg_clubs s
              WHERE advisor_email IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM app_user u JOIN role r ON r.role_id = u.role_id
                                WHERE u.email = s.advisor_email AND u.is_active AND r.role_name IN ('FACULTY', 'HOD', 'ADMIN'))
                AND NOT EXISTS (SELECT 1 FROM stg_users u
                                WHERE u.email = s.advisor_email AND u.role IN ('FACULTY', 'HOD', 'ADMIN'))
    UNION ALL SELECT row_no, format('name "%s" appears more than once in the file', name) FROM stg_clubs s
              WHERE (SELECT count(*) FROM stg_clubs t WHERE t.name = s.name) > 1
    UNION ALL SELECT row_no, format('club "%s" already exists in the database', name) FROM stg_clubs s
              WHERE EXISTS (SELECT 1 FROM club c WHERE c.name = s.name)
) AS p;

-- 3g. club_members.csv
INSERT INTO load_problems
SELECT 'club_members.csv', row_no + 1, problem FROM (
    SELECT row_no, 'club_name and member_email are required' AS problem FROM stg_club_members
     WHERE club_name IS NULL OR member_email IS NULL
    UNION ALL SELECT row_no, format('club_position "%s" must be MEMBER or COORDINATOR', club_position) FROM stg_club_members
              WHERE club_position IS NOT NULL AND club_position NOT IN ('MEMBER', 'COORDINATOR')
    UNION ALL SELECT row_no, format('unknown club "%s"', club_name) FROM stg_club_members s
              WHERE club_name IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM club c WHERE c.name = s.club_name)
                AND NOT EXISTS (SELECT 1 FROM stg_clubs c WHERE c.name = s.club_name)
    UNION ALL SELECT row_no, format('unknown member_email "%s"', member_email) FROM stg_club_members s
              WHERE member_email IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.email = s.member_email)
                AND NOT EXISTS (SELECT 1 FROM stg_users u WHERE u.email = s.member_email)
    UNION ALL SELECT row_no, format('"%s" is listed twice for club "%s"', member_email, club_name) FROM stg_club_members s
              WHERE (SELECT count(*) FROM stg_club_members t
                     WHERE t.club_name = s.club_name AND t.member_email = s.member_email) > 1
    UNION ALL SELECT row_no, format('"%s" is already a member of "%s"', member_email, club_name) FROM stg_club_members s
              WHERE EXISTS (SELECT 1 FROM club_member cm JOIN club c ON c.club_id = cm.club_id
                            JOIN app_user u ON u.user_id = cm.user_id
                            WHERE c.name = s.club_name AND u.email = s.member_email)
) AS p;

-- Stop here if anything is wrong; nothing has been inserted yet, and
-- the error rolls the whole transaction back.
DO $$
DECLARE
    v_report TEXT;
BEGIN
    SELECT string_agg(format('  %s line %s: %s', file, line, problem), E'\n' ORDER BY file, line, problem)
    INTO v_report
    FROM load_problems;

    IF v_report IS NOT NULL THEN
        RAISE EXCEPTION E'PES data NOT loaded (nothing was changed). Fix these rows:\n%', v_report;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Insert, in dependency order, with code -> id lookups. The tables'
--    own constraints and triggers still run on every row.
-- ---------------------------------------------------------------------
INSERT INTO department (code, name)
SELECT code, name FROM stg_departments ORDER BY row_no;

INSERT INTO app_user (university_id, full_name, email, password_hash, role_id, department_id)
SELECT s.university_id, s.full_name, s.email, s.password_hash, r.role_id, d.department_id
FROM stg_users AS s
JOIN role AS r ON r.role_name = s.role
LEFT JOIN department AS d ON d.code = s.department_code
ORDER BY s.row_no;

INSERT INTO venue (name, venue_type, building, capacity, department_id)
SELECT s.name, s.venue_type, s.building, s.capacity::INT, d.department_id
FROM stg_venues AS s
LEFT JOIN department AS d ON d.code = s.managing_department_code
ORDER BY s.row_no;

INSERT INTO resource (name, resource_type, total_quantity)
SELECT name, resource_type, total_quantity::INT FROM stg_resources ORDER BY row_no;

INSERT INTO club (name, department_id, faculty_advisor_id)
SELECT s.name, d.department_id, u.user_id
FROM stg_clubs AS s
LEFT JOIN department AS d ON d.code = s.department_code
JOIN app_user AS u ON u.email = s.advisor_email
ORDER BY s.row_no;

INSERT INTO club_member (club_id, user_id, club_position)
SELECT c.club_id, u.user_id, COALESCE(s.club_position, 'MEMBER')
FROM stg_club_members AS s
JOIN club AS c ON c.name = s.club_name
JOIN app_user AS u ON u.email = s.member_email
ORDER BY s.row_no;

SELECT 'loaded' AS step,
       (SELECT count(*) FROM stg_departments)  AS departments,
       (SELECT count(*) FROM stg_users)        AS users,
       (SELECT count(*) FROM stg_venues)       AS venues,
       (SELECT count(*) FROM stg_resources)    AS resources,
       (SELECT count(*) FROM stg_clubs)        AS clubs,
       (SELECT count(*) FROM stg_club_members) AS club_members;

COMMIT;
