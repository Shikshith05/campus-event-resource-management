# CERMS: Campus Event and Resource Management System

DBMS Experiential Learning Level 3 project, PES University (Aug–Dec 2026).

**Team (Section G):** Shikshith V, Shreyas K M

CERMS lets campus users submit events, request venues and equipment, and follow multi-stage approvals. It includes role-based pages for requesters, approvers, staff, and administrators.

## Features

- Event request form with venue-conflict alternatives and optional equipment requests.
- Venue calendar for pending and confirmed bookings.
- Event request list with approval timelines and decision history.
- Approval inbox with approve/reject actions and comments.
- Staff analytics for event outcomes and venue/resource utilization.
- Admin inventory pages for venues and resources.
- PostgreSQL-enforced role access and row-level security; MongoDB stores workflow templates, instances, and audit history.

## Technology

| Layer | Technology | Data |
|---|---|---|
| Relational database | PostgreSQL 16 | users, roles, clubs, venues, resources, events, bookings, priority decisions |
| Document database | MongoDB 8 | workflow templates, instances, audit history, notifications |
| Web application | Next.js 15, React 19, TypeScript | login, pages, and API routes |
| Local services | Docker Compose | PostgreSQL and MongoDB |

## Repository layout

```text
.
├── app/                    Next.js application
│   ├── app/                Pages and API route handlers
│   ├── lib/                Authentication, database, and workflow helpers
│   ├── .env.example        Local connection settings template
│   └── package.json
├── db/
│   ├── sql/                Schema, seed data, procedures, views, and RBAC
│   └── mongo/              Workflow data and MongoDB scripts
├── docs/                   API reference and database design notes
└── docker-compose.yml      Local PostgreSQL and MongoDB services
```

## Requirements

