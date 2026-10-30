import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/apiError";
import { requireUser } from "../../../../lib/auth";
import { queryAsUser, withUserTransaction } from "../../../../lib/db";
import { ADMIN_ROLES } from "../../../../lib/session";

const venueSchema = z.object({
  name: z.string().trim().min(2).max(100),
  venue_type: z.enum(["AUDITORIUM", "SEMINAR_HALL", "CLASSROOM", "LAB", "OPEN_AIR", "OTHER"]),
  building: z.string().trim().max(100).nullable().optional(),
  capacity: z.number().int().positive(),
  department_id: z.number().int().positive().nullable().optional()
});

export async function GET() {
  const { user, response } = await requireUser(ADMIN_ROLES);
  if (response) return response;
  try {
    const [venues, departments] = await Promise.all([
      queryAsUser(user,
        `SELECT venue_id, name, venue_type, building, capacity, department_id, is_active
         FROM venue ORDER BY is_active DESC, name`),
      queryAsUser(user, "SELECT department_id, code, name FROM department ORDER BY name")
    ]);
    return NextResponse.json({ venues, departments });
  } catch (error) {
    return errorResponse(error, "Admin venue list");
  }
}

export async function POST(request: Request) {
  const { user, response } = await requireUser(ADMIN_ROLES);
  if (response) return response;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 }); }
  const parsed = venueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid venue details", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  try {
    const [venue] = await withUserTransaction(user, async client => {
      const { rows } = await client.query(
        `INSERT INTO venue (name, venue_type, building, capacity, department_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING venue_id, name, venue_type, building, capacity, department_id, is_active`,
        [parsed.data.name, parsed.data.venue_type, parsed.data.building ?? null, parsed.data.capacity, parsed.data.department_id ?? null]
      );
      return rows;
    });
    return NextResponse.json({ venue }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Create venue");
  }
}
