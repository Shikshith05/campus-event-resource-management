// Session cookie and role rules.
//
// This file is imported by middleware.ts, which runs in the Edge runtime,
// so it only uses Web APIs (crypto.subtle, TextEncoder, btoa/atob) and no
// Node.js modules.
//
// Cookie format:  <payload>.<signature>
//   payload   = base64url(JSON {userId, name, email, role, exp})
//   signature = base64url(HMAC-SHA256(payload, SESSION_SECRET))
// The browser can read nothing (httpOnly) and change nothing: editing the
// payload (e.g. role: "ADMIN") breaks the signature, so the cookie is
// rejected.

export const SESSION_COOKIE = "cerms_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // one working day

export const APP_ROLES = [
  "STUDENT",
  "CLUB_COORDINATOR",
  "FACULTY",
  "HOD",
  "ADMIN"
] as const;
export type AppRole = (typeof APP_ROLES)[number];

// The three access levels used by middleware and the database roles.
export const REQUESTER_ROLES: readonly AppRole[] = ["STUDENT", "CLUB_COORDINATOR"];
export const APPROVER_ROLES: readonly AppRole[] = ["FACULTY", "HOD"];
export const STAFF_ROLES: readonly AppRole[] = ["FACULTY", "HOD", "ADMIN"];
export const ADMIN_ROLES: readonly AppRole[] = ["ADMIN"];

export type SessionUser = {
  userId: number;
  name: string;
  email: string;
  role: AppRole;
};

type SessionPayload = SessionUser & { exp: number };

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// Which paths need which roles
// ---------------------------------------------------------------------

// Reachable without logging in.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

// Paths limited to some roles. Every other path only needs a valid login.
// Some prefixes are for pages still being built (approver inbox, admin).
const ROLE_RULES: { prefix: string; roles: readonly AppRole[] }[] = [
  { prefix: "/api/analytics", roles: STAFF_ROLES },
  { prefix: "/analytics", roles: STAFF_ROLES },
  { prefix: "/api/approvals", roles: STAFF_ROLES },
  { prefix: "/approvals", roles: STAFF_ROLES },
  { prefix: "/api/admin", roles: ADMIN_ROLES },
  { prefix: "/admin", roles: ADMIN_ROLES }
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(path => matchesPrefix(pathname, path));
}

// The roles allowed on a path, or null when any logged-in user may enter.
export function rolesAllowedFor(pathname: string): readonly AppRole[] | null {
  const rule = ROLE_RULES.find(candidate => matchesPrefix(pathname, candidate.prefix));
  return rule ? rule.roles : null;
}

// ---------------------------------------------------------------------
// Signing and verifying the cookie
// ---------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns the user for a valid, unexpired cookie, otherwise null.
export async function verifySessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  try {
    // crypto.subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(signature),
      encoder.encode(body)
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as Partial<SessionPayload>;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000) ||
      typeof payload.userId !== "number" ||
      typeof payload.name !== "string" ||
      typeof payload.email !== "string" ||
      !isAppRole(payload.role)
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      name: payload.name,
      email: payload.email,
      role: payload.role
    };
  } catch {
    return null;
  }
}
