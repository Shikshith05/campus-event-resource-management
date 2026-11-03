-- Used by wd.bat: prints t when the cerms schema is current.
-- Keep in sync with app/app/api/health/route.ts.
SELECT
  to_regclass('public.workflow_approver_assignment') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('public.venue')
      AND attname = 'venue_type_confirmed'
      AND NOT attisdropped
  )
  AND to_regprocedure('public.workflow_context(integer)') IS NOT NULL
  AND to_regprocedure('public.approval_details(integer[])') IS NOT NULL
  AND to_regprocedure('public.record_workflow_decision(integer,integer,character varying)') IS NOT NULL;
