import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "../components/AppShell";
import { ROLE_LABELS, getSessionUser } from "../../lib/auth";
import { queryAsUser } from "../../lib/db";
import { ADMIN_ROLES, APPROVAL_ROLES, STAFF_ROLES } from "../../lib/session";
import type { SessionUser } from "../../lib/session";

export const metadata: Metadata = { title: "Dashboard | CERMS" };

async function visibleEventCount(user: SessionUser): Promise<number | null> {
  if (user.role === "WORKFLOW_APPROVER") return null;
  try {
    const [row] = await queryAsUser<{ visible: number }>(user, "SELECT COUNT(*)::int AS visible FROM event");
    return row?.visible ?? 0;
  } catch (error) {
    console.error("Dashboard count failed", error);
    return null;
  }
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  if (user.role === "WORKFLOW_APPROVER") redirect("/approvals");
  const [{ denied }, visible] = await Promise.all([searchParams, visibleEventCount(user)]);

  const actions = [
    { href: "/events/new", title: "Submit an event", detail: "Create a request and start its approval workflow." },
    { href: "/events", title: "Browse event requests", detail: "View visible event status and approval timelines." },
    { href: "/availability", title: "Check venue dates", detail: "Browse reservations and pending requests." },
    ...(APPROVAL_ROLES.includes(user.role) ? [{ href: "/approvals", title: "Review approvals", detail: "Open requests assigned to you." }] : []),
    ...(STAFF_ROLES.includes(user.role) ? [{ href: "/analytics", title: "View analytics", detail: "Review event and resource usage." }] : []),
    ...(ADMIN_ROLES.includes(user.role) ? [{ href: "/admin", title: "Manage inventory", detail: "Update venues and shared resources." }] : [])
  ];

  return <AppShell active="">
    <div className="page-heading">
      <div><span className="eyebrow">{ROLE_LABELS[user.role]}</span><h1 className="page-title">Welcome, {user.name.split(" ")[0]}</h1><p className="page-description">Your campus event workspace is ready.</p></div>
    </div>
    {denied && <p className="message error" role="alert">You do not have access to that page.</p>}
    <div className="section-stack">
      <section className="panel panel-pad dashboard-summary">
        <div><span className="eyebrow">Campus activity</span><h2 className="panel-title">Requests visible to your role</h2><p className="panel-copy">Your access is enforced by your account and campus permissions.</p></div>
        <strong className="dashboard-count">{visible ?? "—"}</strong>
      </section>
      <div className="grid three">
        {actions.map(action => <Link key={action.href} href={action.href} className="panel panel-pad dashboard-action">
          <h2 className="panel-title">{action.title}</h2><p className="panel-copy">{action.detail}</p>
          <span className="subtle-link">Open <span aria-hidden="true">→</span></span>
        </Link>)}
      </div>
    </div>
  </AppShell>;
}
