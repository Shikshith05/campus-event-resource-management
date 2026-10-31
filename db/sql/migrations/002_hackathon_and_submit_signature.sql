-- Safe follow-up after 001_venue_ranges_and_approver_assignments.sql.
-- Run procedures.sql first so the replacement signature exists, then run:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/migrations/002_hackathon_and_submit_signature.sql
-- This migration leaves event, booking, user, and audit rows intact.

BEGIN;

ALTER TABLE event DROP CONSTRAINT IF EXISTS event_event_type_check;
ALTER TABLE event DROP CONSTRAINT IF EXISTS chk_event_type;
ALTER TABLE event ADD CONSTRAINT chk_event_type CHECK (
    event_type IN ('GUEST_LECTURE', 'HACKATHON', 'WORKSHOP', 'SEMINAR', 'TECH_FEST',
                   'CULTURAL', 'CLUB_MEET', 'ORIENTATION', 'COMPETITION', 'SPORTS', 'OTHER')
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_department_required'
          AND conrelid = 'event'::regclass
    ) THEN
        -- NOT VALID preserves existing historical rows with NULL department
        -- while enforcing the HOD-routing requirement on new writes.
        ALTER TABLE event ADD CONSTRAINT chk_event_department_required
            CHECK (department_id IS NOT NULL) NOT VALID;
    END IF;
END $$;

-- Remove the old overload, which accepted no guest lecture details and
-- allowed submissions without a department. New requests use the
-- replacement procedure installed from procedures.sql.
DROP PROCEDURE IF EXISTS submit_booking_request(
    INT, VARCHAR(150), VARCHAR(20), VARCHAR(20), INT, INT, INT, INT,
    TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], INT, INT, VARCHAR(20)
);

REVOKE EXECUTE ON PROCEDURE submit_booking_request(
    INT, VARCHAR(150), VARCHAR(20), VARCHAR(20), INT, INT, INT, INT,
    TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], VARCHAR(150), VARCHAR(200), VARCHAR(250),
    INT, INT, VARCHAR(20)
) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE submit_booking_request(
    INT, VARCHAR(150), VARCHAR(20), VARCHAR(20), INT, INT, INT, INT,
    TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], VARCHAR(150), VARCHAR(200), VARCHAR(250),
    INT, INT, VARCHAR(20)
) TO cerms_student;

COMMIT;
