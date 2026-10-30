import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/apiError";
import { requireUser } from "../../../../lib/auth";
import { queryAsUser, withUserTransaction } from "../../../../lib/db";
import {
  approversFromContext,
  createWorkflowInstance,
  eventFromContext,
  type WorkflowContextRow
} from "../../../../lib/workflow";

const EVENT_TYPES = [
  "GUEST_LECTURE", "WORKSHOP", "SEMINAR", "TECH_FEST", "CULTURAL",
  "CLUB_MEET", "ORIENTATION", "COMPETITION", "SPORTS", "OTHER"
] as const;

const id = z.number().int().positive();

const submitSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    category: z.enum(["ACADEMIC", "DEPARTMENT", "CLUB", "PERSONAL"]),
    event_type: z.enum(EVENT_TYPES),
    department_id: id.nullable().default(null),
    club_id: id.nullable().default(null),
    expected_footfall: id,
    venue_id: id,
    start_time: z.iso.datetime({ offset: true }),
    end_time: z.iso.datetime({ offset: true }),
    resources: z
      .array(z.object({ resource_id: id, quantity: id }))
      .max(20)
      .default([])
  })
  .refine(body => Date.parse(body.end_time) > Date.parse(body.start_time), {
    message: "end_time must be after start_time",
    path: ["end_time"]
  })
  .refine(body => new Set(body.resources.map(r => r.resource_id)).size === body.resources.length, {
    message: "Each resource may appear only once",
    path: ["resources"]
  })
  // The guest-lecture template needs guest details (guest_lecture_details),
  // which this endpoint does not collect yet.
  .refine(body => body.event_type !== "GUEST_LECTURE", {
    message: "Guest lectures cannot be submitted through this endpoint yet",
    path: ["event_type"]
  });

type CallResult = { p_event_id: number; p_booking_id: number; p_booking_status: string };
type AlternateVenue = { venue_id: number; venue_name: string; capacity: number; spare_seats: number };

// POST /api/events/submit
// Submit an event request as the logged-in user (always the organizer).
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid event request", issues: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // -------------------------------------------------------------------
  // Step 1: PostgreSQL, in ONE transaction as the logged-in user.
  // submit_booking_request inserts the event (status PENDING_APPROVAL),
  // its booking and resources, and runs the priority/conflict logic.
  // -------------------------------------------------------------------
  let pg:
    | { lost: true; call: CallResult; alternatives: AlternateVenue[] }
    | { lost: false; call: CallResult; context: WorkflowContextRow };
  try {
    pg = await withUserTransaction(user, async client => {
      const { rows: [call] } = await client.query<CallResult>(
        `CALL submit_booking_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                                     $11::int[], $12::int[], NULL, NULL, NULL)`,
        [
          user.userId, input.title, input.category, input.event_type,
          input.department_id, input.club_id, input.expected_footfall,
          input.venue_id, input.start_time, input.end_time,
          input.resources.map(r => r.resource_id),
          input.resources.map(r => r.quantity)
        ]
      );

      if (call.p_booking_status === "REJECTED") {
        // The venue went to a higher-priority booking. No approval is
        // started; the event goes back to DRAFT and the requester gets
        // alternate venues for the same slot.
        const { rows: alternatives } = await client.query<AlternateVenue>(
          "SELECT * FROM suggest_alternate_venues($1)",
          [call.p_booking_id]
        );
        await client.query("UPDATE event SET status = 'DRAFT' WHERE event_id = $1", [call.p_event_id]);
        return { lost: true as const, call, alternatives };
      }

      // Venue allocated: the event stays PENDING_APPROVAL (set by the
      // procedure). Fetch what MongoDB needs, including the approvers.
      const { rows: [context] } = await client.query<WorkflowContextRow>(
        "SELECT * FROM workflow_context($1)",
        [call.p_event_id]
      );
      return { lost: false as const, call, context };
    });
  } catch (error) {
    return errorResponse(error, "Event submission");
  }

  if (pg.lost) {
    return NextResponse.json(
      {
        status: "VENUE_UNAVAILABLE",
        message: "The venue is already confirmed for a higher-priority booking at that time.",
        event_id: pg.call.p_event_id,
        event_status: "DRAFT",
        booking_id: pg.call.p_booking_id,
        booking_status: pg.call.p_booking_status,
        alternatives: pg.alternatives
      },
      { status: 409 }
    );
  }

  // -------------------------------------------------------------------
  // Step 2: MongoDB, AFTER PostgreSQL has committed.
  // PostgreSQL and MongoDB are two separate databases, so they cannot
  // share one transaction: there is no single COMMIT that covers both.
  // We write PostgreSQL first (it holds the event and booking, and its
  // constraints are the strict ones), then MongoDB. If the MongoDB write
  // fails, we COMPENSATE: a second PostgreSQL transaction sets the event
  // back to DRAFT, so no request is left PENDING_APPROVAL without a
  // workflow that could ever approve it.
  // -------------------------------------------------------------------
  try {
    const instance = await createWorkflowInstance(
      eventFromContext(pg.context, user.userId),
      approversFromContext(pg.context)
    );
    return NextResponse.json(
      {
        status: "SUBMITTED",
        event_id: pg.call.p_event_id,
        event_status: "PENDING_APPROVAL",
        booking_id: pg.call.p_booking_id,
        booking_status: pg.call.p_booking_status,
        workflow: {
          template_code: instance.template_code,
          status: instance.status,
          current_stage_no: instance.current_stage_no,
          stages: instance.stages.map(stage => ({
            stage_no: stage.stage_no,
            name: stage.name,
            approver_role: stage.approver_role,
            assigned_to_user_id: stage.assigned_to_user_id,
            status: stage.status
          }))
        }
      },
      { status: 201 }
    );
  } catch (error) {
    try {
      await queryAsUser(
        user,
        "UPDATE event SET status = 'DRAFT' WHERE event_id = $1 AND status = 'PENDING_APPROVAL'",
        [pg.call.p_event_id]
      );
    } catch (compensationError) {
      // Both databases failed: log loudly so an admin can fix the event.
      console.error(
        `Could not set event ${pg.call.p_event_id} back to DRAFT after a workflow failure`,
        compensationError
      );
    }
    const failure = errorResponse(error, "Workflow creation");
    const details = (await failure.json()) as { message: string };
    return NextResponse.json(
      {
        message: `The approval workflow could not be started: ${details.message}`,
        event_id: pg.call.p_event_id,
        event_status: "DRAFT",
        booking_id: pg.call.p_booking_id
      },
      { status: failure.status }
    );
  }
}
