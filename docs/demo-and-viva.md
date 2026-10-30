# CERMS: demo script, rubric map and viva questions

For the project evaluation (DBMS Experiential Learning Level 3, 50 marks). Line numbers refer to commit `3f5b69b` and later; re-check them if a file is edited.

---

## 1. Before the demo (10 minutes earlier)

PostgreSQL runs inside WSL and **stops when WSL is idle**. Keep one WSL terminal open for the whole demo.

**WSL terminal (Ubuntu): reset PostgreSQL and keep WSL awake.**

```sh
cd /mnt/d/projects/campus-event-resource-management
export PGPASSWORD='<postgres password>'        # this terminal only; avoids 10 password prompts
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS cerms WITH (FORCE)" -c "CREATE DATABASE cerms"
for f in schema views booking_logic analytics procedures seed rbac workflow guest_lecture; do
  psql -h localhost -U postgres -d cerms -v ON_ERROR_STOP=1 -q -f db/sql/$f.sql || break
done
psql -h localhost -U postgres -d cerms -c "SELECT event_id, status FROM event ORDER BY 1"
```

Expect 5 `ERROR` lines from `rbac.sql`: these are its own permission tests, and they are intended. The last command must list events 1-8 (2, 3, 7, 8 = `PENDING_APPROVAL`). **Leave this terminal open.**

**Windows terminal: reset MongoDB and start the app.**

```powershell
cd D:\projects\campus-event-resource-management
mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js     # 3 templates, 4 instances
cd app
npm run dev
```

**Pre-flight (1 minute):**

- [ ] <http://localhost:3000/api/health> shows `"postgres":"ok","mongodb":"ok"`.
- [ ] Open 4 browser windows (normal + incognito, or separate profiles) and log in, so you never type passwords during the demo. All passwords are `password123`:
  1. `student.two@campus.example`
  2. `coordinator.two@campus.example`
  3. `faculty.two@campus.example`
  4. `admin.one@campus.example`

  `hod.ece@campus.example` can share window 2 after the coordinator step.
- [ ] Have a second WSL tab with `psql -h localhost -U postgres -d cerms` and a PowerShell tab in the repo root for `mongosh`.
- [ ] Open `docs/er-diagram-core.png` and `docs/er-diagram-booking.png`.

With Docker instead: `docker compose down -v && docker compose up -d`, then `docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/load.js`.

---

## 2. Demo script (about 6½ minutes)

| Time | Who / where | Do | Say | Rubric |
|---|---|---|---|---|
| 0:00 | ER images, README | Show the two ER images, then the stack table. | "14 tables in 3NF/BCNF; PostgreSQL for facts that must never be wrong, MongoDB for approval chains whose shape changes per event type." | 1, 2, 5 |
| 0:40 | **Student Two**, `/events/new` | Club request: *Robotics Expo Day*, CLUB, TECH FEST, Robotics Club, 120 people, Open Air Theatre, a date in December, PA System 1. Submit. | "One `CALL submit_booking_request` inserts the event, booking and equipment in one transaction, then runs the priority engine." | 10, 11, 8 |
| 1:20 | Student Two, `/events/new` | Second request: Seminar Hall A, **12 Nov 2026, 10:30-11:30**, 40 people. Submit → a yellow box with alternate venues appears. Click **Use Classroom 101**, then submit again. | "Booking 1 is CONFIRMED there. The exclusion constraint makes double-booking impossible. The loser gets alternates from `suggest_alternate_venues`, a function with a CTE." | 8, 3 |
| 2:00 | **Coordinator Two** → **Faculty Two**, `/approvals` | Approve *Robotics Expo Day* in each window. Point at the priority score on the card. | "MongoDB decides whose turn it is; PostgreSQL decides what each approver may see. A coordinator only sees their own club's requests (RLS)." | 9, 12 |
| 2:40 | **HOD ECE** → **Admin**, `/approvals` | Approve, finishing stage 4. | "The final approval writes `event.status` in PostgreSQL inside an open transaction, then MongoDB, then commits." | 11 |
| 3:00 | Student Two, `/events` | Open *Robotics Expo Day* → timeline: 4 stages approved, with names and times. | "Timeline = MongoDB instance + audit trail; the names come from PostgreSQL." | 10, 9 |
| 3:20 | Student Two → `/analytics`, then psql | Get redirected to the dashboard ("no access"). In psql, paste the RLS snippet below. | "The same SELECT gives a different answer per user: Student One sees only their own requests, faculty sees all. RBAC is in the database, not just the UI." | 12 |
| 4:00 | psql | `\i db/sql/queries.sql`, scroll to **E1** (14-day calendar, recursive CTE) and **C1** (correlated). Then `\i db/sql/dml.sql` and show section 8 (CALL) and the `booking_status_history` rows. | "Every query answers a question written above it; the DML file rolls itself back." | 6, 7, 8 |
| 4:50 | PowerShell | `mongosh "mongodb://localhost:27017/cerms" db/mongo/analytics.js`. Optional: run `workflow_rud.js` after a fresh `load.js`. | "Turnaround per stage from `workflow_audit` with `$group`; R/U/D are labelled in `workflow_rud.js`." | 4, 9 |
| 5:30 | **Admin**, `/admin` then `/analytics` | Add a venue, change its capacity, set it to Retired, Save. Show `/analytics`. | "Retired, not deleted: old bookings still reference it. Partial PATCH updates only the fields sent." | 10, 11 |
| 6:10 | Repository | `git log --oneline \| head`, `docs/` folder. | "One commit per task. The docs explain every design decision." | 13, 14 |

