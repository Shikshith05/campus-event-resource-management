import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { queryAsUser } from "../../../lib/db";

// Runs as the logged-in user: row-level security makes a student see only
// their own requests here; faculty and admin see all of them.
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const events = await queryAsUser(user,
      `SELECT *
       FROM event_request_summary
       ORDER BY created_at DESC NULLS LAST, event_id DESC`
    );
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Event list query failed", error);
    return NextResponse.json(
      { message: "Unable to load event requests" },
      { status: 503 }
    );
  }
}
