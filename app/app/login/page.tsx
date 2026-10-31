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
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">C</span>
          <span><span className={styles.brandName}>CERMS</span><span className={styles.brandCaption}>PES University · Ring Road Campus</span></span>
        </div>
        <h1 className={styles.title}>Sign in to your workspace</h1>
        <p className={styles.subtitle}>Manage campus events, venues, and shared resources.</p>
        <LoginForm nextPath={safeNextPath(next)} />
        {process.env.NODE_ENV !== "production" && (
          <details className={styles.hint}>
            <summary>Local development access</summary>
            <p>Seeded test accounts are available for local development. See the “Local demo accounts” section in the repository README for account details.</p>
          </details>
        )}
      </div>
    </main>
  );
}
