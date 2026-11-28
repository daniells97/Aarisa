-- Stage 6a of the database redesign (docs/db-model.md §2.2): clients and their contacts, and the rules of each
-- contract (where the driver comes from, whether open exceptions block payroll, the low-pieces threshold,
-- dates) move from code to the operations table. Each existing operation gets a client of the same name,
-- and today's behaviour: Hovership names drivers in its report, T-Force through Aarisa's daily list.
CREATE TYPE "core"."driver_source" AS ENUM('report_code', 'daily_list');
--> statement-breakpoint
CREATE TYPE "core"."contact_role" AS ENUM('billing', 'claims', 'operations', 'other');
--> statement-breakpoint
CREATE TABLE "core"."clients" (
	"client_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_code" text NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"billing_address" text,
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_client_code_unique" UNIQUE("client_code")
);
--> statement-breakpoint
CREATE TABLE "core"."client_contacts" (
	"client_contact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_role" "core"."contact_role" NOT NULL,
	"full_name" text,
	"email" text,
	"phone_e164" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_reachable" CHECK ("core"."client_contacts"."email" is not null or "core"."client_contacts"."phone_e164" is not null)
);
--> statement-breakpoint
ALTER TABLE "core"."client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("client_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "client_contacts_primary" ON "core"."client_contacts" USING btree ("client_id","contact_role") WHERE "core"."client_contacts"."is_primary" and "core"."client_contacts"."is_active";
--> statement-breakpoint
INSERT INTO "core"."clients" ("client_code", "display_name") SELECT "operation_code", "operation_name" FROM "core"."operations";
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "client_id" uuid;
--> statement-breakpoint
UPDATE "core"."operations" o SET "client_id" = c."client_id" FROM "core"."clients" c WHERE c."client_code" = o."operation_code";
--> statement-breakpoint
ALTER TABLE "core"."operations" ALTER COLUMN "client_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "driver_source" "core"."driver_source";
--> statement-breakpoint
UPDATE "core"."operations" SET "driver_source" = CASE WHEN "operation_code" = 'tforce' THEN 'daily_list' ELSE 'report_code' END::"core"."driver_source";
--> statement-breakpoint
ALTER TABLE "core"."operations" ALTER COLUMN "driver_source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "blocks_payroll_on_exceptions" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "low_quantity_threshold_bp" integer DEFAULT 1000 NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "start_date" date;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "end_date" date;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD CONSTRAINT "operations_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("client_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."operations" ADD CONSTRAINT "operations_threshold" CHECK ("core"."operations"."low_quantity_threshold_bp" between 0 and 10000);
