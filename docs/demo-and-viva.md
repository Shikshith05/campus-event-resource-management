# CERMS demo and viva notes

This guide uses the existing local development database. Do not reset or replace a shared database for a presentation. `docker compose down -v` deletes both database volumes and their data; use it only for a disposable local environment.

## Safe local setup

Start services if they are not already running:

```sh
docker compose up -d
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/load.js
cd app
npm install
npm run dev
```

`load.js` upserts managed workflow templates and indexes. It preserves workflow instances, audit history, and notifications. Development seed users are examples only and have no approval assignments. The application intentionally refuses new submissions until real, distinct approver mappings are configured. Do not substitute demo accounts for real campus designations.

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
