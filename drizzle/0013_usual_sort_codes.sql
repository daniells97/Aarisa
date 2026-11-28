-- A driver code's usual routes (sort codes), suggested each day in Today's drivers. Set by the owner in Drivers and rates.
CREATE TABLE "core"."route_usual_sort_codes" (
	"route_id" uuid NOT NULL,
	"sort_code_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_usual_sort_codes_route_id_sort_code_id_pk" PRIMARY KEY("route_id","sort_code_id")
);
--> statement-breakpoint
ALTER TABLE "core"."route_usual_sort_codes" ADD CONSTRAINT "route_usual_sort_codes_route_id_routes_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "core"."routes"("route_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."route_usual_sort_codes" ADD CONSTRAINT "route_usual_sort_codes_sort_code_id_sort_codes_sort_code_id_fk" FOREIGN KEY ("sort_code_id") REFERENCES "core"."sort_codes"("sort_code_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."route_usual_sort_codes" ADD CONSTRAINT "route_usual_sort_codes_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("user_id") ON DELETE no action ON UPDATE no action;