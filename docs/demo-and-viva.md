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

## Demo sequence

| Step | Show | Explain |
|---|---|---|
| 1 | `data/pes/venues.csv` and the request form | All 10 supplied PES RR venues retain the exact building labels and estimated min/max ranges. An unconfirmed estimate is not treated as a safe booking capacity, so those venues stay unavailable until confirmed. |
| 2 | `db/sql/load_pes_venues.sql` | It upserts by venue name, preserves an already confirmed capacity, and does not delete bookings or events. |
| 3 | `db/mongo/workflow_templates.json` | Club, department, guest-lecture, and standard templates each use the required four roles in the same order. Hackathon requests use the standard template. Guest lecture fields remain required. |
| 4 | `db/sql/schema.sql`, `workflow.sql`, and `app/lib/workflow-policy.ts` | PostgreSQL stores scoped role assignments. The app refuses missing assignments, self-approval, duplicate assignees, and out-of-order decisions. A student club coordinator is not the faculty Club Coordinator approver. |
| 5 | `app/app/api/approvals/[eventId]/route.ts` and `workflow_instances` | The backend checks the current assigned stage and an SQL assignment check before recording. MongoDB updates the stage atomically, writes audit entries, and notifies the next approver. Rejection ends the workflow; only stage four may set the event to APPROVED. |
| 6 | `db/mongo/workflow_rud.js` | The R/U/D coursework demo uses isolated scratch collections and does not alter live events, workflow records, or notification history. |

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
