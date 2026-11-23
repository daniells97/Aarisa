-- Which platforms each person works on (T-Force, Hovership or both), from what they already did:
-- a Hovership code or Hovership days → Hovership; a usual T-Force driver code or T-Force days → T-Force.
ALTER TABLE "core"."drivers" ADD COLUMN "works_tforce" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."drivers" ADD COLUMN "works_hovership" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "core"."drivers" d SET "works_hovership" = EXISTS (
  SELECT 1 FROM "core"."driver_client_codes" c JOIN "core"."operations" o ON o."operation_id" = c."operation_id" WHERE c."driver_id" = d."driver_id" AND o."driver_source" = 'report_code'
) OR EXISTS (
  SELECT 1 FROM "core"."route_executions" e JOIN "core"."operations" o ON o."operation_id" = e."operation_id" WHERE e."driver_id" = d."driver_id" AND o."driver_source" = 'report_code'
);--> statement-breakpoint
UPDATE "core"."drivers" d SET "works_tforce" = EXISTS (
  SELECT 1 FROM "core"."routes" r WHERE r."usual_driver_id" = d."driver_id"
) OR EXISTS (
  SELECT 1 FROM "core"."route_executions" e JOIN "core"."operations" o ON o."operation_id" = e."operation_id" WHERE e."driver_id" = d."driver_id" AND o."driver_source" = 'daily_list'
) OR NOT d."works_hovership";
