-- =====================================================================
-- CERMS - database side of the approval workflow
--
-- Run AFTER rbac.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/workflow.sql
-- Re-run it whenever rbac.sql is re-run: rbac.sql first revokes every
-- routine privilege, including the grants at the end of this file.
--
-- The approval stages live in MongoDB, but approvers need some
-- PostgreSQL data that rbac.sql hides from them:
--   * resolving approvers needs role names (role is admin-only);
--   * a club coordinator must see other students' requests for their
--     club (row-level security shows students only their own);
--   * the priority score function reads the role table;
--   * a coordinator may reject a request at their stage.
-- Instead of widening the general GRANTs, this file adds one narrow
-- SELECT policy and three SECURITY DEFINER functions. Each function
-- checks app.current_user_id itself, like find_user_for_login().
-- Used by app/lib/workflow.ts and the /api/approvals routes.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Club coordinators can see their club's requests (read only).
--    Permissive policies are OR-ed with the ones in rbac.sql, so a
--    coordinator sees their own requests PLUS their club's requests.
--    The UPDATE/DELETE policies are unchanged: they still edit only
--    their own.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS event_coordinator_select ON event;
CREATE POLICY event_coordinator_select ON event
    FOR SELECT TO cerms_student
    USING (club_id IN (SELECT cm.club_id
                       FROM club_member AS cm
                       WHERE cm.user_id = app_current_user_id()
                         AND cm.club_position = 'COORDINATOR'));

DROP POLICY IF EXISTS booking_coordinator_select ON booking;
CREATE POLICY booking_coordinator_select ON booking
    FOR SELECT TO cerms_student
    USING (EXISTS (SELECT 1
                   FROM event AS e
                   JOIN club_member AS cm ON cm.club_id = e.club_id
                   WHERE e.event_id = booking.event_id
                     AND cm.user_id = app_current_user_id()
                     AND cm.club_position = 'COORDINATOR'));


-- ---------------------------------------------------------------------
-- 2. workflow_caller_role(): the app role (STUDENT ... ADMIN) of the
--    logged-in user. Internal helper for the functions below; it is not
--    granted to anyone.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workflow_caller_role()
RETURNS VARCHAR(30)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.role_name
    FROM app_user AS u
    JOIN role AS r ON r.role_id = u.role_id
    WHERE u.user_id = app_current_user_id()
      AND u.is_active;
$$;


