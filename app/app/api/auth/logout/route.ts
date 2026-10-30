import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../lib/session";

export async function POST() {
  const response = NextResponse.json({ message: "Logged out" });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0                                           // delete the cookie
  });
  return response;
}
