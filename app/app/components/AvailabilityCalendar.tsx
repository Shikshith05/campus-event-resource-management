"use client";

import { useEffect, useMemo, useState } from "react";

type Booking = {
  booking_id: number;
  event_id: number;
  event_title: string;
  event_category: string;
  venue_id: number;
  venue_name: string;
  building: string | null;
  venue_capacity: number;
  venue_type: string;
  start_time: string;
  end_time: string;
  booking_status: string;
  organizer_name: string;
};
type ActiveVenue = { venue_id: number; name: string };

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const dayEnd = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
const monthLabel = (date: Date) => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
const timeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
const sameDayBookings = (items: Booking[], date: Date) => items.filter(item => new Date(item.start_time) < dayEnd(date) && new Date(item.end_time) > dayStart(date));

export default function AvailabilityCalendar() {
  const [schedule, setSchedule] = useState<Booking[]>([]);
  const [activeVenues, setActiveVenues] = useState<ActiveVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [venueFilter, setVenueFilter] = useState("all");

  useEffect(() => {
    Promise.all([fetch("/api/availability"), fetch("/api/event-options")])
      .then(async ([scheduleResponse, optionsResponse]) => {
        const [scheduleData, optionsData] = await Promise.all([scheduleResponse.json(), optionsResponse.json()]);
        if (!scheduleResponse.ok) throw new Error(scheduleData.message || "Could not load the venue calendar.");
        if (!optionsResponse.ok) throw new Error(optionsData.message || "Could not load the venue list.");
        setSchedule(scheduleData.schedule as Booking[]);
        setActiveVenues((optionsData.venues as { venue_id: number; name: string }[]).map(venue => ({ venue_id: venue.venue_id, name: venue.name })));
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Could not load the venue calendar."))
      .finally(() => setLoading(false));
  }, []);

  const selectedDate = useMemo(() => {
    const [year, monthNumber, day] = selected.split("-").map(Number);
    return new Date(year, monthNumber - 1, day, 12);
  }, [selected]);
  const venues = useMemo(() => activeVenues.map(venue => ({ id: venue.venue_id, name: venue.name })), [activeVenues]);
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    const offset = first.getDay();
    return Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + index, 12));
  }, [month]);
  const dayBookings = useMemo(() => sameDayBookings(schedule, selectedDate)
    .filter(item => venueFilter === "all" || String(item.venue_id) === venueFilter)
    .sort((a, b) => a.start_time.localeCompare(b.start_time)), [schedule, selectedDate, venueFilter]);
  const bookingsByVenue = useMemo(() => {
    const map = new Map<number, Booking[]>();
    for (const booking of dayBookings) map.set(booking.venue_id, [...(map.get(booking.venue_id) ?? []), booking]);
    return [...map.entries()];
  }, [dayBookings]);

  return (
    <div className="section-stack">
      {error && <p className="message error" role="alert">{error}</p>}
      <section className="panel panel-pad">
        <div className="calendar-toolbar">
          <div>
            <span className="eyebrow">Venue calendar</span>
            <div className="calendar-month">{monthLabel(month)}</div>
          </div>
          <div className="calendar-nav">
            <button className="btn secondary small" type="button" onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Previous month">←</button>
            <button className="btn secondary small" type="button" onClick={() => { const now = new Date(); setMonth(now); setSelected(dateKey(now)); }}>Today</button>
            <button className="btn secondary small" type="button" onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Next month">→</button>
          </div>
        </div>
        {loading ? <p className="muted">Loading venue bookings…</p> : (
          <div className="calendar-grid" role="grid" aria-label={monthLabel(month)}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div className="calendar-day-name" role="columnheader" key={day}>{day}</div>)}
            {days.map(date => {
              const bookings = sameDayBookings(schedule, date);
              const isCurrentMonth = date.getMonth() === month.getMonth();
              return (
                <button className={`calendar-cell${isCurrentMonth ? "" : " outside"}${dateKey(date) === selected ? " selected" : ""}`}
                  type="button" role="gridcell" aria-selected={dateKey(date) === selected} key={dateKey(date)} onClick={() => { setSelected(dateKey(date)); setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }}>
                  <span className="calendar-number">{date.getDate()}</span>
                  <span className="calendar-dots" aria-label={`${bookings.length} bookings`}>
                    {bookings.slice(0, 8).map((booking, index) => <span className={`calendar-dot${booking.booking_status === "PENDING" ? " pending" : ""}`} key={`${booking.booking_id}-${index}`} />)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="field-help" style={{ marginTop: 12 }}>Green marks confirmed bookings. Gold marks pending requests.</p>
      </section>

      <section className="panel panel-pad">
        <div className="card-head">
          <div>
            <h2 className="panel-title">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(selectedDate)}</h2>
            <p className="panel-copy">Confirmed reservations and requests currently pending for this day.</p>
          </div>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="venue-filter">Filter venue</label>
            <select className="control" id="venue-filter" value={venueFilter} onChange={event => setVenueFilter(event.target.value)}>
              <option value="all">All venues</option>
              {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
          </div>
        </div>
        {loading ? <p className="muted">Loading bookings…</p> : bookingsByVenue.length ? bookingsByVenue.map(([venueId, bookings]) => (
          <div className="venue-group" key={venueId}>
            <div className="venue-title"><span>{bookings[0].venue_name}</span><span className="muted">{bookings[0].building || bookings[0].venue_type} · {bookings[0].venue_capacity} seats</span></div>
            {bookings.map(booking => (
              <div className="booking-row" key={booking.booking_id}>
                <span className="booking-time">{timeLabel(booking.start_time)} – {timeLabel(booking.end_time)}</span>
                <span><span className="booking-title">{booking.event_title}</span><span className="booking-meta"> · {booking.event_category} · {booking.organizer_name}</span></span>
                <span className={`pill ${booking.booking_status.toLowerCase()}`}>{booking.booking_status}</span>
              </div>
            ))}
          </div>
        )) : <div className="empty-state"><strong>No bookings for this day</strong>The selected venues have no pending or confirmed bookings.</div>}
      </section>
    </div>
  );
}
