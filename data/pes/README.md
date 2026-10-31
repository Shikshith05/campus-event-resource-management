# PES campus data files

`venues.csv` contains the supplied PES University Ring Road venue list. The remaining public CSVs are format examples; account details and email addresses must be stored in ignored `data/pes/private/` files. See [the safe data guide](../../docs/real-data-guide.md) before loading.

- Keep each CSV header unchanged and save as UTF-8 CSV.
- Delete example rows from files used for an actual load. The loader rejects rows marked `EXAMPLE` unless `-v allow_examples=1` is explicitly set for a disposable test database.
- Never put real staff or student identities, emails, or password hashes in tracked files. `.gitignore` excludes `data/pes/private/`, but the folder itself is not encrypted.
- `db/sql/load_pes_venues.sql` is the repeatable, non-destructive venue import. It upserts by name and does not remove existing database rows.

| File | Columns | Rules |
|---|---|---|
| `departments.csv` | `code,name` | Short unique code (stored uppercase; max 10 characters) and unique full name. |
| `users.csv` (example only) | `university_id,full_name,email,role,department_code,password_hash` | Copy the header to `private/users.csv`. Roles: `STUDENT`, `CLUB_COORDINATOR`, `FACULTY`, `HOD`, `ADMIN`, `WORKFLOW_APPROVER`. Central workflow-only accounts may have no department; other roles except `ADMIN` need one. Store bcrypt hashes only. |
| `venues.csv` | `name,venue_type,building,min_capacity,max_capacity,venue_type_confirmed` | Capacity endpoints preserve supplied estimates. Exact `capacity` stays NULL until an authorized safe booking limit is confirmed. Type values: `AUDITORIUM`, `SEMINAR_HALL`, `CLASSROOM`, `LAB`, `OPEN_AIR`, `OTHER`. |
| `resources.csv` | `name,resource_type,total_quantity` | Unique name; resource type `AV`, `FURNITURE`, `POWER`, `DECOR`, or `OTHER`; quantity is a whole number 0 or greater. |
| `clubs.csv` (example only) | `name,department_code,advisor_email` | Copy to `private/clubs.csv`; advisor email is private. The assigned Club Coordinator approver for a club must be the club's faculty advisor. |
| `club_members.csv` (example only) | `club_name,member_email,club_position` | Copy to `private/club_members.csv`; member emails are private. `club_position` is `MEMBER` or `COORDINATOR`. Student coordinators do not approve proposals. |
| `private/workflow_approvers.csv` | `university_id,approver_role,department_code,club_name` | Maps an existing real account to a workflow designation and scope. Allowed designations and scope rules are described in `docs/real-data-guide.md`. |

The venue data intentionally includes no managing department or equipment availability because neither was supplied. Do not infer those values.
