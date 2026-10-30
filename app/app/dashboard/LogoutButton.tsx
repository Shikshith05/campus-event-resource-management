"use client";

import styles from "../auth.module.css";

export default function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <button className={styles.secondaryButton} type="button" onClick={logout}>
      Log out
    </button>
  );
}
