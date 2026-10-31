-- =====================================================================
-- CERMS - SQL query catalogue
--
-- Run AFTER seed.sql (read-only, changes nothing):
--   psql -d cerms -f db/sql/queries.sql
--
-- Sections:
--   A. Joins                    E. Recursive CTEs
--   B. Nested subqueries        F. Aggregates (GROUP BY / HAVING)
--   C. Correlated subqueries    G. Window function
--   D. Non-recursive CTEs
--
-- Date-based queries use a fixed demo window (10-23 Nov 2026) instead of
-- CURRENT_DATE, so they show the same rows on any day. In the app the
-- dates come from the user's request.
-- =====================================================================


-- =====================================================================
-- A. JOINS
-- =====================================================================

-- A1. INNER JOIN (2 tables)
-- Question: Which venue is each booking for, and when?
-- Only bookings that have a matching venue appear (all of them do).
SELECT b.booking_id, v.name AS venue, b.start_time, b.end_time, b.status
FROM booking AS b
INNER JOIN venue AS v ON v.venue_id = b.venue_id
ORDER BY b.start_time;

-- A2. LEFT JOIN
-- Question: How many active bookings does every venue have, including
-- venues that have never been booked (they show 0)?
SELECT v.name AS venue, v.capacity, COUNT(b.booking_id) AS active_bookings
FROM venue AS v
LEFT JOIN booking AS b
       ON b.venue_id = v.venue_id
      AND b.status IN ('PENDING', 'CONFIRMED')
GROUP BY v.venue_id, v.name, v.capacity
ORDER BY active_bookings DESC, v.name;

-- A3. SELF-JOIN (booking joined to booking)
-- Question: Which pairs of bookings ask for the same venue at overlapping
-- times? These are the clashes the priority engine has to resolve.
SELECT b1.booking_id AS booking_a, b2.booking_id AS booking_b,
       v.name AS venue, b1.status AS status_a, b2.status AS status_b
FROM booking AS b1
JOIN booking AS b2
  ON b2.venue_id = b1.venue_id
 AND b2.booking_id > b1.booking_id          -- each pair once
 AND b1.start_time < b2.end_time            -- time ranges overlap
 AND b2.start_time < b1.end_time
JOIN venue AS v ON v.venue_id = b1.venue_id;

-- A4. MULTI-TABLE JOIN (6 tables)
-- Question: Show every event request with its organizer, the organizer's
-- role, the department, and the booked venue and time.
SELECT e.title, u.full_name AS organizer, r.role_name, d.code AS department,
       v.name AS venue, b.start_time, b.status AS booking_status
FROM event AS e
JOIN app_user AS u        ON u.user_id = e.organizer_id
JOIN role AS r            ON r.role_id = u.role_id
LEFT JOIN department AS d ON d.department_id = e.department_id
JOIN booking AS b         ON b.event_id = e.event_id
JOIN venue AS v           ON v.venue_id = b.venue_id
ORDER BY b.start_time;

-- A5. JOIN the same table twice (booking_conflict_log -> booking -> event)
-- Question: For every priority decision, which event won and which lost?
SELECT c.conflict_id,
       we.title AS winning_event, c.winner_score,
       le.title AS losing_event,  c.loser_score,
       c.decided_at
FROM booking_conflict_log AS c
JOIN booking AS wb ON wb.booking_id = c.winning_booking_id
JOIN event   AS we ON we.event_id   = wb.event_id
JOIN booking AS lb ON lb.booking_id = c.losing_booking_id
JOIN event   AS le ON le.event_id   = lb.event_id;


-- =====================================================================
-- B. NESTED SUBQUERIES (the inner query runs once, on its own)
-- =====================================================================

-- B1. IN
-- Question: Which users have organized at least one event that holds a
-- CONFIRMED booking?
SELECT user_id, full_name
FROM app_user
WHERE user_id IN (
    SELECT e.organizer_id
    FROM event AS e
    JOIN booking AS b ON b.event_id = e.event_id
    WHERE b.status = 'CONFIRMED'
);

-- B2. NOT EXISTS
-- Question: Which venues have never been booked at all?
-- (Useful for the campus survey: are these venues really needed?)
SELECT v.venue_id, v.name
FROM venue AS v
WHERE NOT EXISTS (
    SELECT 1 FROM booking AS b WHERE b.venue_id = v.venue_id
);

-- B3. Scalar subquery in SELECT
-- Question: How does each venue's capacity compare with the average
-- capacity of all venues?
SELECT name,
       capacity,
       (SELECT ROUND(AVG(capacity), 1) FROM venue)            AS avg_capacity,
       capacity - (SELECT ROUND(AVG(capacity), 1) FROM venue) AS difference
FROM venue
ORDER BY capacity DESC;

