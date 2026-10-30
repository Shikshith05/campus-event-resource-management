# CERMS: Campus Event and Resource Management System

DBMS Experiential Learning Level 3 project, PES University (Aug-Dec 2026).

**Team (Section G):** Shikshith V, Shreyas K M

## What it does

Students and club coordinators submit event requests: date and time, expected footfall, venue preference, and resources such as projectors, mics and chairs. CERMS then:

- **Allocates venues by priority.** When two requests clash for the same venue and time, it computes a priority score from four inputs: event category (academic > department > club > personal), the requester's role, how far in advance they booked, and their past cancellations and no-shows. The higher score gets the venue, and the other requester is offered alternates.
- **Runs a multi-level approval workflow.** The chain (e.g. Club Coordinator, then Faculty Advisor, then HOD, then Admin) is configurable per event type and department. Each request has its own workflow instance with per-stage status.
- **Enforces role-based access.** The roles are Student, Club Coordinator, Faculty, HOD and Admin.

## Tech stack

| Layer | Technology | Holds |
|---|---|---|
| Relational DB | PostgreSQL 16 | users, roles, clubs, venues, resources, events, bookings, priority decisions |
| Document DB | MongoDB | workflow templates, instances, audit history and notifications |
| Web app | Next.js + TypeScript | login, role-based dashboard, event/availability/analytics API with database-enforced access control |

## Status

- **Phase 3: integration foundation.** SQL booking logic, MongoDB workflow operations, audit/notification collections, and a Next.js API/dashboard foundation.
- **Phase 4: queries, procedures, security (current).** DML and query catalogues, stored procedure + audit trigger, MongoDB Read/Update/Delete, login with signed session cookies, database roles and row-level security.
- Later: event request form, calendar, approver inbox, admin management, and analytics pages.

## Folder structure

```
.
├── README.md
├── docs/
│   ├── er-diagram.md          ER diagram (Mermaid) and relationship table
│   ├── schema.dbml            same schema for https://dbdiagram.io
│   ├── schema-explanation.md  table-by-table explanation and normal forms (viva notes)
│   └── api.md                 every API route: who may call it, request/response examples
├── db/
│   ├── sql/
│   │   ├── schema.sql         PostgreSQL DDL: tables, keys, constraints, indexes
│   │   ├── booking_logic.sql  validation, priority scoring and conflict resolution
│   │   ├── views.sql          reporting, calendar, history and utilization views
│   │   ├── analytics.sql      event and resource analytics views
│   │   ├── procedures.sql     submit_booking_request procedure, alternate-venue function, audit trigger
│   │   ├── seed.sql           placeholder sample data
│   │   ├── rbac.sql           database roles, least-privilege GRANTs, row-level security + tests
│   │   ├── workflow.sql       approver access: coordinator policy, workflow_context, approval_details, record_workflow_decision
│   │   ├── dml.sql            INSERT/UPDATE/DELETE demo (rolls itself back)
│   │   └── queries.sql        joins, subqueries, CTEs, recursive CTEs, aggregates, window function
│   └── mongo/
│       ├── workflow_templates.json   3 sample approval chains
│       ├── workflow_instances.json   1 sample running approval
│       ├── load.js                   mongosh script: loads sample data and creates indexes
│       ├── workflow_engine.js        template selection, approval and delete operations
│       ├── workflow_rud.js           labelled Read / Update / Delete demo + aggregation
│       └── analytics.js              workflow aggregation reports
└── app/                       Next.js app
    ├── middleware.ts          login + role checks before every page and API route
    ├── lib/session.ts         signed session cookie, roles, route rules
    ├── lib/auth.ts            read the session in routes and pages
    ├── lib/db.ts              PostgreSQL/MongoDB access; withUserTransaction (SET LOCAL ROLE)
    ├── lib/workflow.ts        approval-workflow engine (TypeScript port of db/mongo/workflow_engine.js)
    └── app/                   pages (/login, /dashboard, /) and API routes (/api/...)
```

