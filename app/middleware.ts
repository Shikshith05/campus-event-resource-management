// Runs before every page and API route (see config.matcher).
//   1. Public paths (login page, login API, health check) pass through.
//   2. Everything else needs a valid signed session cookie:
//        pages -> redirect to /login?next=<path>
//        APIs  -> 401 JSON
//   3. Role-limited paths (session.ts ROLE_RULES) check the user's role:
//        Student / Club Coordinator  vs  Faculty / HOD  vs  Admin
//        pages -> redirect to /dashboard?denied=1
//        APIs  -> 403 JSON
// The database enforces the same rules again (db/sql/rbac.sql), so a bug
// here cannot expose other users' data.
import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  isPublicPath,
  rolesAllowedFor,
  verifySessionToken
} from "./lib/session";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  const user = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!user) {
    if (isApi) {
      return NextResponse.json({ message: "Authentication required" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const allowedRoles = rolesAllowedFor(pathname);
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (isApi) {
      return NextResponse.json(
        { message: "You do not have access to this resource" },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL("/dashboard?denied=1", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next.js build assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
