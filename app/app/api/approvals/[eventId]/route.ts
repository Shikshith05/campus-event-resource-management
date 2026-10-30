import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseId } from "../../../../lib/apiError";
import { requireUser } from "../../../../lib/auth";
import { withUserTransaction } from "../../../../lib/db";
import { APPROVAL_ROLES } from "../../../../lib/session";
import {
  approveWorkflowStage,
  currentPendingStage,
  getWorkflowForEvent,
  rejectWorkflowStage,
  type WorkflowOutcome
} from "../../../../lib/workflow";

const decisionSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    comment: z.string().trim().max(500).optional()
  })
  .refine(body => body.action === "approve" || Boolean(body.comment), {
    message: "A comment is required when rejecting",
    path: ["comment"]
  });

// POST /api/approvals/[eventId]   { action: "approve" | "reject", comment? }
// Only the user assigned to the CURRENT stage may act (403 otherwise).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { user, response } = await requireUser(APPROVAL_ROLES);
  if (response) return response;

  const eventId = parseId((await params).eventId);
  if (eventId === null) {
    return NextResponse.json({ message: "eventId must be a positive integer" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid decision", issues: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }
  const { action, comment } = parsed.data;

  try {
    const instance = await getWorkflowForEvent(eventId);
    if (!instance) {
      return NextResponse.json({ message: `No workflow for event ${eventId}` }, { status: 404 });
    }
    const stage = currentPendingStage(instance);
    if (!stage) {
      return NextResponse.json(
        { message: `Workflow for event ${eventId} is ${instance.status}` },
        { status: 409 }
      );
    }
    if (stage.assigned_to_user_id !== user.userId) {
      return NextResponse.json(
        { message: `Stage ${stage.stage_no} (${stage.name}) is not assigned to you` },
        { status: 403 }
      );
    }

    // Both databases change only on the LAST decision (final approve, or
    // any reject). Order:
    //   1. PostgreSQL: check the event, record the outcome  (not committed yet)
    //   2. MongoDB:    update the stage                     (atomic, guarded)
    //   3. PostgreSQL: COMMIT
    // If step 2 fails, step 3 never happens and PostgreSQL rolls back, so
    // the two databases cannot disagree about the outcome. (Only a crash
    // between 2 and 3 could; the audit trail would show it.)
    let eventStatus = "PENDING_APPROVAL";
    const updated = await withUserTransaction(user, async client => {
      const beforeWrite = async (outcome: WorkflowOutcome) => {
        const { rows } = await client.query<{ status: string }>(
          "SELECT status FROM event WHERE event_id = $1",
          [eventId]
        );
        if (rows.length === 0 || rows[0].status !== "PENDING_APPROVAL") {
          throw Object.assign(
            new Error(`Event ${eventId} is ${rows[0]?.status ?? "not visible"}, not PENDING_APPROVAL`),
            { code: "55000" }
          );
        }
        if (outcome !== "IN_PROGRESS") {
          await client.query("SELECT record_workflow_decision($1, $2)", [eventId, outcome]);
          eventStatus = outcome;
        }
      };
      return action === "approve"
        ? approveWorkflowStage(eventId, user.userId, comment ?? null, { beforeWrite })
        : rejectWorkflowStage(eventId, user.userId, comment ?? "", { beforeWrite });
    });

    return NextResponse.json({
      event_id: eventId,
      action,
      stage_no: stage.stage_no,
      workflow_status: updated.status,
      current_stage_no: updated.current_stage_no,
      next_approver_user_id:
        updated.stages.find(s => s.stage_no === updated.current_stage_no)?.assigned_to_user_id ?? null,
      event_status: eventStatus
    });
  } catch (error) {
    return errorResponse(error, "Approval decision");
  }
}
