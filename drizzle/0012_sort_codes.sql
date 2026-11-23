-- Sort codes: the routes (zones) a driver runs each day, per contract, and which ones a driver ran on a day.
-- T-Force's 9000A is the driver's code; its sort codes are 211, 301, CVS007… Lists from Aarisa, Nov 23, 2026.
CREATE TABLE "core"."execution_sort_codes" (
	"route_execution_id" uuid NOT NULL,
	"sort_code_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_sort_codes_route_execution_id_sort_code_id_pk" PRIMARY KEY("route_execution_id","sort_code_id")
);
--> statement-breakpoint
CREATE TABLE "core"."sort_codes" (
	"sort_code_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"sort_code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."execution_sort_codes" ADD CONSTRAINT "execution_sort_codes_route_execution_id_route_executions_route_execution_id_fk" FOREIGN KEY ("route_execution_id") REFERENCES "core"."route_executions"("route_execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."execution_sort_codes" ADD CONSTRAINT "execution_sort_codes_sort_code_id_sort_codes_sort_code_id_fk" FOREIGN KEY ("sort_code_id") REFERENCES "core"."sort_codes"("sort_code_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."execution_sort_codes" ADD CONSTRAINT "execution_sort_codes_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sort_codes" ADD CONSTRAINT "sort_codes_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_sort_codes_sort_code" ON "core"."execution_sort_codes" USING btree ("sort_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sort_codes_op_code" ON "core"."sort_codes" USING btree ("operation_id","sort_code");
--> statement-breakpoint
INSERT INTO "core"."sort_codes" ("operation_id", "sort_code") SELECT o."operation_id", v.code FROM "core"."operations" o CROSS JOIN (VALUES ('211'), ('211A'), ('212'), ('213'), ('214'), ('215'), ('215A'), ('301'), ('302'), ('303'), ('304'), ('305'), ('306'), ('307'), ('CVS007'), ('CVS008'), ('Truck Route1'), ('Truck Route2')) AS v(code) WHERE o."operation_code" = 'tforce' ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "core"."sort_codes" ("operation_id", "sort_code") SELECT o."operation_id", v.code FROM "core"."operations" o CROSS JOIN (VALUES ('200'), ('202'), ('203'), ('205'), ('210'), ('212'), ('220'), ('225'), ('230'), ('232'), ('233'), ('235'), ('237'), ('240'), ('245'), ('247'), ('255'), ('270'), ('280'), ('283'), ('285'), ('287'), ('801'), ('804'), ('814'), ('820'), ('957')) AS v(code) WHERE o."operation_code" = 'hovership' ON CONFLICT DO NOTHING;
