"use client";

import { useState, type FormEvent } from "react";
import styles from "../auth.module.css";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      <label className={styles.label} htmlFor="login-password">Password</label>
      <div className={styles.passwordField}>
        <input
          className={`${styles.input} ${styles.passwordInput}`}
          id="login-password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          required
        />
        <button
          className={styles.passwordToggle}
          type="button"
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          onClick={() => setShowPassword(value => !value)}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
