"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { approverLabel } from "../../lib/workflow-labels";

type EventRow = {
  event_id: number;
  title: string;
  category: string;
  event_type: string;
  event_status: string;
  expected_footfall: number;
  created_at: string;
  organizer_name: string;
  department_code: string | null;
  club_name: string | null;
  venue_name: string | null;
  building: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_status: string | null;
  preferred_venues: { venue_id: number; venue_name: string; preference_order: number }[] | null;
  guest_name: string | null;
  guest_affiliation: string | null;
  talk_topic: string | null;
};
type GuestDetails = Pick<EventRow, "guest_name" | "guest_affiliation" | "talk_topic">;
type TimelineStage = {
  stage_no: number;
  name: string;
  approver_role: string;
  status: string;
  stage_assigned_at: string | null;
  due_by: string | null;
  acted_at: string | null;
  comment: string | null;
};
type WorkflowResponse = {
  event: { event_id: number; title: string; status: string };
  workflow: { status: string; current_stage_no: number | null; submitted_at: string; stages: TimelineStage[] } | null;
  history: { action: string; stage_no: number | null; comment: string | null; created_at: string }[];
};

const fmtDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const statusClass = (status: string) => status === "APPROVED" ? "approved" : status === "REJECTED" || status === "CANCELLED" ? "rejected" : status === "PENDING_APPROVAL" || status === "IN_PROGRESS" ? "pending" : "neutral";

