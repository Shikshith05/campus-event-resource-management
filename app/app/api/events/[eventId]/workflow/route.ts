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

    return NextResponse.json({
      event,
      workflow: {
        template_code: instance.template_code,
        template_version: instance.template_version,
        status: instance.status,
        current_stage_no: instance.current_stage_no,
        submitted_at: instance.submitted_at,
        stages: instance.stages.map(stage => ({
          stage_no: stage.stage_no,
          name: stage.name,
          approver_role: stage.approver_role,
          status: stage.status,
          stage_assigned_at: stage.stage_assigned_at ?? null,
          due_by: stage.due_by ?? null,
          acted_at: stage.acted_at,
          comment: stage.comment
        }))
      },
      history: audit.map(entry => ({
        action: entry.action,
        stage_no: entry.stage_no,
        comment: entry.comment,
        created_at: entry.created_at
      }))
    });
  } catch (error) {
    return errorResponse(error, "Workflow timeline");
  }
}
