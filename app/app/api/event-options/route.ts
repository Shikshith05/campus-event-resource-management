import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { withUserTransaction } from "../../../lib/db";

// Reference data for the request form. All reads still run under the
// current app role; the club list is limited to the logged-in user's clubs.
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const options = await withUserTransaction(user, async client => {
      const departments = await client.query("SELECT department_id, code, name FROM department ORDER BY name");
      const venues = await client.query(
        `SELECT venue_id, name, venue_type, venue_type_confirmed, building,
                capacity, min_capacity, max_capacity
         FROM venue WHERE is_active ORDER BY name`
      );
      const resources = await client.query("SELECT resource_id, name, resource_type, total_quantity FROM resource WHERE is_active ORDER BY name");
      const clubs = await client.query(
        `SELECT c.club_id, c.name, c.department_id
         FROM club AS c
         JOIN club_member AS cm ON cm.club_id = c.club_id
         WHERE cm.user_id = $1 AND c.is_active
         ORDER BY c.name`,
        [user.userId]
      );
      return {
        departments: departments.rows,
        venues: venues.rows,
        resources: resources.rows,
        clubs: clubs.rows
      };
    });
    return NextResponse.json(options);
  } catch (error) {
    console.error("Event form options query failed", error);
    return NextResponse.json({ message: "Unable to load event form options" }, { status: 503 });
  }
}
