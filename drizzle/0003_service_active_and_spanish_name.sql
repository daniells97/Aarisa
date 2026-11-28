ALTER TABLE "service_types" ADD COLUMN "name_es" text;--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN "active" boolean DEFAULT true NOT NULL;