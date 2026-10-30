import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import AvailabilityCalendar from "../components/AvailabilityCalendar";

export const metadata: Metadata = { title: "Venue availability | CERMS" };

export default function AvailabilityPage() {
  return <AppShell active="availability">
    <div className="page-heading">
      <div><span className="eyebrow">Plan around the campus</span><h1 className="page-title">Venue availability</h1><p className="page-description">Browse pending requests and confirmed bookings by date and venue.</p></div>
    </div>
    <AvailabilityCalendar />
  </AppShell>;
}
