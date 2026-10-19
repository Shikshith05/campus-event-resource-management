import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

export async function GET() {
  try {
    const [events, resources, venues] = await Promise.all([
      query("SELECT * FROM event_statistics ORDER BY event_count DESC"),
      query("SELECT * FROM resource_utilization ORDER BY booking_count DESC"),
      query("SELECT * FROM venue_utilization ORDER BY month DESC, confirmed_hours DESC")
    ]);
    return NextResponse.json({ events, resources, venues });
  } catch (error) {
    console.error("Analytics query failed", error);
    return NextResponse.json(
      { message: "Unable to load analytics" },
      { status: 503 }
    );
  }
}
