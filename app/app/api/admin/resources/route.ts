import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/apiError";
import { requireUser } from "../../../../lib/auth";
import { queryAsUser, withUserTransaction } from "../../../../lib/db";
import { ADMIN_ROLES } from "../../../../lib/session";

const resourceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  resource_type: z.enum(["AV", "FURNITURE", "POWER", "DECOR", "OTHER"]),
  total_quantity: z.number().int().nonnegative()
});

export async function GET() {
  const { user, response } = await requireUser(ADMIN_ROLES);
  if (response) return response;
  try {
    const resources = await queryAsUser(user,
      `SELECT resource_id, name, resource_type, total_quantity, is_active
       FROM resource ORDER BY is_active DESC, name`);
    return NextResponse.json({ resources });
  } catch (error) {
    return errorResponse(error, "Admin resource list");
  }
}

export async function POST(request: Request) {
  const { user, response } = await requireUser(ADMIN_ROLES);
  if (response) return response;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 }); }
  const parsed = resourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid resource details", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  try {
    const [resource] = await withUserTransaction(user, async client => {
      const { rows } = await client.query(
        `INSERT INTO resource (name, resource_type, total_quantity)
         VALUES ($1, $2, $3)
         RETURNING resource_id, name, resource_type, total_quantity, is_active`,
        [parsed.data.name, parsed.data.resource_type, parsed.data.total_quantity]
      );
      return rows;
    });
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Create resource");
  }
}
