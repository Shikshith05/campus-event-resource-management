import Link from "next/link";

const roles = ["Student", "Club Coordinator", "Faculty", "HOD", "Admin"];

export default function DashboardPage() {
  return (
    <main>
      <h1>Campus Event and Resource Management System</h1>
      <p>
        Submit events, check venue availability, follow approvals, and manage
        shared campus resources.
      </p>
      <nav aria-label="Primary navigation">
        <Link href="/api/health">System health</Link>
        {" | "}
        <Link href="/api/events">Event requests</Link>
        {" | "}
        <Link href="/api/availability">Availability</Link>
      </nav>
      <section>
        <h2>Supported roles</h2>
        <ul>
          {roles.map(role => <li key={role}>{role}</li>)}
        </ul>
      </section>
    </main>
  );
}