## Running the database scripts

### Cross-platform Docker setup

Docker Desktop is the simplest way to run the same PostgreSQL and MongoDB
versions on macOS, Windows, or Linux:

```bash
docker compose up -d
cd app
cp .env.example .env.local
npm install
npm run dev
```

The SQL files are applied automatically when the PostgreSQL volume is created.
To reset the database and reload the seed data:

```bash
docker compose down -v
docker compose up -d
```

Load the MongoDB sample workflow data from the repository root:

```bash
docker compose exec mongodb mongosh cerms db/mongo/load.js
docker compose exec mongodb mongosh cerms db/mongo/workflow_engine.js
docker compose exec mongodb mongosh cerms db/mongo/workflow_rud.js
```

`docker-compose.yml` mounts `./db/mongo` into the container at `/db/mongo`,
so these paths work inside the `mongodb` service.

The application is then available at <http://localhost:3000>.

### PostgreSQL

```bash
# 1. create the database once
psql -U postgres -c "CREATE DATABASE cerms;"

# 2. create the tables (drops existing CERMS tables first)
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/schema.sql

# 3. create reporting and availability views
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/views.sql

# 4. create booking validation and priority functions
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/booking_logic.sql

# 5. create analytics views
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/analytics.sql

# 6. create the stored procedure, alternate-venue function and audit trigger
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/procedures.sql

# 7. load the placeholder data (wipes existing CERMS data first)
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/seed.sql

# 8. database roles, GRANTs and row-level security
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/rbac.sql

# 9. approval-workflow access: coordinator policy + approver functions
#    (must run after rbac.sql, and again whenever rbac.sql is re-run)
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/workflow.sql

# optional demos (run after the seed; dml.sql rolls itself back)
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/dml.sql
psql -U postgres -d cerms -f db/sql/queries.sql
```

If PostgreSQL runs inside WSL, run these from the WSL shell after `cd /mnt/d/projects/campus-event-resource-management`. Add `-h localhost` if your setup asks for a password over TCP.

**Expected ERROR lines.** Some statements are *meant* to fail, to show that a
constraint, trigger or permission works. They run inside a `SAVEPOINT`, so the
script carries on and exits successfully:

- `rbac.sql` prints 5 (tests T5, T6, T7, T8, T10: permission denied / row-level security)
- `dml.sql` prints 4 (7a double booking, 7b end before start, 7c club without club, 8c procedure failure)

`schema.sql` uses the `btree_gist` extension, which ships with standard PostgreSQL. It powers the "no double-booking" constraint.

### MongoDB

```bash
mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
```

This drops and reloads all four workflow collections (`workflow_templates`, `workflow_instances`, `workflow_audit`, `workflow_notifications`) and creates their indexes.
Alternatively, with MongoDB Database Tools installed:

```bash
mongoimport --db cerms --collection workflow_templates --jsonArray --file db/mongo/workflow_templates.json
mongoimport --db cerms --collection workflow_instances --jsonArray --file db/mongo/workflow_instances.json
```

Load the workflow operations after the sample data:

```bash
mongosh "mongodb://localhost:27017/cerms" db/mongo/workflow_engine.js
mongosh "mongodb://localhost:27017/cerms" db/mongo/analytics.js
```

The workflow engine exposes `createWorkflowInstance`, `approveWorkflowStage`,
`rejectWorkflowStage`, `escalateOverdueStages`, `deleteWorkflowForEvent` and
`purgeOldNotifications` to the application layer.

Read / Update / Delete demonstration (run right after `load.js`, which resets
the collections):

```bash
mongosh "mongodb://localhost:27017/cerms" db/mongo/workflow_rud.js
```

### Next.js application

