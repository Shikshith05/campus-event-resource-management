# CERMS: Schema Explanation

A table-by-table walkthrough of the database design, written for the viva.
DDL: [db/sql/schema.sql](../db/sql/schema.sql) · Diagram: [er-diagram.md](er-diagram.md) · Sample data: [db/sql/seed.sql](../db/sql/seed.sql)

---

## 1. The big picture

CERMS uses **two databases**, each for what it is good at:

| | PostgreSQL | MongoDB |
|---|---|---|
| Holds | users, roles, clubs, venues, resources, events, bookings, priority decisions and guest lecture details | approval workflow templates, running instances, audit history and notifications |
| Why | Fixed structure, must never be wrong: foreign keys, CHECK constraints and ACID transactions stop double-booking | Each event type needs a different number of approval steps, with different fields. That is a natural fit for a nested document and an awkward fit for fixed tables |
| Special feature used | **Exclusion constraint** on a time range: the database itself refuses two confirmed bookings of the same venue at overlapping times. MySQL has no equivalent | Nested arrays of stages; the aggregation pipeline (later) for approval-turnaround analytics |

The 13 PostgreSQL tables fall into four groups:

- **Master data:** `department`, `role`, `app_user`, `club`, `venue`, `resource`
- **Bridge tables (M:N):** `club_member`, `booking_resource`
- **Transactions:** `event`, `booking`
- **Audit:** `booking_conflict_log`

---

## 2. Normal forms in one minute

| Form | Rule (in plain words) |
|---|---|
| 1NF | Every column holds one atomic value; no lists or repeating groups |
| 2NF | 1NF, and no column depends on only *part* of a composite key |
| 3NF | 2NF, and no non-key column depends on another non-key column (no transitive dependency) |
| BCNF | Every column that determines other columns is a candidate key |

**Result: all 13 tables are in 3NF, and in fact in BCNF.** In every table, the only things that determine other columns are the primary key or another UNIQUE column.
Section 4 lists the data we deliberately did *not* store, because storing it would break 3NF.

---

## 3. Table by table

### 3.1 `department`
- **Purpose:** The academic departments (CSE, ECE, ...). Users, clubs, venues and events can belong to one.
- **Key constraints:** PK `department_id`; `code` and `name` are both UNIQUE and NOT NULL.
- **Relationships:** 1 : N with `app_user`, `club`, `venue` and `event` (all optional on the other side).
- **Normal form:** BCNF. `department_id`, `code` and `name` are all candidate keys, and nothing else is stored.

### 3.2 `role`
- **Purpose:** The five system roles: STUDENT, CLUB_COORDINATOR, FACULTY, HOD and ADMIN. These drive access control.
- **Key constraints:** PK `role_id`; `role_name` UNIQUE; `hierarchy_level > 0`. `hierarchy_level` is deliberately *not* unique, so a future DEAN role can share a level with ADMIN.
- **Relationships:** 1 : N with `app_user` (every user has exactly one role).
- **Normal form:** BCNF. Only the candidate keys `role_id` and `role_name` determine the other columns.
- **Why a table, not a CHECK list?** `hierarchy_level` belongs to the role and feeds the priority score. Keeping it as data means a new role is just an INSERT.

### 3.3 `app_user`
- **Purpose:** Everyone who logs in. It is called `app_user` because `USER` is a reserved word in PostgreSQL.
- **Key constraints:** PK `user_id`; `university_id` (SRN or employee ID) and `email` are UNIQUE. A CHECK forces the email to contain `@` and be lowercase, so UNIQUE cannot be bypassed with `A@x` vs `a@x`. `password_hash` is NOT NULL, and only the hash is ever stored.
- **Relationships:** N : 1 to `role` (required) and to `department` (optional, because central admin staff have none). One user can organize many events, advise many clubs and join many clubs.
- **Soft delete:** users are deactivated (`is_active = FALSE`), never deleted, so past events and bookings stay valid.
- **Normal form:** BCNF. The role *name* and department *name* are not copied here; they are reached through the FKs.

