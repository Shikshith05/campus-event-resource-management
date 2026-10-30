import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "../../../../lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  isAppRole,
  type SessionUser
} from "../../../../lib/session";

const loginSchema = z.object({
  email: z.email().max(120),
  password: z.string().min(1).max(200)
});

type LoginRow = {
  user_id: number;
  full_name: string;
  email: string;
  password_hash: string;
  role_name: string;
  is_active: boolean;
};

// Compared against when the email does not exist, so a wrong email and a
// wrong password take the same time (no guessing which emails exist).
const DUMMY_HASH = "$2b$10$.UbVS04LE/FFFuZJg4HsweYcBOlN.4hrogQM7zfVm0e6o7tIJSezS";

const INVALID_LOGIN = { message: "Invalid email or password" };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Enter a valid email and password", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 }
    );
  }

  try {
    // Runs as cerms_app, which may only call this SECURITY DEFINER function.
    const [row] = await query<LoginRow>(
      "SELECT * FROM find_user_for_login($1)",
      [parsed.data.email]
    );

    const passwordMatches = await bcrypt.compare(
      parsed.data.password,
      row?.password_hash ?? DUMMY_HASH
    );
    if (!row || !passwordMatches || !row.is_active || !isAppRole(row.role_name)) {
      return NextResponse.json(INVALID_LOGIN, { status: 401 });
    }

    const user: SessionUser = {
      userId: row.user_id,
      name: row.full_name,
      email: row.email,
      role: row.role_name
    };

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(user), {
      httpOnly: true,                                   // not readable by JavaScript
      sameSite: "lax",                                  // not sent on cross-site POSTs
      secure: process.env.NODE_ENV === "production",    // HTTPS only in production
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    });
    return response;
  } catch (error) {
    console.error("Login failed", error);
    return NextResponse.json({ message: "Login is temporarily unavailable" }, { status: 503 });
  }
}
