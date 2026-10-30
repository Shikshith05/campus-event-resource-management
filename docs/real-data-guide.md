# Loading real PES University data

This guide replaces the placeholder campus data (made-up departments, people, venues, equipment and clubs) with the real data you collect. Nothing in the database design changes; only the rows do.

**You will need:** the repository, PostgreSQL with the CERMS database already reset (see the README), `psql`, Node.js, and a spreadsheet program.

Files:

| Path | What it is |
|---|---|
| `data/pes/*.csv` | the six templates you fill in (each has `EXAMPLE` rows to show the format) |
| `data/pes/README.md` | the rules for every column |
| `db/sql/load_pes_data.sql` | the loader |
| `scripts/hash-password.mjs` | makes a password hash for a new user |

---

## 1. What to survey

Collect these on campus (from the admin office, estate/facilities office, department offices and student affairs):

**Departments**
- [ ] Every department that runs events or manages a venue: short code (e.g. CSE, ECE) and full name.

**Venues** (anything that can be booked for an event)
- [ ] Exact name as people use it (e.g. "MRD Auditorium", "Seminar Hall 2, B Block").
- [ ] Type: auditorium, seminar hall, classroom, lab, open-air space, or other.
- [ ] Building / block.
- [ ] **Capacity**: the safe seating (or standing) number, not an estimate. The system rejects a request whose expected attendance is above it.
- [ ] Which department manages it, or "central" if the admin office does.

**Shared equipment** (lent out per event, not fixed to one hall)
- [ ] Item name (projector, wireless mic, PA system, chairs, generator, banner stand, ...).
- [ ] Type: AV, furniture, power, decor, other.
- [ ] **How many can actually be lent out at the same time** (exclude broken units). Equipment permanently fixed in one hall is not part of this pool.

**People** (only those who will log in)
- [ ] SRN or employee ID, full name, official email.
- [ ] Role: Student, Club Coordinator, Faculty, HOD, Admin.
- [ ] Department (not needed for Admin).
- [ ] One **HOD per department**: the HOD approves department, club and guest-lecture requests.
- [ ] At least one **Admin**: the admin gives final approval.

