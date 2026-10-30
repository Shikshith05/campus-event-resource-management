# PES University data templates

Fill these six CSV files with the real campus data, then load them with
`db/sql/load_pes_data.sql`. Full instructions: [docs/real-data-guide.md](../../docs/real-data-guide.md).

- Keep the **header row** exactly as it is (first line of each file). Do not add or reorder columns.
- Save as **CSV UTF-8** (in Excel: *File > Save As > CSV UTF-8 (Comma delimited)*). Excel adds quotes around values that contain commas.
- The rows starting with `EXAMPLE` are samples. **Delete them** before loading real data; the loader refuses them unless you run a test load with `-v allow_examples=1`.
- Comments are not allowed inside the CSV files (psql's CSV reader and Excel would treat them as data), so the column rules are here.

| File | Columns (header row) | Rules |
|---|---|---|
| `departments.csv` | `code,name` | `code`: short unique code, max 10 characters, e.g. `CSE` (stored upper case). `name`: unique full name. |
| `users.csv` | `university_id,full_name,email,role,department_code,password_hash` | `university_id`: SRN or employee ID, unique. `email`: unique (stored lower case). `role`: `STUDENT`, `CLUB_COORDINATOR`, `FACULTY`, `HOD` or `ADMIN`. `department_code`: a code from `departments.csv` (or already in the database); may be blank only for `ADMIN`. `password_hash`: bcrypt hash from `node scripts/hash-password.mjs "password"`. |
| `venues.csv` | `name,venue_type,building,capacity,managing_department_code` | `name`: unique. `venue_type`: `AUDITORIUM`, `SEMINAR_HALL`, `CLASSROOM`, `LAB`, `OPEN_AIR` or `OTHER`. `building`: optional. `capacity`: whole number > 0 (seats / safe standing capacity). `managing_department_code`: blank = managed centrally by the admin office. |
| `resources.csv` | `name,resource_type,total_quantity` | `name`: unique. `resource_type`: `AV`, `FURNITURE`, `POWER`, `DECOR` or `OTHER`. `total_quantity`: whole number, 0 or more (units that can actually be lent out). |
| `clubs.csv` | `name,department_code,advisor_email` | `name`: unique. `department_code`: blank = campus-wide club. `advisor_email`: a `FACULTY`, `HOD` or `ADMIN` user from `users.csv` (or already in the database). |
| `club_members.csv` | `club_name,member_email,club_position` | `club_name`: a club from `clubs.csv`. `member_email`: a user from `users.csv`. `club_position`: `MEMBER` (default if blank) or `COORDINATOR`. Every club needs at least one `COORDINATOR`, who approves stage 1 of club event requests. |