### 3.4 `club`
- **Purpose:** Student clubs.
- **Key constraints:** PK `club_id`; `name` UNIQUE; `faculty_advisor_id` NOT NULL, so every club has an advisor.
- **Relationships:** N : 1 to `department` (NULL = campus-wide club); N : 1 to `app_user` as faculty advisor; 1 : N to `club_member` and `event`.
- **Normal form:** BCNF. The advisor's name and other details live in `app_user`, not here.

### 3.5 `club_member` (bridge table)
- **Purpose:** Resolves the **M : N** between users and clubs: a student can join many clubs, and a club has many students.
- **Key constraints:** Composite PK `(club_id, user_id)`, so the same person cannot join a club twice. `club_position IN ('MEMBER', 'COORDINATOR')`.
- **Relationships:** N : 1 to `club` and N : 1 to `app_user`, both ON DELETE CASCADE, because a membership has no meaning without both sides.
- **System role vs club position:** `app_user.role_id` says what you may do in the app. `club_position` says *which* club you lead. A CLUB_COORDINATOR user is COORDINATOR in one club and may be a plain MEMBER in another.
- **Normal form:** BCNF. `club_position` and `joined_on` depend on the *whole* key (this person in this club), so there is no partial dependency (2NF) and no transitive one (3NF).

### 3.6 `venue`
- **Purpose:** Bookable spaces: auditoriums, seminar halls, classrooms, labs and open-air spaces.
- **Key constraints:** PK `venue_id`; `name` UNIQUE; `capacity > 0`; `venue_type` limited by a CHECK list.
- **Relationships:** N : 1 to `department` as the manager (NULL = central admin); 1 : N to `booking`.
- **Soft delete:** venues are retired with `is_active`, because old bookings point to them.
- **Normal form:** BCNF. `building` is just a text attribute. If buildings later need their own attributes, they become a separate table.

### 3.7 `resource`
- **Purpose:** The shared equipment pool: projectors, mics, PA systems, chairs, generators.
- **Key constraints:** PK `resource_id`; `name` UNIQUE; `total_quantity >= 0`. Zero is allowed, meaning the item is tracked but none are usable right now.
- **Relationships:** 1 : N to `booking_resource`.
- **Normal form:** BCNF. How many units are *free* at a given time is computed from bookings, not stored.

### 3.8 `event`
- **Purpose:** One event request: what it is, who asked, which department or club, and how many people are expected.
- **Key constraints:**
  - `category IN ('ACADEMIC', 'DEPARTMENT', 'CLUB', 'PERSONAL')` feeds the priority score.
  - `event_type` (GUEST_LECTURE, WORKSHOP, ...) is used, together with the category and department, to pick the approval workflow template.
  - `expected_footfall > 0`.
  - `chk_event_club`: a CLUB event **must** have a `club_id`, and any other category **must not**.
  - `chk_event_department`: every event except PERSONAL **must** have a `department_id`, because that department's HOD is in the approval chain.
  - `status` holds the final approval outcome: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED or CANCELLED.
- **Relationships:** N : 1 to `app_user` (the organizer, i.e. the requester), to `department` and to `club`; 1 : N to `booking`.
- **Normal form:** BCNF. Is `department_id` a transitive copy of `club.department_id`? No. A campus-wide club has no department, and a CSE club may hold an event under ECE. So `club_id` does not determine `department_id`; it is an independent fact about the event.

### 3.8.1 `event_venue_preference` and `guest_lecture_details`
- `event_venue_preference` stores ranked venue choices. The assigned venue remains in `booking`, so preferences do not get confused with the final allocation.
- `guest_lecture_details` stores the visitor fields required by the guest-lecture workflow without adding nullable guest columns to every event row.