**RLS snippet for 3:20** (paste into psql; changes nothing):

```sql
BEGIN;
SET LOCAL ROLE cerms_student; SELECT set_config('app.current_user_id', '1', true);
SELECT 'student 1' AS who, count(*) AS events_visible FROM event;      -- only Student One's own (2)
SET LOCAL ROLE cerms_faculty; SELECT set_config('app.current_user_id', '5', true);
SELECT 'faculty 5' AS who, count(*) AS events_visible FROM event;      -- every event
SET LOCAL ROLE cerms_student; SELECT set_config('app.current_user_id', '1', true);
UPDATE event SET status = 'APPROVED' WHERE event_id = 3;              -- ERROR: row-level security
ROLLBACK;
```

If time is short, skip 4:50 and 5:30 and show the screenshots in `docs/screenshots/` instead.

**What can go wrong:**

- The page shows a 503 or "temporarily unavailable": WSL went idle. Bring the WSL terminal back, wait about 5 seconds, then refresh.
- The clash does not happen: you used a date other than 12 Nov 2026 10:30-11:30 in Seminar Hall A.

---

## 3. Rubric map

| # | Rubric item (marks) | Where it is proved |
|---|---|---|
| 1 | ER diagram (2) | `docs/er-diagram.md:34-178` (Mermaid source, 14 entities, 21 relationships); `docs/er-diagram-core.png`, `docs/er-diagram-booking.png`, `docs/er-diagram.png` (+ `.svg`); `docs/schema.dbml:1-190` |
| 2 | Relational schema with keys, relationships, constraints (3) | `docs/schema-explanation.md:41-139` (every table: purpose, keys, relationships, normal form), `:140-168` (derived data not stored, ON DELETE policy); `docs/er-diagram.md:180-206` (cardinalities) |
| 3 | SQL DDL with constraints (4) | `db/sql/schema.sql:16-332`: PK/FK/UNIQUE/CHECK on 14 tables; `chk_event_club` / `chk_event_department` `:176-185`; exclusion constraint against double booking `:247-250`; conflict-log checks `:294-301`; audit table `:309-322`; indexes `:329-332` |
| 4 | NoSQL database creation (4) | `db/mongo/workflow_templates.json:1-119` (3 templates, 4/2/3 stages), `db/mongo/workflow_instances.json:1-230`, `db/mongo/load.js:19-38` (collections + unique/compound indexes) |
| 5 | Technology justification (1) | `docs/schema-explanation.md:8-26` (why two databases), `:241-247` (why MongoDB for workflows), `:352-402` (how they stay consistent) |
| 6 | DML operations (4) | `db/sql/dml.sql:14-257`: INSERT `:18-62` (incl. INSERT ... SELECT), UPDATE `:63-113` (incl. trigger cascade `:79-89`), UPDATE ... FROM `:114-133`, DELETE + CASCADE `:134-162`, expected failures in SAVEPOINTs `:163-202` |
| 7 | Nested / correlated / recursive and join queries (4) | `db/sql/queries.sql`: joins `:20-79`, nested `:82-122`, correlated `:125-181`, recursive CTEs `:245-293`, GROUP BY/HAVING `:296-318`, window function `:320-337` (20 queries, all return rows) |
| 8 | Procedure / function, trigger, CTE (6) | Procedure `db/sql/procedures.sql:93-206` (`submit_booking_request`, CALL in `dml.sql:204-255`); CTE function `procedures.sql:49-89`; audit trigger `procedures.sql:16-46`; 7 validation/cascade triggers and the priority engine `db/sql/booking_logic.sql:15-589`; CTE queries `queries.sql:184-242`; SECURITY DEFINER workflow functions `db/sql/workflow.sql:54-290` |
| 9 | NoSQL feature: Read, Update, Delete (7) | `db/mongo/workflow_rud.js`: Read `:90-151` (projection, `$elemMatch`, positional projection, sort/limit, `$unwind`+`$group`+`$lookup`), Update `:152-227` (positional `$`, `$set`/`$inc`/`$push`, updateMany, upsert), Delete `:228-256`; engine `db/mongo/workflow_engine.js:96-344`; aggregation `db/mongo/analytics.js:7-35`; used by the app in `app/lib/workflow.ts:221-490` |
| 10 | Next.js interface (3) | `app/app/components/EventRequestForm.tsx`, `ApprovalInbox.tsx`, `MyEvents.tsx`, `AvailabilityCalendar.tsx`, `AnalyticsDashboard.tsx`, `AdminConsole.tsx`; pages `app/app/*/page.tsx`; `docs/screenshots/` (every page at 1280 and 390 px) |
| 11 | Backend / API and database integration (2) | `app/lib/db.ts:48-105` (`withUserTransaction`, `queryAsUser`); `app/app/api/events/submit/route.ts:81-257` (CALL `:108-160`, MongoDB + compensation `:180-257`); `app/app/api/approvals/[eventId]/route.ts:73-117`; `docs/api.md` |
| 12 | Authentication + at least two roles + RBAC in the database (4) | Login `app/app/api/auth/login/route.ts:13-84` (zod, bcrypt, httpOnly cookie); signed session `app/lib/session.ts:80-171`; middleware `app/middleware.ts:20-55`; DB roles, GRANTs and RLS `db/sql/rbac.sql:27-256`, tests `:259-347`; `db/sql/workflow.sql:31-48`, `db/sql/guest_lecture.sql:22-49` |
| 13 | Documentation, Git/GitHub (2) | `README.md`, `docs/schema-explanation.md`, `docs/api.md`, `docs/real-data-guide.md`, this file; `git log` (one commit per task, clear messages) |
| 14 | Originality, individual contribution, viva (4) | Contribution table below; viva answers in section 4 and in `docs/schema-explanation.md:272-284`, `:344-351`, `:352-402` |

