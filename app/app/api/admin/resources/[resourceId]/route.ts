import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseId } from "../../../../../lib/apiError";
import { requireUser } from "../../../../../lib/auth";
import { withUserTransaction } from "../../../../../lib/db";
import { ADMIN_ROLES } from "../../../../../lib/session";

// Every field is optional (partial update), but at least one must be sent.
const updateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  resource_type: z.enum(["AV", "FURNITURE", "POWER", "DECOR", "OTHER"]),
  total_quantity: z.number().int().nonnegative(),
  is_active: z.boolean()
}).partial().refine(body => Object.values(body).some(value => value !== undefined), {
  message: "Provide at least one field to update"
});

// Fixed list of updatable columns: only these names are ever placed in the
// SQL text; the values themselves are always bound parameters.
const COLUMNS = ["name", "resource_type", "total_quantity", "is_active"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const { user, response } = await requireUser(ADMIN_ROLES);
  if (response) return response;
  const resourceId = parseId((await params).resourceId);
  if (!resourceId) return NextResponse.json({ message: "resourceId must be a positive integer" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid resource details", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const changes = parsed.data;
  const fields = COLUMNS.filter(column => changes[column] !== undefined);
  try {
    const [resource] = await withUserTransaction(user, async client => {
      const newQuantity = changes.total_quantity;
      if (newQuantity !== undefined) {
        // Serialize with booking validation, which takes this same lock while
        // confirming a booking that requests this resource.
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [2100000000 + resourceId]);
        const { rows: [usage] } = await client.query<{ peak_quantity: number }>(
          `WITH changes AS (
             SELECT b.start_time AS change_time, br.quantity AS delta
             FROM booking_resource AS br
             JOIN booking AS b ON b.booking_id = br.booking_id
             WHERE br.resource_id = $1 AND b.status = 'CONFIRMED'
             UNION ALL
             SELECT b.end_time AS change_time, -br.quantity AS delta
             FROM booking_resource AS br
             JOIN booking AS b ON b.booking_id = br.booking_id
             WHERE br.resource_id = $1 AND b.status = 'CONFIRMED'
           ), running_usage AS (
             SELECT SUM(delta) OVER (ORDER BY change_time, delta ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS quantity
             FROM changes
           )
           SELECT COALESCE(MAX(quantity), 0)::int AS peak_quantity FROM running_usage`,
          [resourceId]
        );
        if (usage && newQuantity < usage.peak_quantity) {
          throw Object.assign(
            new Error(`Quantity cannot be set below ${usage.peak_quantity}; confirmed bookings need that many at the same time.`),
            { code: "P0001" }
          );
        }
      }
      // Only the provided columns: "SET total_quantity = $2", ...
      const assignments = fields.map((column, index) => `${column} = $${index + 2}`).join(", ");
      const { rows } = await client.query(
        `UPDATE resource SET ${assignments}
         WHERE resource_id = $1
         RETURNING resource_id, name, resource_type, total_quantity, is_active`,
        [resourceId, ...fields.map(column => changes[column])]
      );
      return rows;
    });
    if (!resource) return NextResponse.json({ message: "Resource not found" }, { status: 404 });
    return NextResponse.json({ resource });
  } catch (error) {
    return errorResponse(error, "Update resource");
  }
}
