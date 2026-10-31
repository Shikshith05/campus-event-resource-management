# PES RR data and safe loading

This guide covers the venue data provided for PES University, Ring Road Campus, and the private account and approval mappings needed before production use. The repository contains no real staff account records or approval assignments.

## Venue data and capacity ranges

`data/pes/venues.csv` contains the 10 supplied venues, exact names, building labels, types, and capacity ranges. A clean seed includes these same venues. `min_capacity` and `max_capacity` preserve the supplied estimates. `capacity` in PostgreSQL remains `NULL` until an authorized campus contact confirms a safe booking limit. A venue with `NULL` confirmed capacity is visible in the form but cannot be booked. This prevents the range's upper end from being treated as a verified safety limit.

The `venue_type_confirmed` column is false for PESU 52 and 13th floor because their supplied type is `OTHER, pending confirmation`. The three listed `OTHER` rows use the supported `OTHER` type. No managing department or equipment properties are assigned to these venues.

The targeted venue loader updates by unique venue name, preserves an already confirmed exact capacity, and never deletes records:

```sh
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/migrations/001_venue_ranges_and_approver_assignments.sql
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/load_pes_venues.sql
```

For an existing database, apply the migration once. It adds the range fields, copies existing exact capacities into both range endpoints, and creates the role-assignment table. The loader can then be run again safely; it does not truncate events, bookings, users, or audit records.

## Private account and membership files

Staff identities, student identities, club-advisor emails, member emails, and approver assignments belong under `data/pes/private/`. `.gitignore` excludes that directory from Git. A Git ignore rule is not encryption or access control: keep the directory on protected storage, limit access, and never commit filled private CSVs or password hashes.

Create these files locally using the public CSV headers as a guide. Do not overwrite or move existing files:

| Private CSV | Header | Purpose |
|---|---|---|
| `users.csv` | `university_id,full_name,email,role,department_code,password_hash` | Login accounts; `WORKFLOW_APPROVER` is for central workflow-only accounts. |
| `clubs.csv` | `name,department_code,advisor_email` | Club faculty advisor data. |
| `club_members.csv` | `club_name,member_email,club_position` | Private club membership data. |
| `workflow_approvers.csv` | `university_id,approver_role,department_code,club_name` | Maps existing accounts to scoped designations. |

The checked-in `data/pes/users.csv`, `clubs.csv`, and `club_members.csv` remain example templates only; the real-data loader reads their private counterparts. Public department and resource files may be used if they contain no personal data. The supplied public venue file is safe to track.

Never create placeholder identities to fill a missing position. Obtain the real account mapping through the project owner's approved process. Keep passwords out of CSVs; `password_hash` must contain a bcrypt hash generated for the account holder.

## Approval sequence and required mappings

Every proposal uses these four required stages, in order:

1. Club Coordinator — a faculty member assigned to oversee the club, not its student coordinator.
2. HOD — the HOD assigned to the event's selected department.
3. Dean of Student Affairs.
4. Vice Chancellor.

This same chain applies to club, department, hackathon, guest-lecture, and other event requests. A department is required on every submission so the correct HOD can be resolved. Guest lectures retain their required guest name, affiliation, and talk topic fields.

`workflow_approver_assignment` maps accounts to designations without hardcoded staff IDs in templates. Club assignments must match the club's faculty advisor; HOD assignments must match the HOD's department. The two campus-wide designations require a `WORKFLOW_APPROVER` account, a limited role that can only read assigned approval requests and act on its assigned stage. Student club coordinators remain requesters and cannot approve.

Assignment CSV rules:

- `CLUB_COORDINATOR`: provide either `club_name` (club event; account must match the club faculty advisor) or `department_code` (non-club event routing), never both.
- `HOD`: provide `department_code` and leave `club_name` blank.
- `DEAN_OF_STUDENT_AFFAIRS` and `VICE_CHANCELLOR`: leave both scope columns blank. These use `WORKFLOW_APPROVER` accounts.
- Each designation and scope may have only one mapped account. All four stage accounts must be distinct and must not be the requester. Missing or overlapping assignments block submission with an actionable error; no stage is skipped.

Do not enter or publish the name of the individual holding the Dean of Student Affairs position. The application displays the designation only and suppresses approver account identities in requester timelines and submission responses.

## Loading the full campus data set

`db/sql/load_pes_data.sql` keeps its optional `replace=1` mode for one-time conversion of a disposable seeded database. That mode truncates booking/event records, users, clubs, resources, venues, departments, and workflow assignments. **Do not use `replace=1` on an existing or production database.** For new real-data setup, use a separate empty database, review the SQL first, and load private files from protected local storage.

The full loader stages and validates all inputs in one SQL transaction. Venue rows use a name-based upsert so repeat venue imports do not add duplicates; other master rows reject existing duplicates. It inserts role assignments after departments, users, clubs, and memberships. Database triggers validate that assignment accounts have the required role and scope.

```sh
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -v replace=1 -f db/sql/load_pes_data.sql
```

The command above is only for an explicitly disposable local database after inspecting the `TRUNCATE` list. It is not needed to apply the venue update; use `load_pes_venues.sql` for that.

## Existing database upgrade

For an existing database, preserve its records and apply the upgrade scripts as the database owner:

```sh
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/migrations/001_venue_ranges_and_approver_assignments.sql
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/procedures.sql
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/migrations/002_hackathon_and_submit_signature.sql
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/workflow.sql
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/load_pes_venues.sql
```

This does not rerun `rbac.sql`, which resets development login passwords and rebuilds grants. The first migration creates the workflow-only database group and membership. The updated `workflow.sql` grants the narrow workflow routines. If RBAC is intentionally reconfigured later, run `rbac.sql` followed by `workflow.sql` and `guest_lecture.sql` as applicable.

## Verification and unresolved data

Check venues without changing data:

```sh
psql -U postgres -d cerms -c "SELECT name, venue_type, building, capacity, min_capacity, max_capacity, venue_type_confirmed FROM venue WHERE name IN ('Opera House','MRD Auditorium','GJBC 1A Audi','GJBC 1B Auditorium','GJBC 2A Auditorium','GJBC 2B Auditorium','PESU 52','13th floor','3rd floor seminar hall','5th floor seminar hall') ORDER BY name"
```

The exact safe booking capacity for each supplied range is still unconfirmed. PESU 52 and 13th floor still need venue-type confirmation. Before submissions can start in a production deployment, the owner must provide the real Club Coordinator, HOD, Dean of Student Affairs, and Vice Chancellor account mappings for the required scopes. The approval SLA values in templates are software defaults, not verified PES policy.