### 3.9 `booking`
- **Purpose:** One venue for one time slot, requested for an event. An event can have several bookings: a multi-day event, or a new booking in an alternate venue after losing a clash.
- **Key constraints:**
  - `end_time > start_time`.
  - `start_time > requested_at`: you can only book in advance. The difference is the **lead time** used in the priority score.
  - `status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')`. CANCELLED (withdrawn by the requester) and NO_SHOW count as penalties. REJECTED (lost a clash or was denied) does not.
  - **`excl_booking_no_overlap`** (exclusion constraint): two **CONFIRMED** bookings of the same venue cannot have overlapping time ranges. PENDING bookings *may* overlap, because that is exactly the clash the priority logic exists to resolve. The range is `[start, end)`, so 10:00-12:00 and 12:00-14:00 do not clash.
- **Relationships:** N : 1 to `event` (CASCADE: deleting a draft event deletes its bookings) and N : 1 to `venue` (RESTRICT); 1 : N to `booking_resource` and `booking_conflict_log`.
- **Normal form:** BCNF. The requester is *not* stored here. It is `event.organizer_id`, and storing it would create the transitive dependency `booking_id -> event_id -> organizer_id`.

### 3.10 `booking_resource` (bridge table)
- **Purpose:** Resolves the **M : N** between bookings and resources, and records *how many* of each resource is needed.
- **Key constraints:** Composite PK `(booking_id, resource_id)`, so one line per resource per booking. `quantity > 0`.
- **Relationships:** N : 1 to `booking` (CASCADE) and N : 1 to `resource` (RESTRICT).
- **Normal form:** BCNF. `quantity` depends on the whole key (this resource for this booking).
- **Why attach resources to the booking and not the event?** Availability depends on the time slot, and the slot belongs to the booking.

### 3.11 `booking_conflict_log`
- **Purpose:** The audit trail of priority decisions. When two bookings clash, it records which booking won, both scores, the reason, and whether the system decided or an admin overrode it. This is where the abstract's "Priority Scores" are stored.
- **Key constraints:**
  - `winning_booking_id <> losing_booking_id`.
  - UNIQUE `(winning_booking_id, losing_booking_id)`, so the same decision is not logged twice.
  - `chk_conflict_auto_follows_score`: an automatic decision (`decided_by IS NULL`) must give the venue to the higher score. Only an admin override may pick the lower one.
- **Relationships:** two N : 1 links to `booking` (winner and loser) and an optional N : 1 to `app_user` (the overriding admin). All are RESTRICT, so a booking that was part of a decision cannot be deleted, only cancelled.
- **Normal form:** BCNF. The venue is *not* stored, because it can be derived from the winning booking. The scores look derived but are not: they are a **snapshot at decision time**. Cancellation counts and weights change later, so recomputing would give a different answer than the one actually used.

---

## 4. What we deliberately do NOT store (and why)

| Not stored | Where it comes from instead | Why |
|---|---|---|
| A user's cancellation / no-show count | `COUNT(*)` of their bookings with status CANCELLED or NO_SHOW (booking, then event, then organizer) | A stored counter could disagree with the real bookings (update anomaly) |
| Requester on `booking` | `event.organizer_id` | Would be a transitive dependency |
| Venue on `booking_conflict_log` | the winning booking's `venue_id` | Would be a transitive dependency |
| Priority score on `booking` | computed when a clash happens; the snapshot goes to `booking_conflict_log` | Depends on data that keeps changing |
| HOD of a department | the user with role HOD in that department | No second source of truth |
| Free quantity of a resource | `total_quantity` minus overlapping confirmed bookings | Changes with every booking |
| Alternate venue suggestions | computed on demand: active venues with capacity >= footfall and no confirmed overlap | They go out of date immediately |
| Approval stages | MongoDB `workflow_instances` | Variable shape (see section 8) |
| Workflow audit and notifications | MongoDB `workflow_audit` and `workflow_notifications` | Event-driven history and inbox state |

---

## 5. ON DELETE policy (one rule per situation)

| Behaviour | Used for | Reason |
|---|---|---|
| **CASCADE** | `club_member`, `booking_resource`, and `booking` when its event is deleted | The child is *part of* the parent and meaningless without it |
| **SET NULL** | `club.department_id`, `venue.department_id` | NULL already has a meaning (campus-wide club, centrally managed venue) |
| **RESTRICT** | everything else: a role, user, department, club, venue or resource that is still referenced cannot be deleted, and neither can any booking in `booking_conflict_log` | Protects history. Old rows must keep pointing at something real |

