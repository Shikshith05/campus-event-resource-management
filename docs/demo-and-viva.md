# CERMS: demo script, rubric map and viva questions

This walkthrough uses fictional local seed accounts and placeholder venues. Never use these identities or mappings for a real campus deployment. Reset only a disposable local database: `DROP DATABASE` and `docker compose down -v` delete data.

## 1. Before the demo (10 minutes earlier)

### WSL PostgreSQL on port 5432

Run from the repository root in the WSL terminal. Keep this terminal open so PostgreSQL stays available during the demo.

```sh
psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS cerms WITH (FORCE)"
psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE cerms"
for sqlFile in schema views booking_logic analytics procedures seed rbac workflow guest_lecture; do
  psql -h localhost -p 5432 -U postgres -d cerms -v ON_ERROR_STOP=1 -q -f "db/sql/$sqlFile.sql" || break
done
psql -h localhost -p 5432 -U postgres -d cerms -c "SELECT event_id, status FROM event WHERE event_id IN (7, 8) ORDER BY event_id"
```

Use these reset commands only with a disposable local `cerms` database. The last query should show events 7 and 8 as `PENDING_APPROVAL`.

### MongoDB and the app

If using Docker, reset its volumes only when they contain disposable demo data:

```sh
docker compose down -v
docker compose up -d
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/load.js
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/seed_demo_workflows.js
```

For WSL services, start MongoDB and run the two loader commands from the repository root:

```sh
mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
mongosh "mongodb://localhost:27017/cerms" db/mongo/seed_demo_workflows.js
```

`load.js` upserts workflow templates and indexes. The demo seeder adds pending MongoDB workflow instances for the two PostgreSQL sample requests without replacing existing instances. Then configure and start the app:

```sh
cd app
cp .env.example .env.local
npm install
npm run dev
```

Set `DATABASE_URL` in `app/.env.local` to port **5432** when using WSL PostgreSQL. The checked-in `.env.example` uses port **5433** for Docker Compose. Keep the local session secret in `.env.local`.

### Pre-flight

- [ ] <http://localhost:3000/api/health> reports PostgreSQL and MongoDB as `ok`.
- [ ] Log in to the accounts you will use. All seeded demo passwords are `password123`:
  1. `student.two@campus.example` — requester
  2. `faculty.two@campus.example` — Robotics Club faculty advisor, stage 1
  3. `hod.ece@campus.example` — ECE HOD, stage 2
  4. `dean.demo@campus.example` — fictional demo Dean, stage 3
  5. `vc.demo@campus.example` — fictional demo Vice Chancellor, stage 4
  6. `admin.one@campus.example` — administrator, read-only inbox
  7. `coordinator.two@campus.example` — student club coordinator, read-only inbox
- [ ] Open `docs/er-diagram-core.png` and `docs/er-diagram-booking.png`.

## 2. Demo script (about 6½ minutes)

| Time | Who / where | Do | Say | Rubric |
|---|---|---|---|---|
| 0:00 | ER images, PES venue CSV, README | Show the ER images, stack, and the supplied PES venue list. Point out that venues with unconfirmed capacities are visible but unavailable for booking. | “PostgreSQL protects bookings and event facts; MongoDB stores flexible approval chains. Estimated capacity is never treated as a confirmed safe limit.” | 1, 2, 5 |
| 0:40 | **Student Two**, `/events/new` | Submit *Robotics Expo Day*: CLUB, TECH FEST, Robotics Club, ECE, 120 people, Open Air Theatre, a date in December 2026, PA System 1. | “One `CALL submit_booking_request` inserts the event, booking, and equipment in one transaction, then runs the priority engine.” | 10, 11, 8 |
| 1:20 | Student Two, `/events/new` | Submit a second request for Seminar Hall A on **12 Nov 2026, 10:30–11:30**, 40 people. The clash shows alternates. Choose **Classroom 101** and submit again. | “The confirmed booking wins. The exclusion constraint prevents double-booking; the losing request gets alternatives from `suggest_alternate_venues`, which uses a CTE.” | 8, 3 |
| 2:00 | **Faculty Two** → **HOD ECE**, `/approvals` | Approve *Robotics Expo Day* at stages 1 and 2. Point at the priority score. | “The faculty advisor is stage one; the HOD is stage two. MongoDB identifies the current turn, and PostgreSQL checks the account’s scoped assignment.” | 9, 12 |
| 2:40 | **Demo Dean** → **Demo Vice Chancellor**, `/approvals` | Approve stages 3 and 4. Optionally open `/approvals` as Student Coordinator Two and Admin to show their read-only inbox access. | “The Dean and Vice Chancellor use limited workflow approver accounts. Only the assigned account can decide the current stage; the last approval completes the event.” | 11, 12 |
| 3:00 | Student Two, `/events` | Open *Robotics Expo Day* and show its approval timeline. | “The timeline combines the MongoDB workflow and audit trail with the public stage designations.” | 10, 9 |
| 3:20 | Student Two → `/analytics`, then `psql` | Show the access denial, then run the RLS snippet below. | “The same SELECT returns different rows by role. RBAC and row-level security are enforced by PostgreSQL, not only by the interface.” | 12 |
| 4:00 | `psql` | Run `\i db/sql/queries.sql`; show E1 and C1. Then run `\i db/sql/dml.sql` and show the procedure call and `booking_status_history`. | “The query catalogue demonstrates joins, nested and correlated queries, and recursive CTEs. The DML walkthrough rolls back its changes.” | 6, 7, 8 |
| 4:50 | MongoDB shell | Run `mongosh "mongodb://localhost:27017/cerms" db/mongo/analytics.js`; show `db/mongo/workflow_rud.js` for isolated R/U/D examples. | “The aggregation summarizes stage turnaround. The R/U/D demo uses scratch collections and leaves live workflows alone.” | 4, 9 |
| 5:30 | **Admin**, `/admin` then `/analytics` | Show venue and resource administration using the placeholder venues. Retire a placeholder venue and show analytics. | “A venue is retired rather than deleted so old bookings retain their reference. PES venues stay unbookable until their exact safe capacities are confirmed.” | 10, 11 |
| 6:10 | Repository | Show `git log --oneline -10` and the `docs/` folder. | “The project history has ten task-focused commits, and the documentation connects the design to the rubric.” | 13, 14 |

