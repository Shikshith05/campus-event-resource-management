# CERMS API reference

During development, routes are under `http://localhost:3000` (`cd app && npm run dev`). The browser uses an HTTP-only `cerms_session` cookie after login.

## Conventions

- Request bodies are JSON. Timestamps use ISO 8601 with an offset.
- Errors return `{ "message": "..." }`, optionally with validation `issues` or a database `sqlstate`.
- `401` means unauthenticated; `403` means the role or stage assignment is not authorized; `404` includes rows hidden by row-level security; `409` means a venue/workflow conflict; `422` means a business rule or required approver mapping is missing; `503` means a database is unavailable.
- PostgreSQL enforces row and role access. Workflow-only accounts receive approval details through a scoped database function.

## Roles

| Account role | Access |
|---|---|
| `STUDENT` | Submit and view own requests; no approval access. |
| `CLUB_COORDINATOR` | Student club coordinator. Can retain club request visibility, but cannot approve. |
| `FACULTY`, `HOD` | Event and staff access; can approve only a stage assigned to their account. |
| `WORKFLOW_APPROVER` | Limited workflow-only access to assigned requests and stages. |
| `ADMIN` | Existing system administration access; not a designated workflow approver. |

The stage designation `CLUB_COORDINATOR` is assigned to a responsible faculty member in the separate workflow assignment table. It is not the student `CLUB_COORDINATOR` app role.

## Route summary

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Log in and set the session cookie. |
| `POST` | `/api/auth/logout` | Signed-in | Clear the session cookie. |
| `GET` | `/api/auth/me` | Signed-in | Current account and role. |
| `GET` | `/api/health` | Public | Database health. |
| `GET` | `/api/event-options` | Event roles | Departments, venues, resources, and clubs available to the requester. |
| `GET` | `/api/events` | Event roles | Requests visible under PostgreSQL row rules. |
| `POST` | `/api/events/submit` | Event roles | Submit a request and start the four-stage workflow. |
| `DELETE` | `/api/events/{eventId}` | Request owner, draft only | Delete an unsubmitted draft request. |
| `GET` | `/api/events/{eventId}/workflow` | Event roles, visible event only | Designation-based timeline and audit actions. |
| `GET` | `/api/approvals` | Approval roles | Current assigned approval inbox. |
| `POST` | `/api/approvals/{eventId}` | Assigned current-stage approver | Approve or reject the current stage. |
| `GET`, `POST` | `/api/admin/venues` | Admin | List and create venues. |
| `PATCH` | `/api/admin/venues/{venueId}` | Admin | Partially update or retire a venue. |
| `GET`, `POST` | `/api/admin/resources` | Admin | List and create shared resources. |
| `PATCH` | `/api/admin/resources/{resourceId}` | Admin | Partially update or retire a resource. |
| `GET` | `/api/availability` | Event roles | Venue booking calendar. |
| `GET` | `/api/analytics` | Faculty, HOD, Admin | Event and resource statistics. |

## Event submission

### `GET /api/event-options`

The venue object includes the verified booking capacity and the supplied estimate separately:

```json
{
  "venues": [
    {
      "venue_id": 1,
      "name": "Opera House",
      "venue_type": "AUDITORIUM",
      "venue_type_confirmed": true,
      "building": "GJBC",
      "capacity": null,
      "min_capacity": 1800,
      "max_capacity": 2000
    }
  ]
}
```

Venues without a confirmed `capacity` are shown with their range but disabled for booking. Booking validation independently rejects a missing confirmed capacity and attendance above the confirmed limit.

### `POST /api/events/submit`

The organizer is always the logged-in user. Every event requires a department for the HOD stage. Example:

```json
{
  "title": "Campus Hackathon",
  "category": "DEPARTMENT",
  "event_type": "HACKATHON",
  "department_id": 2,
  "club_id": null,
  "expected_footfall": 120,
  "venue_id": 3,
  "start_time": "2026-12-10T16:00:00+05:30",
  "end_time": "2026-12-10T19:00:00+05:30",
  "resources": []
}
```

Supported event types are `GUEST_LECTURE`, `HACKATHON`, `WORKSHOP`, `SEMINAR`, `TECH_FEST`, `CULTURAL`, `CLUB_MEET`, `ORIENTATION`, `COMPETITION`, `SPORTS`, and `OTHER`. A `CLUB` category requires a club membership and club ID. Other categories must send `club_id: null`.

For `GUEST_LECTURE`, only Faculty, HOD, and Admin accounts may submit; category must be `ACADEMIC`; `guest_name`, `guest_affiliation`, and `talk_topic` are required and stored in `guest_lecture_details` within the PostgreSQL submission transaction. These fields are rejected for other event types.

