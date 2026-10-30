import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import AnalyticsDashboard from "../components/AnalyticsDashboard";

export const metadata: Metadata = { title: "Analytics | CERMS" };

export default function AnalyticsPage() {
  return <AppShell active="analytics">
    <div className="page-heading">
      <div><span className="eyebrow">Campus operations</span><h1 className="page-title">Event analytics</h1><p className="page-description">Request outcomes, expected attendance, and utilization of shared resources and venues.</p></div>
    </div>
    <AnalyticsDashboard />
  </AppShell>;
}
