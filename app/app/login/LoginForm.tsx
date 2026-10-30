"use client";

import { useState, type FormEvent } from "react";
import styles from "../auth.module.css";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "Login failed");
        return;
      }
      // Full page load, so the middleware sees the new session cookie.
      window.location.assign(nextPath);
    } catch {
      setError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <label className={styles.label}>
        Email
        <input
          className={styles.input}
          type="email"
          autoComplete="username"
          value={email}
          onChange={event => setEmail(event.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Password
        <input
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          required
        />
      </label>
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
