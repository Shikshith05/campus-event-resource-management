# CERMS API reference

For the front end. Every route is under `http://localhost:3000` in development (`cd app && npm run dev`).

## Conventions

- **Login first.** `POST /api/auth/login` sets an httpOnly cookie `cerms_session`; the browser sends it automatically on same-site requests (`fetch` from our pages needs no extra options). Without it, API routes answer **401**.
- **Bodies are JSON** (`Content-Type: application/json`). Timestamps are ISO 8601 with an offset, e.g. `2026-12-10T16:00:00+05:30`.
- **Errors** always look like `{ "message": "..." }`, sometimes with `issues` (validation) or `sqlstate` (a database rule).

| Status | Meaning |
|---|---|
| 400 | body or URL is invalid (`issues` lists the fields) |
| 401 | not logged in |
| 403 | logged in, but not allowed (wrong role, or not the assigned approver) |
| 404 | not found, or hidden from this user by row-level security |
| 409 | conflict: venue taken, workflow already finished, or changed by someone else |
| 422 | the request breaks a business rule (capacity, not a club member, no approver for a stage ...) |
| 503 | a database is unreachable; try again |

- **Data visibility is enforced by PostgreSQL**, not by the route: the same URL returns different rows for different users. Every query runs as the logged-in user (`queryAsUser` / `withUserTransaction` in `app/lib/db.ts`).

### Roles

| App role | Example login (password `password123`, dev only) | Can approve? |
|---|---|---|
| STUDENT | `student.one@campus.example`, `student.two@campus.example` | no |
| CLUB_COORDINATOR | `coordinator.one@campus.example`, `coordinator.two@campus.example` | stage 1 of club events |
| FACULTY | `faculty.one@campus.example`, `faculty.two@campus.example` | yes |
| HOD | `hod.cse@campus.example`, `hod.ece@campus.example` | yes |
| ADMIN | `admin.one@campus.example` | yes |

After a fresh reset, these approvers each have one pending item: `coordinator.two` (event 7), `faculty.two` (event 8), `hod.cse` (event 3) and `admin.one` (event 2).

---

