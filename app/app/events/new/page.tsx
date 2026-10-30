import type { Metadata } from "next";
import AppShell from "../../components/AppShell";
import EventRequestForm from "../../components/EventRequestForm";
import { getSessionUser } from "../../../lib/auth";
import { STAFF_ROLES } from "../../../lib/session";

export const metadata: Metadata = { title: "New event request | CERMS" };

export default async function NewEventPage() {
  const user = await getSessionUser();
  // Faculty, HOD and admin may request guest lectures (the API and the
  // database enforce the same rule).
  const canRequestGuestLecture = user ? STAFF_ROLES.includes(user.role) : false;
  return <AppShell active="new">
    <div className="page-heading">
      <div><span className="eyebrow">Event planning</span><h1 className="page-title">Request an event</h1><p className="page-description">Tell us what you’re planning, reserve a venue, and request shared equipment.</p></div>
    </div>
    <EventRequestForm canRequestGuestLecture={canRequestGuestLecture} />
  </AppShell>;
}
