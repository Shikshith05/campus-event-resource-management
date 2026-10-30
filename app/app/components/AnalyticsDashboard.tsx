"use client";

import { useEffect, useMemo, useState } from "react";

type EventStat = { category: string; event_type: string; department_id: number | null; event_count: number | string; approved_count: number | string; rejected_count: number | string; cancelled_count: number | string; expected_attendance: number | string | null };
type ResourceStat = { resource_id: number; resource_name: string; resource_type: string; total_quantity: number; booking_count: number | string; total_units_requested: number | string };
type VenueStat = { venue_id: number; venue_name: string; building: string | null; capacity: number; month: string; confirmed_booking_count: number | string; confirmed_hours: number | string };
type AnalyticsData = { events: EventStat[]; resources: ResourceStat[]; venues: VenueStat[] };
const n = (value: number | string | null) => Number(value ?? 0);

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/analytics", { cache: "no-store" })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Unable to load analytics.");
        setData(result as AnalyticsData);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load analytics."));
  }, []);

  const totals = useMemo(() => {
    if (!data) return { events: 0, approved: 0, rejected: 0, attendance: 0 };
    return data.events.reduce((summary, row) => ({
      events: summary.events + n(row.event_count),
      approved: summary.approved + n(row.approved_count),
      rejected: summary.rejected + n(row.rejected_count),
      attendance: summary.attendance + n(row.expected_attendance)
    }), { events: 0, approved: 0, rejected: 0, attendance: 0 });
  }, [data]);
  const maxTypeCount = Math.max(1, ...(data?.events.map(item => n(item.event_count)) ?? [0]));
  const topTypes = data?.events.slice().sort((a, b) => n(b.event_count) - n(a.event_count)).slice(0, 8) ?? [];

  if (error) return <p className="message error" role="alert">{error}</p>;
  if (!data) return <section className="panel panel-pad"><p className="muted">Loading campus analytics…</p></section>;

  return (
    <div className="section-stack">
      <div className="grid three">
        <Metric label="Event requests" value={totals.events.toLocaleString()} foot="Across visible campus records" />
        <Metric label="Approved" value={totals.approved.toLocaleString()} foot={`${totals.events ? Math.round(totals.approved / totals.events * 100) : 0}% of recorded requests`} />
        <Metric label="Expected attendance" value={totals.attendance.toLocaleString()} foot={`${totals.rejected.toLocaleString()} rejected requests`} />
      </div>

      <section className="panel panel-pad">
        <div><h2 className="panel-title">Event mix</h2><p className="panel-copy">Requests grouped by category and event type.</p></div>
        {topTypes.length ? <div className="section-stack" style={{ gap: 13 }}>
          {topTypes.map((row, index) => {
            const count = n(row.event_count);
            return <div key={`${row.category}-${row.event_type}-${row.department_id ?? "none"}`}>
              <div className="card-head" style={{ alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 750 }}>{row.event_type.replaceAll("_", " ")} <span className="muted">· {row.category}</span></span>
                <span className="muted" style={{ fontSize: 12 }}>{count} requests · {n(row.expected_attendance).toLocaleString()} expected guests</span>
              </div>
              <div style={{ height: 8, marginTop: 7, overflow: "hidden", borderRadius: 99, background: "#edf3ef" }}>
                <div style={{ width: `${Math.max(5, count / maxTypeCount * 100)}%`, height: "100%", borderRadius: 99, background: index % 3 === 1 ? "#e9a94a" : index % 3 === 2 ? "#7fb59a" : "#176b52" }} />
              </div>
            </div>;
          })}
        </div> : <div className="empty-state">No event statistics are available.</div>}
        <div className="divider" />
        <div className="table-wrap"><table>
          <thead><tr><th>Category</th><th>Type</th><th>Requests</th><th>Approved</th><th>Rejected</th><th>Cancelled</th></tr></thead>
          <tbody>{data.events.map(row => <tr key={`${row.category}-${row.event_type}-${row.department_id ?? "none"}`}>
            <td>{row.category}</td><td>{row.event_type.replaceAll("_", " ")}</td><td>{n(row.event_count)}</td><td>{n(row.approved_count)}</td><td>{n(row.rejected_count)}</td><td>{n(row.cancelled_count)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <div className="grid two">
        <section className="panel panel-pad">
          <h2 className="panel-title">Resource utilization</h2><p className="panel-copy">Confirmed bookings and units requested by equipment type.</p>
          {data.resources.length ? <div className="table-wrap"><table>
            <thead><tr><th>Resource</th><th>Type</th><th>Bookings</th><th>Units used</th><th>Pool</th></tr></thead>
            <tbody>{data.resources.map(row => <tr key={row.resource_id}><td>{row.resource_name}</td><td>{row.resource_type}</td><td>{n(row.booking_count)}</td><td>{n(row.total_units_requested)}</td><td>{row.total_quantity}</td></tr>)}</tbody>
          </table></div> : <div className="empty-state">No resources are registered.</div>}
        </section>
        <section className="panel panel-pad">
          <h2 className="panel-title">Venue utilization</h2><p className="panel-copy">Monthly confirmed and completed reservations.</p>
          {data.venues.length ? <div className="table-wrap"><table>
            <thead><tr><th>Venue / month</th><th>Bookings</th><th>Hours</th></tr></thead>
            <tbody>{data.venues.map((row, index) => {
              const monthDate = new Date(`${row.month.slice(0, 10)}T12:00:00Z`);
              return <tr key={`${row.venue_id}-${row.month}-${index}`}><td><strong>{row.venue_name}</strong><div className="field-help">{row.building || "Campus"} · {new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(monthDate)}</div></td><td>{n(row.confirmed_booking_count)}</td><td>{n(row.confirmed_hours).toFixed(1)}</td></tr>;
            })}</tbody>
          </table></div> : <div className="empty-state">No confirmed venue usage to report.</div>}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <section className="panel metric"><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-foot">{foot}</span></section>;
}
