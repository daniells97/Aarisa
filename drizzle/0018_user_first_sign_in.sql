-- Invited people show in Team access before their first sign-in (client request, Nov 24 2026).
-- Everyone already in the table got there by signing in, so they count as signed in.
ALTER TABLE "core"."users" ADD COLUMN "first_sign_in_at" timestamp with time zone;--> statement-breakpoint
UPDATE "core"."users" SET "first_sign_in_at" = "created_at" WHERE "first_sign_in_at" IS NULL;
