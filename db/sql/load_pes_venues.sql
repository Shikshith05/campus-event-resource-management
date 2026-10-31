-- Targeted, repeatable load for public PES RR venue information.
-- Run from the repository root after the venue columns have been migrated:
--   psql -v ON_ERROR_STOP=1 -d cerms -f db/sql/load_pes_venues.sql
-- This script never truncates or deletes application data.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE pes_venue_stage (
    name                  VARCHAR(100) NOT NULL,
    venue_type            VARCHAR(20) NOT NULL,
    building              VARCHAR(100) NOT NULL,
    min_capacity          INT NOT NULL,
    max_capacity          INT NOT NULL,
    venue_type_confirmed  BOOLEAN NOT NULL
) ON COMMIT DROP;

\copy pes_venue_stage (name, venue_type, building, min_capacity, max_capacity, venue_type_confirmed) FROM 'data/pes/venues.csv' WITH (FORMAT csv, HEADER true)

INSERT INTO venue (
    name, venue_type, building, capacity, min_capacity, max_capacity,
    venue_type_confirmed
)
SELECT name, venue_type, building, NULL, min_capacity, max_capacity,
       venue_type_confirmed
FROM pes_venue_stage
ON CONFLICT (name) DO UPDATE SET
    venue_type = CASE
        WHEN venue.venue_type_confirmed AND NOT EXCLUDED.venue_type_confirmed
            THEN venue.venue_type
        ELSE EXCLUDED.venue_type
    END,
    building = EXCLUDED.building,
    -- Keep any exact capacity already verified in the database. Newly
    -- added venues remain unbookable until an exact capacity is confirmed.
    capacity = COALESCE(venue.capacity, EXCLUDED.capacity),
    min_capacity = EXCLUDED.min_capacity,
    max_capacity = EXCLUDED.max_capacity,
    venue_type_confirmed = venue.venue_type_confirmed OR EXCLUDED.venue_type_confirmed;

COMMIT;