On success (`201`), the response contains event/booking IDs, current stage number, designation, and status. It does not return approver account IDs or names:

```json
{
  "status": "SUBMITTED",
  "event_id": 11,
  "event_status": "PENDING_APPROVAL",
  "booking_id": 10,
  "booking_status": "CONFIRMED",
  "workflow": {
    "template_code": "DEPARTMENT_EVENT",
    "status": "IN_PROGRESS",
    "current_stage_no": 1,
    "stages": [
      { "stage_no": 1, "name": "Club Coordinator Review", "approver_role": "CLUB_COORDINATOR", "status": "PENDING" },
      { "stage_no": 2, "name": "HOD Approval", "approver_role": "HOD", "status": "NOT_STARTED" },
      { "stage_no": 3, "name": "Dean of Student Affairs Review", "approver_role": "DEAN_OF_STUDENT_AFFAIRS", "status": "NOT_STARTED" },
      { "stage_no": 4, "name": "Vice Chancellor Approval", "approver_role": "VICE_CHANCELLOR", "status": "NOT_STARTED" }
    ]
  }
}
```

If any approver mapping is missing, the request is compensated back to `DRAFT` and returns `422` with an actionable message. It is not submitted with a skipped stage. A venue conflict returns `409` with eligible alternatives. A database business-rule error returns `422`.

## Approvals

### `GET /api/approvals`

Returns pending items assigned to the logged-in approver. Student `CLUB_COORDINATOR` accounts also receive a read-only list of pending requests for clubs they coordinate; the assigned faculty advisor remains the stage-one approver. The decision endpoint does not grant student coordinators approval rights. A `WORKFLOW_APPROVER` can see only assigned approval details.

### `POST /api/approvals/{eventId}`

Request:

```json
{ "action": "approve", "comment": "Reviewed" }
```

```json
{ "action": "reject", "comment": "Reason for rejection" }
```

An approval comment is optional; a rejection comment is required (maximum 500 characters). The assigned user must match the MongoDB current stage and the PostgreSQL role/scope assignment. Duplicate requests are guarded by an atomic conditional update. Rejection ends the workflow. Only stage four can set the event to `APPROVED`.

An intermediate result returns `next_approver_role`, not an account identity:

```json
{
  "event_id": 11,
  "action": "approve",
  "stage_no": 1,
  "workflow_status": "IN_PROGRESS",
  "current_stage_no": 2,
  "next_approver_role": "HOD",
  "event_status": "PENDING_APPROVAL"
}
```

An unauthorized user receives `403`; a finished or concurrently changed workflow receives `409`. The existing MongoDB audit records the acting user ID, stage, decision, comment, and timestamp. Notifications are sent to the next assigned account and requester as appropriate.

### `GET /api/events/{eventId}/workflow`

Returns workflow status, all four stage designations, timestamps, comments, and audit actions when PostgreSQL permits the account to see the event. Requester-facing timelines do not return approver account names or IDs. A hidden event returns `404`.

## Venue administration

`POST /api/admin/venues` accepts `name`, `venue_type`, `venue_type_confirmed`, `building`, `capacity`, `min_capacity`, `max_capacity`, and optional `department_id`. `capacity` is the confirmed booking limit; supply either it or a valid estimate range. `PATCH` accepts any subset, including both range endpoints as `null` to clear them. A confirmed capacity cannot be unset or lowered beneath attendance for an existing confirmed booking.

```json
{
  "name": "Seminar Hall",
  "venue_type": "SEMINAR_HALL",
  "venue_type_confirmed": true,
  "building": "BE Block",
  "capacity": null,
  "min_capacity": 100,
  "max_capacity": 150,
  "department_id": null
}
```

Venues are retired with `is_active: false`, not deleted. Supported venue types are `AUDITORIUM`, `SEMINAR_HALL`, `CLASSROOM`, `LAB`, `OPEN_AIR`, and `OTHER`.

## Other response shapes

- `GET /api/events`: `{ "events": [...] }`, sourced from `event_request_summary` and filtered by PostgreSQL permissions.
- `GET /api/availability`: `{ "schedule": [...] }`, sourced from `venue_booking_schedule`.
- `GET /api/analytics`: `{ "events": [...], "resources": [...], "venues": [...] }` for staff roles.
- `GET /api/health`: `{ "status": "ok", "postgres": "ok", "mongodb": "ok" }` when both databases are available.

See [real-data-guide.md](real-data-guide.md) for schema migrations, private account CSVs, scoped approval assignments, and safe venue loading.
