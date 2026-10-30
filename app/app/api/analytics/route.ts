import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { withUserTransaction } from "../../../lib/db";
import { STAFF_ROLES } from "../../../lib/session";

// Faculty, HOD and Admin only (the database grants these views to
// cerms_faculty and cerms_admin only, too).
export async function GET() {
  const { user, response } = await requireUser(STAFF_ROLES);
  if (response) return response;

  try {
    // One connection runs one query at a time, so these run in sequence.
    const { events, resources, venues } = await withUserTransaction(user, async client => ({
      events: (await client.query("SELECT * FROM event_statistics ORDER BY event_count DESC")).rows,
      resources: (await client.query("SELECT * FROM resource_utilization ORDER BY booking_count DESC")).rows,
      venues: (await client.query("SELECT * FROM venue_utilization ORDER BY month DESC, confirmed_hours DESC")).rows
    }));
    return NextResponse.json({ events, resources, venues });
  } catch (error) {
    console.error("Analytics query failed", error);
    return NextResponse.json(
      { message: "Unable to load analytics" },
      { status: 503 }
    );
  }
}
