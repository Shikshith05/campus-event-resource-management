import { NextResponse } from "next/server";
import { errorResponse, parseId } from "../../../../lib/apiError";
import { requireUser } from "../../../../lib/auth";
import { withUserTransaction } from "../../../../lib/db";

// DELETE /api/events/{eventId}
// A requester may discard their own draft. Submitted requests are not
// deletable, and PostgreSQL retains any booking that is part of conflict
// history through its foreign-key restrictions.
export async function DELETE(
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
    const [deleted] = await withUserTransaction(user, async client => {
      const { rows } = await client.query<{ event_id: number }>(
        `DELETE FROM event
         WHERE event_id = $1
           AND organizer_id = $2
           AND status = 'DRAFT'
         RETURNING event_id`,
        [eventId, user.userId]
      );
      return rows;
    });

    if (!deleted) {
      return NextResponse.json(
        { message: "Only your own draft requests can be deleted." },
        { status: 404 }
      );
    }
    return NextResponse.json({ event_id: deleted.event_id, status: "DELETED" });
  } catch (error) {
    if ((error as { code?: string }).code === "23503") {
      return NextResponse.json(
        { message: "This draft has a recorded booking conflict and cannot be permanently deleted." },
        { status: 409 }
      );
    }
    return errorResponse(error, "Delete event draft");
  }
}
