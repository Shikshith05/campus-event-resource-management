# Screenshots

Taken with Playwright (Chromium) against `npm run dev` on the seed data, during the end-to-end test of 30 Oct 2026: desktop at 1280 px wide, phone at 390 px. The `-1280` / `-390` suffix is the browser width.

| File | Page | Logged in as | Shows |
|---|---|---|---|
| `01-login-*` | `/login` | none | sign-in page |
| `02-dashboard-*` | `/dashboard` | Admin One | role-specific shortcuts |
| `03-new-request-*` | `/events/new` | Student Two | empty request form (no Guest Lecture option for students) |
| `04-events-*` | `/events` | Student Two | own requests with the approved timeline open |
| `05-analytics-after-run-1280` | `/analytics` | Admin One | counts after the test's approvals and the rejection |
| `06-request-form-guest-lecture-*` | `/events/new` | Faculty One | Guest Lecture selected: guest fields shown, category fixed to ACADEMIC |
| `07-request-form-venue-clash-1280` | `/events/new` | Student Two | venue clash with alternate-venue buttons |
| `08-event-timeline-in-progress-1280` | `/events` | Student Two | timeline after 2 of 4 approvals |
| `09-event-timeline-approved-*` | `/events` | Student Two | all 4 stages approved |
| `10-guest-lecture-timeline-1280` | `/events` | Faculty One | guest-lecture card and timeline with the guest details |
| `11-admin-venue-retired-1280` | `/admin` | Admin One | a venue created, edited and retired |
| `12-availability-*` | `/availability` | Student Two | venue calendar |
| `13-approvals-*` | `/approvals` | HOD One | approver inbox with priority scores |
| `14-analytics-*` | `/analytics` | Admin One | analytics dashboard |
| `15-admin-*` | `/admin` | Admin One | inventory management |
| `16-home-*` | `/` | Student Two | home page |
