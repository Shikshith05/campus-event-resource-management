// Turns errors from the workflow engine and PostgreSQL into HTTP answers.
import { NextResponse } from "next/server";
import { WorkflowError } from "./workflow";

// SQLSTATE codes raised on purpose by our SQL (procedures.sql,
// booking_logic.sql, workflow.sql, rbac.sql). Anything else is an
// unexpected failure (e.g. a database is down) and becomes 503.
const SQLSTATE_TO_HTTP: Record<string, number> = {
  P0001: 422,   // RAISE EXCEPTION in a trigger/procedure: invalid request
  "23505": 409, // unique violation
  "23P01": 409, // exclusion violation (double booking)
  "23514": 422, // check constraint
  "23503": 422, // foreign key (unknown venue, club, resource ...)
  "22P02": 422, // invalid input syntax
  "42501": 403, // permission denied / insufficient_privilege / RLS
  "02000": 404, // no_data_found
  "55000": 409  // object_not_in_prerequisite_state (e.g. not PENDING_APPROVAL)
};

export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof WorkflowError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }

  const sqlState = (error as { code?: unknown }).code;
  if (typeof sqlState === "string" && SQLSTATE_TO_HTTP[sqlState]) {
    return NextResponse.json(
      { message: (error as Error).message, sqlstate: sqlState },
      { status: SQLSTATE_TO_HTTP[sqlState] }
    );
  }

  console.error(`${context} failed`, error);
  return NextResponse.json({ message: `${context} is temporarily unavailable` }, { status: 503 });
}

// Route parameter -> positive integer id, or null.
export function parseId(value: string): number | null {
  return /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : null;
}
