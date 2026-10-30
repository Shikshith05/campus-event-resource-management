import type { Metadata } from "next";
import styles from "../auth.module.css";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Log in | CERMS" };

// Only allow redirects to paths on this site ("/dashboard"), never to
// another site ("//evil.example" or "https://...").
function safeNextPath(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>CERMS</h1>
        <p className={styles.subtitle}>Campus Event and Resource Management System</p>
        <LoginForm nextPath={safeNextPath(next)} />
        {process.env.NODE_ENV !== "production" && (
          <p className={styles.hint}>
            Development accounts: e.g. student.one@campus.example,
            faculty.one@campus.example or admin.one@campus.example with
            password <code>password123</code>.
          </p>
        )}
      </div>
    </main>
  );
}
