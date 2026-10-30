import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import MyEvents from "../components/MyEvents";

export const metadata: Metadata = { title: "My event requests | CERMS" };

export default function EventsPage() {
  return <AppShell active="events">
    <div className="page-heading">
      <div><span className="eyebrow">Event activity</span><h1 className="page-title">Event requests</h1><p className="page-description">See the requests available to your account, their status, and approval timelines.</p></div>
    </div>
    <MyEvents />
  </AppShell>;
}
