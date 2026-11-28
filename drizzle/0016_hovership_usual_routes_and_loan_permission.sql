-- A Hovership person's usual routes (suggested daily, like a T-Force driver code's) and a per-user switch to record loans.
CREATE TABLE "core"."driver_usual_sort_codes" (
	"driver_id" uuid NOT NULL,
	"sort_code_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_usual_sort_codes_driver_id_sort_code_id_pk" PRIMARY KEY("driver_id","sort_code_id")
);
--> statement-breakpoint
ALTER TABLE "core"."users" ADD COLUMN "can_record_loans" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."driver_usual_sort_codes" ADD CONSTRAINT "driver_usual_sort_codes_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."driver_usual_sort_codes" ADD CONSTRAINT "driver_usual_sort_codes_sort_code_id_sort_codes_sort_code_id_fk" FOREIGN KEY ("sort_code_id") REFERENCES "core"."sort_codes"("sort_code_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."driver_usual_sort_codes" ADD CONSTRAINT "driver_usual_sort_codes_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Start each person's usual routes from the last Hovership day that already has routes.
INSERT INTO "core"."driver_usual_sort_codes" ("driver_id", "sort_code_id")
SELECT DISTINCT e."driver_id", s."sort_code_id"
FROM "core"."route_executions" e
JOIN "core"."execution_sort_codes" s ON s."route_execution_id" = e."route_execution_id"
WHERE e."route_id" IS NULL AND e."execution_kind" = 'route' AND e."driver_id" IS NOT NULL
  AND e."work_date" = (SELECT max(e2."work_date") FROM "core"."route_executions" e2
    JOIN "core"."execution_sort_codes" s2 ON s2."route_execution_id" = e2."route_execution_id"
    WHERE e2."driver_id" = e."driver_id" AND e2."route_id" IS NULL AND e2."execution_kind" = 'route')
ON CONFLICT DO NOTHING;
