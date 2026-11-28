-- Loans and salary advances to drivers (repaid by deductions the owner picks in each payroll) and notes on a driver.
CREATE TYPE "core"."loan_kind" AS ENUM('loan', 'advance');--> statement-breakpoint
CREATE TABLE "core"."driver_loans" (
	"driver_loan_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"loan_kind" "core"."loan_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"given_on" date NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_loans_amount" CHECK ("core"."driver_loans"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."driver_notes" (
	"driver_note_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD COLUMN "driver_loan_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."driver_loans" ADD CONSTRAINT "driver_loans_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."driver_loans" ADD CONSTRAINT "driver_loans_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."driver_notes" ADD CONSTRAINT "driver_notes_driver_id_drivers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "core"."drivers"("driver_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."driver_notes" ADD CONSTRAINT "driver_notes_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."driver_notes" ADD CONSTRAINT "driver_notes_resolved_by_user_id_users_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_loans_driver" ON "core"."driver_loans" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_notes_driver" ON "core"."driver_notes" USING btree ("driver_id");--> statement-breakpoint
ALTER TABLE "core"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_driver_loan_id_driver_loans_driver_loan_id_fk" FOREIGN KEY ("driver_loan_id") REFERENCES "core"."driver_loans"("driver_loan_id") ON DELETE no action ON UPDATE no action;