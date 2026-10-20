CREATE TYPE "public"."ai_status" AS ENUM('pending', 'applied', 'partially_applied', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('proposed', 'confirmed', 'changed', 'waiting', 'no_driver');--> statement-breakpoint
CREATE TYPE "public"."audit_source" AS ENUM('portal', 'whatsapp', 'email-import', 'system');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'email', 'none');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('no_driver', 'unknown_name', 'no_pieces', 'low_pieces', 'unknown_driver_code', 'missing_rate', 'negative_margin');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('waiting', 'reading', 'layout_changed', 'partial', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pay_cycle" AS ENUM('weekly', 'biweekly');--> statement-breakpoint
CREATE TYPE "public"."resolution" AS ENUM('assigned_driver', 'not_ours', 'pay_as_reported', 'ask_client', 'rate_added', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'dispatcher', 'finance', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('draft', 'ready', 'approved', 'reopened', 'paid');--> statement-breakpoint
CREATE TYPE "public"."settlement_kind" AS ENUM('hovership_invoice', 'tforce_weekly', 'extra_job', 'claim_adjustment');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('open', 'paid', 'short', 'late', 'claim_ready', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('hovership_report', 'tforce_report', 'daily_list', 'extra_job', 'manual', 'whatsapp', 'system');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('t1_3', 't4');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('package', 'stop', 'piece', 'job');--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"message_id" uuid,
	"input_text" text NOT NULL,
	"model" text NOT NULL,
	"output" jsonb NOT NULL,
	"status" "ai_status" DEFAULT 'pending' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"user_id" uuid,
	"source" "audit_source" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_line_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_to" text,
	"sent_at" timestamp with time zone,
	"pdf_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "daily_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"route_id" uuid NOT NULL,
	"driver_id" uuid,
	"contractor_id" uuid,
	"raw_name" text,
	"status" "assignment_status" DEFAULT 'proposed' NOT NULL,
	"source" "source" DEFAULT 'system' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"contractor_id" uuid,
	"hovership_code" text,
	"phone" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"setup_complete" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_hovership_code_unique" UNIQUE("hovership_code")
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"date" date NOT NULL,
	"route_id" uuid,
	"type" "exception_type" NOT NULL,
	"work_record_id" uuid,
	"assignment_id" uuid,
	"details" jsonb,
	"status" "exception_status" DEFAULT 'open' NOT NULL,
	"resolution" "resolution",
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extra_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_uuid" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"service_type_id" uuid NOT NULL,
	"date" date NOT NULL,
	"near_route_id" uuid,
	"driver_id" uuid,
	"contractor_id" uuid,
	"client_amount_cents" bigint,
	"driver_amount_cents" bigint,
	"order_number" text,
	"photo_url" text,
	"note" text,
	"source" "source" NOT NULL,
	"ai_suggestion_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_jobs_client_uuid_unique" UNIQUE("client_uuid"),
	CONSTRAINT "extra_one_payee" CHECK (("extra_jobs"."driver_id" is null) <> ("extra_jobs"."contractor_id" is null))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_message_id" text,
	"direction" text NOT NULL,
	"phone" text NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"body" text,
	"media_url" text,
	"transcript" text,
	"related_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "operation_revenue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"amount_cents" bigint NOT NULL,
	"import_id" uuid
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"pay_cycle" "pay_cycle" NOT NULL,
	"cycle_anchor" date NOT NULL,
	"payment_terms_days" integer NOT NULL,
	CONSTRAINT "operations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"settlement_line_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments_received" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text,
	"reference" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"driver_id" uuid,
	"contractor_id" uuid,
	"route_days" integer NOT NULL,
	"pieces" integer NOT NULL,
	"bonus_cents" bigint NOT NULL,
	"pay_cents" bigint NOT NULL,
	"margin_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_period_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'draft' NOT NULL,
	"totals" jsonb,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"reopenable_until" timestamp with time zone,
	"export_url" text,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payroll_runs_pay_period_id_unique" UNIQUE("pay_period_id")
);
--> statement-breakpoint
CREATE TABLE "rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type_id" uuid NOT NULL,
	"tier" "tier",
	"driver_id" uuid,
	"contractor_id" uuid,
	"client_rate_cents" bigint,
	"driver_rate_cents" bigint,
	"effective_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"channel" text NOT NULL,
	"file_name" text,
	"file_sha256" text,
	"file_url" text,
	"status" "import_status" DEFAULT 'waiting' NOT NULL,
	"column_map" jsonb,
	"row_count" integer,
	"problems" jsonb,
	"received_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"contractor_id" uuid,
	"usual_driver_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" "unit" NOT NULL,
	"from_report" boolean NOT NULL,
	"requires_order_number" boolean DEFAULT false NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" "settlement_kind" NOT NULL,
	"reference" text,
	"period_start" date,
	"period_end" date,
	"extra_job_id" uuid,
	"expected_cents" bigint,
	"expected_date" date,
	"status" "settlement_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zitadel_sub" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "role" NOT NULL,
	"morning_channel" "channel" DEFAULT 'none' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_zitadel_sub_unique" UNIQUE("zitadel_sub"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "work_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"operation_id" uuid NOT NULL,
	"service_type_id" uuid NOT NULL,
	"route_id" uuid,
	"driver_id" uuid,
	"contractor_id" uuid,
	"tier" "tier",
	"pieces" integer DEFAULT 0 NOT NULL,
	"bonus_cents" bigint DEFAULT 0 NOT NULL,
	"client_rate_cents" bigint,
	"driver_rate_cents" bigint,
	"driver_pay_cents" bigint,
	"revenue_cents" bigint,
	"profit_cents" bigint,
	"source" "source" NOT NULL,
	"import_id" uuid,
	"assignment_id" uuid,
	"extra_job_id" uuid,
	"payroll_run_id" uuid,
	"settlement_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_settlement_line_id_settlement_lines_id_fk" FOREIGN KEY ("settlement_line_id") REFERENCES "public"."settlement_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_assignments" ADD CONSTRAINT "daily_assignments_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_assignments" ADD CONSTRAINT "daily_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_assignments" ADD CONSTRAINT "daily_assignments_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_assignments" ADD CONSTRAINT "daily_assignments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_work_record_id_work_records_id_fk" FOREIGN KEY ("work_record_id") REFERENCES "public"."work_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_assignment_id_daily_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."daily_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_jobs" ADD CONSTRAINT "extra_jobs_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_jobs" ADD CONSTRAINT "extra_jobs_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_jobs" ADD CONSTRAINT "extra_jobs_near_route_id_routes_id_fk" FOREIGN KEY ("near_route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_jobs" ADD CONSTRAINT "extra_jobs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_jobs" ADD CONSTRAINT "extra_jobs_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_jobs" ADD CONSTRAINT "extra_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_revenue" ADD CONSTRAINT "operation_revenue_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_revenue" ADD CONSTRAINT "operation_revenue_import_id_report_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."report_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_received_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments_received"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_settlement_line_id_settlement_lines_id_fk" FOREIGN KEY ("settlement_line_id") REFERENCES "public"."settlement_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_pay_period_id_pay_periods_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_imports" ADD CONSTRAINT "report_imports_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_imports" ADD CONSTRAINT "report_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_usual_driver_id_drivers_id_fk" FOREIGN KEY ("usual_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_extra_job_id_extra_jobs_id_fk" FOREIGN KEY ("extra_job_id") REFERENCES "public"."extra_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_import_id_report_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."report_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_assignment_id_daily_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."daily_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_extra_job_id_extra_jobs_id_fk" FOREIGN KEY ("extra_job_id") REFERENCES "public"."extra_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_record" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_day_route" ON "daily_assignments" USING btree ("date","route_id");--> statement-breakpoint
CREATE INDEX "exceptions_open" ON "exceptions" USING btree ("operation_id","period_start","status");--> statement-breakpoint
CREATE UNIQUE INDEX "period_op_start" ON "pay_periods" USING btree ("operation_id","start_date");--> statement-breakpoint
CREATE INDEX "rates_lookup" ON "rates" USING btree ("service_type_id","tier","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "import_file_once" ON "report_imports" USING btree ("operation_id","file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_op_code" ON "routes" USING btree ("operation_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "service_op_code" ON "service_types" USING btree ("operation_id","code");--> statement-breakpoint
CREATE INDEX "work_op_date" ON "work_records" USING btree ("operation_id","date");--> statement-breakpoint
CREATE INDEX "work_driver_date" ON "work_records" USING btree ("driver_id","date");