-- B4. Subquery in WHERE with a comparison
-- Question: Which events expect more people than the average event?
SELECT title, expected_footfall
FROM event
WHERE expected_footfall > (SELECT AVG(expected_footfall) FROM event)
ORDER BY expected_footfall DESC;


-- =====================================================================
-- C. CORRELATED SUBQUERIES (the inner query re-runs for each outer row)
-- =====================================================================

-- C1. Users with more penalties (cancellations + no-shows) than the
--     average for their own role.
-- Question: Who is less reliable than others with the same role?
-- The inner query is correlated through u.role_id.
SELECT h.full_name, r.role_name, h.total_penalties
FROM requester_booking_history AS h
JOIN app_user AS u ON u.user_id = h.user_id
JOIN role AS r     ON r.role_id = u.role_id
WHERE h.total_penalties > (
    SELECT AVG(h2.total_penalties)
    FROM requester_booking_history AS h2
    JOIN app_user AS u2 ON u2.user_id = h2.user_id
    WHERE u2.role_id = u.role_id               -- same role as the outer row
);

-- C2. Venues whose largest booked event is bigger than the average
--     booked event across the campus.
-- Question: Which venues host above-average crowds at their peak?
SELECT v.name,
       (SELECT MAX(e.expected_footfall)
        FROM booking AS b JOIN event AS e ON e.event_id = b.event_id
        WHERE b.venue_id = v.venue_id) AS largest_footfall
FROM venue AS v
WHERE (SELECT MAX(e.expected_footfall)
       FROM booking AS b JOIN event AS e ON e.event_id = b.event_id
       WHERE b.venue_id = v.venue_id)                    -- correlated on v
    > (SELECT AVG(e.expected_footfall)
       FROM booking AS b JOIN event AS e ON e.event_id = b.event_id);

-- C3. Latest booking per venue.
-- Question: What is the most recent (latest-starting) booking in each venue?
SELECT v.name AS venue, b.booking_id, b.start_time, b.status
FROM booking AS b
JOIN venue AS v ON v.venue_id = b.venue_id
WHERE b.start_time = (
    SELECT MAX(b2.start_time)
    FROM booking AS b2
    WHERE b2.venue_id = b.venue_id               -- same venue as the outer row
)
ORDER BY v.name;

-- C4. Correlated EXISTS
-- Question: Which clubs have held at least one event that actually used a
-- venue (booking CONFIRMED or COMPLETED)?
SELECT c.name
FROM club AS c
WHERE EXISTS (
    SELECT 1
    FROM event AS e
    JOIN booking AS b ON b.event_id = e.event_id
    WHERE e.club_id = c.club_id
      AND b.status IN ('CONFIRMED', 'COMPLETED')
);


-- =====================================================================
-- D. NON-RECURSIVE CTEs (WITH ...)
-- =====================================================================

-- D1. Alternate venue suggestion (from the abstract).
-- Question: For a request of 100 people on 12 Nov, 10:00-12:00, which
-- active venues are big enough and have no CONFIRMED booking at that
-- time? Closest capacity first, so big halls are not wasted.
WITH request AS (
    SELECT TIMESTAMPTZ '2026-11-12 10:00+05:30' AS start_time,
           TIMESTAMPTZ '2026-11-12 12:00+05:30' AS end_time,
           100                                  AS footfall
),
busy_venues AS (
    SELECT DISTINCT b.venue_id
    FROM booking AS b, request AS q
    WHERE b.status = 'CONFIRMED'
      AND b.start_time < q.end_time
      AND q.start_time < b.end_time
)
SELECT v.venue_id, v.name, v.capacity, v.capacity - q.footfall AS spare_seats
FROM venue AS v, request AS q
WHERE v.is_active
  AND v.capacity IS NOT NULL
  AND v.capacity >= q.footfall
  AND v.venue_id NOT IN (SELECT venue_id FROM busy_venues)
ORDER BY spare_seats, v.name;

-- D2. Priority score breakdown for every PENDING booking.
-- Question: Why would a pending request win or lose a clash? Shows each
-- factor separately and checks it against calculate_booking_priority().
WITH pending AS (
    SELECT b.booking_id, b.start_time, b.requested_at, e.title, e.category,
           e.organizer_id, r.hierarchy_level
    FROM booking AS b
    JOIN event AS e    ON e.event_id = b.event_id
    JOIN app_user AS u ON u.user_id  = e.organizer_id
    JOIN role AS r     ON r.role_id  = u.role_id
    WHERE b.status = 'PENDING'
),
penalties AS (
    SELECT p.booking_id, COUNT(pb.booking_id) AS penalty_count
    FROM pending AS p
    LEFT JOIN event AS pe   ON pe.organizer_id = p.organizer_id
    LEFT JOIN booking AS pb ON pb.event_id = pe.event_id
                           AND pb.status IN ('CANCELLED', 'NO_SHOW')
                           AND pb.end_time >= p.requested_at - INTERVAL '180 days'
    GROUP BY p.booking_id
)
SELECT p.booking_id, p.title,
       CASE p.category WHEN 'ACADEMIC' THEN 40 WHEN 'DEPARTMENT' THEN 30
                       WHEN 'CLUB' THEN 20 ELSE 10 END              AS category_points,
       p.hierarchy_level * 5                                         AS role_points,
       ROUND(LEAST(15, EXTRACT(EPOCH FROM (p.start_time - p.requested_at)) / 86400 * 0.5), 2)
                                                                     AS lead_time_points,
       -5 * pen.penalty_count                                        AS penalty_points,
       calculate_booking_priority(p.booking_id)                      AS total_score
