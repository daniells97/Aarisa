-- Claims from the weekly check (Ask T-Force): what is claimed, the client's answer and, when the owner
-- decides, the later correction paid to the payee. "Pay another amount" becomes a resolution of its own.
CREATE TYPE "core"."claim_response" AS ENUM('accepted', 'partial', 'rejected');--> statement-breakpoint
ALTER TYPE "core"."resolution" ADD VALUE 'pay_other';--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "exception_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "claimed_quantity" integer;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "claimed_cents" bigint;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "claim_response" "core"."claim_response";--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "accepted_cents" bigint;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "responded_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD COLUMN "pay_adjustment_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD CONSTRAINT "claims_exception_id_exceptions_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "core"."exceptions"("exception_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD CONSTRAINT "claims_responded_by_user_id_users_user_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD CONSTRAINT "claims_pay_adjustment_id_pay_adjustments_pay_adjustment_id_fk" FOREIGN KEY ("pay_adjustment_id") REFERENCES "core"."pay_adjustments"("pay_adjustment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."claims" ADD CONSTRAINT "claims_response_amount" CHECK ("core"."claims"."claim_response" is null or "core"."claims"."accepted_cents" is not null);