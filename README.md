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
| Document DB | MongoDB | approval workflow templates and running workflow instances |
| Web app | Next.js (later phase) | not started |

## Status

- **Phase 1: database design (current).** ER diagram, normalized schema with constraints, and placeholder seed data.
- Later: SQL queries, procedures and functions, triggers, views, the priority engine, MongoDB aggregation, then the Next.js app with authentication and RBAC.

## Folder structure

```
.
├── README.md
├── docs/
│   ├── er-diagram.md          ER diagram (Mermaid) and relationship table
│   ├── schema.dbml            same schema for https://dbdiagram.io
│   └── schema-explanation.md  table-by-table explanation and normal forms (viva notes)
├── db/
│   ├── sql/
│   │   ├── schema.sql         PostgreSQL DDL: tables, keys, constraints, indexes
│   │   └── seed.sql           placeholder sample data
│   └── mongo/
│       ├── workflow_templates.json   3 sample approval chains
│       ├── workflow_instances.json   1 sample running approval
│       └── load.js                   mongosh script: loads both files and creates indexes
└── app/                       Next.js app (later phase; empty for now)
```

## Running the database scripts

### PostgreSQL

```bash
# 1. create the database once
psql -U postgres -c "CREATE DATABASE cerms;"

# 2. create the tables (drops existing CERMS tables first)
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/schema.sql

# 3. load the placeholder data (wipes existing CERMS data first)
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/seed.sql
```

If PostgreSQL runs inside WSL, run these from the WSL shell after `cd /mnt/d/projects/campus-event-resource-management`. Add `-h localhost` if your setup asks for a password over TCP.

`schema.sql` uses the `btree_gist` extension, which ships with standard PostgreSQL. It powers the "no double-booking" constraint.

### MongoDB

```bash
mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
```

This drops and reloads the `workflow_templates` and `workflow_instances` collections and creates their indexes.
Alternatively, with MongoDB Database Tools installed:

```bash
mongoimport --db cerms --collection workflow_templates --jsonArray --file db/mongo/workflow_templates.json
mongoimport --db cerms --collection workflow_instances --jsonArray --file db/mongo/workflow_instances.json
```

## About the sample data

Real venue counts, capacities and equipment quantities will come from a campus survey. Until then, every name, number, person and date in `db/sql/seed.sql` and `db/mongo/*.json` is a placeholder, marked with `PLACEHOLDER: replace after campus survey`. The schema itself does not depend on any of these values. Only the five role rows are real design data.

## Documents

- [docs/er-diagram.md](docs/er-diagram.md): ER diagram
- [docs/schema-explanation.md](docs/schema-explanation.md): design explanation and normalization
