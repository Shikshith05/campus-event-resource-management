// Server-side helpers for route handlers and pages.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionToken,
  type AppRole,
  type SessionUser
} from "./session";

// The logged-in user from the signed session cookie, or null.
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

// For API routes: returns the user, or a ready 401/403 response.
// middleware.ts already checks this; repeating it here means a route
// stays protected even if the middleware matcher changes.
export async function requireUser(
  allowedRoles?: readonly AppRole[]
): Promise<{ user: SessionUser; response?: never } | { user?: never; response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: NextResponse.json({ message: "Authentication required" }, { status: 401 })
    };
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return {
      response: NextResponse.json({ message: "You do not have access to this resource" }, { status: 403 })
    };
  }
  return { user };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  STUDENT: "Student",
  CLUB_COORDINATOR: "Club Coordinator",
  FACULTY: "Faculty",
  HOD: "Head of Department",
  ADMIN: "Admin"
};
