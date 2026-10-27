-- Stage 3 of the database redesign (docs/db-model.md §2.6): the route execution. One payee, one day,
-- one route (or none) for one operation. Daily assignments become executions with the same ids; Hovership
-- driver-days and extra jobs get their own. Work records, extra jobs and exceptions hang from executions,
-- and payroll lines point to the payee. Read views keep the flat shape screens and reports use.
ALTER TYPE "core"."assignment_status" RENAME TO "execution_status";
--> statement-breakpoint
CREATE TYPE "core"."execution_kind" AS ENUM('route', 'extra');
--> statement-breakpoint
CREATE TABLE "core"."route_executions" (
	"route_execution_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"route_id" uuid,
	"execution_kind" "core"."execution_kind" DEFAULT 'route' NOT NULL,
	"payee_id" uuid,
	"driver_id" uuid,
	"raw_name" text,
	"execution_status" "core"."execution_status" DEFAULT 'proposed' NOT NULL,
	"execution_source" "core"."source" DEFAULT 'system' NOT NULL,
	"report_import_id" uuid,
	"agreed_client_amount_cents" bigint,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_executions_status_payee" CHECK (("core"."route_executions"."execution_status" in ('confirmed', 'changed') and "core"."route_executions"."payee_id" is not null) or ("core"."route_executions"."execution_status" = 'no_driver' and "core"."route_executions"."payee_id" is null) or "core"."route_executions"."execution_status" in ('proposed', 'waiting')),
	CONSTRAINT "route_executions_confirmed_at" CHECK ("core"."route_executions"."confirmed_at" is null or "core"."route_executions"."execution_status" in ('confirmed', 'changed')),
	CONSTRAINT "route_executions_extra_payee" CHECK ("core"."route_executions"."execution_kind" = 'route' or "core"."route_executions"."payee_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "route_executions_route_day" ON "core"."route_executions" USING btree ("operation_id","work_date","route_id") WHERE "core"."route_executions"."execution_kind" = 'route' and "core"."route_executions"."route_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "route_executions_payee_day" ON "core"."route_executions" USING btree ("operation_id","work_date","payee_id") WHERE "core"."route_executions"."execution_kind" = 'route' and "core"."route_executions"."route_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "route_executions_extra_day" ON "core"."route_executions" USING btree ("operation_id","work_date","payee_id") WHERE "core"."route_executions"."execution_kind" = 'extra';
--> statement-breakpoint
CREATE INDEX "route_executions_payee" ON "core"."route_executions" USING btree ("payee_id","work_date");
--> statement-breakpoint
-- 1. The daily list: each assignment becomes the route execution of its route and day, same id.
INSERT INTO "core"."route_executions" ("route_execution_id", "operation_id", "work_date", "route_id", "execution_kind", "payee_id", "driver_id", "raw_name",
  "execution_status", "execution_source", "confirmed_by_user_id", "confirmed_at", "created_at", "updated_at")
SELECT a."daily_assignment_id", r."operation_id", a."work_date", a."route_id", 'route', coalesce(d."payee_id", c."payee_id"), a."driver_id", a."raw_name",
  a."assignment_status", a."assignment_source", a."confirmed_by_user_id",
  CASE WHEN a."assignment_status" IN ('confirmed', 'changed') THEN a."confirmed_at" END, a."updated_at", a."updated_at"
FROM "core"."daily_assignments" a
JOIN "core"."routes" r ON r."route_id" = a."route_id"
LEFT JOIN "core"."drivers" d ON d."driver_id" = a."driver_id"
LEFT JOIN "core"."contractors" c ON c."contractor_id" = a."contractor_id";
--> statement-breakpoint
-- 2. Report route-days the list never mentioned.
INSERT INTO "core"."route_executions" ("operation_id", "work_date", "route_id", "execution_kind", "payee_id", "driver_id", "execution_status", "execution_source", "report_import_id", "confirmed_at")
SELECT DISTINCT ON (w."operation_id", w."work_date", w."route_id") w."operation_id", w."work_date", w."route_id", 'route', coalesce(d."payee_id", c."payee_id"), w."driver_id",
  CASE WHEN coalesce(d."payee_id", c."payee_id") IS NULL THEN 'no_driver' ELSE 'confirmed' END::"core"."execution_status", w."record_source", w."report_import_id",
  CASE WHEN coalesce(d."payee_id", c."payee_id") IS NULL THEN NULL ELSE w."created_at" END
FROM "core"."work_records" w
LEFT JOIN "core"."drivers" d ON d."driver_id" = w."driver_id"
LEFT JOIN "core"."contractors" c ON c."contractor_id" = w."contractor_id"
WHERE w."extra_job_id" IS NULL AND w."route_id" IS NOT NULL AND w."daily_assignment_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "core"."route_executions" e WHERE e."operation_id" = w."operation_id" AND e."work_date" = w."work_date" AND e."route_id" = w."route_id" AND e."execution_kind" = 'route')
ORDER BY w."operation_id", w."work_date", w."route_id", w."created_at";
--> statement-breakpoint
-- 3. Hovership driver-days (no route): one execution per payee and day.
INSERT INTO "core"."route_executions" ("operation_id", "work_date", "execution_kind", "payee_id", "driver_id", "execution_status", "execution_source", "report_import_id", "confirmed_at", "created_at")
SELECT DISTINCT ON (w."operation_id", w."work_date", coalesce(d."payee_id", c."payee_id")) w."operation_id", w."work_date", 'route', coalesce(d."payee_id", c."payee_id"), w."driver_id",
  'confirmed', w."record_source", w."report_import_id", w."created_at", w."created_at"
FROM "core"."work_records" w
LEFT JOIN "core"."drivers" d ON d."driver_id" = w."driver_id"
LEFT JOIN "core"."contractors" c ON c."contractor_id" = w."contractor_id"
WHERE w."extra_job_id" IS NULL AND w."route_id" IS NULL AND coalesce(d."payee_id", c."payee_id") IS NOT NULL
ORDER BY w."operation_id", w."work_date", coalesce(d."payee_id", c."payee_id"), w."created_at";
--> statement-breakpoint
-- 4. Extra jobs: one `extra` execution per payee and day (paid, not a route day).
INSERT INTO "core"."route_executions" ("operation_id", "work_date", "execution_kind", "payee_id", "driver_id", "execution_status", "execution_source", "confirmed_by_user_id", "confirmed_at", "created_at")
SELECT DISTINCT ON (j."operation_id", j."work_date", coalesce(d."payee_id", c."payee_id")) j."operation_id", j."work_date", 'extra', coalesce(d."payee_id", c."payee_id"), j."driver_id",
  'confirmed', j."job_source", j."created_by_user_id", j."created_at", j."created_at"
FROM "core"."extra_jobs" j
LEFT JOIN "core"."drivers" d ON d."driver_id" = j."driver_id"
LEFT JOIN "core"."contractors" c ON c."contractor_id" = j."contractor_id"
ORDER BY j."operation_id", j."work_date", coalesce(d."payee_id", c."payee_id"), j."created_at";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" ADD COLUMN "route_execution_id" uuid;
--> statement-breakpoint
UPDATE "core"."extra_jobs" j SET "route_execution_id" = e."route_execution_id"
FROM "core"."route_executions" e
WHERE e."execution_kind" = 'extra' AND e."operation_id" = j."operation_id" AND e."work_date" = j."work_date"
  AND e."payee_id" = coalesce((SELECT "payee_id" FROM "core"."drivers" WHERE "driver_id" = j."driver_id"), (SELECT "payee_id" FROM "core"."contractors" WHERE "contractor_id" = j."contractor_id"));
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" ALTER COLUMN "route_execution_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD COLUMN "route_execution_id" uuid;
--> statement-breakpoint
UPDATE "core"."work_records" SET "route_execution_id" = "daily_assignment_id" WHERE "daily_assignment_id" IS NOT NULL AND "extra_job_id" IS NULL;
--> statement-breakpoint
UPDATE "core"."work_records" w SET "route_execution_id" = j."route_execution_id" FROM "core"."extra_jobs" j WHERE j."extra_job_id" = w."extra_job_id";
--> statement-breakpoint
UPDATE "core"."work_records" w SET "route_execution_id" = e."route_execution_id" FROM "core"."route_executions" e
WHERE w."route_execution_id" IS NULL AND w."route_id" IS NOT NULL AND e."execution_kind" = 'route'
  AND e."operation_id" = w."operation_id" AND e."work_date" = w."work_date" AND e."route_id" = w."route_id";
--> statement-breakpoint
UPDATE "core"."work_records" w SET "route_execution_id" = e."route_execution_id" FROM "core"."route_executions" e
WHERE w."route_execution_id" IS NULL AND w."route_id" IS NULL AND e."execution_kind" = 'route' AND e."route_id" IS NULL
  AND e."operation_id" = w."operation_id" AND e."work_date" = w."work_date"
  AND e."payee_id" = coalesce((SELECT "payee_id" FROM "core"."drivers" WHERE "driver_id" = w."driver_id"), (SELECT "payee_id" FROM "core"."contractors" WHERE "contractor_id" = w."contractor_id"));
--> statement-breakpoint
ALTER TABLE "core"."work_records" ALTER COLUMN "route_execution_id" SET NOT NULL;
--> statement-breakpoint
-- Exceptions keep their assignment link under its new name (same ids); report rows give the rest.
ALTER TABLE "core"."exceptions" DROP CONSTRAINT "exceptions_daily_assignment_id_daily_assignments_daily_assignme";
--> statement-breakpoint
ALTER TABLE "core"."exceptions" RENAME COLUMN "daily_assignment_id" TO "route_execution_id";
--> statement-breakpoint
UPDATE "core"."exceptions" x SET "route_execution_id" = w."route_execution_id" FROM "core"."work_records" w WHERE x."route_execution_id" IS NULL AND w."work_record_id" = x."work_record_id";
--> statement-breakpoint
ALTER TABLE "core"."payroll_lines" ADD COLUMN "payee_id" uuid;
--> statement-breakpoint
UPDATE "core"."payroll_lines" l SET "payee_id" = coalesce((SELECT "payee_id" FROM "core"."drivers" WHERE "driver_id" = l."driver_id"), (SELECT "payee_id" FROM "core"."contractors" WHERE "contractor_id" = l."contractor_id"));
--> statement-breakpoint
ALTER TABLE "core"."payroll_lines" ALTER COLUMN "payee_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."payroll_lines" DROP COLUMN "driver_id";
--> statement-breakpoint
ALTER TABLE "core"."payroll_lines" DROP COLUMN "contractor_id";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" DROP CONSTRAINT "extra_one_payee";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" DROP COLUMN "operation_id";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" DROP COLUMN "work_date";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" DROP COLUMN "driver_id";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" DROP COLUMN "contractor_id";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "work_date";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "operation_id";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "route_id";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "driver_id";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "contractor_id";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "daily_assignment_id";
--> statement-breakpoint
DROP TABLE "core"."daily_assignments";
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_route_id_routes_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "core"."routes"("route_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_payee_id_payees_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "core"."payees"("payee_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_report_import_id_report_imports_report_import_id_fk" FOREIGN KEY ("report_import_id") REFERENCES "core"."report_imports"("report_import_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ADD CONSTRAINT "route_executions_confirmed_by_user_id_users_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."exceptions" ADD CONSTRAINT "exceptions_route_execution_id_route_executions_route_execution_id_fk" FOREIGN KEY ("route_execution_id") REFERENCES "core"."route_executions"("route_execution_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" ADD CONSTRAINT "extra_jobs_route_execution_id_route_executions_route_execution_id_fk" FOREIGN KEY ("route_execution_id") REFERENCES "core"."route_executions"("route_execution_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" ADD CONSTRAINT "extra_jobs_ai_suggestion_id_ai_suggestions_ai_suggestion_id_fk" FOREIGN KEY ("ai_suggestion_id") REFERENCES "core"."ai_suggestions"("ai_suggestion_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."payroll_lines" ADD CONSTRAINT "payroll_lines_payee_id_payees_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "core"."payees"("payee_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_route_execution_id_route_executions_route_execution_id_fk" FOREIGN KEY ("route_execution_id") REFERENCES "core"."route_executions"("route_execution_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_payroll_run_id_payroll_runs_payroll_run_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "core"."payroll_runs"("payroll_run_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_settlement_line_id_settlement_lines_settlement_line_id_fk" FOREIGN KEY ("settlement_line_id") REFERENCES "core"."settlement_lines"("settlement_line_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "extra_jobs_execution" ON "core"."extra_jobs" USING btree ("route_execution_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_run_payee" ON "core"."payroll_lines" USING btree ("payroll_run_id","payee_id");
--> statement-breakpoint
CREATE INDEX "work_records_execution" ON "core"."work_records" USING btree ("route_execution_id");
--> statement-breakpoint
CREATE INDEX "work_records_payroll_run" ON "core"."work_records" USING btree ("payroll_run_id");
--> statement-breakpoint
CREATE INDEX "work_records_settlement_line" ON "core"."work_records" USING btree ("settlement_line_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "work_records_grain_tier" ON "core"."work_records" USING btree ("route_execution_id","service_type_id","tier") WHERE "core"."work_records"."extra_job_id" is null and "core"."work_records"."tier" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "work_records_grain" ON "core"."work_records" USING btree ("route_execution_id","service_type_id") WHERE "core"."work_records"."extra_job_id" is null and "core"."work_records"."tier" is null;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_extra_job_id_unique" UNIQUE("extra_job_id");
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" ADD CONSTRAINT "extra_jobs_amounts" CHECK ("core"."extra_jobs"."payee_amount_cents" >= 0 and ("core"."extra_jobs"."client_amount_cents" is null or "core"."extra_jobs"."client_amount_cents" >= 0));
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_quantity" CHECK ("core"."work_records"."quantity" >= 0 and "core"."work_records"."bonus_cents" >= 0);
--> statement-breakpoint
-- Read views: the flat shape screens and reports use (payee split into driver or contractor).
CREATE VIEW "core"."v_route_executions" AS
SELECT e."route_execution_id", e."operation_id", e."work_date", e."route_id", e."execution_kind", e."payee_id",
  d."driver_id" AS "payee_driver_id", c."contractor_id" AS "payee_contractor_id", e."driver_id", e."raw_name",
  e."execution_status", e."execution_source", e."confirmed_at", e."updated_at"
FROM "core"."route_executions" e
LEFT JOIN "core"."drivers" d ON d."payee_id" = e."payee_id"
LEFT JOIN "core"."contractors" c ON c."payee_id" = e."payee_id";
--> statement-breakpoint
CREATE VIEW "core"."v_work_records" AS
SELECT w."work_record_id", w."route_execution_id", e."execution_kind", e."work_date", e."operation_id", e."route_id", e."payee_id",
  e."payee_driver_id" AS "driver_id", e."payee_contractor_id" AS "contractor_id", w."service_type_id", w."tier", w."quantity", w."bonus_cents",
  w."client_rate_cents", w."payee_rate_cents", w."pay_cents", w."revenue_cents", w."profit_cents", w."record_source", w."report_import_id",
  w."extra_job_id", w."payroll_run_id", w."settlement_line_id", w."created_at", w."updated_at"
FROM "core"."work_records" w JOIN "core"."v_route_executions" e ON e."route_execution_id" = w."route_execution_id";
--> statement-breakpoint
CREATE VIEW "core"."v_extra_jobs" AS
SELECT j."extra_job_id", j."client_uuid", j."route_execution_id", e."operation_id", e."work_date", j."service_type_id", j."near_route_id", e."payee_id",
  e."payee_driver_id" AS "driver_id", e."payee_contractor_id" AS "contractor_id", j."client_amount_cents", j."payee_amount_cents", j."order_number",
  j."photo_url", j."note", j."job_source", j."ai_suggestion_id", j."created_by_user_id", j."created_at", j."updated_at"
FROM "core"."extra_jobs" j JOIN "core"."v_route_executions" e ON e."route_execution_id" = j."route_execution_id";
