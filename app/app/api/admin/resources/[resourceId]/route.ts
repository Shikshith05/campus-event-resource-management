import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseId } from "../../../../../lib/apiError";
import { requireUser } from "../../../../../lib/auth";
import { withUserTransaction } from "../../../../../lib/db";
import { ADMIN_ROLES } from "../../../../../lib/session";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  resource_type: z.enum(["AV", "FURNITURE", "POWER", "DECOR", "OTHER"]),
  total_quantity: z.number().int().nonnegative(),
  is_active: z.boolean()
});

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
  try {
    const [resource] = await withUserTransaction(user, async client => {
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
      if (usage && parsed.data.total_quantity < usage.peak_quantity) {
        throw Object.assign(
          new Error(`Quantity cannot be set below ${usage.peak_quantity}; confirmed bookings need that many at the same time.`),
          { code: "P0001" }
        );
      }
      const { rows } = await client.query(
        `UPDATE resource SET name = $2, resource_type = $3, total_quantity = $4, is_active = $5
         WHERE resource_id = $1
         RETURNING resource_id, name, resource_type, total_quantity, is_active`,
        [resourceId, parsed.data.name, parsed.data.resource_type, parsed.data.total_quantity, parsed.data.is_active]
      );
      return rows;
    });
    if (!resource) return NextResponse.json({ message: "Resource not found" }, { status: 404 });
    return NextResponse.json({ resource });
  } catch (error) {
    return errorResponse(error, "Update resource");
  }
}