```bash
cd app
cp .env.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000/login>. The app connects to PostgreSQL as
`cerms_app` (created by `rbac.sql`), so run `rbac.sql` before starting it.

#### Login credentials (DEVELOPMENT ONLY)

Every sample user in `seed.sql` has the password **`password123`**, stored
as a real bcrypt hash. These accounts and the database role passwords in
`rbac.sql` (`cerms_app_dev`, `password123`) are for local development only.
Never use them on a shared or public server.

| Email | App role | Database role |
|---|---|---|
| `student.one@campus.example` | Student | `cerms_student` |
| `coordinator.one@campus.example` | Club Coordinator | `cerms_student` |
| `faculty.one@campus.example` | Faculty | `cerms_faculty` |
| `hod.cse@campus.example` | HOD | `cerms_faculty` |
| `admin.one@campus.example` | Admin | `cerms_admin` |

#### Endpoints

| Endpoint | Access |
|---|---|
| `POST /api/auth/login` | public: email + password, sets the signed `cerms_session` cookie |
| `POST /api/auth/logout` | clears the cookie |
| `GET /api/auth/me` | any logged-in user |
| `GET /api/health` | public |
| `GET /api/events` | any logged-in user (a student sees only their own requests: row-level security) |
| `GET /api/availability` | any logged-in user |
| `GET /api/analytics` | Faculty, HOD, Admin |
| `POST /api/events/submit` | any logged-in user: submit a request and start its approval workflow |
| `GET /api/events/{eventId}/workflow` | anyone who can see the event: approval timeline |
| `GET /api/approvals` | Club Coordinator, Faculty, HOD, Admin: my pending approvals |
| `POST /api/approvals/{eventId}` | the assigned approver only: approve or reject |
| `/login`, `/dashboard` | login page; dashboard with a role-specific section |

Full request/response examples: [docs/api.md](docs/api.md).

## What each file demonstrates

| Topic | File | What to look at |
|---|---|---|
| DDL with constraints | `db/sql/schema.sql` | PK/FK/UNIQUE/CHECK, exclusion constraint against double booking |
| DML | `db/sql/dml.sql` | INSERT, UPDATE, DELETE, `UPDATE ... FROM`, `INSERT ... SELECT`, CASCADE, SAVEPOINTs |
| Joins, nested, correlated and recursive queries | `db/sql/queries.sql` | sections A-G, each query answers a question written above it |
| Functions and triggers | `db/sql/booking_logic.sql`, `db/sql/procedures.sql` | priority score, conflict resolution, validation triggers, status audit trigger |
| Stored procedure | `db/sql/procedures.sql` | `submit_booking_request`, called with `CALL` in `dml.sql` section 8 |
| Views | `db/sql/views.sql`, `db/sql/analytics.sql` | calendar, history and analytics views |
| Database RBAC and row-level security | `db/sql/rbac.sql` | roles, GRANTs, policies, test section T1-T11 |
| NoSQL create / aggregation | `db/mongo/load.js`, `workflow_engine.js`, `analytics.js` | templates, instances, audit, notifications |
| NoSQL Read / Update / Delete | `db/mongo/workflow_rud.js` | labelled R1-R5, U1-U4, D1-D3 |
| Authentication | `app/app/api/auth/*`, `app/middleware.ts`, `app/lib/session.ts` | bcrypt, signed httpOnly cookie, role checks |
| Database-enforced access from the app | `app/lib/db.ts` | `withUserTransaction`: `SET LOCAL ROLE` + `app.current_user_id` |

## About the sample data

Real venue counts, capacities and equipment quantities will come from a campus survey. Until then, every name, number, person and date in `db/sql/seed.sql` and `db/mongo/*.json` is a placeholder, marked with `PLACEHOLDER: replace after campus survey`. The schema itself does not depend on any of these values. Only the five role rows are real design data.

## Documents

- [docs/er-diagram.md](docs/er-diagram.md): ER diagram
- [docs/schema-explanation.md](docs/schema-explanation.md): design explanation and normalization
- [docs/api.md](docs/api.md): API routes for the front end
