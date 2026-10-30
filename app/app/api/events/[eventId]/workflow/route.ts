import { NextResponse } from "next/server";
import { errorResponse, parseId } from "../../../../../lib/apiError";
import { requireUser } from "../../../../../lib/auth";
import { queryAsUser } from "../../../../../lib/db";
import { getAuditForEvent, getWorkflowForEvent } from "../../../../../lib/workflow";

type EventRow = { event_id: number; title: string; status: string; organizer_id: number };

// GET /api/events/[eventId]/workflow
// The approval timeline of one event. The event is first read from
// PostgreSQL AS THE LOGGED-IN USER: if row-level security hides it
// (another student's request), the answer is 404, so the route does not
// even reveal that the event exists.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const eventId = parseId((await params).eventId);
  if (eventId === null) {
    return NextResponse.json({ message: "eventId must be a positive integer" }, { status: 400 });
  }

  try {
    const [event] = await queryAsUser<EventRow>(
      user,
      "SELECT event_id, title, status, organizer_id FROM event WHERE event_id = $1",
      [eventId]
    );
    if (!event) {
      return NextResponse.json({ message: `Event ${eventId} not found` }, { status: 404 });
    }

    const [instance, audit] = await Promise.all([
      getWorkflowForEvent(eventId),
      getAuditForEvent(eventId)
    ]);
    if (!instance) {
      return NextResponse.json({ event, workflow: null, history: [] });
    }

    // Names of everyone in the timeline (app_user is readable without
    // password_hash by every role).
    const userIds = [...new Set(
      instance.stages.flatMap(s => [s.assigned_to_user_id, s.acted_by_user_id])
        .concat(instance.submitted_by_user_id)
        .filter((value): value is number => value != null)
    )];
    const names = new Map(
      (await queryAsUser<{ user_id: number; full_name: string }>(
        user,
        "SELECT user_id, full_name FROM app_user WHERE user_id = ANY($1::int[])",
        [userIds]
      )).map(row => [row.user_id, row.full_name])
    );
    const nameOf = (userId: number | null) => (userId == null ? null : names.get(userId) ?? null);

    return NextResponse.json({
      event,
      workflow: {
        template_code: instance.template_code,
        template_version: instance.template_version,
        status: instance.status,
        current_stage_no: instance.current_stage_no,
        submitted_by_user_id: instance.submitted_by_user_id,
        submitted_by_name: nameOf(instance.submitted_by_user_id),
        submitted_at: instance.submitted_at,
        stages: instance.stages.map(stage => ({
          stage_no: stage.stage_no,
          name: stage.name,
          approver_role: stage.approver_role,
          status: stage.status,
          assigned_to_user_id: stage.assigned_to_user_id,
          assigned_to_name: nameOf(stage.assigned_to_user_id),
          stage_assigned_at: stage.stage_assigned_at ?? null,
          due_by: stage.due_by ?? null,
          acted_by_user_id: stage.acted_by_user_id,
          acted_by_name: nameOf(stage.acted_by_user_id),
          acted_at: stage.acted_at,
          comment: stage.comment
        }))
      },
      history: audit.map(entry => ({
        action: entry.action,
        stage_no: entry.stage_no,
        acted_by_user_id: entry.acted_by_user_id,
        comment: entry.comment,
        created_at: entry.created_at
      }))
    });
  } catch (error) {
    return errorResponse(error, "Workflow timeline");
  }
}
