import { NextResponse } from "next/server";
import { mongoDatabase, query } from "../../../lib/db";

export async function GET() {
  try {
    const [schema] = await query<{ ready: boolean }>(`
      SELECT
        to_regclass('public.workflow_approver_assignment') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass('public.venue')
            AND attname = 'venue_type_confirmed'
            AND NOT attisdropped
        )
        AND to_regprocedure('public.workflow_context(integer)') IS NOT NULL
        AND to_regprocedure('public.approval_details(integer[])') IS NOT NULL
        AND to_regprocedure('public.record_workflow_decision(integer,integer,character varying)') IS NOT NULL
        AS ready
    `);
    const database = await mongoDatabase();
    await database.command({ ping: 1 });

    if (!schema?.ready) {
      return NextResponse.json(
        {
          status: "error",
          postgres: "schema_out_of_date",
          mongodb: "ok",
          message: "Apply the existing-database upgrade in docs/real-data-guide.md"
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ status: "ok", postgres: "ok", mongodb: "ok" });
  } catch (error) {
    console.error("CERMS health check failed", error);
    return NextResponse.json(
      { status: "error", message: "A database health check failed" },
      { status: 503 }
    );
  }
}