- Git.
- Node.js 20.9 or newer and npm. The app uses Next.js 15; see the [Next.js system requirements](https://nextjs.org/docs/15/pages/getting-started/installation#system-requirements).
- Docker Desktop with Docker Compose for the recommended setup. Docker Desktop is available for [macOS](https://docs.docker.com/desktop/setup/install/mac-install/) and [Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
- If not using Docker: PostgreSQL 16, MongoDB 8, `psql`, and `mongosh` installed and available in your terminal.

Commands below assume you have opened a terminal at the repository root. The Docker commands work from macOS Terminal, Windows PowerShell, and Windows Git Bash. Native database setup includes separate shell examples.

## Quick start with Docker

Docker Compose starts PostgreSQL and MongoDB. On a new database volume, PostgreSQL automatically applies the SQL files in the correct order and loads the sample data.

### 1. Start the databases

From the repository root:

```sh
docker compose up -d
```

Wait for PostgreSQL and MongoDB to finish starting. You can check their status with:

```sh
docker compose ps
```

### 2. Load the MongoDB sample workflows

The MongoDB image includes `mongosh`; the script and JSON data are mounted in the container:

```sh
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/load.js
```

This resets the four workflow collections and loads the sample templates and workflow instances. Run it after a fresh database setup, or whenever you intentionally want to reload those samples.

### 3. Configure the app

In a second terminal, create `app/.env.local` from the example.

**macOS Terminal / Git Bash:**

```sh
cd app
cp .env.example .env.local
openssl rand -base64 48
```

**Windows PowerShell:**

```powershell
Set-Location app
Copy-Item .env.example .env.local
$secretBytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
[Convert]::ToBase64String($secretBytes)
```

Copy the generated value into the `SESSION_SECRET` line in `app/.env.local`. Keep the database values from `.env.example` for the Docker setup. The app connects as `cerms_app`, which is required for PostgreSQL row-level security; do not change it to the database owner/superuser.

### 4. Install and run the web app

Run from the `app` directory:

```sh
npm install
npm run dev
```

Open <http://localhost:3000/login>. To stop the development server, press `Ctrl+C` in its terminal. Stop the databases with `docker compose down` from the repository root.

## Run without Docker

Install PostgreSQL 16 and MongoDB 8 locally, start both services, and make sure `psql` and `mongosh` are on `PATH`. The database scripts below are run from the repository root.

### Reset and initialize PostgreSQL

Stop the app before resetting because active PostgreSQL connections can prevent the database from being dropped.

**macOS Terminal / Git Bash / Linux shell:**

```sh
psql -U postgres -c "DROP DATABASE IF EXISTS cerms" -c "CREATE DATABASE cerms"
for sqlFile in schema views booking_logic analytics procedures seed rbac workflow guest_lecture; do
  psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f "db/sql/$sqlFile.sql" || exit 1
done
```

**Windows PowerShell:**

```powershell
psql -U postgres -c "DROP DATABASE IF EXISTS cerms" -c "CREATE DATABASE cerms"
if ($LASTEXITCODE -ne 0) { throw "Could not recreate database cerms" }

$sqlFiles = @("schema", "views", "booking_logic", "analytics", "procedures", "seed", "rbac", "workflow", "guest_lecture")
foreach ($sqlFile in $sqlFiles) {
    psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f "db/sql/$sqlFile.sql"
    if ($LASTEXITCODE -ne 0) { throw "Failed while applying db/sql/$sqlFile.sql" }
}
```

The `rbac.sql` script intentionally prints five SQL `ERROR` lines in its permission/RLS checks. Those are expected; the script handles them and continues. The order matters: `workflow.sql` and then `guest_lecture.sql` must run after `rbac.sql` (re-run both whenever `rbac.sql` is re-run).

If PostgreSQL uses password authentication, add `-h localhost` to the `psql` commands and enter the PostgreSQL administrator password when prompted.

### Load MongoDB data

Run this from the repository root after MongoDB is running:

```sh
mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
```

The same command works in macOS Terminal, Windows PowerShell, and Git Bash when `mongosh` is installed and on `PATH`.

## App configuration

`app/.env.example` contains the local connection values:

```dotenv
DATABASE_URL=postgresql://cerms_app:cerms_app_dev@localhost:5432/cerms
MONGODB_URI=mongodb://localhost:27017/cerms
SESSION_SECRET=replace-with-a-long-random-development-secret
```

Copy this file to `app/.env.local` and replace `SESSION_SECRET` with a unique random value of at least 32 characters. `rbac.sql` creates `cerms_app` with the development password shown in the example. Never use these development credentials on a shared or public deployment.

## Logins

All seeded accounts use the development-only password **`password123`**.

| Email | Role |
|---|---|
| `student.one@campus.example` | Student |
| `student.two@campus.example` | Student |
| `coordinator.one@campus.example` | Club Coordinator |
| `coordinator.two@campus.example` | Club Coordinator |
| `faculty.one@campus.example` | Faculty |
| `faculty.two@campus.example` | Faculty |
| `hod.cse@campus.example` | HOD |
| `hod.ece@campus.example` | HOD |
| `admin.one@campus.example` | Admin |

After a fresh reset, the approver inbox samples include pending items for Coordinator Two, Faculty Two, HOD CSE, and Admin One.

## Pages and access

| Page | Access |
|---|---|
| `/login` | Public sign-in |
| `/dashboard` | All signed-in users |
| `/events/new` | All signed-in users |
| `/events` | All signed-in users; visible rows depend on the account's database permissions |
| `/availability` | All signed-in users |
| `/approvals` | Club Coordinator, Faculty, HOD, Admin |
| `/analytics` | Faculty, HOD, Admin |
| `/admin` | Admin |

Guest Lecture is offered in the request form only to Faculty, HOD and Admin accounts; it asks for the guest speaker, affiliation and talk topic, and is approved by the HOD and then the admin office. The API reference, including request/response examples, is in [docs/api.md](docs/api.md).

## Useful development commands

Run these from `app/`:

```sh
npm run dev       # start the development server at http://localhost:3000
npm run lint      # TypeScript check (tsc --noEmit)
npm run build     # create a production build
npm run start     # serve the production build
```

There is no automated test script in `package.json` yet. The `lint` script currently runs TypeScript checking; it does not run ESLint.

## Resetting Docker data

To rebuild the databases from scratch, run from the repository root:

```sh
docker compose down -v
docker compose up -d
```

Then reload MongoDB with the command from the quick start. **The `-v` option deletes both database volumes and all data in them.** PostgreSQL initialization scripts run automatically only when its data volume is empty.

## Database project files

| Topic | File |
|---|---|
| Tables, keys, constraints, indexes | `db/sql/schema.sql` |
| Validation, priority scoring, conflict resolution | `db/sql/booking_logic.sql` |
| Calendar, request, and utilization views | `db/sql/views.sql` |
| Analytics views | `db/sql/analytics.sql` |
| Submission procedure and audit trigger | `db/sql/procedures.sql` |
| Sample relational data | `db/sql/seed.sql` |
| Roles, grants, row-level security, and policy demonstrations | `db/sql/rbac.sql` |
| Workflow-aware access and approval functions | `db/sql/workflow.sql` |
| Guest-lecture details: insert grant and row-level security | `db/sql/guest_lecture.sql` |
| Real PES University data: CSV templates, loader, password hashes | `data/pes/*.csv`, `db/sql/load_pes_data.sql`, `scripts/hash-password.mjs`; step by step in [docs/real-data-guide.md](docs/real-data-guide.md) |
| SQL query catalogue | `db/sql/queries.sql` |
| Reversible DML demonstration | `db/sql/dml.sql` |
| MongoDB sample loader | `db/mongo/load.js` |
| MongoDB workflow engine demonstration | `db/mongo/workflow_engine.js` |
| MongoDB read/update/delete demonstration | `db/mongo/workflow_rud.js` |
| Database diagram and design notes | `docs/er-diagram.md`, `docs/schema.dbml`, `docs/schema-explanation.md` |
| Screenshots of every page at 1280 px and 390 px | [docs/screenshots/](docs/screenshots/README.md) |
| ER diagram images (regenerate with `node scripts/render-er-diagram.mjs`) | [core tables](docs/er-diagram-core.png), [booking tables](docs/er-diagram-booking.png), [all 14 tables](docs/er-diagram.png) (+ `.svg` of each) |

Sample people, venue names, capacities, equipment counts, and event data are placeholders for the campus survey. Development passwords and database-role passwords are for local use only.
