import { NextResponse } from "next/server";
import { errorResponse } from "../../../lib/apiError";
import { requireUser } from "../../../lib/auth";
import { queryAsUser } from "../../../lib/db";
import { APPROVAL_ROLES } from "../../../lib/session";
import { getPendingForApprover } from "../../../lib/workflow";

type ApprovalDetailsRow = {
  event_id: number;
  title: string;
  category: string;
  event_type: string;
  expected_footfall: number;
  event_status: string;
  organizer_id: number;
  organizer_name: string;
  department_code: string | null;
  club_name: string | null;
  booking_id: number | null;
  booking_status: string | null;
  start_time: Date | null;
  end_time: Date | null;
  venue_id: number | null;
  venue_name: string | null;
  venue_capacity: number | null;
  priority_score: string | null;     // NUMERIC arrives as a string
};

// GET /api/approvals
// The logged-in approver's inbox: stages assigned to them and PENDING.
//   MongoDB    -> which workflows are waiting for this user
//   PostgreSQL -> event, booking, venue and priority score, through
//                 approval_details(), which applies the database rules
export async function GET() {
  const { user, response } = await requireUser(APPROVAL_ROLES);
  if (response) return response;

  try {
    const pending = await getPendingForApprover(user.userId);
    if (pending.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const details = await queryAsUser<ApprovalDetailsRow>(
      user,
      "SELECT * FROM approval_details($1::int[])",
      [pending.map(item => item.instance.event_id)]
    );
    const byEvent = new Map(details.map(row => [row.event_id, row]));

    const items = pending.map(({ instance, stage }) => {
      const row = byEvent.get(instance.event_id);
      return {
        event_id: instance.event_id,
        workflow: {
          template_code: instance.template_code,
          submitted_by_user_id: instance.submitted_by_user_id,
          submitted_at: instance.submitted_at,
          current_stage_no: instance.current_stage_no,
          total_stages: instance.stages.length
        },
        stage: {
          stage_no: stage.stage_no,
          name: stage.name,
          approver_role: stage.approver_role,
          stage_assigned_at: stage.stage_assigned_at ?? null,
          due_by: stage.due_by ?? null
        },
        event: row
          ? {
              title: row.title,
              category: row.category,
              event_type: row.event_type,
              expected_footfall: row.expected_footfall,
              status: row.event_status,
              organizer_id: row.organizer_id,
              organizer_name: row.organizer_name,
              department_code: row.department_code,
              club_name: row.club_name
            }
          : null,
        booking: row?.booking_id
          ? {
              booking_id: row.booking_id,
              status: row.booking_status,
              start_time: row.start_time,
              end_time: row.end_time,
              venue_id: row.venue_id,
              venue_name: row.venue_name,
              venue_capacity: row.venue_capacity
            }
          : null,
        priority_score: row?.priority_score == null ? null : Number(row.priority_score)
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error, "Approval inbox");
  }
}