## Summary

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | log in, sets the cookie |
| POST | `/api/auth/logout` | anyone | clear the cookie |
| GET | `/api/auth/me` | logged in | who am I |
| GET | `/api/health` | public | both databases reachable? |
| GET | `/api/event-options` | logged in | departments, active venues/resources and my clubs for the request form |
| GET | `/api/events` | logged in | event requests (students: own only; coordinators: own + their club's) |
| GET | `/api/availability` | logged in | venue calendar (everyone's PENDING/CONFIRMED bookings) |
| GET | `/api/analytics` | Faculty, HOD, Admin | event, resource and venue statistics |
| GET/POST | `/api/admin/venues` | Admin | list, create venues |
| PATCH | `/api/admin/venues/{venueId}` | Admin | partial update or retire a venue |
| GET/POST | `/api/admin/resources` | Admin | list, create resources |
| PATCH | `/api/admin/resources/{resourceId}` | Admin | partial update or retire a resource |
| **POST** | **`/api/events/submit`** | logged in | submit a request and start its approval |
| **GET** | **`/api/events/{eventId}/workflow`** | logged in, if the event is visible | approval timeline of one event |
| **GET** | **`/api/approvals`** | Coordinator, Faculty, HOD, Admin | my approver inbox |
| **POST** | **`/api/approvals/{eventId}`** | the assigned approver only | approve or reject the current stage |

---

## Authentication

### `POST /api/auth/login` (public)

```json
{ "email": "student.two@campus.example", "password": "password123" }
```

`200` (and `Set-Cookie: cerms_session=...; HttpOnly; SameSite=Lax`):

```json
{ "user": { "userId": 2, "name": "Student Two", "email": "student.two@campus.example", "role": "STUDENT" } }
```

`400` invalid body · `401 { "message": "Invalid email or password" }` (same for unknown email).

### `POST /api/auth/logout`

`200 { "message": "Logged out" }` and the cookie is cleared.

### `GET /api/auth/me`

`200 { "user": { "userId": 7, "name": "HOD One", "email": "hod.cse@campus.example", "role": "HOD" } }` · `401`.

---

## Submitting a request

### `GET /api/event-options`: any logged-in user

Returns the active reference data used by the event request form. The club list contains only active clubs where the logged-in user is a member.

```json
{
  "departments": [{ "department_id": 1, "code": "CSE", "name": "Computer Science and Engineering" }],
  "venues": [{ "venue_id": 1, "name": "Auditorium 1", "venue_type": "AUDITORIUM", "building": "Main Block", "capacity": 500 }],
  "resources": [{ "resource_id": 1, "name": "Projector", "resource_type": "AV", "total_quantity": 10 }],
  "clubs": [{ "club_id": 1, "name": "Coding Club", "department_id": 1 }]
}
```

`401` · `503`.

### `POST /api/events/submit`: any logged-in user

The organizer is **always the logged-in user** (never taken from the body).

```json
{
  "title": "Robotics Expo Day",
  "category": "CLUB",
  "event_type": "TECH_FEST",
  "department_id": 2,
  "club_id": 2,
  "expected_footfall": 120,
  "venue_id": 5,
  "start_time": "2026-12-10T16:00:00+05:30",
  "end_time": "2026-12-10T19:00:00+05:30",
  "resources": [ { "resource_id": 3, "quantity": 1 }, { "resource_id": 2, "quantity": 2 } ]
}
```

| Field | Rules |
|---|---|
| `title` | 3-150 characters |
| `category` | `ACADEMIC`, `DEPARTMENT`, `CLUB`, `PERSONAL` |
| `event_type` | `GUEST_LECTURE` (Faculty, HOD, Admin only), `WORKSHOP`, `SEMINAR`, `TECH_FEST`, `CULTURAL`, `CLUB_MEET`, `ORIENTATION`, `COMPETITION`, `SPORTS`, `OTHER` |
| `department_id` | required unless `PERSONAL` |
| `club_id` | required for `CLUB`, must be null otherwise; the user must be a member |
| `expected_footfall` | > 0 and <= the venue's capacity |
| `venue_id`, `start_time`, `end_time` | end after start, start in the future |
| `resources` | optional, each `resource_id` once, `quantity` > 0 |
| `guest_name`, `guest_affiliation`, `talk_topic` | **required** for `GUEST_LECTURE` (2-150 / 2-200 / 2-250 characters), not allowed for other types |

#### Guest lectures (Faculty, HOD, Admin)

A guest lecture must use `category: "ACADEMIC"` (so the `GUEST_LECTURE` workflow template is chosen) and include the three guest fields:

```json
{
  "title": "Guest Lecture: Databases at Scale",
  "category": "ACADEMIC",
  "event_type": "GUEST_LECTURE",
  "department_id": 1,
  "expected_footfall": 80,
  "venue_id": 3,
  "start_time": "2026-12-15T10:00:00+05:30",
  "end_time": "2026-12-15T12:00:00+05:30",
  "resources": [ { "resource_id": 1, "quantity": 1 } ],
  "guest_name": "Dr. Meera Iyer",
  "guest_affiliation": "Institute of Data Systems",
  "talk_topic": "Scaling relational databases"
}
```

The guest details are saved in `guest_lecture_details` in the same transaction as the event. The workflow uses the `GUEST_LECTURE` template. For a faculty/HOD/admin requester, stage 1 (Faculty In-charge Review) is `SKIPPED`, so it goes to the department's HOD, then the admin office:

```json
"workflow": { "template_code": "GUEST_LECTURE", "current_stage_no": 2, "stages": [
  { "stage_no": 1, "name": "Faculty In-charge Review", "assigned_to_user_id": null, "status": "SKIPPED" },
  { "stage_no": 2, "name": "HOD Approval", "assigned_to_user_id": 7, "status": "PENDING" },
  { "stage_no": 3, "name": "Admin: Gate Pass and Final Approval", "assigned_to_user_id": 9, "status": "NOT_STARTED" } ] }
```

A student or club coordinator gets `403 { "message": "Only faculty, HOD and admin users can request a guest lecture" }`. A missing guest field or a non-`ACADEMIC` category gives `400` with `issues.fieldErrors`. `GET /api/events` returns `guest_name`, `guest_affiliation` and `talk_topic` on each row (null for other events).

What happens, in order:

1. **PostgreSQL**: `CALL submit_booking_request(...)` inserts the event (`PENDING_APPROVAL`), booking and resources, and runs the priority logic. For a guest lecture, the guest details are inserted in the same transaction.
2. **Venue lost?** The event is set to `DRAFT`, and the response lists alternate venues.
3. **Otherwise MongoDB** creates the workflow. If that fails, the event goes back to `DRAFT` and its booking back to `PENDING`.

**`201 Created`**: submitted, approval started.

```json
{
  "status": "SUBMITTED",
  "event_id": 11,
  "event_status": "PENDING_APPROVAL",
  "booking_id": 10,
  "booking_status": "CONFIRMED",
  "workflow": {
    "template_code": "CLUB_EVENT",
    "status": "IN_PROGRESS",
    "current_stage_no": 1,
    "stages": [
      { "stage_no": 1, "name": "Club Coordinator Review",  "approver_role": "CLUB_COORDINATOR", "assigned_to_user_id": 4, "status": "PENDING" },
      { "stage_no": 2, "name": "Faculty Advisor Approval", "approver_role": "FACULTY",          "assigned_to_user_id": 6, "status": "NOT_STARTED" },
      { "stage_no": 3, "name": "HOD Approval",             "approver_role": "HOD",              "assigned_to_user_id": 8, "status": "NOT_STARTED" },
      { "stage_no": 4, "name": "Admin Final Approval",     "approver_role": "ADMIN",            "assigned_to_user_id": 9, "status": "NOT_STARTED" }
    ]
  }
}
```

A stage can come back as `SKIPPED` (e.g. a coordinator does not review their own request).

**`409 Conflict`**: the venue is already confirmed for a higher-priority booking. Show the alternatives and let the user submit again with another venue.

```json
{
  "status": "VENUE_UNAVAILABLE",
  "message": "The venue is already confirmed for a higher-priority booking at that time.",
  "event_id": 13,
  "event_status": "DRAFT",
  "booking_id": 12,
  "booking_status": "REJECTED",
  "alternatives": [
    { "venue_id": 4, "venue_name": "Classroom 101",    "capacity": 60,  "spare_seats": 20 },
    { "venue_id": 3, "venue_name": "Seminar Hall B",   "capacity": 120, "spare_seats": 80 },
    { "venue_id": 1, "venue_name": "Auditorium 1",     "capacity": 500, "spare_seats": 460 },
    { "venue_id": 5, "venue_name": "Open Air Theatre", "capacity": 800, "spare_seats": 760 }
  ]
}
```

**`422`**: a database rule failed (nothing is saved), e.g.:

```json
{ "message": "submit_booking_request failed for \"Mega Fest\": Booking 15 requires capacity 900, but venue 5 only holds 800", "sqlstate": "P0001" }
```

or the approval could not be started. In that case the event exists but is `DRAFT`:

```json
{ "message": "The approval workflow could not be started: No approver found for rule COORDINATOR_OF_EVENT_CLUB at stage 1",
  "event_id": 14, "event_status": "DRAFT", "booking_id": 13 }
```

`400` validation (`issues.fieldErrors`) · `401` · `503`.

---

## Approver inbox

### `GET /api/approvals`: Club Coordinator, Faculty, HOD, Admin (students: `403`)

The stages assigned to the logged-in user that are waiting for them, oldest submission first.

`200` (as `coordinator.two@campus.example` after a fresh reset):

```json
{
  "items": [
    {
      "event_id": 7,
      "workflow": {
        "template_code": "CLUB_EVENT",
        "submitted_by_user_id": 2,
        "submitted_at": "2026-10-20T04:30:00.000Z",
        "current_stage_no": 1,
        "total_stages": 4
      },
      "stage": {
        "stage_no": 1,
        "name": "Club Coordinator Review",
        "approver_role": "CLUB_COORDINATOR",
        "stage_assigned_at": "2026-10-20T04:30:00.000Z",
        "due_by": "2026-10-21T04:30:00.000Z"
      },
      "event": {
        "title": "Robotics Line-Follower Contest",
        "category": "CLUB",
        "event_type": "COMPETITION",
        "expected_footfall": 60,
        "status": "PENDING_APPROVAL",
        "organizer_id": 2,
        "organizer_name": "Student Two",
        "department_code": "ECE",
        "club_name": "Robotics Club"
      },
      "booking": {
        "booking_id": 8,
        "status": "CONFIRMED",
        "start_time": "2026-11-18T04:30:00.000Z",
        "end_time": "2026-11-18T07:30:00.000Z",
        "venue_id": 3,
        "venue_name": "Seminar Hall B",
        "venue_capacity": 120
      },
      "priority_score": 39.5
    }
  ]
}
```

`items` is `[]` when nothing is waiting. `due_by` in the past means the stage is overdue (SLA). `event`/`booking` can be `null` if PostgreSQL does not let this user see them (should not happen for an assigned approver).

### `POST /api/approvals/{eventId}`: the assigned approver only

```json
{ "action": "approve", "comment": "Approved by the faculty advisor" }
```

```json
{ "action": "reject", "comment": "Lab safety officer not available that night" }
```

`comment` is optional when approving and **required** when rejecting (max 500 characters).

`200`, workflow continues:

```json
{ "event_id": 11, "action": "approve", "stage_no": 1, "workflow_status": "IN_PROGRESS",
  "current_stage_no": 2, "next_approver_user_id": 6, "event_status": "PENDING_APPROVAL" }
```

`200`, final approval (the event is now `APPROVED` in PostgreSQL too):

```json
{ "event_id": 11, "action": "approve", "stage_no": 4, "workflow_status": "APPROVED",
  "current_stage_no": null, "next_approver_user_id": null, "event_status": "APPROVED" }
```

`200`, rejected (event `REJECTED`, its booking is released):

```json
{ "event_id": 12, "action": "reject", "stage_no": 2, "workflow_status": "REJECTED",
  "current_stage_no": null, "next_approver_user_id": null, "event_status": "REJECTED" }
```

| Error | When |
|---|---|
| `400` | bad `eventId`, bad `action`, reject without `comment` |
| `403` | `{ "message": "Stage 1 (Club Coordinator Review) is not assigned to you" }`, or a student |
| `404` | no workflow for this event |
| `409` | workflow already `APPROVED`/`REJECTED`, the event is no longer `PENDING_APPROVAL`, or another approver acted at the same moment |

---

## Approval timeline

### `GET /api/events/{eventId}/workflow`: anyone who can see the event

Organizer, coordinators of the event's club, Faculty, HOD and Admin. Everyone else gets `404` (the event is hidden by row-level security, so the API does not reveal that it exists).

`200`:

```json
{
  "event": { "event_id": 11, "title": "Robotics Expo Day", "status": "APPROVED", "organizer_id": 2 },
  "workflow": {
    "template_code": "CLUB_EVENT",
    "template_version": 1,
    "status": "APPROVED",
    "current_stage_no": null,
    "submitted_by_user_id": 2,
    "submitted_by_name": "Student Two",
    "submitted_at": "2026-10-30T07:01:12.000Z",
    "stages": [
      {
        "stage_no": 1, "name": "Club Coordinator Review", "approver_role": "CLUB_COORDINATOR",
        "status": "APPROVED",
        "assigned_to_user_id": 4, "assigned_to_name": "Coordinator Two",
        "stage_assigned_at": "2026-10-30T07:01:12.000Z", "due_by": "2026-10-31T07:01:12.000Z",
        "acted_by_user_id": 4, "acted_by_name": "Coordinator Two",
        "acted_at": "2026-10-30T07:01:13.000Z", "comment": "Approved by coordinator"
      }
    ]
  },
  "history": [
    { "action": "WORKFLOW_CREATED", "stage_no": null, "acted_by_user_id": 2, "comment": null, "created_at": "..." },
    { "action": "STAGE_APPROVED",   "stage_no": 1,    "acted_by_user_id": 4, "comment": "Approved by coordinator", "created_at": "..." }
  ]
}
```

(`stages` shortened to one entry here; all stages are returned.) An event without a workflow (e.g. a `DRAFT`) returns `{ "event": {...}, "workflow": null, "history": [] }`.

Stage `status`: `NOT_STARTED`, `PENDING`, `APPROVED`, `REJECTED`, `SKIPPED`. Workflow `status`: `IN_PROGRESS`, `APPROVED`, `REJECTED`, `CANCELLED`.

`400` bad `eventId` · `401` · `404`.

---

## Existing routes (unchanged)

| Route | Response |
|---|---|
| `GET /api/health` | `{ "status": "ok", "postgres": "ok", "mongodb": "ok" }`, or `503` |
| `GET /api/events` | `{ "events": [ ...rows of event_request_summary... ] }`, one row per event and booking |
| `GET /api/availability` | `{ "schedule": [ ...rows of venue_booking_schedule... ] }` |
| `GET /api/analytics` | `{ "events": [...], "resources": [...], "venues": [...] }` (Faculty/HOD/Admin; others `403`) |

## Administration

All administration routes require the `ADMIN` role. Venues and resources are retired with `is_active: false` instead of deleted, so older bookings retain their references. Every database read and write runs as the logged-in admin role.

### Venues: `/api/admin/venues`

`GET` returns `{ "venues": [...], "departments": [...] }`, including inactive venues for inventory management. `POST` creates an active venue:

```json
{ "name": "Lecture Hall C", "venue_type": "SEMINAR_HALL", "building": "Block C", "capacity": 180, "department_id": 3 }
```

`PATCH /api/admin/venues/{venueId}` is a **partial update**: send only the fields to change (at least one). Fields that are left out keep their current value. Editable fields: `name`, `venue_type`, `building`, `capacity`, `department_id`, `is_active`.

```json
{ "capacity": 200 }
```

```json
{ "is_active": false }
```

Sending the full record (as the admin page does) still works:

```json
{ "name": "Lecture Hall C", "venue_type": "SEMINAR_HALL", "building": "Block C", "capacity": 180, "department_id": 3, "is_active": true }
```

`200` returns the whole updated venue: `{ "venue": { "venue_id": 6, "name": "Lecture Hall C", ..., "is_active": true } }`.

Valid venue types are `AUDITORIUM`, `SEMINAR_HALL`, `CLASSROOM`, `LAB`, `OPEN_AIR`, `OTHER`. `department_id` and `building` may be `null` (send `null` to clear them).

| Status | When |
|---|---|
| `201` | created (POST) |
| `400` | invalid body, invalid value, or an empty object `{}` (`"Provide at least one field to update"`) |
| `403` | not an admin |
| `404` | the venue id does not exist |
| `409` | another venue already has that `name` |
| `422` | the new `capacity` is below the attendance of an existing confirmed booking (checked only when `capacity` is sent) |

### Resources: `/api/admin/resources`

`GET` returns `{ "resources": [...] }`, including inactive resources. `POST` creates an active resource:

```json
{ "name": "Portable Stage Light", "resource_type": "AV", "total_quantity": 4 }
```

`PATCH /api/admin/resources/{resourceId}` is a **partial update**: send only the fields to change (at least one). Editable fields: `name`, `resource_type`, `total_quantity`, `is_active`.

```json
{ "total_quantity": 6 }
```

The full record still works:

```json
{ "name": "Portable Stage Light", "resource_type": "AV", "total_quantity": 4, "is_active": true }
```

`200` returns the whole updated resource: `{ "resource": { "resource_id": 3, "name": "PA System", "resource_type": "AV", "total_quantity": 6, "is_active": true } }`.

Valid resource types are `AV`, `FURNITURE`, `POWER`, `DECOR`, `OTHER`. `total_quantity` may be zero.

| Status | When |
|---|---|
| `201` | created (POST) |
| `400` | invalid body, invalid value, or an empty object `{}` |
| `403` | not an admin |
| `404` | the resource id does not exist |
| `409` | another resource already has that `name` |
| `422` | the new `total_quantity` is below the peak quantity already used by confirmed bookings at the same time (checked only when `total_quantity` is sent) |