### Who did what (from `git log`)

| Area | Shikshith V | Shreyas K M |
|---|---|---|
| Design | ER diagram, schema, normalization notes, seed data | |
| PostgreSQL | DDL, DML, queries, procedure + audit trigger, RBAC/RLS, workflow.sql, guest_lecture.sql, PES data loader | booking validation triggers, priority engine, views, analytics views |
| MongoDB | templates, instances, R/U/D demo, delete functions | workflow engine, analytics aggregations |
| Application | authentication, middleware, DB-enforced access, approval-workflow API, guest lectures, partial admin edits | API foundation, all pages (request form, events, calendar, approvals, analytics, admin) |
| Testing and docs | verification on the real setup, end-to-end tests, screenshots, API and viva docs | setup guide (README) |

---

## 4. Likely viva questions

### Design and normalization
1. **Is the schema in 3NF? How do you know?** Yes, all 14 tables are in 3NF, and in fact in BCNF. In every table the only determinants are the primary key or a UNIQUE key. Derived values (cancellation counts, free equipment, the requester of a booking) are computed, not stored (`schema-explanation.md` section 4).
2. **Why the bridge tables `club_member` and `booking_resource`?** Users↔clubs and bookings↔resources are many-to-many. A column cannot hold a list (1NF), so the bridge table holds one row per pair, plus data about the pair (position, quantity).
3. **Why soft-delete (`is_active`) instead of DELETE?** Old events and bookings reference users and venues through RESTRICT foreign keys. Deleting would either fail or destroy history, so they are retired instead.

