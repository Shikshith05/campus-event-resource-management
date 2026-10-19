import { NextResponse } from "next/server";
import { mongoDatabase, query } from "../../../lib/db";

export async function GET() {
  try {
    await query("SELECT 1 AS ok");
    const database = await mongoDatabase();
    await database.command({ ping: 1 });
    return NextResponse.json({ status: "ok", postgres: "ok", mongodb: "ok" });
  } catch (error) {
    console.error("CERMS health check failed", error);
    return NextResponse.json(
      { status: "error", message: "A database health check failed" },
      { status: 503 }
    );
  }
}
