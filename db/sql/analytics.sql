-- =====================================================================
-- CERMS - PostgreSQL analytics views
--
-- Run after schema.sql and views.sql:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/analytics.sql
-- =====================================================================

DROP VIEW IF EXISTS
    event_statistics,
    resource_utilization
CASCADE;

CREATE VIEW event_statistics AS
SELECT
    e.category,
    e.event_type,
    e.department_id,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE e.status = 'APPROVED') AS approved_count,
    COUNT(*) FILTER (WHERE e.status = 'REJECTED') AS rejected_count,
    COUNT(*) FILTER (WHERE e.status = 'CANCELLED') AS cancelled_count,
    SUM(e.expected_footfall) AS expected_attendance
FROM event AS e
GROUP BY e.category, e.event_type, e.department_id;

CREATE VIEW resource_utilization AS
SELECT
    r.resource_id,
    r.name AS resource_name,
    r.resource_type,
    r.total_quantity,
    COUNT(DISTINCT br.booking_id) FILTER (
        WHERE b.status IN ('CONFIRMED', 'COMPLETED')
    ) AS booking_count,
    COALESCE(SUM(br.quantity) FILTER (
        WHERE b.status IN ('CONFIRMED', 'COMPLETED')
    ), 0) AS total_units_requested
FROM resource AS r
LEFT JOIN booking_resource AS br ON br.resource_id = r.resource_id
LEFT JOIN booking AS b ON b.booking_id = br.booking_id
GROUP BY r.resource_id, r.name, r.resource_type, r.total_quantity;