FROM pending AS p
JOIN penalties AS pen ON pen.booking_id = p.booking_id
ORDER BY total_score DESC;


-- =====================================================================
-- E. RECURSIVE CTEs (WITH RECURSIVE ...)
-- =====================================================================

-- E1. Day-by-day availability calendar: 14 days x every venue.
-- Question: For each of the 14 days from 10 Nov, is each venue FREE,
-- PENDING (requested but not confirmed) or BOOKED?
-- The recursive part generates one row per day: start at day 1, keep
-- adding one day until 14 days exist.
WITH RECURSIVE days (day, n) AS (
    SELECT DATE '2026-11-10', 1                 -- anchor: first day
    UNION ALL
    SELECT day + 1, n + 1                       -- recursive step: next day
    FROM days
    WHERE n < 14                                -- stop after 14 days
)
SELECT d.day,
       v.name AS venue,
       CASE
           WHEN bool_or(b.status = 'CONFIRMED') THEN 'BOOKED'
           WHEN bool_or(b.status = 'PENDING')   THEN 'PENDING'
           ELSE 'FREE'
       END AS availability
FROM days AS d
CROSS JOIN venue AS v
LEFT JOIN booking AS b
       ON b.venue_id = v.venue_id
      AND b.status IN ('PENDING', 'CONFIRMED')
      AND (b.start_time AT TIME ZONE 'Asia/Kolkata')::date = d.day
GROUP BY d.day, v.venue_id, v.name
ORDER BY d.day, v.name;

-- E2. Walk the role hierarchy from STUDENT up to ADMIN.
-- Question: What is the chain of authority, and how many steps is each
-- role above a student? Each recursive step moves one level up.
WITH RECURSIVE chain AS (
    SELECT role_id, role_name, hierarchy_level, 0 AS steps_above_student,
           role_name::TEXT AS path
    FROM role
    WHERE role_name = 'STUDENT'                 -- anchor: bottom of the hierarchy
    UNION ALL
    SELECT r.role_id, r.role_name, r.hierarchy_level, c.steps_above_student + 1,
           c.path || ' -> ' || r.role_name
    FROM chain AS c
    JOIN role AS r ON r.hierarchy_level = c.hierarchy_level + 1   -- one level up
)
SELECT role_name, hierarchy_level, steps_above_student, path
FROM chain
ORDER BY hierarchy_level;


-- =====================================================================
-- F. AGGREGATES WITH GROUP BY / HAVING
-- =====================================================================

-- F1. Question: Which venues have been requested at least twice (any
-- status)? HAVING filters groups after they are counted.
SELECT v.name AS venue, COUNT(*) AS total_requests,
       COUNT(*) FILTER (WHERE b.status = 'REJECTED') AS rejected_requests
FROM booking AS b
JOIN venue AS v ON v.venue_id = b.venue_id
GROUP BY v.venue_id, v.name
HAVING COUNT(*) >= 2
ORDER BY total_requests DESC;

-- F2. Question: Per event category, how many events and how many people
-- are expected in total, for categories expecting more than 50 people?
SELECT category, COUNT(*) AS events, SUM(expected_footfall) AS total_footfall,
       ROUND(AVG(expected_footfall), 1) AS avg_footfall
FROM event
GROUP BY category
HAVING SUM(expected_footfall) > 50
ORDER BY total_footfall DESC;


-- =====================================================================
-- G. WINDOW FUNCTION
-- =====================================================================

-- G1. Question: Rank venues by hours actually used (CONFIRMED or
-- COMPLETED bookings). RANK() gives equal hours the same rank; unused
-- venues rank last with 0 hours.
SELECT v.name AS venue,
       COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 3600), 1), 0)
           AS confirmed_hours,
       RANK() OVER (
           ORDER BY COALESCE(SUM(EXTRACT(EPOCH FROM (b.end_time - b.start_time))), 0) DESC
       ) AS usage_rank
FROM venue AS v
LEFT JOIN booking AS b
       ON b.venue_id = v.venue_id
      AND b.status IN ('CONFIRMED', 'COMPLETED')
GROUP BY v.venue_id, v.name
ORDER BY usage_rank, v.name;
