import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

export async function GET() {
  try {
    const schedule = await query(
      `SELECT *
       FROM venue_booking_schedule
       ORDER BY start_time, venue_id`
    );
    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("Availability query failed", error);
    return NextResponse.json(
      { message: "Unable to load venue availability" },
      { status: 503 }
    );
  }
}