**Clubs**
- [ ] Club name, department (or campus-wide), and the faculty advisor's email.
- [ ] Members, and **at least one coordinator per club** (the coordinator approves stage 1 of the club's requests).

Get consent before entering students' personal data, and keep the filled CSVs out of public places. The repository is not a safe place for real students' emails if it is public.

---

## 2. Fill in the CSV files

1. Open each file in `data/pes/` in Excel / Google Sheets / LibreOffice.
2. **Delete the `EXAMPLE` rows.**
3. Add one row per item. Keep the header row unchanged.
4. Fill them in this order, because later files refer to earlier ones by code or email: `departments` → `users` → `venues` → `resources` → `clubs` → `club_members`.
5. Save as **CSV UTF-8** with the same file name.

The column rules are in [data/pes/README.md](../data/pes/README.md). The most common mistakes:

| Column | Must be |
|---|---|
| `department_code` in users, venues, clubs | a code that exists in `departments.csv` (or already in the database) |
| `role` | one of `STUDENT`, `CLUB_COORDINATOR`, `FACULTY`, `HOD`, `ADMIN` |
| `venue_type` | `AUDITORIUM`, `SEMINAR_HALL`, `CLASSROOM`, `LAB`, `OPEN_AIR`, `OTHER` |
| `resource_type` | `AV`, `FURNITURE`, `POWER`, `DECOR`, `OTHER` |
| `capacity` | a whole number greater than 0 |
| `advisor_email` | the email of a FACULTY, HOD or ADMIN user |
| emails, university IDs, names | unique: each may appear only once |

---

## 3. Passwords

Every user row needs a `password_hash`: a bcrypt hash, never the plain password. To make one (run from the repository root, after `npm install` in `app/` once):

```sh
node scripts/hash-password.mjs "Temp#Pass2026"
```

It prints something like `$2b$10$lPhVHR1QJ00QX/...`. Paste that whole value into the user's `password_hash` cell. Run the command once per user, so each gets a different hash, and give each person their temporary password privately.

To change the password of a user who is **already loaded**, make a hash and then run the UPDATE through a *quoted* heredoc. The hash contains `$` signs, which bash and PowerShell would otherwise treat as variables and silently remove.

```sh
node scripts/hash-password.mjs "New#Pass2026"
psql -U postgres -d cerms <<'SQL'
UPDATE app_user SET password_hash = '<paste hash>' WHERE email = 'person@pes.edu';
SQL
```

In Windows PowerShell, put the SQL in single quotes (no `$` expansion) and double the inner quotes:

```powershell
psql -U postgres -d cerms -c 'UPDATE app_user SET password_hash = ''<paste hash>'' WHERE email = ''person@pes.edu'''
```

---

## 4. Load the data

Run everything from the **repository root**: the loader reads `data/pes/*.csv` relative to it. With PostgreSQL in WSL, open the WSL shell and `cd /mnt/d/projects/campus-event-resource-management` first. Add `-h localhost` if `psql` asks for a password. With Docker, use `psql -h localhost -U cerms -d cerms` (password `cerms`).

### 4a. Test load (optional): placeholder data + your rows

Use this first to check your files. It adds your rows on top of the placeholder data, which stays.

```sh
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -f db/sql/load_pes_data.sql
```

If anything is wrong, **nothing is loaded** and you get one list of every problem, with file and line number (line 1 is the header):

```text
ERROR:  PES data NOT loaded (nothing was changed). Fix these rows:
  users.csv line 3: unknown department_code "XYZ"
  users.csv line 3: unknown role "PROFESSOR" (use STUDENT, CLUB_COORDINATOR, FACULTY, HOD or ADMIN)
  venues.csv line 2: capacity "ninety" must be a whole number greater than 0
```

Fix the rows, then run it again. Rows that clash with existing placeholder data (e.g. your `CSE` department vs the placeholder `CSE`) are reported as "already exists". That is expected in a test load; use 4b for the real load.

To try the loader with the `EXAMPLE` rows still in the files, add `-v allow_examples=1`.

### 4b. Real load: replace the placeholder data

First reset the database (README, "Reset and initialize PostgreSQL"). Then:

```sh
psql -U postgres -d cerms -v ON_ERROR_STOP=1 -v replace=1 -f db/sql/load_pes_data.sql
```

`replace=1` first deletes all placeholder departments, users, clubs, venues, resources, **events and bookings**, then loads your files. The 5 role rows are never touched, and the database roles, permissions and functions stay. It still runs in one transaction: if your files have a problem, the placeholder data is kept and nothing changes.

Then clear the sample workflows in MongoDB, which belong to the deleted placeholder events. Keep the templates:

```sh
mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
mongosh "mongodb://localhost:27017/cerms" --eval "db.workflow_instances.deleteMany({}); db.workflow_audit.deleteMany({}); db.workflow_notifications.deleteMany({})"
```

### 4c. Check it

```sh
psql -U postgres -d cerms -c "SELECT d.code, count(u.*) AS users FROM department d LEFT JOIN app_user u USING (department_id) GROUP BY d.code ORDER BY 1"
psql -U postgres -d cerms -c "SELECT c.name, count(*) FILTER (WHERE cm.club_position = 'COORDINATOR') AS coordinators FROM club c LEFT JOIN club_member cm USING (club_id) GROUP BY c.name ORDER BY 1"
```

Every club should have at least 1 coordinator, and every department at least one HOD. Then start the app and log in as one of the new users with their temporary password.

---

## 5. Go back to the placeholder data

Reset the databases exactly as in the README (drop and recreate `cerms`, run all SQL files in order, then `load.js`). The CSV files are not used by the reset, so your filled-in files stay as they are.

---

## 6. What the loader does not load

| Data | How it is added |
|---|---|
| events and bookings | through the app (`/events/new`) once the real users exist |
| venue preferences, guest-lecture details | with each event request |
| workflow templates (approval chains) | `db/mongo/workflow_templates.json` + `load.js`; change them there if PES's real approval chain differs |

---

## 7. How the loader works (for the viva)

1. `\copy` reads each CSV into a **temporary staging table** (all text columns, plus the line number).
2. It tidies the values: trims spaces, turns empty cells into NULL, upper-cases codes and lower-cases emails.
3. It **checks everything first** (required fields, allowed values, numbers, codes and emails that must exist, duplicates in the file or in the database) and collects all problems in one table. Any problem raises one error listing them all.
4. It inserts in dependency order (`department` → `app_user` → `venue` → `resource` → `club` → `club_member`) with **code → id lookups** (`INSERT ... SELECT ... JOIN department ON code = ...`).
5. The normal table constraints and triggers still run on every row (e.g. a club advisor must be active faculty), and everything is one transaction, so a failure leaves the database unchanged.