Because of RESTRICT, master data is **soft-deleted** with `is_active = FALSE` instead of `DELETE`.
One chain worth knowing: deleting an event cascades to its bookings, but if one of those bookings is in the conflict log, the RESTRICT there blocks the whole delete. Events that went through a priority decision can only be *cancelled*. This is tested and works.

---

## 6. Rules implemented by booking logic

A CHECK constraint can only look at **one row**. The cross-row rules below are implemented in [booking_logic.sql](../db/sql/booking_logic.sql):

1. Venue `capacity >= event.expected_footfall` when a booking is confirmed.
2. Requested resource quantity <= quantity still free in that time slot.
3. Computing the priority score from category, role, lead time, and past penalties.
4. Picking a winner and rejecting overlapping pending requests inside a transaction.

The following rules remain for a later phase:

1. Both bookings in a conflict-log row must be for the same venue and overlap in time.
2. Cancelling an event cancels its bookings.

Additional cross-table validation now enforces active event organizers,
club-coordinator organizers for club events, active faculty-or-higher club
advisors, active venues for pending/confirmed bookings, and administrator-only
manual conflict overrides.

---

## 7. Priority score (implemented formula with placeholder weights)

The formula below is now implemented by `calculate_booking_priority()` in [booking_logic.sql](../db/sql/booking_logic.sql). The weights remain placeholders to be tuned after the campus survey.

The schema already holds every input the score needs:

| Factor | Comes from | Placeholder points |
|---|---|---|
| Event category | `event.category` | ACADEMIC 40, DEPARTMENT 30, CLUB 20, PERSONAL 10 |
| Requester role | `role.hierarchy_level` of `event.organizer_id` | `hierarchy_level x 5` (Student 5 ... Admin 25) |
| Booking lead time | `booking.start_time - booking.requested_at` | 0.5 per day in advance, max 15 (30 days) |
| Past behaviour | count of the requester's CANCELLED + NO_SHOW bookings in the last 180 days | -5 each |

**score = category + role + lead time - penalty.** On a tie, the earlier `requested_at` wins.

Category has the widest spread (30 points), then role (20), then lead time (15), so the order academic > department > club > personal is respected in normal cases. The weights are placeholders to be tuned.

Worked example from the seed data (Seminar Hall A, 12 Nov):

| | Booking 1: Guest Lecture | Booking 2: Club Hackathon |
|---|---|---|
| Category | ACADEMIC: 40 | CLUB: 20 |
| Role | FACULTY (3 x 5): 15 | STUDENT (1 x 5): 5 |
| Lead time | 42 days, capped at 30: 15 | 38 days, capped at 30: 15 |
| Penalty | none: 0 | 1 no-show: -5 |
| **Score** | **70** | **35** |

Booking 1 is CONFIRMED and booking 2 is REJECTED. The hackathon then took the suggested alternate, Seminar Hall B (booking 3).

---

## 8. MongoDB collections

Sample files: [workflow_templates.json](../db/mongo/workflow_templates.json), [workflow_instances.json](../db/mongo/workflow_instances.json). Loader: [load.js](../db/mongo/load.js).

### `workflow_templates`: the approval chain definitions
- One document per chain, identified by `template_code` + `version` (unique index).
- `applies_to: { event_category, event_type, department_code }`, where `null` means "any".
- **Choosing a template:** among active templates that match the event, the most specific wins: department + type, then type, then category.
  - A guest lecture uses `GUEST_LECTURE` (it matches on type).
  - Any other club event uses `CLUB_EVENT`.
  - To give one department its own chain, add a document with its `department_code`. No code or schema change is needed.
- `stages[]` is an ordered list. Each stage has `approver_role` (a role from PostgreSQL), `approver_rule` (which user with that role, e.g. `ADVISOR_OF_EVENT_CLUB`, `HOD_OF_EVENT_DEPARTMENT`), `sla_hours`, and optionally `skip_if_requester_role` (a coordinator does not review their own request).
- The samples have **4, 2 and 3 stages**. The guest-lecture template also carries `required_fields` (guest name, affiliation, topic), a field the other templates do not have.