export default function MyEvents() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<WorkflowResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");

  const loadTimeline = useCallback(async (eventId: number) => {
    setSelectedId(eventId);
    setTimeline(null);
    setTimelineError("");
    setTimelineLoading(true);
    try {
      const response = await fetch(`/api/events/${eventId}/workflow`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load the approval timeline.");
      setTimeline(data as WorkflowResponse);
    } catch (reason) {
      setTimelineError(reason instanceof Error ? reason.message : "Unable to load the approval timeline.");
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/events")
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to load your event requests.");
        const loaded = data.events as EventRow[];
        setRows(loaded);
        const target = Number(new URLSearchParams(window.location.search).get("event"));
        if (Number.isInteger(target) && target > 0 && loaded.some(item => item.event_id === target)) void loadTimeline(target);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load your event requests."))
      .finally(() => setLoading(false));
  }, [loadTimeline]);

  const events = useMemo(() => {
    const map = new Map<number, EventRow>();
    for (const row of rows) if (!map.has(row.event_id)) map.set(row.event_id, row);
    return [...map.values()].filter(event => filter === "ALL" || event.event_status === filter)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [rows, filter]);

  return (
    <div className="section-stack">
      {error && <p className="message error" role="alert">{error}</p>}
      <section className="panel panel-pad">
        <div className="card-head">
          <div><h2 className="panel-title">Event requests</h2><p className="panel-copy">Browse the requests visible to your account and review their approval timelines.</p></div>
          <div className="button-row" style={{ marginTop: 0 }}>
            <select className="control" aria-label="Filter requests by status" value={filter} onChange={event => setFilter(event.target.value)}>
              {["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map(status => <option value={status} key={status}>{status === "ALL" ? "All statuses" : status.replaceAll("_", " ")}</option>)}
            </select>
            <Link className="btn small" href="/events/new">New request</Link>
          </div>
        </div>
        {loading ? <p className="muted">Loading your requests…</p> : events.length ? (
          <div className="section-stack">
            {events.map(event => (
              <article className="panel panel-pad event-card" key={event.event_id}>
                <div className="card-head">
                  <div>
                    <span className={`pill ${statusClass(event.event_status)}`}>{event.event_status.replaceAll("_", " ")}</span>
                    <h3 className="event-title">{event.title}</h3>
                    <p className="event-summary muted">
                      {event.category.replaceAll("_", " ")} · {event.event_type.replaceAll("_", " ")} · {event.expected_footfall} expected
                      {event.department_code ? ` · ${event.department_code}` : ""}{event.club_name ? ` · ${event.club_name}` : ""}
                    </p>
                    <p className="event-organizer muted">Organizer: {event.organizer_name}</p>
                  </div>
                  <button className="btn secondary small" type="button" onClick={() => void loadTimeline(event.event_id)}>
                    {selectedId === event.event_id ? "Refresh timeline" : "Approval timeline"}
                  </button>
                </div>
                <div className="divider" />
                <div className="grid three">
                  <div><span className="field-help">Created</span><div>{fmtDate(event.created_at)}</div></div>
                  <div><span className="field-help">Venue</span><div>{event.venue_name ?? "Not assigned"}{event.building ? ` · ${event.building}` : ""}</div></div>
                  <div><span className="field-help">Event time</span><div>{event.start_time ? `${fmtDate(event.start_time)} – ${fmtDate(event.end_time)}` : "Not scheduled"}</div></div>
                </div>
                {event.guest_name && <GuestBlock guest={event} />}
                {selectedId === event.event_id && (
                  <div className="timeline-panel">
                    {timelineLoading && <p className="muted">Loading timeline…</p>}
                    {timelineError && <p className="message error" role="alert">{timelineError}</p>}
                    {timeline && <WorkflowTimeline data={timeline} guest={event.guest_name ? event : null} />}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><strong>No requests match this view</strong>Create a request to start an event approval.</div>}
      </section>
    </div>
  );
}

function GuestBlock({ guest }: { guest: GuestDetails }) {
  return (
    <div className="comment-box guest-details">
      <span className="field-help">Guest lecture</span>
      <div><strong>{guest.guest_name}</strong>{guest.guest_affiliation ? ` · ${guest.guest_affiliation}` : ""}</div>
      {guest.talk_topic && <div>Topic: {guest.talk_topic}</div>}
    </div>
  );
}

function WorkflowTimeline({ data, guest }: { data: WorkflowResponse; guest: GuestDetails | null }) {
  if (!data.workflow) return <div><h3 className="panel-title">Approval timeline</h3><p className="muted">This event does not have a workflow. It may still be a draft.</p></div>;
  return (
    <div className="grid two workflow-details">
      <div>
        <div className="card-head"><div><h3 className="panel-title">Approval progress</h3><p className="panel-copy">Submitted · {fmtDate(data.workflow.submitted_at)}</p></div><span className={`pill ${statusClass(data.workflow.status)}`}>{data.workflow.status.replaceAll("_", " ")}</span></div>
        {guest && <p className="timeline-detail guest-summary">Guest lecture by {guest.guest_name}{guest.guest_affiliation ? ` (${guest.guest_affiliation})` : ""}{guest.talk_topic ? `: “${guest.talk_topic}”` : ""}</p>}
        <ol className="timeline">
          {data.workflow.stages.map(stage => {
            const done = ["APPROVED", "SKIPPED"].includes(stage.status);
            const rejected = stage.status === "REJECTED";
            const current = stage.status === "PENDING" && stage.stage_no === data.workflow?.current_stage_no;
            return <li key={stage.stage_no}>
              <span className={`timeline-mark${done ? " done" : rejected ? " rejected" : current ? " current" : ""}`}>{done ? "✓" : rejected ? "×" : stage.stage_no}</span>
              <div>
                <div className="card-head"><span className="timeline-name">{approverLabel(stage.approver_role)}</span><span className={`pill ${stage.status === "APPROVED" ? "approved" : rejected ? "rejected" : current ? "pending" : "neutral"}`}>{stage.status.replaceAll("_", " ")}</span></div>
                <div className="timeline-detail">{current ? "Current stage · awaiting action" : stage.status === "PENDING" ? "Pending" : approverLabel(stage.approver_role)}{stage.due_by ? ` · due ${fmtDate(stage.due_by)}` : ""}</div>
                {stage.acted_at && <div className="timeline-detail">{stage.status === "SKIPPED" ? "Skipped" : stage.status.replaceAll("_", " ")} · {fmtDate(stage.acted_at)}</div>}
                {stage.comment && <div className="comment-box">“{stage.comment}”</div>}
              </div>
            </li>;
          })}
        </ol>
      </div>
      <div>
        <h3 className="panel-title">Activity</h3>
        <p className="panel-copy">Recorded workflow updates.</p>
        {data.history.length ? data.history.slice().reverse().map((entry, index) => (
          <div className="comment-box" key={`${entry.action}-${entry.created_at}-${index}`}>
            <strong>{entry.action.replaceAll("_", " ")}</strong><div className="timeline-detail">{fmtDate(entry.created_at)}{entry.stage_no ? ` · stage ${entry.stage_no}` : ""}</div>
            {entry.comment && <div style={{ marginTop: 5 }}>{entry.comment}</div>}
          </div>
        )) : <p className="muted">No workflow activity has been recorded.</p>}
      </div>
    </div>
  );
}
