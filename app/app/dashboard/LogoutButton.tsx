"use client";

export default function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <button className="logout-button" type="button" onClick={logout}>
      Log out
    </button>
  );
}
