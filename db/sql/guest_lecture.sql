-- =====================================================================
-- CERMS - guest-lecture details for faculty requests
--
-- Run AFTER workflow.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/guest_lecture.sql
-- Re-run it whenever rbac.sql is re-run (rbac.sql revokes table
-- privileges first). Re-runnable.
--
-- POST /api/events/submit lets FACULTY, HOD and ADMIN request a guest
-- lecture. The GUEST_LECTURE workflow template requires guest_name,
-- guest_affiliation and talk_topic, which are stored in
-- guest_lecture_details in the same transaction as the event.
--
-- rbac.sql only lets students and faculty READ that table (admin has
-- everything). This file adds the minimum needed:
--   * INSERT for cerms_faculty (faculty and HOD; admin inherits it), and
--   * row-level security, so the insert is only allowed for the caller's
--     OWN guest-lecture event, and guest details are only visible when
--     their event is visible.
-- =====================================================================

GRANT INSERT ON guest_lecture_details TO cerms_faculty;

ALTER TABLE guest_lecture_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guest_details_select ON guest_lecture_details;
DROP POLICY IF EXISTS guest_details_insert ON guest_lecture_details;
DROP POLICY IF EXISTS guest_details_admin  ON guest_lecture_details;

-- Visible when the event is visible to the caller. The subquery on event
-- is itself filtered by event's row-level security (own requests for a
-- student, their club's requests for a coordinator, all for staff).
CREATE POLICY guest_details_select ON guest_lecture_details
    FOR SELECT TO cerms_student
    USING (EXISTS (SELECT 1 FROM event AS e
                   WHERE e.event_id = guest_lecture_details.event_id));

-- Faculty/HOD may add details only to their OWN guest-lecture request.
CREATE POLICY guest_details_insert ON guest_lecture_details
    FOR INSERT TO cerms_faculty
    WITH CHECK (EXISTS (SELECT 1 FROM event AS e
                        WHERE e.event_id = guest_lecture_details.event_id
                          AND e.organizer_id = app_current_user_id()
                          AND e.event_type = 'GUEST_LECTURE'));

-- Admin keeps full control (rbac.sql grants admin ALL on every table).
CREATE POLICY guest_details_admin ON guest_lecture_details
    FOR ALL TO cerms_admin
    USING (TRUE) WITH CHECK (TRUE);