### `workflow_instances`: one running approval per event
- `event_id` links to PostgreSQL `event.event_id`. User IDs link to `app_user.user_id`.
- Copies the stage list from the template **at submission time**, plus `template_version`. Editing a template later does not change approvals already in progress.
- Stage status: NOT_STARTED, PENDING, APPROVED, REJECTED or SKIPPED. Instance status: IN_PROGRESS, APPROVED, REJECTED or CANCELLED.
- The sample is the Coding Club Hackathon (event 3): stages 1-2 APPROVED, stage 3 (HOD) PENDING, stage 4 NOT_STARTED.

### Why MongoDB here, and how the two databases stay consistent
- In SQL this would need at least four tables (template, template_stage, instance, stage_action) plus nullable columns for template-specific fields. In MongoDB, one document holds one whole approval, which is read and updated together.
- MongoDB cannot enforce a foreign key into PostgreSQL, so the application checks `event_id` and the user IDs.
- **Split of responsibility:** MongoDB holds the stage-by-stage detail. PostgreSQL `event.status` holds the final outcome, so SQL queries such as "approved events next week" need no MongoDB lookup. When the last stage is approved, the app updates both.

---

## 9. Why only these 13 tables

Things we considered and left out, to keep the design simple:

| Not added | Reason |
|---|---|
| `event_category` table | The four categories are fixed by the problem statement, so a CHECK list is enough |
| `permission` / `role_permission` tables | Five roles. Permissions are checked by the app, and DB-level GRANTs come in the auth phase |
| `time_slot` table | Free start and end times plus range overlap are more flexible than fixed slots |
| SQL workflow tables | Workflows live in MongoDB |
| `alternate_suggestion` table | Suggestions are computed on demand |
| `venue_resource` (built-in equipment per hall) | Add it only if the campus survey shows halls have fixed equipment; for now there is one shared pool |

---

## 10. Smaller design choices

- **CHECK lists instead of ENUM types** for status and category fields. They are standard SQL, the allowed values are visible in the table definition, and they are easy to change (drop and re-add the constraint). An ENUM value cannot easily be removed.
- **`GENERATED BY DEFAULT AS IDENTITY`** instead of `SERIAL`. This is the SQL-standard auto-increment. "BY DEFAULT" lets the seed file use fixed IDs, and the seed then moves the counters forward with `setval`.
- **`TIMESTAMPTZ`** for all times. It is stored in UTC and shown in the session time zone (IST). This avoids bugs once the web app sends ISO timestamps.
- **Indexes:** PostgreSQL indexes PKs and UNIQUE columns automatically, but not foreign keys. We added three: `booking(venue_id, start_time)` for availability search, `booking(event_id)`, and `event(organizer_id)` for a requester's history.

---

## 11. Quick viva answers

- **Why is `club_member` needed?** Users and clubs are M : N. A relational table cannot hold a list in one column (1NF), so the bridge table holds one row per membership.
- **How do you stop double-booking?** With the exclusion constraint on `booking`. The database rejects two confirmed overlapping bookings of the same venue, even when two requests arrive at the same moment.
- **Then how can two requests clash at all?** Only CONFIRMED bookings are blocked. PENDING ones may overlap, and the priority logic decides which one gets confirmed.
- **Where is the priority score stored?** In `booking_conflict_log`, as a snapshot at decision time. It is not stored on `booking`, because its inputs change.
- **Why not store the cancellation count on the user?** It can be derived from bookings, and storing it would risk disagreement (an update anomaly).
- **Why two databases?** Core records need strict integrity and transactions (PostgreSQL). Approval chains have a different shape per event type (MongoDB documents).
- **What happens if a user leaves?** They are deactivated, not deleted. RESTRICT foreign keys protect their history.
- **Is the design in 3NF?** Yes, all 13 tables are in 3NF, and in BCNF. Every determinant is a candidate key, and derived data is computed rather than stored (section 4).
