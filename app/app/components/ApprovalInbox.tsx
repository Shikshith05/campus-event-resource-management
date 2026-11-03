"use client";

import { useCallback, useEffect, useState } from "react";
import { approverLabel } from "../../lib/workflow-labels";
import type { AppRole } from "../../lib/session";

type ApprovalItem = {
  event_id: number;
  workflow: { template_code: string; submitted_by_user_id: number; submitted_at: string; current_stage_no: number; total_stages: number };
  stage: { stage_no: number; name: string; approver_role: string; stage_assigned_at: string | null; due_by: string | null };
  event: { title: string; category: string; event_type: string; expected_footfall: number; status: string; organizer_name: string; department_code: string | null; club_name: string | null } | null;
  booking: { booking_id: number; status: string; start_time: string; end_time: string; venue_id: number; venue_name: string; venue_capacity: number } | null;
  priority_score: number | null;
};

const fmtDate = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export default function ApprovalInbox({ canDecide, viewerRole }: { canDecide: boolean; viewerRole: AppRole | null }) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/approvals", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load your approval inbox.");
    setItems(data.items as ApprovalItem[]);
  }, []);

  useEffect(() => {
    load().catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load your approval inbox."))
      .finally(() => setLoading(false));
  }, [load]);

  async function decide(eventId: number, action: "approve" | "reject") {
    const comment = comments[eventId]?.trim() ?? "";
    if (action === "reject" && !comment) {
      setError("Add a comment explaining the rejection before continuing.");
      return;
    }
    setBusyId(eventId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/approvals/${eventId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(comment ? { comment } : {}) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The decision could not be saved.");
      const next = data.current_stage_no
        ? ` The request moved to stage ${data.current_stage_no}.`
        : data.workflow_status === "REJECTED" ? " The request was rejected." : " The approval workflow is complete.";
      setNotice(`${action === "approve" ? "Approval recorded." : "Rejection recorded."}${next}`);
      setComments(current => ({ ...current, [eventId]: "" }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="section-stack">
      {!canDecide && <p className="message">{viewerRole === "CLUB_COORDINATOR"
        ? "Showing pending requests for clubs you coordinate. This view is read-only; the assigned faculty approver makes the decision."
        : "This inbox is read-only. Only an approver assigned to the current stage can record a decision."}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message" role="status">{notice}</p>}
      {loading ? <section className="panel panel-pad"><p className="muted">Loading your approval inbox…</p></section> : items.length ? items.map(item => {
        const overdue = item.stage.due_by ? new Date(item.stage.due_by).getTime() < Date.now() : false;
        return (
          <article className="panel approval-card" key={item.event_id}>
            <div className="card-head">
              <div>
                <span className="eyebrow">{approverLabel(item.stage.approver_role)} · stage {item.stage.stage_no} of {item.workflow.total_stages}</span>
                <h2 className="panel-title" style={{ fontSize: 21 }}>{item.event?.title ?? `Event #${item.event_id}`}</h2>
                <p className="panel-copy" style={{ marginTop: 5 }}>Submitted {fmtDate(item.workflow.submitted_at)} by {item.event?.organizer_name ?? "requester"}</p>
              </div>
              <div style={{ display: "grid", gap: 7, justifyItems: "end" }}>
                <span className="pill pending">{canDecide ? "Waiting for your review" : "Current approval stage"}</span>
                {overdue && <span className="pill rejected">Overdue</span>}
              </div>
            </div>
            <div className="approval-grid">
              <div>
                <div className="grid two">
                  <div><span className="field-help">Event</span><div>{item.event?.category.replaceAll("_", " ")} · {item.event?.event_type.replaceAll("_", " ")}</div></div>
                  <div><span className="field-help">Attendance</span><div>{item.event?.expected_footfall ?? "—"} expected</div></div>
                  <div><span className="field-help">Group</span><div>{item.event?.club_name ?? item.event?.department_code ?? "Campus"}</div></div>
                  <div><span className="field-help">Priority score</span><div>{item.priority_score ?? "—"}</div></div>
                  <div><span className="field-help">Venue</span><div>{item.booking?.venue_name ?? "Unavailable"}{item.booking ? ` · ${item.booking.venue_capacity} seats` : ""}</div></div>
                  <div><span className="field-help">Event time</span><div>{item.booking ? `${fmtDate(item.booking.start_time)} – ${fmtDate(item.booking.end_time)}` : "Unavailable"}</div></div>
                  <div><span className="field-help">Decision due</span><div>{fmtDate(item.stage.due_by)}</div></div>
                  <div><span className="field-help">Approver role</span><div>{approverLabel(item.stage.approver_role)}</div></div>
                </div>
              </div>
              {canDecide && <div className="approval-action">
                <label className="field" htmlFor={`comment-${item.event_id}`}>
                  <span>{"Comment"} <span className="muted">· required to reject</span></span>
                  <textarea className="control" id={`comment-${item.event_id}`} maxLength={500}
                    value={comments[item.event_id] ?? ""}
                    onChange={event => setComments(current => ({ ...current, [item.event_id]: event.target.value }))}
                    placeholder="Add context for the requester or next approver" />
                </label>
                <div className="button-row">
                  <button className="btn" type="button" disabled={busyId !== null} onClick={() => void decide(item.event_id, "approve")}>
                    {busyId === item.event_id ? "Saving…" : "Approve"}
                  </button>
                  <button className="btn danger" type="button" disabled={busyId !== null} onClick={() => void decide(item.event_id, "reject")}>
                    Reject
                  </button>
                  <span className="field-help">Comments are limited to 500 characters.</span>
                </div>
              </div>}
            </div>
          </article>
        );
      }) : <section className="panel empty-state"><strong>Your inbox is clear</strong>No event requests are waiting for your decision.</section>}
    </div>
  );
}
