import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import AdminConsole from "../components/AdminConsole";

export const metadata: Metadata = { title: "Administration | CERMS" };

export default function AdminPage() {
  return <AppShell active="admin">
    <div className="page-heading">
      <div><span className="eyebrow">System management</span><h1 className="page-title">Campus inventory</h1><p className="page-description">Manage venues and shared resources used across event requests.</p></div>
    </div>
    <AdminConsole />
  </AppShell>;
}