-- ---------------------------------------------------------------------
-- 3. workflow_context(event_id): what MongoDB needs to start a workflow.
--    Returns the event's category, type and department code (to pick the
--    template), the requester's role (for skip_if_requester_role) and one
--    user per approver_rule used in workflow_templates.json:
--      COORDINATOR_OF_EVENT_CLUB        a coordinator of the event's club
--      ADVISOR_OF_EVENT_CLUB            the club's faculty advisor
--      HOD_OF_EVENT_DEPARTMENT          the HOD of the event's department
--      ANY_FACULTY_OF_EVENT_DEPARTMENT  a faculty member of that department
--      ANY_ADMIN                        an admin
--    NULL means nobody fits that rule. Nobody approves their own request.
--    Only the organizer or staff (faculty, HOD, admin) may call it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workflow_context(p_event_id INT)
RETURNS TABLE (
    event_id                         INT,
    title                            VARCHAR(150),
    category                         VARCHAR(20),
    event_type                       VARCHAR(20),
    department_code                  VARCHAR(10),
    organizer_id                     INT,
    requester_role                   VARCHAR(30),
    coordinator_of_event_club        INT,
    advisor_of_event_club            INT,
    hod_of_event_department          INT,
    any_faculty_of_event_department  INT,
    any_admin                        INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.event_id, e.title, e.category, e.event_type, d.code, e.organizer_id,
        organizer_role.role_name,
        (SELECT cm.user_id
         FROM club_member AS cm
         JOIN app_user AS u ON u.user_id = cm.user_id
         WHERE cm.club_id = e.club_id
           AND cm.club_position = 'COORDINATOR'
           AND u.is_active
           AND u.user_id <> e.organizer_id
         ORDER BY cm.user_id
         LIMIT 1),
        (SELECT c.faculty_advisor_id
         FROM club AS c
         WHERE c.club_id = e.club_id
           AND c.faculty_advisor_id <> e.organizer_id),
        (SELECT u.user_id
         FROM app_user AS u
         JOIN role AS r ON r.role_id = u.role_id
         WHERE r.role_name = 'HOD'
           AND u.department_id = e.department_id
           AND u.is_active
           AND u.user_id <> e.organizer_id
         ORDER BY u.user_id
         LIMIT 1),
        (SELECT u.user_id
         FROM app_user AS u
         JOIN role AS r ON r.role_id = u.role_id
         WHERE r.role_name = 'FACULTY'
           AND u.department_id = e.department_id
           AND u.is_active
           AND u.user_id <> e.organizer_id
         ORDER BY u.user_id
         LIMIT 1),
        (SELECT u.user_id
         FROM app_user AS u
         JOIN role AS r ON r.role_id = u.role_id
         WHERE r.role_name = 'ADMIN'
           AND u.is_active
           AND u.user_id <> e.organizer_id
         ORDER BY u.user_id
         LIMIT 1)
    FROM event AS e
    JOIN app_user AS organizer   ON organizer.user_id = e.organizer_id
    JOIN role AS organizer_role  ON organizer_role.role_id = organizer.role_id
    LEFT JOIN department AS d    ON d.department_id = e.department_id
    WHERE e.event_id = p_event_id
      AND (e.organizer_id = app_current_user_id()
           OR workflow_caller_role() IN ('FACULTY', 'HOD', 'ADMIN'));
$$;


-- ---------------------------------------------------------------------
-- 4. approval_details(event_ids): one row per event for the approver
--    inbox: the event, its active booking and venue, and the booking's
--    priority score (calculate_booking_priority() reads the role table,
--    which approvers cannot read directly).
--    Staff get rows for any of the given events; a club coordinator only
--    for their own club's events. MongoDB decides which event_ids are
--    pending for this approver; PostgreSQL decides what they may see.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approval_details(p_event_ids INT[])
RETURNS TABLE (
    event_id           INT,
    title              VARCHAR(150),
    category           VARCHAR(20),
    event_type         VARCHAR(20),
    expected_footfall  INT,
    event_status       VARCHAR(20),
    organizer_id       INT,
    organizer_name     VARCHAR(100),
    department_code    VARCHAR(10),
    club_name          VARCHAR(100),
    booking_id         INT,
    booking_status     VARCHAR(20),
    start_time         TIMESTAMPTZ,
    end_time           TIMESTAMPTZ,
    venue_id           INT,
    venue_name         VARCHAR(100),
    venue_capacity     INT,
    priority_score     NUMERIC(6,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.event_id, e.title, e.category, e.event_type, e.expected_footfall, e.status,
        e.organizer_id, organizer.full_name, d.code, c.name,
        b.booking_id, b.status, b.start_time, b.end_time,
        v.venue_id, v.name, v.capacity,
        CASE WHEN b.booking_id IS NULL THEN NULL
             ELSE calculate_booking_priority(b.booking_id) END
    FROM event AS e
    JOIN app_user AS organizer ON organizer.user_id = e.organizer_id
    LEFT JOIN department AS d  ON d.department_id = e.department_id
    LEFT JOIN club AS c        ON c.club_id = e.club_id
    LEFT JOIN LATERAL (                       -- the event's active booking
        SELECT bk.booking_id, bk.status, bk.start_time, bk.end_time, bk.venue_id
        FROM booking AS bk
        WHERE bk.event_id = e.event_id
          AND bk.status IN ('PENDING', 'CONFIRMED')
        ORDER BY bk.start_time
        LIMIT 1
    ) AS b ON TRUE
    LEFT JOIN venue AS v ON v.venue_id = b.venue_id
    WHERE e.event_id = ANY (p_event_ids)
      AND (workflow_caller_role() IN ('FACULTY', 'HOD', 'ADMIN')
           OR EXISTS (SELECT 1
                      FROM club_member AS cm
                      WHERE cm.club_id = e.club_id
                        AND cm.user_id = app_current_user_id()
                        AND cm.club_position = 'COORDINATOR'))
    ORDER BY e.event_id;
$$;


-- ---------------------------------------------------------------------
-- 5. record_workflow_decision(event_id, 'APPROVED' | 'REJECTED')
--    Writes the FINAL outcome of an approval workflow to PostgreSQL.
--      * The event must still be PENDING_APPROVAL.
--      * Faculty, HOD and admin may record either decision; a club
--        coordinator may only reject a request of their own club.
--      * Rejecting also rejects the event's active bookings, so the
--        venue slot is freed for others (REJECTED is not a penalty).
--    MongoDB (the workflow instance) decides WHICH stage is current and
--    who is assigned to it; this function is the database's own check
--    on who may change the event at all.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_workflow_decision(p_event_id INT, p_decision VARCHAR(20))
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role VARCHAR(30) := workflow_caller_role();
    v_event       RECORD;
BEGIN
    IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'Decision must be APPROVED or REJECTED, not %', p_decision;
    END IF;

    SELECT e.event_id, e.club_id, e.status
    INTO v_event
    FROM event AS e
    WHERE e.event_id = p_event_id
    FOR UPDATE;                                  -- one decision at a time

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % does not exist', p_event_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT (v_caller_role IN ('FACULTY', 'HOD', 'ADMIN')
            OR (p_decision = 'REJECTED'
                AND EXISTS (SELECT 1
                            FROM club_member AS cm
                            WHERE cm.club_id = v_event.club_id
                              AND cm.user_id = app_current_user_id()
                              AND cm.club_position = 'COORDINATOR'))) THEN
        RAISE EXCEPTION 'User % may not record % for event %',
            app_current_user_id(), p_decision, p_event_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_event.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Event % is %, not PENDING_APPROVAL', p_event_id, v_event.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    UPDATE event SET status = p_decision WHERE event_id = p_event_id;

    IF p_decision = 'REJECTED' THEN
        UPDATE booking
        SET status = 'REJECTED'
        WHERE event_id = p_event_id
          AND status IN ('PENDING', 'CONFIRMED');
    END IF;

    RETURN p_decision;
END;
$$;


-- ---------------------------------------------------------------------
-- 6. Privileges. SECURITY DEFINER routines must not be callable by
--    PUBLIC. Granting to cerms_student also covers faculty and admin,
--    who are members of cerms_student (rbac.sql).
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION workflow_caller_role()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION workflow_context(INT)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION approval_details(INT[])                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_workflow_decision(INT, VARCHAR)      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION workflow_context(INT)                  TO cerms_student;
GRANT EXECUTE ON FUNCTION approval_details(INT[])                TO cerms_student;
GRANT EXECUTE ON FUNCTION record_workflow_decision(INT, VARCHAR) TO cerms_student;
