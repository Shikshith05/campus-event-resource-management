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
--   * workflow approvers need narrowly scoped event and inbox access;
--   * the priority score function reads the role table;
--   * a coordinator may reject a request at their stage.
-- Instead of widening the general GRANTs, this file adds narrow
-- policies and SECURITY DEFINER functions. Each function
-- checks app.current_user_id itself, like find_user_for_login().
-- Used by app/lib/workflow.ts and the /api/approvals routes.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Workflow-only approvers can read event status. Full event details
--    for assigned approvals come through approval_details().
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS event_workflow_approver_select ON event;
CREATE POLICY event_workflow_approver_select ON event
    FOR SELECT TO cerms_workflow_approver
    USING (TRUE);

-- Student coordinators retain their existing request-management visibility.
-- This read access does not grant approval rights; only FACULTY/HOD and
-- assigned WORKFLOW_APPROVER accounts pass the approval route and SQL checks.
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
-- 2. Validate designation assignments against account role and scope.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_workflow_approver_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_role VARCHAR(30);
    v_department_id INT;
    v_active BOOLEAN;
BEGIN
    SELECT r.role_name, u.department_id, u.is_active
    INTO v_role, v_department_id, v_active
    FROM app_user AS u
    JOIN role AS r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.user_id;

    IF NOT FOUND OR NOT v_active THEN
        RAISE EXCEPTION 'Workflow approver assignment requires an active account';
    END IF;

    IF NEW.approver_role = 'CLUB_COORDINATOR' AND v_role NOT IN ('FACULTY', 'HOD') THEN
        RAISE EXCEPTION 'Club Coordinator assignments must use an active faculty or HOD account';
    ELSIF NEW.approver_role = 'CLUB_COORDINATOR' AND NEW.club_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM club AS c
        WHERE c.club_id = NEW.club_id AND c.faculty_advisor_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'A club event Club Coordinator must be the club faculty advisor';
    ELSIF NEW.approver_role = 'HOD'
          AND (v_role <> 'HOD' OR v_department_id IS DISTINCT FROM NEW.department_id) THEN
        RAISE EXCEPTION 'HOD assignments must match the account department';
    ELSIF NEW.approver_role IN ('DEAN_OF_STUDENT_AFFAIRS', 'VICE_CHANCELLOR')
          AND v_role <> 'WORKFLOW_APPROVER' THEN
        RAISE EXCEPTION '% assignments require a WORKFLOW_APPROVER account', NEW.approver_role;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_workflow_approver_assignment ON workflow_approver_assignment;
CREATE TRIGGER trg_validate_workflow_approver_assignment
BEFORE INSERT OR UPDATE OF user_id, approver_role, department_id, club_id
ON workflow_approver_assignment
FOR EACH ROW EXECUTE FUNCTION validate_workflow_approver_assignment();


