-- Stage 2 of the database redesign (docs/db-model.md §2.3, §2.4): payees, Aarisa as its own company,
-- driver codes, aliases and company links with history, and route owners with history.
-- Existing rows keep their ids: each driver's and contractor's payee reuses that id.
CREATE TYPE "core"."payee_type" AS ENUM('driver', 'contractor');
--> statement-breakpoint
CREATE TYPE "core"."payment_method" AS ENUM('ach', 'check', 'zelle', 'cash');
--> statement-breakpoint
CREATE TYPE "core"."pay_trigger" AS ENUM('payroll', 'on_collection');
--> statement-breakpoint
CREATE TYPE "core"."pay_basis" AS ENUM('per_unit', 'per_route_day', 'fixed');
--> statement-breakpoint
CREATE TABLE "core"."payees" (
	"payee_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payee_type" "core"."payee_type" NOT NULL,
	"display_name" text NOT NULL,
	"tax_id_masked" text,
	"payment_method" "core"."payment_method",
	"email" text,
	"phone_e164" text,
	"postal_address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payees_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
-- Aarisa itself: owns routes, never paid.
INSERT INTO "core"."contractors" ("contractor_name") VALUES ('Aarisa Consulting');
--> statement-breakpoint
INSERT INTO "core"."payees" ("payee_id", "payee_type", "display_name", "phone_e164", "is_active", "created_at", "updated_at")
SELECT "driver_id", 'driver', "full_name", "phone_e164", "is_active", "created_at", "updated_at" FROM "core"."drivers";
--> statement-breakpoint
INSERT INTO "core"."payees" ("payee_id", "payee_type", "display_name", "is_active", "created_at", "updated_at")
SELECT "contractor_id", 'contractor', "contractor_name", "is_active", "created_at", "updated_at" FROM "core"."contractors";
--> statement-breakpoint
ALTER TABLE "core"."drivers" ADD COLUMN "payee_id" uuid;
--> statement-breakpoint
UPDATE "core"."drivers" SET "payee_id" = "driver_id";
--> statement-breakpoint
ALTER TABLE "core"."drivers" ALTER COLUMN "payee_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."drivers" ADD COLUMN "hire_date" date;
--> statement-breakpoint
ALTER TABLE "core"."drivers" ADD COLUMN "termination_date" date;
--> statement-breakpoint
ALTER TABLE "core"."drivers" ADD CONSTRAINT "drivers_payee_id_unique" UNIQUE("payee_id");
--> statement-breakpoint
ALTER TABLE "core"."drivers" ADD CONSTRAINT "drivers_payee_id_payees_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "core"."payees"("payee_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "payee_id" uuid;
--> statement-breakpoint
UPDATE "core"."contractors" SET "payee_id" = "contractor_id";
--> statement-breakpoint
ALTER TABLE "core"."contractors" ALTER COLUMN "payee_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "legal_name" text;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "contact_name" text;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "is_own_company" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "pay_trigger" "core"."pay_trigger" DEFAULT 'payroll' NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "pay_basis" "core"."pay_basis";
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "fee_bp" integer;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "start_date" date;
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD COLUMN "end_date" date;
--> statement-breakpoint
UPDATE "core"."contractors" SET "is_own_company" = true, "legal_name" = 'Aarisa Consulting' WHERE "contractor_name" = 'Aarisa Consulting';
--> statement-breakpoint
-- Puma is the partner paid when T-Force pays (owner, Oct 18, 2026).
UPDATE "core"."contractors" SET "pay_trigger" = 'on_collection' WHERE "contractor_name" = 'Puma';
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD CONSTRAINT "contractors_payee_id_unique" UNIQUE("payee_id");
--> statement-breakpoint
ALTER TABLE "core"."contractors" ADD CONSTRAINT "contractors_payee_id_payees_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "core"."payees"("payee_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "contractors_one_own_company" ON "core"."contractors" USING btree ("is_own_company") WHERE "core"."contractors"."is_own_company";
--> statement-breakpoint
CREATE TABLE "core"."driver_aliases" (
	"driver_alias_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"alias_text" text NOT NULL,
	CONSTRAINT "driver_aliases_alias_text_unique" UNIQUE("alias_text")
);
--> statement-breakpoint
CREATE TABLE "core"."driver_client_codes" (
	"driver_client_code_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"driver_code" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "core"."driver_affiliations" (
	"driver_affiliation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "driver_affiliations_range" CHECK ("core"."driver_affiliations"."valid_to" is null or "core"."driver_affiliations"."valid_to" >= "core"."driver_affiliations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "core"."route_ownerships" (
	"route_ownership_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- History starts on Jan 1, 2026 (the first client data is June 2026).
INSERT INTO "core"."driver_aliases" ("driver_id", "alias_text")
SELECT DISTINCT ON (lower(btrim(a))) "driver_id", lower(btrim(a)) FROM "core"."drivers", unnest("aliases") AS a WHERE btrim(a) <> '' ORDER BY lower(btrim(a)), "driver_id";
--> statement-breakpoint
INSERT INTO "core"."driver_client_codes" ("driver_id", "operation_id", "driver_code", "valid_from")
SELECT d."driver_id", o."operation_id", upper(btrim(d."hovership_code")), '2026-01-01' FROM "core"."drivers" d CROSS JOIN "core"."operations" o
WHERE o."operation_code" = 'hovership' AND d."hovership_code" IS NOT NULL AND btrim(d."hovership_code") <> '';
--> statement-breakpoint
INSERT INTO "core"."driver_affiliations" ("driver_id", "contractor_id", "valid_from")
SELECT d."driver_id", coalesce(d."contractor_id", own."contractor_id"), '2026-01-01' FROM "core"."drivers" d
CROSS JOIN (SELECT "contractor_id" FROM "core"."contractors" WHERE "is_own_company") own;
--> statement-breakpoint
INSERT INTO "core"."route_ownerships" ("route_id", "contractor_id", "effective_from", "note")
SELECT r."route_id", coalesce(r."contractor_id", own."contractor_id"), '2026-01-01', 'Owner before the redesign' FROM "core"."routes" r
CROSS JOIN (SELECT "contractor_id" FROM "core"."contractors" WHERE "is_own_company") own;
--> statement-breakpoint
ALTER TABLE "core"."drivers" DROP COLUMN "full_name";
--> statement-breakpoint
ALTER TABLE "core"."drivers" DROP COLUMN "contractor_id";
--> statement-breakpoint
ALTER TABLE "core"."drivers" DROP COLUMN "hovership_code";
--> statement-breakpoint
ALTER TABLE "core"."drivers" DROP COLUMN "phone_e164";
--> statement-breakpoint
ALTER TABLE "core"."drivers" DROP COLUMN "aliases";
--> statement-breakpoint
ALTER TABLE "core"."drivers" DROP COLUMN "is_active";
--> statement-breakpoint
ALTER TABLE "core"."contractors" DROP COLUMN "contractor_name";
--> statement-breakpoint
ALTER TABLE "core"."contractors" DROP COLUMN "is_active";
--> statement-breakpoint
ALTER TABLE "core"."routes" DROP COLUMN "contractor_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "payees_active_driver_name" ON "core"."payees" USING btree ("payee_type",lower("display_name")) WHERE "core"."payees"."payee_type" = 'driver' and "core"."payees"."is_active";
--> statement-breakpoint
CREATE UNIQUE INDEX "payees_contractor_name" ON "core"."payees" USING btree (lower("display_name")) WHERE "core"."payees"."payee_type" = 'contractor';
--> statement-breakpoint
CREATE UNIQUE INDEX "driver_client_codes_op_code" ON "core"."driver_client_codes" USING btree ("operation_id","driver_code");
--> statement-breakpoint
CREATE INDEX "driver_affiliations_driver" ON "core"."driver_affiliations" USING btree ("driver_id","valid_from");
--> statement-breakpoint
CREATE UNIQUE INDEX "route_ownerships_route_from" ON "core"."route_ownerships" USING btree ("route_id","effective_from");
--> statement-breakpoint
ALTER TABLE "core"."driver_aliases" ADD CONSTRAINT "driver_aliases_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."driver_client_codes" ADD CONSTRAINT "driver_client_codes_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."driver_client_codes" ADD CONSTRAINT "driver_client_codes_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."driver_affiliations" ADD CONSTRAINT "driver_affiliations_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."driver_affiliations" ADD CONSTRAINT "driver_affiliations_contractor_id_contractors_contractor_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "core"."contractors"("contractor_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_ownerships" ADD CONSTRAINT "route_ownerships_route_id_routes_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "core"."routes"("route_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_ownerships" ADD CONSTRAINT "route_ownerships_contractor_id_contractors_contractor_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "core"."contractors"("contractor_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."route_ownerships" ADD CONSTRAINT "route_ownerships_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;
