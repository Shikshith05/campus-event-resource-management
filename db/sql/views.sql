-- =====================================================================
-- CERMS - reporting and availability views
--
-- Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/views.sql
--
-- These views expose derived information without storing duplicate
-- counters or availability flags. Slot-specific availability is queried
-- by filtering venue_booking_schedule and resource_booking_usage.
-- =====================================================================

DROP VIEW IF EXISTS
    venue_utilization,
    requester_booking_history,
    resource_booking_usage,
    venue_booking_schedule,
    event_request_summary
CASCADE;


-- One row per event and booking, suitable for request and calendar screens.
CREATE VIEW event_request_summary AS
SELECT
    e.event_id,
    e.title,
    e.category,
    e.event_type,
    e.status AS event_status,
    e.expected_footfall,
    e.created_at,
    e.organizer_id,
    organizer.full_name AS organizer_name,
    organizer.department_id AS organizer_department_id,
    e.department_id,
    d.code AS department_code,
    e.club_id,
    c.name AS club_name,
    guest.guest_name,
    guest.guest_affiliation,
    guest.talk_topic,
    preferences.preferred_venues,
    b.booking_id,
    b.venue_id,
    v.name AS venue_name,
    v.building,
    v.capacity AS venue_capacity,
    b.start_time,
    b.end_time,
    b.status AS booking_status,
    b.requested_at
FROM event AS e
JOIN app_user AS organizer ON organizer.user_id = e.organizer_id
LEFT JOIN department AS d ON d.department_id = e.department_id
LEFT JOIN club AS c ON c.club_id = e.club_id
LEFT JOIN guest_lecture_details AS guest ON guest.event_id = e.event_id
LEFT JOIN booking AS b ON b.event_id = e.event_id
LEFT JOIN venue AS v ON v.venue_id = b.venue_id
LEFT JOIN LATERAL (
    SELECT array_agg(
        jsonb_build_object(
            'venue_id', preference.venue_id,
            'venue_name', preferred_venue.name,
            'preference_order', preference.preference_order
        )
        ORDER BY preference.preference_order
    ) AS preferred_venues
    FROM event_venue_preference AS preference
    JOIN venue AS preferred_venue
        ON preferred_venue.venue_id = preference.venue_id
    WHERE preference.event_id = e.event_id
) AS preferences ON TRUE;


-- Confirmed and pending venue requests. Filter this view by a requested
-- time range to find conflicts or to render a calendar.
CREATE VIEW venue_booking_schedule AS
SELECT
    b.booking_id,
    b.event_id,
    e.title AS event_title,
    e.category AS event_category,
    e.expected_footfall,
    b.venue_id,
    v.name AS venue_name,
    v.building,
    v.capacity AS venue_capacity,
    v.venue_type,
    b.start_time,
    b.end_time,
    b.status AS booking_status,
    b.requested_at,
    e.organizer_id,
    organizer.full_name AS organizer_name
FROM booking AS b
JOIN event AS e ON e.event_id = b.event_id
JOIN venue AS v ON v.venue_id = b.venue_id
JOIN app_user AS organizer ON organizer.user_id = e.organizer_id
WHERE b.status IN ('PENDING', 'CONFIRMED');


-- Resource demand by booking. Confirmed usage is available separately so
-- callers can calculate remaining quantity for an arbitrary time range.
CREATE VIEW resource_booking_usage AS
SELECT
    br.booking_id,
    b.event_id,
    b.venue_id,
    b.start_time,
    b.end_time,
    b.status AS booking_status,
    br.resource_id,
    r.name AS resource_name,
    r.resource_type,
    r.total_quantity,
    br.quantity
FROM booking_resource AS br
JOIN booking AS b ON b.booking_id = br.booking_id
JOIN resource AS r ON r.resource_id = br.resource_id
WHERE b.status IN ('PENDING', 'CONFIRMED');


-- Historical behavior used by the priority engine and requester dashboard.
CREATE VIEW requester_booking_history AS
SELECT
    u.user_id,
    u.university_id,
    u.full_name,
    COUNT(b.booking_id) FILTER (WHERE b.status = 'COMPLETED') AS completed_bookings,
    COUNT(b.booking_id) FILTER (WHERE b.status = 'CANCELLED') AS cancelled_bookings,
    COUNT(b.booking_id) FILTER (WHERE b.status = 'NO_SHOW') AS no_show_bookings,
    COUNT(b.booking_id) FILTER (
        WHERE b.status IN ('CANCELLED', 'NO_SHOW')
    ) AS total_penalties,
    COUNT(b.booking_id) AS total_bookings
FROM app_user AS u
LEFT JOIN event AS e ON e.organizer_id = u.user_id
LEFT JOIN booking AS b ON b.event_id = e.event_id
GROUP BY u.user_id, u.university_id, u.full_name;


-- Monthly confirmed venue usage for administration analytics.
CREATE VIEW venue_utilization AS
SELECT
    v.venue_id,
    v.name AS venue_name,
    v.building,
    v.capacity,
    date_trunc('month', b.start_time)::date AS month,
    COUNT(*) AS confirmed_booking_count,
    SUM(EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 3600.0)
        AS confirmed_hours
FROM venue AS v
JOIN booking AS b ON b.venue_id = v.venue_id
WHERE b.status IN ('CONFIRMED', 'COMPLETED')
GROUP BY
    v.venue_id,
    v.name,
    v.building,
    v.capacity,
    date_trunc('month', b.start_time)::date;
