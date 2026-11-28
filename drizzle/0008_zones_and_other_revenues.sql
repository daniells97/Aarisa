-- Stage 5a of the database redesign (docs/db-model.md §2.4, §2.6; owner decisions of Oct 18, 2026): a global zones
-- catalog with the ways each zone arrives written, revenue types per operation, and operation_revenue becomes
-- other_revenues (same ids) with its zone, an optional driver-day, and a review status. STEM with no known
-- zone, no reason, or above $200 waits for someone to classify it.
CREATE TYPE "core"."classification_status" AS ENUM('classified', 'needs_review', 'lump_adjustment');
--> statement-breakpoint
CREATE TABLE "core"."zones" (
	"zone_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_code" text NOT NULL,
	"zone_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_zone_code_unique" UNIQUE("zone_code")
);
--> statement-breakpoint
CREATE TABLE "core"."zone_aliases" (
	"zone_alias_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"alias_text" text NOT NULL,
	CONSTRAINT "zone_aliases_alias_text_unique" UNIQUE("alias_text")
);
--> statement-breakpoint
ALTER TABLE "core"."zone_aliases" ADD CONSTRAINT "zone_aliases_zone_id_zones_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "core"."zones"("zone_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The 15 zones and 2 combined zones of the June 2026 file (option A: a combination is a zone of its own).
INSERT INTO "core"."zones" ("zone_code", "zone_name") VALUES
  ('benicia', 'Benicia'),
  ('diablo', 'Diablo'),
  ('discovery_bay', 'Discovery Bay'),
  ('orinda', 'Orinda'),
  ('pittsburg', 'Pittsburg'),
  ('livermore', 'Livermore'),
  ('sunol', 'Sunol'),
  ('alamo', 'Alamo'),
  ('alameda', 'Alameda'),
  ('antioch', 'Antioch'),
  ('martinez', 'Martinez'),
  ('castro_valley', 'Castro Valley'),
  ('crockett', 'Crockett'),
  ('dublin_hills', 'Dublin Hills'),
  ('richmond', 'Richmond'),
  ('pittsburg_martinez', 'Pittsburg + Martinez'),
  ('richmond_crockett', 'Richmond + Crockett');
--> statement-breakpoint
INSERT INTO "core"."zone_aliases" ("zone_id", "alias_text")
SELECT z."zone_id", a.alias FROM (VALUES
  ('discovery_bay', 'disco bay'),
  ('pittsburg', 'pitsburg'),
  ('crockett', 'crocket'),
  ('pittsburg_martinez', 'pittsburg martinez'),
  ('pittsburg_martinez', 'pittrsburg martinez'),
  ('pittsburg_martinez', 'pitsburg martinez'),
  ('richmond_crockett', 'richmond crocket'),
  ('richmond_crockett', 'richmond crockett')) AS a(code, alias) JOIN "core"."zones" z ON z."zone_code" = a.code;
--> statement-breakpoint
CREATE TABLE "core"."revenue_types" (
	"revenue_type_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"revenue_type_code" text NOT NULL,
	"revenue_type_name" text NOT NULL,
	"counts_in_payee_margin" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."revenue_types" ADD CONSTRAINT "revenue_types_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_types_op_code" ON "core"."revenue_types" USING btree ("operation_id","revenue_type_code");
--> statement-breakpoint
INSERT INTO "core"."revenue_types" ("operation_id", "revenue_type_code", "revenue_type_name")
SELECT DISTINCT "operation_id", "revenue_kind", 'STEM' FROM "core"."operation_revenue"
UNION SELECT "operation_id", 'stem', 'STEM' FROM "core"."operations" WHERE "operation_code" = 'hovership';
--> statement-breakpoint
ALTER TABLE "core"."operation_revenue" RENAME TO "other_revenues";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" RENAME COLUMN "operation_revenue_id" TO "other_revenue_id";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" RENAME CONSTRAINT "operation_revenue_pkey" TO "other_revenues_pkey";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" RENAME CONSTRAINT "operation_revenue_operation_id_operations_operation_id_fk" TO "other_revenues_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" RENAME CONSTRAINT "operation_revenue_report_import_id_report_imports_report_import" TO "other_revenues_report_import_id_report_imports_report_import_id_";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD COLUMN "revenue_type_id" uuid;
--> statement-breakpoint
UPDATE "core"."other_revenues" o SET "revenue_type_id" = t."revenue_type_id" FROM "core"."revenue_types" t WHERE t."operation_id" = o."operation_id" AND t."revenue_type_code" = o."revenue_kind";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ALTER COLUMN "revenue_type_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" DROP COLUMN "revenue_kind";
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD COLUMN "route_execution_id" uuid;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD COLUMN "zone_id" uuid;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD COLUMN "classification_status" "core"."classification_status" DEFAULT 'classified' NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD COLUMN "review_note" text;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Existing STEM: its zone from the reason as written; no known zone, no reason or above $200 → review.
UPDATE "core"."other_revenues" o SET "zone_id" = m."zone_id" FROM (
  SELECT z."zone_id", lower(z."zone_name") AS k FROM "core"."zones" z
  UNION SELECT z."zone_id", lower(z."zone_code") FROM "core"."zones" z
  UNION SELECT a."zone_id", a."alias_text" FROM "core"."zone_aliases" a
) m WHERE m.k = lower(regexp_replace(btrim(o."reason_text"), '\s+', ' ', 'g'));
--> statement-breakpoint
UPDATE "core"."other_revenues" SET "classification_status" = 'needs_review' WHERE "zone_id" IS NULL OR "amount_cents" > 20000;
--> statement-breakpoint
-- The change log keeps its history under the new table name.
UPDATE "core"."audit_log" SET "table_name" = 'other_revenues' WHERE "table_name" = 'operation_revenue';
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD CONSTRAINT "other_revenues_revenue_type_id_revenue_types_revenue_type_id_fk" FOREIGN KEY ("revenue_type_id") REFERENCES "core"."revenue_types"("revenue_type_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD CONSTRAINT "other_revenues_route_execution_id_route_executions_route_execution_id_fk" FOREIGN KEY ("route_execution_id") REFERENCES "core"."route_executions"("route_execution_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD CONSTRAINT "other_revenues_zone_id_zones_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "core"."zones"("zone_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "other_revenues_op_date" ON "core"."other_revenues" USING btree ("operation_id","revenue_date");
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD CONSTRAINT "other_revenues_zone" CHECK ("core"."other_revenues"."classification_status" <> 'classified' or "core"."other_revenues"."zone_id" is not null);
--> statement-breakpoint
ALTER TABLE "core"."other_revenues" ADD CONSTRAINT "other_revenues_lump_note" CHECK ("core"."other_revenues"."classification_status" <> 'lump_adjustment' or "core"."other_revenues"."review_note" is not null);
