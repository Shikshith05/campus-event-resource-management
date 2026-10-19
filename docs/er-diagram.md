# CERMS: ER Diagram

This diagram covers the PostgreSQL side of CERMS: 13 tables, matching [db/sql/schema.sql](../db/sql/schema.sql).
The approval workflow lives in MongoDB and is described at the end of this page.

For a nicer image, paste [schema.dbml](schema.dbml) into <https://dbdiagram.io>.

## How to read it

| Symbol | Meaning |
|---|---|
| `PK` | primary key |
| `FK` | foreign key |
| `UK` | unique (candidate key) |
| `\|\|--o{` | exactly one ... zero or more |
| `\|o--o{` | zero or one ... zero or more (the FK column is nullable) |

```mermaid
erDiagram
    DEPARTMENT {
        int department_id PK
        varchar code UK "e.g. CSE"
        varchar name UK
    }

    ROLE {
        int role_id PK
        varchar role_name UK "STUDENT, CLUB_COORDINATOR, FACULTY, HOD, ADMIN"
        smallint hierarchy_level "higher = more authority"
        varchar description
    }

    APP_USER {
        int user_id PK
        varchar university_id UK "SRN or employee ID"
        varchar full_name
        varchar email UK "stored lowercase"
        text password_hash
        int role_id FK
        int department_id FK "nullable"
        boolean is_active
        timestamptz created_at
    }

    CLUB {
        int club_id PK
        varchar name UK
        text description
        int department_id FK "nullable = campus-wide"
        int faculty_advisor_id FK
        boolean is_active
    }

    CLUB_MEMBER {
        int club_id PK, FK
        int user_id PK, FK
        varchar club_position "MEMBER or COORDINATOR"
        date joined_on
    }

    VENUE {
        int venue_id PK
        varchar name UK
        varchar venue_type "AUDITORIUM, SEMINAR_HALL, ..."
        varchar building
        int capacity "greater than 0"
        int department_id FK "nullable = central"
        boolean is_active
    }

    RESOURCE {
        int resource_id PK
        varchar name UK
        varchar resource_type "AV, FURNITURE, POWER, ..."
        int total_quantity "0 or more"
        boolean is_active
    }

    EVENT {
        int event_id PK
        varchar title
        text description
        varchar category "ACADEMIC, DEPARTMENT, CLUB, PERSONAL"
        varchar event_type "GUEST_LECTURE, WORKSHOP, ..."
        int organizer_id FK "the requester"
        int department_id FK "required unless PERSONAL"
        int club_id FK "required only if CLUB"
        int expected_footfall "greater than 0"
        varchar status "DRAFT ... APPROVED, REJECTED"
        timestamptz created_at
    }

    EVENT_VENUE_PREFERENCE {
        int event_id PK, FK
        int venue_id PK, FK
        smallint preference_order
    }

    GUEST_LECTURE_DETAILS {
        int event_id PK, FK
        varchar guest_name
        varchar guest_affiliation
        varchar talk_topic
    }

    BOOKING {
        int booking_id PK
        int event_id FK
        int venue_id FK
        timestamptz start_time
        timestamptz end_time "after start_time"
        varchar status "PENDING, CONFIRMED, ..."
        timestamptz requested_at "before start_time"
    }

    BOOKING_RESOURCE {
        int booking_id PK, FK
        int resource_id PK, FK
        int quantity "greater than 0"
    }

    BOOKING_CONFLICT_LOG {
        int conflict_id PK
        int winning_booking_id FK
        int losing_booking_id FK
        numeric winner_score
        numeric loser_score
        text reason
        int decided_by FK "nullable = automatic"
        timestamptz decided_at
    }

    ROLE             ||--o{ APP_USER             : "is assigned to"
    DEPARTMENT       |o--o{ APP_USER             : "has"
    DEPARTMENT       |o--o{ CLUB                 : "hosts"
    APP_USER         ||--o{ CLUB                 : "advises"
    CLUB             ||--o{ CLUB_MEMBER          : "has"
    APP_USER         ||--o{ CLUB_MEMBER          : "joins"
    DEPARTMENT       |o--o{ VENUE                : "manages"
    APP_USER         ||--o{ EVENT                : "organizes"
    DEPARTMENT       |o--o{ EVENT                : "runs"
    CLUB             |o--o{ EVENT                : "holds"
    EVENT            ||--o{ EVENT_VENUE_PREFERENCE : "prefers"
    VENUE            ||--o{ EVENT_VENUE_PREFERENCE : "is preferred"
    EVENT            ||--o| GUEST_LECTURE_DETAILS : "has details"
    EVENT            ||--o{ BOOKING              : "requests"
    VENUE            ||--o{ BOOKING              : "is booked in"
    BOOKING          ||--o{ BOOKING_RESOURCE     : "needs"
    RESOURCE         ||--o{ BOOKING_RESOURCE     : "is used in"
    BOOKING          ||--o{ BOOKING_CONFLICT_LOG : "wins"
    BOOKING          ||--o{ BOOKING_CONFLICT_LOG : "loses"
    APP_USER         |o--o{ BOOKING_CONFLICT_LOG : "overrides"
```

## Relationships in words

| Relationship | Cardinality | Notes |
|---|---|---|
| Role to User | 1 : N | every user has exactly one role |
| Department to User | 1 : N, optional | central admin staff have no department |
| Department to Club | 1 : N, optional | NULL department = campus-wide club |
| User (faculty) to Club | 1 : N | each club has exactly one faculty advisor |
| User to Club | **M : N** | resolved by the bridge table `CLUB_MEMBER` |
| Department to Venue | 1 : N, optional | which department manages the venue |
| User to Event | 1 : N | the organizer (requester) of the event |
| Department / Club to Event | 1 : N, optional | rules depend on category (see below) |
| Event to Booking | 1 : N | one event can book several slots or venues |
| Venue to Booking | 1 : N | |
| Booking to Resource | **M : N** | resolved by the bridge table `BOOKING_RESOURCE`, which also holds the quantity |
| Booking to Conflict Log | 1 : N, twice | a booking can appear as the winner or the loser of a decision |
| User (admin) to Conflict Log | 1 : N, optional | set only when an admin overrides the automatic decision |

Rules that the diagram cannot show (they are CHECK constraints in the DDL):

- A `CLUB` event must have a `club_id`; other categories must not.
- Every event except `PERSONAL` must have a `department_id`.
- Venue preferences are ranked uniquely per event; the booking stores the assigned venue.
- Guest lecture events may have a separate details row for visitor and talk information.
- Two `CONFIRMED` bookings of the same venue cannot overlap in time (exclusion constraint).

## MongoDB side (not in the ER diagram)

| Collection | One document is ... | Link to PostgreSQL |
|---|---|---|
| `workflow_templates` | an approval chain (ordered list of stages) for an event category, type or department | stages name roles from the `role` table |
| `workflow_instances` | the live approval of one event, with the status of each stage | `event_id` refers to `event.event_id`; user IDs refer to `app_user.user_id` |

These links are logical, not enforced: MongoDB cannot hold a foreign key into PostgreSQL. The application checks them.
Sample documents: [db/mongo/](../db/mongo/).
