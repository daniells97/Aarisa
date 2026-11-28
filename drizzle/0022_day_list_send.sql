CREATE TABLE "core"."day_list_sends" (
	"day_list_send_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"sent_by" uuid,
	"recipients" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."users" ADD COLUMN "receives_day_list" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."day_list_sends" ADD CONSTRAINT "day_list_sends_operation_id_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."operations"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."day_list_sends" ADD CONSTRAINT "day_list_sends_sent_by_users_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;