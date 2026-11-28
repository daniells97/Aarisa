-- Stage 6c (+6b) of the database redesign: any client's report is read with a saved layout, sources and
-- settlement kinds are generic (no client names in the database), each contract says which weekly
-- settlement it uses, every imported line is kept as it arrived, and audit entries can point to the
-- WhatsApp suggestion behind them. Views that read the changed columns are rebuilt.
DROP VIEW "core"."v_extra_jobs";
--> statement-breakpoint
DROP VIEW "core"."v_work_records";
--> statement-breakpoint
DROP VIEW "core"."v_route_executions";
--> statement-breakpoint
CREATE TYPE "core"."source_new" AS ENUM('client_report', 'daily_list', 'extra_job', 'manual', 'whatsapp', 'system');
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ALTER COLUMN "execution_source" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ALTER COLUMN "execution_source" TYPE "core"."source_new" USING (CASE "execution_source"::text WHEN 'hovership_report' THEN 'client_report' WHEN 'tforce_report' THEN 'client_report' ELSE "execution_source"::text END)::"core"."source_new";
--> statement-breakpoint
ALTER TABLE "core"."route_executions" ALTER COLUMN "execution_source" SET DEFAULT 'system';
--> statement-breakpoint
ALTER TABLE "core"."work_records" ALTER COLUMN "record_source" TYPE "core"."source_new" USING (CASE "record_source"::text WHEN 'hovership_report' THEN 'client_report' WHEN 'tforce_report' THEN 'client_report' ELSE "record_source"::text END)::"core"."source_new";
--> statement-breakpoint
ALTER TABLE "core"."extra_jobs" ALTER COLUMN "job_source" TYPE "core"."source_new" USING (CASE "job_source"::text WHEN 'hovership_report' THEN 'client_report' WHEN 'tforce_report' THEN 'client_report' ELSE "job_source"::text END)::"core"."source_new";
--> statement-breakpoint
DROP TYPE "core"."source";
--> statement-breakpoint
ALTER TYPE "core"."source_new" RENAME TO "source";
--> statement-breakpoint
CREATE TYPE "core"."settlement_kind_new" AS ENUM('invoice', 'weekly_statement', 'extra_job', 'claim_adjustment');
--> statement-breakpoint
ALTER TABLE "core"."settlement_lines" ALTER COLUMN "settlement_kind" TYPE "core"."settlement_kind_new" USING (CASE "settlement_kind"::text WHEN 'hovership_invoice' THEN 'invoice' WHEN 'tforce_weekly' THEN 'weekly_statement' ELSE "settlement_kind"::text END)::"core"."settlement_kind_new";
--> statement-breakpoint
DROP TYPE "core"."settlement_kind";
--> statement-breakpoint
ALTER TYPE "core"."settlement_kind_new" RENAME TO "settlement_kind";
--> statement-breakpoint
-- Hovership is billed with Aarisa's weekly invoice; T-Force pays from its weekly statement.
ALTER TABLE "core"."operations" ADD COLUMN "weekly_settlement_kind" "core"."settlement_kind" DEFAULT 'weekly_statement' NOT NULL;
--> statement-breakpoint
UPDATE "core"."operations" SET "weekly_settlement_kind" = 'invoice' WHERE "operation_code" = 'hovership';
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD CONSTRAINT "operations_weekly_kind" CHECK ("core"."operations"."weekly_settlement_kind" in ('invoice', 'weekly_statement'));
--> statement-breakpoint
CREATE TYPE "core"."column_meaning" AS ENUM('work_date', 'driver_code', 'driver_name', 'route_code', 'quantity', 'bonus', 'other_revenue', 'other_revenue_reason', 'expected_pay', 'ignore');
--> statement-breakpoint
CREATE TYPE "core"."row_status" AS ENUM('ok', 'warning', 'error', 'ignored');
--> statement-breakpoint
CREATE TABLE "core"."report_import_rows" (
	"report_import_row_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"row_status" "core"."row_status" DEFAULT 'ok' NOT NULL,
	"problem_code" text,
	"problem_text" text
);
--> statement-breakpoint
CREATE TABLE "core"."report_layout_columns" (
	"report_layout_column_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_layout_id" uuid NOT NULL,
	"source_column_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"column_meaning" "core"."column_meaning" NOT NULL,
	"service_type_id" uuid,
	"service_tier_id" uuid,
	"revenue_type_id" uuid,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "report_layout_columns_quantity" CHECK ("core"."report_layout_columns"."column_meaning" <> 'quantity' or "core"."report_layout_columns"."service_type_id" is not null),
	CONSTRAINT "report_layout_columns_revenue" CHECK ("core"."report_layout_columns"."column_meaning" <> 'other_revenue' or "core"."report_layout_columns"."revenue_type_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "core"."report_layouts" (
	"report_layout_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"layout_name" text NOT NULL,
	"header_row" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."audit_log" ADD COLUMN "ai_suggestion_id" uuid;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD COLUMN "report_import_row_id" uuid;
--> statement-breakpoint
ALTER TABLE "core"."report_import_rows" ADD CONSTRAINT "report_import_rows_report_import_id_report_imports_report_import_id_fk" FOREIGN KEY ("report_import_id") REFERENCES "core"."report_imports"("report_import_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."report_layout_columns" ADD CONSTRAINT "report_layout_columns_report_layout_id_report_layouts_report_layout_id_fk" FOREIGN KEY ("report_layout_id") REFERENCES "core"."report_layouts"("report_layout_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."report_layout_columns" ADD CONSTRAINT "report_layout_columns_service_type_id_service_types_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "core"."service_types"("service_type_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."report_layout_columns" ADD CONSTRAINT "report_layout_columns_service_tier_id_service_tiers_service_tier_id_fk" FOREIGN KEY ("service_tier_id") REFERENCES "core"."service_tiers"("service_tier_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."report_layout_columns" ADD CONSTRAINT "report_layout_columns_revenue_type_id_revenue_types_revenue_type_id_fk" FOREIGN KEY ("revenue_type_id") REFERENCES "core"."revenue_types"("revenue_type_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."report_layouts" ADD CONSTRAINT "report_layouts_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."report_layouts" ADD CONSTRAINT "report_layouts_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "report_import_rows_line" ON "core"."report_import_rows" USING btree ("report_import_id","row_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_layout_columns_name" ON "core"."report_layout_columns" USING btree ("report_layout_id","source_column_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_layouts_one_active" ON "core"."report_layouts" USING btree ("operation_id") WHERE "core"."report_layouts"."is_active";
--> statement-breakpoint
ALTER TABLE "core"."audit_log" ADD CONSTRAINT "audit_log_ai_suggestion_id_ai_suggestions_ai_suggestion_id_fk" FOREIGN KEY ("ai_suggestion_id") REFERENCES "core"."ai_suggestions"("ai_suggestion_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_report_import_row_id_report_import_rows_report_import_row_id_fk" FOREIGN KEY ("report_import_row_id") REFERENCES "core"."report_import_rows"("report_import_row_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- hovership: the layout its importer had in code.
INSERT INTO "core"."report_layouts" ("operation_id", "layout_name") SELECT "operation_id", 'hovership report' FROM "core"."operations" WHERE "operation_code" = 'hovership';
--> statement-breakpoint
INSERT INTO "core"."report_layout_columns" ("report_layout_id", "source_column_name", "aliases", "column_meaning", "is_required", "sort_order", "service_type_id", "service_tier_id", "revenue_type_id")
SELECT l."report_layout_id", c.name, c.aliases, c.meaning::"core"."column_meaning", c.req, c.ord, s."service_type_id", t."service_tier_id", r."revenue_type_id"
FROM (VALUES
  ('POD Date', ARRAY['date','service date']::text[], 'work_date', true, 0, NULL, NULL, NULL),
  ('DriverCode', ARRAY['code']::text[], 'driver_code', true, 1, NULL, NULL, NULL),
  ('DriverNameCode', ARRAY['driver name','name']::text[], 'driver_name', false, 2, NULL, NULL, NULL),
  ('Tier 1', ARRAY['t1']::text[], 'quantity', true, 3, 'hovership_packages', 'T1', NULL),
  ('Tier 2', ARRAY['t2']::text[], 'quantity', true, 4, 'hovership_packages', 'T2', NULL),
  ('Tier 3', ARRAY['t3']::text[], 'quantity', true, 5, 'hovership_packages', 'T3', NULL),
  ('Tier 4', ARRAY['t4']::text[], 'quantity', true, 6, 'hovership_packages', 'T4', NULL),
  ('Stat', ARRAY['stats','stat stops']::text[], 'quantity', true, 7, 'stat', NULL, NULL),
  ('Stem', '{}'::text[], 'other_revenue', true, 8, NULL, NULL, 'stem'),
  ('Stem Reason', '{}'::text[], 'other_revenue_reason', false, 9, NULL, NULL, NULL),
  ('Bonus', '{}'::text[], 'bonus', false, 10, NULL, NULL, NULL),
  ('Total Route', '{}'::text[], 'expected_pay', false, 11, NULL, NULL, NULL),
  ('Total Profit', '{}'::text[], 'ignore', false, 12, NULL, NULL, NULL)
) AS c(name, aliases, meaning, req, ord, svc, tier, rev)
JOIN "core"."operations" o ON o."operation_code" = 'hovership'
JOIN "core"."report_layouts" l ON l."operation_id" = o."operation_id"
LEFT JOIN "core"."service_types" s ON s."operation_id" = o."operation_id" AND s."service_code" = c.svc
LEFT JOIN "core"."service_tiers" t ON t."service_type_id" = s."service_type_id" AND t."tier_code" = c.tier
LEFT JOIN "core"."revenue_types" r ON r."operation_id" = o."operation_id" AND r."revenue_type_code" = c.rev;
--> statement-breakpoint
-- tforce: the layout its importer had in code.
INSERT INTO "core"."report_layouts" ("operation_id", "layout_name") SELECT "operation_id", 'tforce report' FROM "core"."operations" WHERE "operation_code" = 'tforce';
--> statement-breakpoint
INSERT INTO "core"."report_layout_columns" ("report_layout_id", "source_column_name", "aliases", "column_meaning", "is_required", "sort_order", "service_type_id", "service_tier_id", "revenue_type_id")
SELECT l."report_layout_id", c.name, c.aliases, c.meaning::"core"."column_meaning", c.req, c.ord, s."service_type_id", t."service_tier_id", r."revenue_type_id"
FROM (VALUES
  ('Order Date', ARRAY['date']::text[], 'work_date', true, 0, NULL, NULL, NULL),
  ('Paid Driver #', ARRAY['paid driver number','route']::text[], 'route_code', true, 1, NULL, NULL, NULL),
  ('Pieces', ARRAY['pcs','piece count']::text[], 'quantity', true, 2, 'ecommerce', NULL, NULL)
) AS c(name, aliases, meaning, req, ord, svc, tier, rev)
JOIN "core"."operations" o ON o."operation_code" = 'tforce'
JOIN "core"."report_layouts" l ON l."operation_id" = o."operation_id"
LEFT JOIN "core"."service_types" s ON s."operation_id" = o."operation_id" AND s."service_code" = c.svc
LEFT JOIN "core"."service_tiers" t ON t."service_type_id" = s."service_type_id" AND t."tier_code" = c.tier
LEFT JOIN "core"."revenue_types" r ON r."operation_id" = o."operation_id" AND r."revenue_type_code" = c.rev;
--> statement-breakpoint
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
  e."payee_driver_id" AS "driver_id", e."payee_contractor_id" AS "contractor_id", w."service_type_id", w."service_tier_id", t."tier_code", w."quantity",
  w."client_rate_cents", w."payee_rate_cents", w."pay_cents", w."revenue_cents", w."record_source", w."report_import_id",
  w."extra_job_id", w."payroll_run_id", w."settlement_line_id", w."created_at", w."updated_at"
FROM "core"."work_records" w JOIN "core"."v_route_executions" e ON e."route_execution_id" = w."route_execution_id"
LEFT JOIN "core"."service_tiers" t ON t."service_tier_id" = w."service_tier_id";
--> statement-breakpoint
CREATE VIEW "core"."v_extra_jobs" AS
SELECT j."extra_job_id", j."client_uuid", j."route_execution_id", e."operation_id", e."work_date", j."service_type_id", j."near_route_id", e."payee_id",
  e."payee_driver_id" AS "driver_id", e."payee_contractor_id" AS "contractor_id", j."client_amount_cents", j."payee_amount_cents", j."order_number",
  j."photo_url", j."note", j."job_source", j."ai_suggestion_id", j."created_by_user_id", j."created_at", j."updated_at"
FROM "core"."extra_jobs" j JOIN "core"."v_route_executions" e ON e."route_execution_id" = j."route_execution_id";
