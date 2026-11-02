import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser, ROLE_LABELS } from "../../lib/auth";
import { ADMIN_ROLES, APPROVAL_INBOX_ROLES, EVENT_ROLES, STAFF_ROLES } from "../../lib/session";
import LogoutButton from "../dashboard/LogoutButton";
import AppNavigation from "./AppNavigation";

const links = [
  { href: "/events/new", label: "New request", key: "new", roles: EVENT_ROLES },
  { href: "/events", label: "Events", key: "events", roles: EVENT_ROLES },
  { href: "/availability", label: "Availability", key: "availability", roles: EVENT_ROLES },
  { href: "/approvals", label: "Approvals", key: "approvals", roles: APPROVAL_INBOX_ROLES },
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
        <Link className="brand" href={user.role === "WORKFLOW_APPROVER" ? "/approvals" : "/events"}>
          <span className="brand-mark">C</span>
          <span>
            <span className="brand-title">CERMS</span>
            <span className="brand-subtitle">Campus events & resources</span>
          </span>
        </Link>
        <div className="topbar-right">
          <AppNavigation links={links.filter(link => link.roles.includes(user.role))} active={active} />
          <div className="user-tools">
            <span className="user-name"><strong>{user.role === "WORKFLOW_APPROVER" ? "Assigned approver" : user.name}</strong>{ROLE_LABELS[user.role]}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="main-wrap">{children}</main>
    </div>
  );
}
