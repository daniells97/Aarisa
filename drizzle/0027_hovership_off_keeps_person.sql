ALTER TABLE "core"."route_executions" DROP CONSTRAINT "route_executions_status_payee";--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_status_payee" CHECK (("core"."route_executions"."execution_status" in ('confirmed', 'changed') and "core"."route_executions"."payee_id" is not null) or ("core"."route_executions"."execution_status"::text in ('no_driver', 'off') and "core"."route_executions"."payee_id" is null) or ("core"."route_executions"."execution_status"::text = 'off' and "core"."route_executions"."route_id" is null) or "core"."route_executions"."execution_status" in ('proposed', 'waiting'));--> statement-breakpoint
-- Hovership days marked "didn't work" before this change were saved as confirmed with no routes and no report work:
-- they become the "off" status (the person stays on the day, not paid by the report).
UPDATE "core"."route_executions" e SET "execution_status" = 'off', "confirmed_by_user_id" = NULL, "confirmed_at" = NULL
FROM "core"."operations" o
WHERE o."operation_id" = e."operation_id" AND o."driver_source" = 'report_code' AND e."route_id" IS NULL AND e."execution_kind" = 'route'
  AND e."payee_id" IS NOT NULL AND e."execution_status" IN ('confirmed', 'changed') AND e."report_import_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "core"."execution_sort_codes" s WHERE s."route_execution_id" = e."route_execution_id")
  AND NOT EXISTS (SELECT 1 FROM "core"."work_records" w WHERE w."route_execution_id" = e."route_execution_id");
