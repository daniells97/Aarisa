-- Stage 4 of the database redesign (docs/db-model.md §2.4, §2.6): tiers per service (premise 2), rates per
-- side under dated agreements (renegotiations keep history), pay adjustments (bonuses move off the work
-- record), and no stored profit. Pieces imported before this were summed into Tier 1–3; they keep that
-- as the retired tier "T1-3", which gets the same rates T1–T3 had.
CREATE TYPE "core"."adjustment_class" AS ENUM('bonus', 'goal_top_up', 'correction', 'deduction');
--> statement-breakpoint
CREATE TYPE "core"."adjustment_source" AS ENUM('manual', 'rule', 'goal');
--> statement-breakpoint
CREATE TYPE "core"."adjustment_status" AS ENUM('proposed', 'confirmed', 'rejected');
--> statement-breakpoint
CREATE TYPE "core"."rate_side" AS ENUM('client', 'payee');
--> statement-breakpoint
CREATE TABLE "core"."service_tiers" (
	"service_tier_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type_id" uuid NOT NULL,
	"tier_code" text NOT NULL,
	"tier_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"min_qty" integer,
	"max_qty" integer,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."service_tiers" ADD CONSTRAINT "service_tiers_service_type_id_service_types_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "core"."service_types"("service_type_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "service_tiers_service_code" ON "core"."service_tiers" USING btree ("service_type_id","tier_code");
--> statement-breakpoint
INSERT INTO "core"."service_tiers" ("service_type_id", "tier_code", "tier_name", "sort_order", "is_active")
SELECT s."service_type_id", t.code, t.name, t.sort, t.active FROM "core"."service_types" s
CROSS JOIN (VALUES ('T1', 'Tier 1', 1, true), ('T2', 'Tier 2', 2, true), ('T3', 'Tier 3', 3, true), ('T4', 'Tier 4', 4, true), ('T1-3', 'Tier 1–3 (before tiers were kept apart)', 0, false)) AS t(code, name, sort, active)
WHERE s."service_code" = 'hovership_packages';
--> statement-breakpoint
-- Rates: keep the old rows aside, rebuild them per side under agreements.
CREATE TEMP TABLE "old_rates" ON COMMIT DROP AS
SELECT r."service_type_id", r."tier"::text AS "tier", r."client_rate_cents", r."payee_rate_cents", r."effective_from", r."created_by_user_id", r."created_at",
  s."operation_id", coalesce(d."payee_id", c."payee_id") AS "payee_id" FROM "core"."rates" r
JOIN "core"."service_types" s ON s."service_type_id" = r."service_type_id"
LEFT JOIN "core"."drivers" d ON d."driver_id" = r."driver_id"
LEFT JOIN "core"."contractors" c ON c."contractor_id" = r."contractor_id";
--> statement-breakpoint
DROP TABLE "core"."rates";
--> statement-breakpoint
CREATE TABLE "core"."rate_agreements" (
	"rate_agreement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"rate_side" "core"."rate_side" NOT NULL,
	"effective_from" date NOT NULL,
	"reason" text,
	"document_url" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."rates" (
	"rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_agreement_id" uuid NOT NULL,
	"rate_side" "core"."rate_side" NOT NULL,
	"effective_from" date NOT NULL,
	"service_type_id" uuid NOT NULL,
	"service_tier_id" uuid,
	"payee_id" uuid,
	"rate_cents" bigint NOT NULL,
	CONSTRAINT "rates_unique" UNIQUE NULLS NOT DISTINCT("service_type_id","service_tier_id","payee_id","rate_side","effective_from"),
	CONSTRAINT "rates_not_negative" CHECK ("core"."rates"."rate_cents" >= 0),
	CONSTRAINT "rates_client_general" CHECK ("core"."rates"."rate_side" = 'payee' or "core"."rates"."payee_id" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rate_agreements_key" ON "core"."rate_agreements" USING btree ("rate_agreement_id","rate_side","effective_from");
--> statement-breakpoint
-- One agreement per operation, side and start date the old rates had.
INSERT INTO "core"."rate_agreements" ("operation_id", "rate_side", "effective_from", "reason", "created_by_user_id", "created_at")
SELECT "operation_id", side::"core"."rate_side", "effective_from", 'Rates before the redesign', (array_agg("created_by_user_id"))[1], min("created_at")
FROM (
  SELECT "operation_id", 'client' AS side, "effective_from", "created_by_user_id", "created_at" FROM old_rates WHERE "client_rate_cents" IS NOT NULL AND "payee_id" IS NULL
  UNION ALL
  SELECT "operation_id", 'payee', "effective_from", "created_by_user_id", "created_at" FROM old_rates WHERE "payee_rate_cents" IS NOT NULL
) x GROUP BY "operation_id", side, "effective_from";
--> statement-breakpoint
-- Each old row becomes one rate per side; Tier 1–3 fans out to T1, T2, T3 and the retired T1-3.
INSERT INTO "core"."rates" ("rate_agreement_id", "rate_side", "effective_from", "service_type_id", "service_tier_id", "payee_id", "rate_cents")
SELECT a."rate_agreement_id", a."rate_side", a."effective_from", o."service_type_id", t."service_tier_id", CASE WHEN v.side = 'payee' THEN o."payee_id" END, v.cents
FROM old_rates o
CROSS JOIN LATERAL (VALUES ('client', o."client_rate_cents"), ('payee', o."payee_rate_cents")) AS v(side, cents)
JOIN "core"."rate_agreements" a ON a."operation_id" = o."operation_id" AND a."rate_side" = v.side::"core"."rate_side" AND a."effective_from" = o."effective_from"
LEFT JOIN "core"."service_tiers" t ON t."service_type_id" = o."service_type_id"
  AND t."tier_code" = ANY (CASE o."tier" WHEN 't1_3' THEN ARRAY['T1', 'T2', 'T3', 'T1-3'] WHEN 't4' THEN ARRAY['T4'] END)
WHERE v.cents IS NOT NULL AND (v.side = 'payee' OR o."payee_id" IS NULL) AND (o."tier" IS NULL OR t."service_tier_id" IS NOT NULL);
--> statement-breakpoint
CREATE INDEX "rates_lookup" ON "core"."rates" USING btree ("service_type_id","service_tier_id","effective_from");
--> statement-breakpoint
-- Adjustments, with the bonuses that sat on the Tier 1–3 work records.
CREATE TABLE "core"."adjustment_types" (
	"adjustment_type_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjustment_type_code" text NOT NULL,
	"adjustment_type_name" text NOT NULL,
	"adjustment_type_name_es" text,
	"adjustment_class" "core"."adjustment_class" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "adjustment_types_adjustment_type_code_unique" UNIQUE("adjustment_type_code")
);
--> statement-breakpoint
INSERT INTO "core"."adjustment_types" ("adjustment_type_code", "adjustment_type_name", "adjustment_type_name_es", "adjustment_class") VALUES
  ('bonus', 'Bonus', 'Bono', 'bonus'),
  ('goal_top_up', 'Daily goal top-up', 'Complemento de meta diaria', 'goal_top_up'),
  ('correction', 'Correction', 'Corrección', 'correction'),
  ('deduction', 'Deduction', 'Deducción', 'deduction');
--> statement-breakpoint
CREATE TABLE "core"."pay_adjustments" (
	"pay_adjustment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_period_id" uuid,
	"payee_id" uuid NOT NULL,
	"route_execution_id" uuid,
	"adjustment_type_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text,
	"adjustment_source" "core"."adjustment_source" DEFAULT 'manual' NOT NULL,
	"adjustment_status" "core"."adjustment_status" DEFAULT 'confirmed' NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_adjustments_target" CHECK ("core"."pay_adjustments"."route_execution_id" is not null or "core"."pay_adjustments"."pay_period_id" is not null),
	CONSTRAINT "pay_adjustments_not_zero" CHECK ("core"."pay_adjustments"."amount_cents" <> 0)
);
--> statement-breakpoint
INSERT INTO "core"."pay_adjustments" ("payee_id", "route_execution_id", "adjustment_type_id", "amount_cents", "reason", "adjustment_source", "adjustment_status", "confirmed_at", "created_at", "updated_at")
SELECT e."payee_id", w."route_execution_id", (SELECT "adjustment_type_id" FROM "core"."adjustment_types" WHERE "adjustment_type_code" = 'bonus'),
  w."bonus_cents", 'Moved from the work record', 'manual', 'confirmed', w."updated_at", w."created_at", w."updated_at"
FROM "core"."work_records" w JOIN "core"."route_executions" e ON e."route_execution_id" = w."route_execution_id"
WHERE w."bonus_cents" <> 0 AND e."payee_id" IS NOT NULL;
--> statement-breakpoint
-- Approved snapshots counted the bonus in the record's pay; the bonus now lives in its adjustment.
UPDATE "core"."work_records" SET "pay_cents" = "pay_cents" - "bonus_cents" WHERE "pay_cents" IS NOT NULL AND "bonus_cents" <> 0;
--> statement-breakpoint
-- Tiers on work records.
ALTER TABLE "core"."work_records" ADD COLUMN "service_tier_id" uuid;
--> statement-breakpoint
UPDATE "core"."work_records" w SET "service_tier_id" = t."service_tier_id" FROM "core"."service_tiers" t
WHERE t."service_type_id" = w."service_type_id" AND t."tier_code" = CASE w."tier"::text WHEN 't1_3' THEN 'T1-3' WHEN 't4' THEN 'T4' END;
--> statement-breakpoint
DROP VIEW "core"."v_extra_jobs";
--> statement-breakpoint
DROP VIEW "core"."v_work_records";
--> statement-breakpoint
DROP INDEX "core"."work_records_grain_tier";
--> statement-breakpoint
DROP INDEX "core"."work_records_grain";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP CONSTRAINT "work_records_quantity";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "tier";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "bonus_cents";
--> statement-breakpoint
ALTER TABLE "core"."work_records" DROP COLUMN "profit_cents";
--> statement-breakpoint
DROP TYPE "core"."tier";
--> statement-breakpoint
ALTER TABLE "core"."payroll_lines" RENAME COLUMN "bonus_cents" TO "adjustment_cents";
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_pay_period_id_pay_periods_pay_period_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "core"."pay_periods"("pay_period_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_payee_id_payees_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "core"."payees"("payee_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_route_execution_id_route_executions_route_execution_id_fk" FOREIGN KEY ("route_execution_id") REFERENCES "core"."route_executions"("route_execution_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_adjustment_type_id_adjustment_types_adjustment_type_id_fk" FOREIGN KEY ("adjustment_type_id") REFERENCES "core"."adjustment_types"("adjustment_type_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_confirmed_by_user_id_users_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."rate_agreements" ADD CONSTRAINT "rate_agreements_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."rate_agreements" ADD CONSTRAINT "rate_agreements_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."rates" ADD CONSTRAINT "rates_service_type_id_service_types_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "core"."service_types"("service_type_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."rates" ADD CONSTRAINT "rates_service_tier_id_service_tiers_service_tier_id_fk" FOREIGN KEY ("service_tier_id") REFERENCES "core"."service_tiers"("service_tier_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."rates" ADD CONSTRAINT "rates_payee_id_payees_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "core"."payees"("payee_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."rates" ADD CONSTRAINT "rates_agreement_fk" FOREIGN KEY ("rate_agreement_id","rate_side","effective_from") REFERENCES "core"."rate_agreements"("rate_agreement_id","rate_side","effective_from") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pay_adjustments_execution" ON "core"."pay_adjustments" USING btree ("route_execution_id");
--> statement-breakpoint
CREATE INDEX "pay_adjustments_payee" ON "core"."pay_adjustments" USING btree ("payee_id");
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_service_tier_id_service_tiers_service_tier_id_fk" FOREIGN KEY ("service_tier_id") REFERENCES "core"."service_tiers"("service_tier_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "work_records_grain_tier" ON "core"."work_records" USING btree ("route_execution_id","service_type_id","service_tier_id") WHERE "core"."work_records"."extra_job_id" is null and "core"."work_records"."service_tier_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "work_records_grain" ON "core"."work_records" USING btree ("route_execution_id","service_type_id") WHERE "core"."work_records"."extra_job_id" is null and "core"."work_records"."service_tier_id" is null;
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_quantity" CHECK ("core"."work_records"."quantity" >= 0);
--> statement-breakpoint
ALTER TABLE "core"."work_records" ADD CONSTRAINT "work_records_snapshot" CHECK (("core"."work_records"."pay_cents" is null) = ("core"."work_records"."revenue_cents" is null));
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
