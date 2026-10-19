import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

export async function GET() {
  try {
    const events = await query(
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
