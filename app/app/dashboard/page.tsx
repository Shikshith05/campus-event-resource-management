import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ROLE_LABELS, getSessionUser } from "../../lib/auth";
import { queryAsUser } from "../../lib/db";
import {
  ADMIN_ROLES,
  APPROVER_ROLES,
  type SessionUser
} from "../../lib/session";
import styles from "../auth.module.css";
import LogoutButton from "./LogoutButton";

export const metadata: Metadata = { title: "Dashboard | CERMS" };

// How many event requests this user can see. The SAME query returns a
// different number per user, because PostgreSQL row-level security
// filters the rows (a student sees only their own requests).
async function visibleEventCount(user: SessionUser): Promise<number | null> {
  try {
    const [row] = await queryAsUser<{ visible: number }>(
      user,
      "SELECT COUNT(*)::int AS visible FROM event"
    );
    return row?.visible ?? 0;
  } catch (error) {
    console.error("Dashboard count failed", error);
    return null;
  }
}

function RoleSection({ user, visible }: { user: SessionUser; visible: number | null }) {
  const count = visible === null ? "unavailable" : String(visible);

  if (ADMIN_ROLES.includes(user.role)) {
    return (
      <section className={styles.section}>
        <h2>Administration</h2>
        <p>Event requests on the system: <strong>{count}</strong></p>
        <p className={styles.muted}>
          Placeholder: venue, resource and user management will appear here.
        </p>
      </section>
    );
  }

  if (APPROVER_ROLES.includes(user.role)) {
    return (
      <section className={styles.section}>
        <h2>Approvals</h2>
        <p>Event requests you can review: <strong>{count}</strong></p>
        <p className={styles.muted}>
          Placeholder: your approver inbox will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2>My event requests</h2>
      <p>Requests you have submitted: <strong>{count}</strong></p>
      <p className={styles.muted}>
        Placeholder: the event request form and your request history will
        appear here.
      </p>
    </section>
  );
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?next=/dashboard");
  }
  const { denied } = await searchParams;
  const visible = await visibleEventCount(user);

  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${styles.wide}`}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Welcome, {user.name}</h1>
            <span className={styles.badge}>{ROLE_LABELS[user.role]}</span>
            <p className={styles.muted}>{user.email}</p>
          </div>
          <LogoutButton />
        </header>
        {denied && (
          <p className={styles.error} role="alert">
            You do not have access to that page.
          </p>
        )}
        <RoleSection user={user} visible={visible} />
      </div>
    </main>
  );
}