### Constraints and triggers
4. **How is double-booking prevented?** An exclusion constraint (`EXCLUDE USING gist (venue_id WITH =, tstzrange(start,end) WITH &&) WHERE status='CONFIRMED'`). The database rejects two overlapping confirmed bookings of a venue, even when the requests arrive at the same moment.
5. **Why do some rules need triggers instead of CHECK?** A CHECK sees only one row. Rules like "capacity ≥ footfall" or "a club advisor must be faculty" read other tables, so they are BEFORE/AFTER triggers in `booking_logic.sql`.
6. **BEFORE vs AFTER trigger in your project?** BEFORE triggers validate the row before it is saved (`trg_validate_event_submission`). AFTER triggers react to a change that succeeded: `trg_cancel_event_bookings` cancels the bookings, and `trg_log_booking_status` writes the audit row.

### Queries
7. **Difference between a nested and a correlated subquery? Show one of each.** A nested subquery runs once on its own (B1: `WHERE user_id IN (SELECT ...)`). A correlated one re-runs for every outer row because it refers to it (C1: average penalties *of the same role*, `u2.role_id = u.role_id`).
8. **How does your recursive CTE stop?** E1 starts at one day (the anchor) and adds a day per step until `n < 14` is false; E2 climbs one role level until no role has `level + 1`.

### Procedure, function and CTE
9. **Why is `submit_booking_request` a procedure and not a function?** It is an action you `CALL` that writes three tables and runs conflict resolution. If any step fails, its EXCEPTION block undoes everything and raises one clear error. A function returns a value to use inside a query.
10. **How does the priority score work?** Category (academic 40 ... personal 10) + role level × 5 + 0.5 per day booked in advance (max 15) − 5 per cancellation or no-show in the last 180 days. On a tie, the earlier request wins (`calculate_booking_priority`).

### MongoDB
11. **Why MongoDB for workflows?** Each event type needs a different number of stages and different fields (guest lectures need guest details). One document holds a whole approval, and templates can change without a schema migration.
12. **Why copy the template's stages into each instance?** Editing or replacing a template (e.g. GUEST_LECTURE v2) must not change approvals that are already running, so each instance keeps its own copy plus `template_version`.
13. **Show an update operator that only works on arrays.** The positional `$`: `stages.$.status` updates exactly the stage matched by `$elemMatch` in the filter (`workflow_rud.js` U1).

### RBAC and row-level security
14. **GRANT vs row-level security?** A GRANT decides which tables and columns a role may use; RLS decides which rows. A student has SELECT on `event`, but the policy `organizer_id = app_current_user_id()` shows only their own.
15. **How does PostgreSQL know who the user is when the app always logs in as `cerms_app`?** Each request runs `BEGIN; SET LOCAL ROLE cerms_student; set_config('app.current_user_id', '<id>', true)`. The policies read that setting, and LOCAL means it ends at COMMIT, so a pooled connection never leaks one user's identity to the next request.
16. **Why SECURITY DEFINER functions, and how are they kept safe?** Some steps need data a role cannot read (role names, other users' bookings). The function runs with its owner's rights but checks the caller itself. EXECUTE is revoked from PUBLIC and `search_path` is fixed.

### Two-database consistency
17. **What happens if MongoDB fails while a request is submitted?** PostgreSQL has already committed, and the two databases cannot share one transaction. So the app compensates: the event goes back to DRAFT and its booking to PENDING, freeing the venue.
18. **How do approve and reject avoid disagreement between the databases?** The final decision is written to PostgreSQL in an open transaction, then MongoDB is updated, then PostgreSQL commits. If MongoDB fails, PostgreSQL rolls back. The MongoDB update's filter repeats the checks, so two approvers clicking at once cannot both win.

### App and authentication
19. **How are passwords and sessions protected?** Passwords are bcrypt hashes. A wrong email and a wrong password give the same 401, and take the same time (a dummy hash is compared). The session cookie is httpOnly and SameSite=Lax, and HMAC-signed with `SESSION_SECRET`, so editing the role inside it is rejected.
20. **If the UI has a bug that shows another student's request, what happens?** The data still comes from PostgreSQL as the logged-in user, so RLS returns no row. The API answers 404 (e.g. `/api/events/{id}/workflow`). The database is the last line of defence, not the UI.