-- ---------------------------------------------------------------------
-- 3. workflow_caller_role(): the app role of the
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
-- 4. workflow_context(event_id): event facts and explicit role assignees.
--    A missing assignment is returned as NULL and reported as an
--    actionable error; no approval stage is skipped.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS workflow_context(INT);
CREATE OR REPLACE FUNCTION workflow_context(p_event_id INT)
RETURNS TABLE (
    event_id                         INT,
    title                            VARCHAR(150),
    category                         VARCHAR(20),
    event_type                       VARCHAR(20),
    department_code                  VARCHAR(10),
    organizer_id                     INT,
    requester_role                   VARCHAR(30),
    club_coordinator_user_id          INT,
    hod_user_id                       INT,
    dean_of_student_affairs_user_id   INT,
    vice_chancellor_user_id           INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.event_id, e.title, e.category, e.event_type, d.code, e.organizer_id,
        organizer_role.role_name,
        (SELECT a.user_id
         FROM workflow_approver_assignment AS a
         JOIN app_user AS u ON u.user_id = a.user_id AND u.is_active
         JOIN role AS r ON r.role_id = u.role_id AND r.role_name IN ('FACULTY', 'HOD')
         WHERE a.approver_role = 'CLUB_COORDINATOR'
           AND ((e.club_id IS NOT NULL AND a.club_id = e.club_id)
             OR (e.club_id IS NULL AND a.club_id IS NULL
                 AND (a.department_id = e.department_id OR a.department_id IS NULL)))
         ORDER BY (a.department_id IS NOT NULL) DESC
         LIMIT 1),
        (SELECT a.user_id
         FROM workflow_approver_assignment AS a
         JOIN app_user AS u ON u.user_id = a.user_id AND u.is_active
         JOIN role AS r ON r.role_id = u.role_id AND r.role_name = 'HOD'
         WHERE a.approver_role = 'HOD'
           AND a.department_id = e.department_id
         LIMIT 1),
        (SELECT a.user_id
         FROM workflow_approver_assignment AS a
         JOIN app_user AS u ON u.user_id = a.user_id AND u.is_active
         JOIN role AS r ON r.role_id = u.role_id AND r.role_name = 'WORKFLOW_APPROVER'
         WHERE a.approver_role = 'DEAN_OF_STUDENT_AFFAIRS'
         LIMIT 1),
        (SELECT a.user_id
         FROM workflow_approver_assignment AS a
         JOIN app_user AS u ON u.user_id = a.user_id AND u.is_active
         JOIN role AS r ON r.role_id = u.role_id AND r.role_name = 'WORKFLOW_APPROVER'
         WHERE a.approver_role = 'VICE_CHANCELLOR'
         LIMIT 1)
    FROM event AS e
    JOIN app_user AS organizer   ON organizer.user_id = e.organizer_id
    JOIN role AS organizer_role  ON organizer_role.role_id = organizer.role_id
    LEFT JOIN department AS d    ON d.department_id = e.department_id
    WHERE e.event_id = p_event_id
      AND (e.organizer_id = app_current_user_id()
           OR workflow_caller_role() IN ('FACULTY', 'HOD', 'ADMIN', 'WORKFLOW_APPROVER'));
$$;


-- ---------------------------------------------------------------------
-- 5. approval_details(event_ids): one row per event for the approver
--    inbox: the event, its active booking and venue, and the booking's
--    priority score (calculate_booking_priority() reads the role table,
--    which approvers cannot read directly).
--    Staff get rows for any of the given events. A workflow-only user
--    sees rows only when their designation maps to the event.
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
      AND (
          workflow_caller_role() IN ('FACULTY', 'HOD', 'ADMIN')
          OR EXISTS (
              SELECT 1
              FROM workflow_approver_assignment AS a
              WHERE a.user_id = app_current_user_id()
                AND (
                    (
                        a.approver_role = 'CLUB_COORDINATOR'
                        AND (
                            (e.club_id IS NOT NULL AND a.club_id = e.club_id)
                            OR (
                                e.club_id IS NULL
                                AND a.club_id IS NULL
                                AND (a.department_id = e.department_id OR a.department_id IS NULL)
                            )
                        )
                    )
                    OR (a.approver_role = 'HOD' AND a.department_id = e.department_id)
                    OR (
                        a.approver_role IN ('DEAN_OF_STUDENT_AFFAIRS', 'VICE_CHANCELLOR')
                        AND a.department_id IS NULL
                        AND a.club_id IS NULL
                    )
                )
          )
      )
    ORDER BY e.event_id;
$$;


-- ---------------------------------------------------------------------
-- 6. Assert the current account still holds the assignment for this
--    stage. Called for intermediate as well as terminal decisions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_workflow_stage_assignment(
    p_event_id INT, p_stage_no INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event RECORD;
    v_role VARCHAR(30);
    v_assigned BOOLEAN := FALSE;
BEGIN
    SELECT e.event_id, e.club_id, e.department_id, e.organizer_id
    INTO v_event
    FROM event AS e
    WHERE e.event_id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % does not exist', p_event_id
            USING ERRCODE = 'no_data_found';
    END IF;
    IF v_event.organizer_id = app_current_user_id() THEN
        RAISE EXCEPTION 'A requester cannot approve or reject their own event'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_role := workflow_caller_role();
    SELECT CASE p_stage_no
        WHEN 1 THEN EXISTS (
            SELECT 1 FROM workflow_approver_assignment AS a
            WHERE a.user_id = app_current_user_id()
              AND a.approver_role = 'CLUB_COORDINATOR'
              AND v_role IN ('FACULTY', 'HOD')
              AND ((v_event.club_id IS NOT NULL AND a.club_id = v_event.club_id)
                OR (v_event.club_id IS NULL AND a.club_id IS NULL
                    AND (a.department_id = v_event.department_id OR a.department_id IS NULL)))
        )
        WHEN 2 THEN EXISTS (
            SELECT 1 FROM workflow_approver_assignment AS a
            WHERE a.user_id = app_current_user_id()
              AND a.approver_role = 'HOD'
              AND v_role = 'HOD'
              AND a.department_id = v_event.department_id
        )
        WHEN 3 THEN EXISTS (
            SELECT 1 FROM workflow_approver_assignment AS a
            WHERE a.user_id = app_current_user_id()
              AND a.approver_role = 'DEAN_OF_STUDENT_AFFAIRS'
              AND v_role = 'WORKFLOW_APPROVER'
              AND a.department_id IS NULL AND a.club_id IS NULL
        )
        WHEN 4 THEN EXISTS (
            SELECT 1 FROM workflow_approver_assignment AS a
            WHERE a.user_id = app_current_user_id()
              AND a.approver_role = 'VICE_CHANCELLOR'
              AND v_role = 'WORKFLOW_APPROVER'
              AND a.department_id IS NULL AND a.club_id IS NULL
        )
        ELSE FALSE
    END INTO v_assigned;

    IF NOT COALESCE(v_assigned, FALSE) THEN
        RAISE EXCEPTION 'User % has no active assignment for approval stage % of event %',
            app_current_user_id(), p_stage_no, p_event_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;


-- ---------------------------------------------------------------------
-- 7. record_workflow_decision(event_id, stage_no, decision)
--    Writes the FINAL outcome of an approval workflow to PostgreSQL.
--      * The event must still be PENDING_APPROVAL.
--      * The caller must hold an assignment for the supplied stage.
--      * Rejecting also rejects the event's active bookings, so the
--        venue slot is freed for others (REJECTED is not a penalty).
--    MongoDB (the workflow instance) decides WHICH stage is current and
--    who is assigned to it; this function is the database's own check
--    on who may change the event at all.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS record_workflow_decision(INT, VARCHAR(20));
CREATE OR REPLACE FUNCTION record_workflow_decision(
    p_event_id INT, p_stage_no INT, p_decision VARCHAR(20)
)
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event RECORD;
BEGIN
    IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'Decision must be APPROVED or REJECTED, not %', p_decision;
    END IF;

    IF p_stage_no NOT BETWEEN 1 AND 4 THEN
        RAISE EXCEPTION 'Approval stage must be between 1 and 4';
    END IF;
    IF p_decision = 'APPROVED' AND p_stage_no <> 4 THEN
        RAISE EXCEPTION 'Only stage 4 can mark an event fully approved';
    END IF;

    SELECT e.event_id, e.club_id, e.department_id, e.organizer_id, e.status
    INTO v_event
    FROM event AS e
    WHERE e.event_id = p_event_id
    FOR UPDATE;                                  -- one decision at a time

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % does not exist', p_event_id
            USING ERRCODE = 'no_data_found';
    END IF;

    PERFORM assert_workflow_stage_assignment(p_event_id, p_stage_no);

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
REVOKE EXECUTE ON FUNCTION assert_workflow_stage_assignment(INT, INT)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_workflow_decision(INT, INT, VARCHAR) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION workflow_context(INT)                  TO cerms_student;
GRANT EXECUTE ON FUNCTION approval_details(INT[])                TO cerms_student;
GRANT EXECUTE ON FUNCTION record_workflow_decision(INT, INT, VARCHAR)
    TO cerms_student, cerms_workflow_approver;
GRANT EXECUTE ON FUNCTION assert_workflow_stage_assignment(INT, INT)
    TO cerms_student, cerms_workflow_approver;
GRANT EXECUTE ON FUNCTION approval_details(INT[])
    TO cerms_workflow_approver;
GRANT EXECUTE ON FUNCTION workflow_context(INT)
    TO cerms_workflow_approver;
