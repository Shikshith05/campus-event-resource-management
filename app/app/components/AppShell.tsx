import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser, ROLE_LABELS } from "../../lib/auth";
import { ADMIN_ROLES, APPROVAL_ROLES, STAFF_ROLES } from "../../lib/session";
import LogoutButton from "../dashboard/LogoutButton";

const links = [
  { href: "/events/new", label: "New request", key: "new" },
  { href: "/events", label: "Events", key: "events" },
  { href: "/availability", label: "Availability", key: "availability" },
  { href: "/approvals", label: "Approvals", key: "approvals", roles: APPROVAL_ROLES },
  { href: "/analytics", label: "Analytics", key: "analytics", roles: STAFF_ROLES },
  { href: "/admin", label: "Admin", key: "admin", roles: ADMIN_ROLES }
] as const;

export default async function AppShell({
  active,
  children
}: {
  active: string;
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/events">
          <span className="brand-mark">C</span>
          <span>
            <span className="brand-title">CERMS</span>
            <span className="brand-subtitle">Campus events & resources</span>
          </span>
        </Link>
        <div className="topbar-right">
          <nav className="nav-links" aria-label="Main navigation">
            {links.filter(link => !("roles" in link) || link.roles.includes(user.role)).map(link => (
              <Link
                key={link.key}
                className={`nav-link${active === link.key ? " active" : ""}`}
                href={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="user-tools">
            <span className="user-name"><strong>{user.name}</strong>{ROLE_LABELS[user.role]}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="main-wrap">{children}</main>
    </div>
  );
}
