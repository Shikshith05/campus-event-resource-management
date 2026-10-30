"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Venue = { venue_id: number; name: string; venue_type: string; building: string | null; capacity: number };
type Resource = { resource_id: number; name: string; resource_type: string; total_quantity: number };
type EventOptions = {
  departments: { department_id: number; code: string; name: string }[];
  venues: Venue[];
  resources: Resource[];
  clubs: { club_id: number; name: string; department_id: number | null }[];
};
type Alternate = { venue_id: number; venue_name: string; capacity: number; spare_seats: number };
type ApiMessage = { message?: string; status?: string; event_id?: number; event_status?: string; workflow?: { stages: { stage_no: number; name: string; status: string }[] }; alternatives?: Alternate[] };

const categories = ["ACADEMIC", "DEPARTMENT", "CLUB", "PERSONAL"] as const;
const eventTypes = ["WORKSHOP", "SEMINAR", "TECH_FEST", "CULTURAL", "CLUB_MEET", "ORIENTATION", "COMPETITION", "SPORTS", "OTHER"] as const;
type EventType = (typeof eventTypes)[number] | "GUEST_LECTURE";

// canRequestGuestLecture comes from the server (faculty, HOD, admin). For
// everyone else the GUEST_LECTURE option is never rendered; the API and the
// database refuse it too.
export default function EventRequestForm({ canRequestGuestLecture = false }: { canRequestGuestLecture?: boolean }) {
  const [options, setOptions] = useState<EventOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("ACADEMIC");
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("SEMINAR");
  const [guestName, setGuestName] = useState("");
  const [guestAffiliation, setGuestAffiliation] = useState("");
  const [talkTopic, setTalkTopic] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [footfall, setFootfall] = useState("");
  const [venueId, setVenueId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<ApiMessage | null>(null);
  const [submitted, setSubmitted] = useState<ApiMessage | null>(null);

  useEffect(() => {
    fetch("/api/event-options")
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not load request options.");
        setOptions(data as EventOptions);
      })
      .catch(reason => setOptionsError(reason instanceof Error ? reason.message : "Could not load request options."));
  }, []);

  const selectedVenue = useMemo(
    () => options?.venues.find(venue => venue.venue_id === Number(venueId)),
    [options, venueId]
  );
  const needsDepartment = category !== "PERSONAL";
  const isGuestLecture = eventType === "GUEST_LECTURE";
  const typeOptions: EventType[] = canRequestGuestLecture ? ["GUEST_LECTURE", ...eventTypes] : [...eventTypes];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setConflict(null);
    setSubmitted(null);
    if (!startTime || !endTime || Date.parse(endTime) <= Date.parse(startTime)) {
      setError("Choose an end time after the start time.");
      setBusy(false);
      return;
    }
    if (Date.parse(startTime) <= Date.now()) {
      setError("Choose a start time in the future.");
      setBusy(false);
      return;
    }
    const resources = Object.entries(quantities)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([resource_id, quantity]) => ({ resource_id: Number(resource_id), quantity: Number(quantity) }));
    const body = {
      title: title.trim(),
      category,
      event_type: eventType,
      department_id: needsDepartment ? Number(departmentId) || null : null,
      club_id: category === "CLUB" ? Number(clubId) || null : null,
      expected_footfall: Number(footfall),
      venue_id: Number(venueId),
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      resources,
      ...(isGuestLecture && {
        guest_name: guestName.trim(),
        guest_affiliation: guestAffiliation.trim(),
        talk_topic: talkTopic.trim()
      })
    };
    try {
      const response = await fetch("/api/events/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as ApiMessage;
      if (response.status === 409 && data.status === "VENUE_UNAVAILABLE") {
        setConflict(data);
      } else if (!response.ok) {
        setError(data.message || "The request could not be submitted.");
      } else {
        setSubmitted(data);
        setNotice(`Request submitted. Event #${data.event_id} is now waiting for approval.`);
      }
    } catch {
      setError("The server could not be reached. Your request has not been submitted.");
    } finally {
      setBusy(false);
    }
  }

  if (optionsError) return <p className="message error" role="alert">{optionsError}</p>;
  if (!options) return <section className="panel panel-pad"><p className="muted">Loading request details…</p></section>;

  return (
    <div className="section-stack">
      {notice && <div className="message" role="status">{notice} {submitted?.event_id && <Link className="subtle-link" href={`/events?event=${submitted.event_id}`}>View request →</Link>}</div>}
      {error && <p className="message error" role="alert">{error}</p>}
      {conflict && (
        <section className="message warning" role="alert">
          <strong>That venue was taken by a higher priority request.</strong>
          <div>{conflict.message} Choose one of these venues and submit again for the same time.</div>
          <div className="button-row">
            {conflict.alternatives?.map(alternative => (
              <button className="btn secondary small" type="button" key={alternative.venue_id}
                onClick={() => { setVenueId(String(alternative.venue_id)); setConflict(null); }}>
                Use {alternative.venue_name} · {alternative.capacity} seats
              </button>
            ))}
          </div>
          {!conflict.alternatives?.length && <span>No alternate venues fit this request and time.</span>}
        </section>
      )}

      <form className="panel panel-pad" onSubmit={submit}>
        <div className="field-grid">
          <div className="field full">
            <label htmlFor="event-title">Event name</label>
            <input className="control" id="event-title" required minLength={3} maxLength={150} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Robotics Expo Day" />
          </div>
          <div className="field">
            <label htmlFor="category">Request category</label>
            <select className="control" id="category" value={category} disabled={isGuestLecture} onChange={e => { setCategory(e.target.value as typeof category); setClubId(""); }}>
              {categories.map(item => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
            {isGuestLecture && <span className="field-help">Guest lectures are academic requests.</span>}
          </div>
          <div className="field">
            <label htmlFor="event-type">Event type</label>
            <select className="control" id="event-type" value={eventType} onChange={e => {
              const value = e.target.value as EventType;
              setEventType(value);
              if (value === "GUEST_LECTURE") { setCategory("ACADEMIC"); setClubId(""); }
            }}>
              {typeOptions.map(item => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
            {isGuestLecture && <span className="field-help">Approved by your HOD, then the admin office (gate pass).</span>}
          </div>
          {isGuestLecture && <>
            <div className="field">
              <label htmlFor="guest-name">Guest speaker</label>
              <input className="control" id="guest-name" required minLength={2} maxLength={150} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="e.g. Dr. A. Rao" />
            </div>
            <div className="field">
              <label htmlFor="guest-affiliation">Guest affiliation</label>
              <input className="control" id="guest-affiliation" required minLength={2} maxLength={200} value={guestAffiliation} onChange={e => setGuestAffiliation(e.target.value)} placeholder="Organisation or university" />
            </div>
            <div className="field full">
              <label htmlFor="talk-topic">Talk topic</label>
              <input className="control" id="talk-topic" required minLength={2} maxLength={250} value={talkTopic} onChange={e => setTalkTopic(e.target.value)} placeholder="Title of the talk" />
            </div>
          </>}
          {needsDepartment && (
            <div className="field">
              <label htmlFor="department">Department</label>
              <select className="control" id="department" required value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">Select department</option>
                {options.departments.map(department => <option key={department.department_id} value={department.department_id}>{department.code} · {department.name}</option>)}
              </select>
            </div>
          )}
          {category === "CLUB" && (
            <div className="field">
              <label htmlFor="club">Club</label>
              <select className="control" id="club" required value={clubId} onChange={e => {
                const value = e.target.value;
                setClubId(value);
                const club = options.clubs.find(item => item.club_id === Number(value));
                if (club?.department_id) setDepartmentId(String(club.department_id));
              }}>
                <option value="">Select a club you belong to</option>
                {options.clubs.map(club => <option key={club.club_id} value={club.club_id}>{club.name}</option>)}
              </select>
              {!options.clubs.length && <span className="field-help">No active club memberships are linked to your account.</span>}
            </div>
          )}
          <div className="field">
            <label htmlFor="footfall">Expected attendance</label>
            <input className="control" id="footfall" type="number" min={1} max={selectedVenue?.capacity} required value={footfall} onChange={e => setFootfall(e.target.value)} placeholder="People expected" />
          </div>
          <div className="field">
            <label htmlFor="venue">Preferred venue</label>
            <select className="control" id="venue" required value={venueId} onChange={e => setVenueId(e.target.value)}>
              <option value="">Select a venue</option>
              {options.venues.map(venue => <option key={venue.venue_id} value={venue.venue_id}>{venue.name} · {venue.capacity} seats</option>)}
            </select>
            {selectedVenue && <span className="field-help">{selectedVenue.building || selectedVenue.venue_type} · capacity {selectedVenue.capacity}</span>}
          </div>
          <div className="field">
            <label htmlFor="start-time">Starts</label>
            <input className="control" id="start-time" type="datetime-local" required value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="end-time">Ends</label>
            <input className="control" id="end-time" type="datetime-local" required value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
          <div className="field full">
            <span className="field-label">Equipment request <span className="muted">(optional)</span></span>
            {options.resources.length ? (
              <div className="grid two">
                {options.resources.map(resource => (
                  <label className="field" key={resource.resource_id}>
                    <span>{resource.name} <span className="muted">· {resource.total_quantity} available</span></span>
                    <input className="control" type="number" min={0} max={resource.total_quantity} value={quantities[resource.resource_id] ?? "0"}
                      onChange={e => setQuantities(current => ({ ...current, [resource.resource_id]: e.target.value }))} />
                  </label>
                ))}
              </div>
            ) : <span className="field-help">No active equipment is listed.</span>}
          </div>
        </div>
        <div className="button-row">
          <button className="btn" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit for approval"}</button>
          <span className="field-help">Your request is routed through the approval chain after submission.</span>
        </div>
      </form>
    </div>
  );
}
