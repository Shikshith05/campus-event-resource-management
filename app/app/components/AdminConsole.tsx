"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Department = { department_id: number; code: string; name: string };
type Venue = {
  venue_id: number; name: string; venue_type: string; venue_type_confirmed: boolean;
  building: string | null; capacity: number | null; min_capacity: number | null;
  max_capacity: number | null; department_id: number | null; is_active: boolean;
};
type Resource = { resource_id: number; name: string; resource_type: string; total_quantity: number; is_active: boolean };
type VenueDraft = Omit<Venue, "venue_id">;
type ResourceDraft = Omit<Resource, "resource_id">;
const venueTypes = ["AUDITORIUM", "SEMINAR_HALL", "CLASSROOM", "LAB", "OPEN_AIR", "OTHER"];
const resourceTypes = ["AV", "FURNITURE", "POWER", "DECOR", "OTHER"];

async function sendJson(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "The change could not be saved.");
  return data;
}

export default function AdminConsole() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [venueDrafts, setVenueDrafts] = useState<Record<number, VenueDraft>>({});
  const [resourceDrafts, setResourceDrafts] = useState<Record<number, ResourceDraft>>({});
  const [newVenue, setNewVenue] = useState<VenueDraft>({ name: "", venue_type: "CLASSROOM", venue_type_confirmed: true, building: "", capacity: 60, min_capacity: null, max_capacity: null, department_id: null, is_active: true });
  const [newResource, setNewResource] = useState<ResourceDraft>({ name: "", resource_type: "AV", total_quantity: 1, is_active: true });
  const [tab, setTab] = useState<"venues" | "resources">("venues");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [venueData, resourceData] = await Promise.all([
      sendJson("/api/admin/venues", "GET"),
      sendJson("/api/admin/resources", "GET")
    ]);
    const venueRows = venueData.venues as Venue[];
    const resourceRows = resourceData.resources as Resource[];
    setVenues(venueRows);
    setResources(resourceRows);
    setDepartments(venueData.departments as Department[]);
    setVenueDrafts(Object.fromEntries(venueRows.map(row => [row.venue_id, {
      name: row.name, venue_type: row.venue_type, venue_type_confirmed: row.venue_type_confirmed,
      building: row.building, capacity: row.capacity, min_capacity: row.min_capacity, max_capacity: row.max_capacity,
      department_id: row.department_id, is_active: row.is_active
    }])));
    setResourceDrafts(Object.fromEntries(resourceRows.map(row => [row.resource_id, {
      name: row.name, resource_type: row.resource_type, total_quantity: row.total_quantity, is_active: row.is_active
    }])));
  }, []);

  useEffect(() => {
    load().catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load administration data."))
      .finally(() => setLoading(false));
  }, [load]);

  async function saveVenue(id: number) {
    setBusy(`venue-${id}`); setError(""); setNotice("");
    try {
      const data = await sendJson(`/api/admin/venues/${id}`, "PATCH", venueDrafts[id]);
      setVenues(current => current.map(row => row.venue_id === id ? data.venue as Venue : row));
      setNotice(`Saved ${data.venue.name}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update venue."); }
    finally { setBusy(""); }
  }

  async function createVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("venue-new"); setError(""); setNotice("");
    try {
      const data = await sendJson("/api/admin/venues", "POST", { ...newVenue, building: newVenue.building || null });
      const row = data.venue as Venue;
      setVenues(current => [...current, row].sort((a, b) => a.name.localeCompare(b.name)));
      setVenueDrafts(current => ({ ...current, [row.venue_id]: { name: row.name, venue_type: row.venue_type, venue_type_confirmed: row.venue_type_confirmed, building: row.building, capacity: row.capacity, min_capacity: row.min_capacity, max_capacity: row.max_capacity, department_id: row.department_id, is_active: row.is_active } }));
      setNewVenue({ name: "", venue_type: "CLASSROOM", venue_type_confirmed: true, building: "", capacity: 60, min_capacity: null, max_capacity: null, department_id: null, is_active: true });
      setNotice(`${row.name} was added.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add venue."); }
    finally { setBusy(""); }
  }

  async function saveResource(id: number) {
    setBusy(`resource-${id}`); setError(""); setNotice("");
    try {
      const data = await sendJson(`/api/admin/resources/${id}`, "PATCH", resourceDrafts[id]);
      setResources(current => current.map(row => row.resource_id === id ? data.resource as Resource : row));
      setNotice(`Saved ${data.resource.name}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update resource."); }
    finally { setBusy(""); }
  }

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("resource-new"); setError(""); setNotice("");
    try {
      const data = await sendJson("/api/admin/resources", "POST", newResource);
      const row = data.resource as Resource;
      setResources(current => [...current, row].sort((a, b) => a.name.localeCompare(b.name)));
      setResourceDrafts(current => ({ ...current, [row.resource_id]: { name: row.name, resource_type: row.resource_type, total_quantity: row.total_quantity, is_active: row.is_active } }));
      setNewResource({ name: "", resource_type: "AV", total_quantity: 1, is_active: true });
      setNotice(`${row.name} was added.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add resource."); }
    finally { setBusy(""); }
  }

  if (loading) return <section className="panel panel-pad"><p className="muted">Loading campus inventory…</p></section>;

  return (
    <div className="section-stack">
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message" role="status">{notice}</p>}
      <section className="panel panel-pad">
        <div className="card-head">
          <div><h2 className="panel-title">Campus inventory</h2><p className="panel-copy">Update bookable spaces and shared equipment. Retire items to keep past bookings intact.</p></div>
          <div className="button-row" style={{ marginTop: 0 }}>
            <button className={`btn small${tab === "venues" ? "" : " secondary"}`} type="button" onClick={() => setTab("venues")}>Venues <span className="pill neutral">{venues.length}</span></button>
            <button className={`btn small${tab === "resources" ? "" : " secondary"}`} type="button" onClick={() => setTab("resources")}>Resources <span className="pill neutral">{resources.length}</span></button>
          </div>
        </div>
      </section>

      {tab === "venues" ? <>
        <section className="panel panel-pad">
          <h2 className="panel-title">Add a venue</h2><p className="panel-copy">An estimated range is displayed to requesters, but booking stays disabled until a confirmed capacity is entered.</p>
          <form className="field-grid" onSubmit={createVenue}>
            <div className="field"><label htmlFor="new-venue-name">Name</label><input id="new-venue-name" className="control" required maxLength={100} value={newVenue.name} onChange={e => setNewVenue(current => ({ ...current, name: e.target.value }))} /></div>
            <div className="field"><label htmlFor="new-venue-type">Venue type</label><select id="new-venue-type" className="control" value={newVenue.venue_type} onChange={e => setNewVenue(current => ({ ...current, venue_type: e.target.value }))}>{venueTypes.map(type => <option key={type}>{type}</option>)}</select></div>
            <div className="field"><label htmlFor="new-venue-type-confirmed">Type status</label><select id="new-venue-type-confirmed" className="control" value={String(newVenue.venue_type_confirmed)} onChange={e => setNewVenue(current => ({ ...current, venue_type_confirmed: e.target.value === "true" }))}><option value="true">Confirmed</option><option value="false">Pending confirmation</option></select></div>
            <div className="field"><label htmlFor="new-venue-building">Building / location</label><input id="new-venue-building" className="control" maxLength={100} value={newVenue.building ?? ""} onChange={e => setNewVenue(current => ({ ...current, building: e.target.value }))} /></div>
            <div className="field"><label htmlFor="new-venue-capacity">Confirmed capacity</label><input id="new-venue-capacity" className="control" type="number" min={1} value={newVenue.capacity ?? ""} onChange={e => setNewVenue(current => ({ ...current, capacity: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
            <div className="field"><label htmlFor="new-venue-min">Estimated minimum</label><input id="new-venue-min" className="control" type="number" min={1} value={newVenue.min_capacity ?? ""} onChange={e => setNewVenue(current => ({ ...current, min_capacity: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
            <div className="field"><label htmlFor="new-venue-max">Estimated maximum</label><input id="new-venue-max" className="control" type="number" min={1} value={newVenue.max_capacity ?? ""} onChange={e => setNewVenue(current => ({ ...current, max_capacity: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
            <div className="field"><label htmlFor="new-venue-dept">Managing department</label><select id="new-venue-dept" className="control" value={newVenue.department_id ?? ""} onChange={e => setNewVenue(current => ({ ...current, department_id: Number(e.target.value) || null }))}><option value="">Central / campus-wide</option>{departments.map(department => <option value={department.department_id} key={department.department_id}>{department.code}</option>)}</select></div>
            <div className="field" style={{ justifyContent: "end" }}><button className="btn" type="submit" disabled={busy !== ""}>{busy === "venue-new" ? "Adding…" : "Add venue"}</button></div>
          </form>
        </section>
        <section className="panel panel-pad">
          <h2 className="panel-title">Manage venues</h2><p className="panel-copy">Update details, adjust capacity, or retire a venue.</p>
          {venues.length ? <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Type status</th><th>Building</th><th>Department</th><th>Confirmed capacity</th><th>Estimated range</th><th>Availability</th><th /></tr></thead>
            <tbody>{venues.map(row => {
              const draft = venueDrafts[row.venue_id] ?? row;
              return <tr key={row.venue_id}>
                <td><input className="control" aria-label={`${row.name} name`} value={draft.name} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, name: e.target.value } }))} /></td>
                <td><select className="control" aria-label={`${row.name} type`} value={draft.venue_type} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, venue_type: e.target.value } }))}>{venueTypes.map(type => <option key={type}>{type}</option>)}</select></td>
                <td><select className="control" aria-label={`${row.name} type confirmation`} value={String(draft.venue_type_confirmed)} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, venue_type_confirmed: e.target.value === "true" } }))}><option value="true">Confirmed</option><option value="false">Pending</option></select></td>
                <td><input className="control" aria-label={`${row.name} building`} value={draft.building ?? ""} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, building: e.target.value || null } }))} /></td>
                <td><select className="control" aria-label={`${row.name} department`} value={draft.department_id ?? ""} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, department_id: Number(e.target.value) || null } }))}><option value="">Central</option>{departments.map(department => <option value={department.department_id} key={department.department_id}>{department.code}</option>)}</select></td>
                <td><input className="control" aria-label={`${row.name} confirmed capacity`} type="number" min={1} value={draft.capacity ?? ""} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, capacity: e.target.value === "" ? null : Number(e.target.value) } }))} /></td>
                <td><div className="grid two"><input className="control" aria-label={`${row.name} estimated minimum`} type="number" min={1} value={draft.min_capacity ?? ""} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, min_capacity: e.target.value === "" ? null : Number(e.target.value) } }))} /><input className="control" aria-label={`${row.name} estimated maximum`} type="number" min={1} value={draft.max_capacity ?? ""} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, max_capacity: e.target.value === "" ? null : Number(e.target.value) } }))} /></div></td>
                <td><select className="control" aria-label={`${row.name} status`} value={String(draft.is_active)} onChange={e => setVenueDrafts(current => ({ ...current, [row.venue_id]: { ...draft, is_active: e.target.value === "true" } }))}><option value="true">Active</option><option value="false">Retired</option></select></td>
                <td><button className="btn small" type="button" disabled={busy !== ""} onClick={() => void saveVenue(row.venue_id)}>{busy === `venue-${row.venue_id}` ? "Saving…" : "Save"}</button></td>
              </tr>;
            })}</tbody>
          </table></div> : <div className="empty-state">No venues have been added yet.</div>}
        </section>
      </> : <>
        <section className="panel panel-pad">
          <h2 className="panel-title">Add a resource</h2><p className="panel-copy">Track shared equipment available for event bookings.</p>
          <form className="field-grid" onSubmit={createResource}>
            <div className="field"><label htmlFor="new-resource-name">Name</label><input id="new-resource-name" className="control" required maxLength={100} value={newResource.name} onChange={e => setNewResource(current => ({ ...current, name: e.target.value }))} /></div>
            <div className="field"><label htmlFor="new-resource-type">Resource type</label><select id="new-resource-type" className="control" value={newResource.resource_type} onChange={e => setNewResource(current => ({ ...current, resource_type: e.target.value }))}>{resourceTypes.map(type => <option key={type}>{type}</option>)}</select></div>
            <div className="field"><label htmlFor="new-resource-quantity">Total quantity</label><input id="new-resource-quantity" className="control" type="number" min={0} required value={newResource.total_quantity} onChange={e => setNewResource(current => ({ ...current, total_quantity: Number(e.target.value) }))} /></div>
            <div className="field" style={{ justifyContent: "end" }}><button className="btn" type="submit" disabled={busy !== ""}>{busy === "resource-new" ? "Adding…" : "Add resource"}</button></div>
          </form>
        </section>
        <section className="panel panel-pad">
          <h2 className="panel-title">Manage resources</h2><p className="panel-copy">Adjust pool quantities or retire equipment.</p>
          {resources.length ? <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Total quantity</th><th>Availability</th><th /></tr></thead>
            <tbody>{resources.map(row => {
              const draft = resourceDrafts[row.resource_id] ?? row;
              return <tr key={row.resource_id}>
                <td><input className="control" aria-label={`${row.name} name`} value={draft.name} onChange={e => setResourceDrafts(current => ({ ...current, [row.resource_id]: { ...draft, name: e.target.value } }))} /></td>
                <td><select className="control" aria-label={`${row.name} type`} value={draft.resource_type} onChange={e => setResourceDrafts(current => ({ ...current, [row.resource_id]: { ...draft, resource_type: e.target.value } }))}>{resourceTypes.map(type => <option key={type}>{type}</option>)}</select></td>
                <td><input className="control" aria-label={`${row.name} total quantity`} type="number" min={0} value={draft.total_quantity} onChange={e => setResourceDrafts(current => ({ ...current, [row.resource_id]: { ...draft, total_quantity: Number(e.target.value) } }))} /></td>
                <td><select className="control" aria-label={`${row.name} status`} value={String(draft.is_active)} onChange={e => setResourceDrafts(current => ({ ...current, [row.resource_id]: { ...draft, is_active: e.target.value === "true" } }))}><option value="true">Active</option><option value="false">Retired</option></select></td>
                <td><button className="btn small" type="button" disabled={busy !== ""} onClick={() => void saveResource(row.resource_id)}>{busy === `resource-${row.resource_id}` ? "Saving…" : "Save"}</button></td>
              </tr>;
            })}</tbody>
          </table></div> : <div className="empty-state">No resources have been added yet.</div>}
        </section>
      </>}
    </div>
  );
}
