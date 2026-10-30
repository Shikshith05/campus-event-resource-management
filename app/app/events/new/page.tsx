import type { Metadata } from "next";
import AppShell from "../../components/AppShell";
import EventRequestForm from "../../components/EventRequestForm";

export const metadata: Metadata = { title: "New event request | CERMS" };

export default function NewEventPage() {
  return <AppShell active="new">
    <div className="page-heading">
      <div><span className="eyebrow">Event planning</span><h1 className="page-title">Request an event</h1><p className="page-description">Tell us what you’re planning, reserve a venue, and request shared equipment.</p></div>
    </div>
    <EventRequestForm />
  </AppShell>;
}