**RLS snippet for 3:20** (paste in `psql`; the transaction rolls back):

```sql
BEGIN;
SET LOCAL ROLE cerms_student; SELECT set_config('app.current_user_id', '1', true);
SELECT 'student 1' AS who, count(*) AS events_visible FROM event;
SET LOCAL ROLE cerms_faculty; SELECT set_config('app.current_user_id', '5', true);
SELECT 'faculty 5' AS who, count(*) AS events_visible FROM event;
SET LOCAL ROLE cerms_student; SELECT set_config('app.current_user_id', '1', true);
UPDATE event SET status = 'APPROVED' WHERE event_id = 3; -- blocked by row-level security
ROLLBACK;
```

If time is short, skip the MongoDB aggregation and admin steps and show the screenshots under `docs/screenshots/`. The ten PES RR venues are deliberately not bookable until an authorized person confirms each exact safe capacity; use the five legacy placeholder venues for booking examples.

**What can go wrong:**

- A 503 or “temporarily unavailable” response usually means PostgreSQL or MongoDB stopped. Start the WSL service or Docker container and retry.
- A request stays in DRAFT if the demo approver SQL seed or MongoDB demo workflow seed was skipped. Repeat the setup steps above on a disposable local database.
- The venue clash example depends on Seminar Hall A, 12 Nov 2026, 10:30–11:30.

To run the source-level checks and app verification:

```sh
cd app
npm test
npm run lint
npm run build
```

The SQL upgrade and venue import commands are in [real-data-guide.md](real-data-guide.md). Use a dedicated disposable database for database integration checks.

## Likely viva questions

1. **Why keep estimated and confirmed venue capacity separate?** The supplied ranges are useful to display, but neither endpoint is an authorized safe booking limit. `capacity` stays NULL until confirmation; booking validation rejects NULL and values above the confirmed limit.
2. **Why does every event need a department?** Every event type has an HOD stage, so a department is needed to route that approval. This is enforced by the form, procedure, and database constraint for new events.
3. **Why is the student Club Coordinator not the stage-one approver?** The app's `CLUB_COORDINATOR` account role belongs to student requesters. The workflow assignment is scoped separately and only accepts a faculty or HOD account; for a club, it must be the club's faculty advisor.
4. **How does the app prevent out-of-order approval?** The MongoDB workflow instance records one current pending stage. The route accepts actions only from that stage's assigned account, then performs an atomic conditional update. PostgreSQL independently validates the user's stage assignment before a final approval or rejection.
5. **When does an event become fully approved?** Only an approval action on stage four updates the event to APPROVED. An earlier rejection stops the workflow and rejects its pending or confirmed booking.
6. **How are Dean of Student Affairs and Vice Chancellor accounts represented?** Both use the limited `WORKFLOW_APPROVER` app role and a scoped designation mapping. It has access to assigned approval details and actions only; no person is embedded in templates or source files.
7. **How are approvals audited?** `workflow_audit` records the stage, acting user ID, decision, comment, and timestamp. Requester-facing timelines show stage designations and timestamps without staff account IDs or names.
8. **How are the two databases kept consistent?** PostgreSQL owns event and booking facts; MongoDB owns workflow stages. Submission compensates a failed Mongo write by returning the event to DRAFT. Decision updates use a PostgreSQL transaction around the atomic Mongo stage update; a process failure between the Mongo write and SQL commit remains a repair case visible in the audit trail.
9. **Why are real staff CSVs ignored by Git?** They contain identifiers, email addresses, and password hashes. The ignored directory prevents accidental tracking, while protected storage and access control remain necessary.

The template SLA hours are application defaults. They are not represented as verified PES policy. Exact safe capacities, the two pending venue types, and real approver account mappings still require confirmation.
