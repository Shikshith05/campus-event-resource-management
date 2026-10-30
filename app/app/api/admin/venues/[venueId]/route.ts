import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseId } from "../../../../../lib/apiError";
import { requireUser } from "../../../../../lib/auth";
import { withUserTransaction } from "../../../../../lib/db";
import { ADMIN_ROLES } from "../../../../../lib/session";

// Every field is optional (partial update), but at least one must be sent.
const updateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  venue_type: z.enum(["AUDITORIUM", "SEMINAR_HALL", "CLASSROOM", "LAB", "OPEN_AIR", "OTHER"]),
  building: z.string().trim().max(100).nullable(),
  capacity: z.number().int().positive(),
  department_id: z.number().int().positive().nullable(),
  is_active: z.boolean()
}).partial().refine(body => Object.values(body).some(value => value !== undefined), {
  message: "Provide at least one field to update"
});

// Fixed list of updatable columns: only these names are ever placed in the
// SQL text; the values themselves are always bound parameters.
const COLUMNS = ["name", "venue_type", "building", "capacity", "department_id", "is_active"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ venueId: string }> }) {
  const { user, response } = await requireUser(ADMIN_ROLES);
  if (response) return response;
  const venueId = parseId((await params).venueId);
  if (!venueId) return NextResponse.json({ message: "venueId must be a positive integer" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid venue details", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const changes = parsed.data;
  const fields = COLUMNS.filter(column => changes[column] !== undefined);
  try {
    const [venue] = await withUserTransaction(user, async client => {
      const newCapacity = changes.capacity;
      if (newCapacity !== undefined) {
        // Serialize a capacity change with booking conflict resolution for
        // this venue, which uses the same advisory lock.
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [2000000000 + venueId]);
        const { rows: [capacityCheck] } = await client.query<{ max_footfall: number | null }>(
          `SELECT MAX(e.expected_footfall)::int AS max_footfall
           FROM booking AS b
           JOIN event AS e ON e.event_id = b.event_id
           WHERE b.venue_id = $1 AND b.status = 'CONFIRMED'`,
          [venueId]
        );
        if (capacityCheck?.max_footfall && newCapacity < capacityCheck.max_footfall) {
          throw Object.assign(
            new Error(`Capacity cannot be set below ${capacityCheck.max_footfall}; that venue has a confirmed booking for that many people.`),
            { code: "P0001" }
          );
        }
      }
      // Only the provided columns: "SET capacity = $2", "SET name = $2, is_active = $3", ...
      const assignments = fields.map((column, index) => `${column} = $${index + 2}`).join(", ");
      const { rows } = await client.query(
        `UPDATE venue SET ${assignments}
         WHERE venue_id = $1
         RETURNING venue_id, name, venue_type, building, capacity, department_id, is_active`,
        [venueId, ...fields.map(column => changes[column])]
      );
      return rows;
    });
    if (!venue) return NextResponse.json({ message: "Venue not found" }, { status: 404 });
    return NextResponse.json({ venue });
  } catch (error) {
    return errorResponse(error, "Update venue");
  }
}
