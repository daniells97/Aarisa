-- Stage 1 of the database redesign (docs/db-model.md): move every table and enum to the `core`
-- schema and rename columns to the naming convention. Data is untouched.
CREATE SCHEMA IF NOT EXISTS core;
--> statement-breakpoint
ALTER TYPE public."ai_status" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."assignment_status" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."audit_source" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."channel" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."exception_status" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."exception_type" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."import_status" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."pay_cycle" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."resolution" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."role" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."run_status" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."settlement_kind" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."settlement_status" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."source" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."tier" SET SCHEMA core;
--> statement-breakpoint
ALTER TYPE public."unit" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."ai_suggestions" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."audit_log" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."claims" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."contractors" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."daily_assignments" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."drivers" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."exceptions" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."extra_jobs" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."messages" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."operation_revenue" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."operations" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."pay_periods" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."payment_allocations" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."payments_received" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."payroll_lines" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."payroll_runs" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."rates" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."report_imports" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."routes" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."service_types" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."settlement_lines" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."users" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE public."work_records" SET SCHEMA core;
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME COLUMN "id" TO "ai_suggestion_id";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME COLUMN "kind" TO "suggestion_kind";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME COLUMN "model" TO "model_name";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME COLUMN "output" TO "output_data";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME COLUMN "status" TO "suggestion_status";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME COLUMN "confirmed_by" TO "confirmed_by_user_id";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME CONSTRAINT "ai_suggestions_message_id_messages_id_fk" TO "ai_suggestions_message_id_messages_message_id_fk";
--> statement-breakpoint
ALTER TABLE core."ai_suggestions" RENAME CONSTRAINT "ai_suggestions_confirmed_by_users_id_fk" TO "ai_suggestions_confirmed_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME COLUMN "id" TO "audit_log_id";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME COLUMN "action" TO "audit_action";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME COLUMN "before" TO "before_data";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME COLUMN "after" TO "after_data";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME COLUMN "source" TO "audit_source";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME COLUMN "at" TO "occurred_at";
--> statement-breakpoint
ALTER TABLE core."audit_log" RENAME CONSTRAINT "audit_log_user_id_users_id_fk" TO "audit_log_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."claims" RENAME COLUMN "id" TO "claim_id";
--> statement-breakpoint
ALTER TABLE core."claims" RENAME COLUMN "status" TO "claim_status";
--> statement-breakpoint
ALTER TABLE core."claims" RENAME COLUMN "created_by" TO "created_by_user_id";
--> statement-breakpoint
ALTER TABLE core."claims" RENAME CONSTRAINT "claims_settlement_line_id_settlement_lines_id_fk" TO "claims_settlement_line_id_settlement_lines_settlement_line_id_f";
--> statement-breakpoint
ALTER TABLE core."claims" RENAME CONSTRAINT "claims_created_by_users_id_fk" TO "claims_created_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."contractors" RENAME COLUMN "id" TO "contractor_id";
--> statement-breakpoint
ALTER TABLE core."contractors" RENAME COLUMN "name" TO "contractor_name";
--> statement-breakpoint
ALTER TABLE core."contractors" RENAME COLUMN "active" TO "is_active";
--> statement-breakpoint
ALTER TABLE core."contractors" RENAME CONSTRAINT "contractors_name_unique" TO "contractors_contractor_name_unique";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME COLUMN "id" TO "daily_assignment_id";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME COLUMN "date" TO "work_date";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME COLUMN "status" TO "assignment_status";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME COLUMN "source" TO "assignment_source";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME COLUMN "confirmed_by" TO "confirmed_by_user_id";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME CONSTRAINT "daily_assignments_route_id_routes_id_fk" TO "daily_assignments_route_id_routes_route_id_fk";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME CONSTRAINT "daily_assignments_driver_id_drivers_id_fk" TO "daily_assignments_driver_id_drivers_driver_id_fk";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME CONSTRAINT "daily_assignments_contractor_id_contractors_id_fk" TO "daily_assignments_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."daily_assignments" RENAME CONSTRAINT "daily_assignments_confirmed_by_users_id_fk" TO "daily_assignments_confirmed_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."drivers" RENAME COLUMN "id" TO "driver_id";
--> statement-breakpoint
ALTER TABLE core."drivers" RENAME COLUMN "phone" TO "phone_e164";
--> statement-breakpoint
ALTER TABLE core."drivers" RENAME COLUMN "setup_complete" TO "is_setup_complete";
--> statement-breakpoint
ALTER TABLE core."drivers" RENAME COLUMN "active" TO "is_active";
--> statement-breakpoint
ALTER TABLE core."drivers" RENAME CONSTRAINT "drivers_contractor_id_contractors_id_fk" TO "drivers_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "id" TO "exception_id";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "period_start" TO "period_start_date";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "date" TO "work_date";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "type" TO "exception_type";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "assignment_id" TO "daily_assignment_id";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "status" TO "exception_status";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME COLUMN "resolved_by" TO "resolved_by_user_id";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME CONSTRAINT "exceptions_operation_id_operations_id_fk" TO "exceptions_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME CONSTRAINT "exceptions_route_id_routes_id_fk" TO "exceptions_route_id_routes_route_id_fk";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME CONSTRAINT "exceptions_work_record_id_work_records_id_fk" TO "exceptions_work_record_id_work_records_work_record_id_fk";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME CONSTRAINT "exceptions_assignment_id_daily_assignments_id_fk" TO "exceptions_daily_assignment_id_daily_assignments_daily_assignme";
--> statement-breakpoint
ALTER TABLE core."exceptions" RENAME CONSTRAINT "exceptions_resolved_by_users_id_fk" TO "exceptions_resolved_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME COLUMN "id" TO "extra_job_id";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME COLUMN "date" TO "work_date";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME COLUMN "driver_amount_cents" TO "payee_amount_cents";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME COLUMN "source" TO "job_source";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME COLUMN "created_by" TO "created_by_user_id";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME CONSTRAINT "extra_jobs_operation_id_operations_id_fk" TO "extra_jobs_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME CONSTRAINT "extra_jobs_service_type_id_service_types_id_fk" TO "extra_jobs_service_type_id_service_types_service_type_id_fk";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME CONSTRAINT "extra_jobs_near_route_id_routes_id_fk" TO "extra_jobs_near_route_id_routes_route_id_fk";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME CONSTRAINT "extra_jobs_driver_id_drivers_id_fk" TO "extra_jobs_driver_id_drivers_driver_id_fk";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME CONSTRAINT "extra_jobs_contractor_id_contractors_id_fk" TO "extra_jobs_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."extra_jobs" RENAME CONSTRAINT "extra_jobs_created_by_users_id_fk" TO "extra_jobs_created_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."messages" RENAME COLUMN "id" TO "message_id";
--> statement-breakpoint
ALTER TABLE core."messages" RENAME COLUMN "direction" TO "message_direction";
--> statement-breakpoint
ALTER TABLE core."messages" RENAME COLUMN "phone" TO "phone_e164";
--> statement-breakpoint
ALTER TABLE core."messages" RENAME COLUMN "type" TO "message_type";
--> statement-breakpoint
ALTER TABLE core."messages" RENAME CONSTRAINT "messages_user_id_users_id_fk" TO "messages_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME COLUMN "id" TO "operation_revenue_id";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME COLUMN "date" TO "revenue_date";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME COLUMN "kind" TO "revenue_kind";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME COLUMN "reason" TO "reason_text";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME COLUMN "import_id" TO "report_import_id";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME CONSTRAINT "operation_revenue_operation_id_operations_id_fk" TO "operation_revenue_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."operation_revenue" RENAME CONSTRAINT "operation_revenue_import_id_report_imports_id_fk" TO "operation_revenue_report_import_id_report_imports_report_import";
--> statement-breakpoint
ALTER TABLE core."operations" RENAME COLUMN "id" TO "operation_id";
--> statement-breakpoint
ALTER TABLE core."operations" RENAME COLUMN "code" TO "operation_code";
--> statement-breakpoint
ALTER TABLE core."operations" RENAME COLUMN "name" TO "operation_name";
--> statement-breakpoint
ALTER TABLE core."operations" RENAME COLUMN "cycle_anchor" TO "cycle_anchor_date";
--> statement-breakpoint
ALTER TABLE core."operations" RENAME CONSTRAINT "operations_code_unique" TO "operations_operation_code_unique";
--> statement-breakpoint
ALTER TABLE core."pay_periods" RENAME COLUMN "id" TO "pay_period_id";
--> statement-breakpoint
ALTER TABLE core."pay_periods" RENAME CONSTRAINT "pay_periods_operation_id_operations_id_fk" TO "pay_periods_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."payment_allocations" RENAME COLUMN "id" TO "payment_allocation_id";
--> statement-breakpoint
ALTER TABLE core."payment_allocations" RENAME COLUMN "payment_id" TO "payment_received_id";
--> statement-breakpoint
ALTER TABLE core."payment_allocations" RENAME CONSTRAINT "payment_allocations_payment_id_payments_received_id_fk" TO "payment_allocations_payment_received_id_payments_received_payme";
--> statement-breakpoint
ALTER TABLE core."payment_allocations" RENAME CONSTRAINT "payment_allocations_settlement_line_id_settlement_lines_id_fk" TO "payment_allocations_settlement_line_id_settlement_lines_settlem";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME COLUMN "id" TO "payment_received_id";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME COLUMN "received_on" TO "received_date";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME COLUMN "method" TO "payment_method";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME COLUMN "reference" TO "bank_reference";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME COLUMN "created_by" TO "created_by_user_id";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME CONSTRAINT "payments_received_operation_id_operations_id_fk" TO "payments_received_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."payments_received" RENAME CONSTRAINT "payments_received_created_by_users_id_fk" TO "payments_received_created_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME COLUMN "id" TO "payroll_line_id";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME COLUMN "run_id" TO "payroll_run_id";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME COLUMN "route_days" TO "route_day_count";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME COLUMN "extra_jobs" TO "extra_job_count";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME COLUMN "pieces" TO "quantity_total";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME COLUMN "stops" TO "stop_count";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" TO "payroll_lines_payroll_run_id_payroll_runs_payroll_run_id_fk";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME CONSTRAINT "payroll_lines_driver_id_drivers_id_fk" TO "payroll_lines_driver_id_drivers_driver_id_fk";
--> statement-breakpoint
ALTER TABLE core."payroll_lines" RENAME CONSTRAINT "payroll_lines_contractor_id_contractors_id_fk" TO "payroll_lines_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."payroll_runs" RENAME COLUMN "id" TO "payroll_run_id";
--> statement-breakpoint
ALTER TABLE core."payroll_runs" RENAME COLUMN "status" TO "run_status";
--> statement-breakpoint
ALTER TABLE core."payroll_runs" RENAME COLUMN "approved_by" TO "approved_by_user_id";
--> statement-breakpoint
ALTER TABLE core."payroll_runs" RENAME CONSTRAINT "payroll_runs_pay_period_id_pay_periods_id_fk" TO "payroll_runs_pay_period_id_pay_periods_pay_period_id_fk";
--> statement-breakpoint
ALTER TABLE core."payroll_runs" RENAME CONSTRAINT "payroll_runs_approved_by_users_id_fk" TO "payroll_runs_approved_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME COLUMN "id" TO "rate_id";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME COLUMN "driver_rate_cents" TO "payee_rate_cents";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME COLUMN "created_by" TO "created_by_user_id";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME CONSTRAINT "rates_service_type_id_service_types_id_fk" TO "rates_service_type_id_service_types_service_type_id_fk";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME CONSTRAINT "rates_driver_id_drivers_id_fk" TO "rates_driver_id_drivers_driver_id_fk";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME CONSTRAINT "rates_contractor_id_contractors_id_fk" TO "rates_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."rates" RENAME CONSTRAINT "rates_created_by_users_id_fk" TO "rates_created_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME COLUMN "id" TO "report_import_id";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME COLUMN "period_start" TO "period_start_date";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME COLUMN "period_end" TO "period_end_date";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME COLUMN "channel" TO "import_channel";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME COLUMN "status" TO "import_status";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME COLUMN "created_by" TO "created_by_user_id";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME CONSTRAINT "report_imports_operation_id_operations_id_fk" TO "report_imports_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."report_imports" RENAME CONSTRAINT "report_imports_created_by_users_id_fk" TO "report_imports_created_by_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE core."routes" RENAME COLUMN "id" TO "route_id";
--> statement-breakpoint
ALTER TABLE core."routes" RENAME COLUMN "code" TO "route_code";
--> statement-breakpoint
ALTER TABLE core."routes" RENAME COLUMN "active" TO "is_active";
--> statement-breakpoint
ALTER TABLE core."routes" RENAME CONSTRAINT "routes_operation_id_operations_id_fk" TO "routes_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."routes" RENAME CONSTRAINT "routes_contractor_id_contractors_id_fk" TO "routes_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."routes" RENAME CONSTRAINT "routes_usual_driver_id_drivers_id_fk" TO "routes_usual_driver_id_drivers_driver_id_fk";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "id" TO "service_type_id";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "code" TO "service_code";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "name" TO "service_name";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "unit" TO "unit_type";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "from_report" TO "is_from_report";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "name_es" TO "service_name_es";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME COLUMN "active" TO "is_active";
--> statement-breakpoint
ALTER TABLE core."service_types" RENAME CONSTRAINT "service_types_operation_id_operations_id_fk" TO "service_types_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME COLUMN "id" TO "settlement_line_id";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME COLUMN "kind" TO "settlement_kind";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME COLUMN "period_start" TO "period_start_date";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME COLUMN "period_end" TO "period_end_date";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME COLUMN "status" TO "settlement_status";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME CONSTRAINT "settlement_lines_operation_id_operations_id_fk" TO "settlement_lines_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."settlement_lines" RENAME CONSTRAINT "settlement_lines_extra_job_id_extra_jobs_id_fk" TO "settlement_lines_extra_job_id_extra_jobs_extra_job_id_fk";
--> statement-breakpoint
ALTER TABLE core."users" RENAME COLUMN "id" TO "user_id";
--> statement-breakpoint
ALTER TABLE core."users" RENAME COLUMN "name" TO "full_name";
--> statement-breakpoint
ALTER TABLE core."users" RENAME COLUMN "phone" TO "phone_e164";
--> statement-breakpoint
ALTER TABLE core."users" RENAME COLUMN "role" TO "user_role";
--> statement-breakpoint
ALTER TABLE core."users" RENAME COLUMN "active" TO "is_active";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "id" TO "work_record_id";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "date" TO "work_date";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "pieces" TO "quantity";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "driver_rate_cents" TO "payee_rate_cents";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "driver_pay_cents" TO "pay_cents";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "source" TO "record_source";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "import_id" TO "report_import_id";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME COLUMN "assignment_id" TO "daily_assignment_id";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_operation_id_operations_id_fk" TO "work_records_operation_id_operations_operation_id_fk";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_service_type_id_service_types_id_fk" TO "work_records_service_type_id_service_types_service_type_id_fk";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_route_id_routes_id_fk" TO "work_records_route_id_routes_route_id_fk";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_driver_id_drivers_id_fk" TO "work_records_driver_id_drivers_driver_id_fk";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_contractor_id_contractors_id_fk" TO "work_records_contractor_id_contractors_contractor_id_fk";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_import_id_report_imports_id_fk" TO "work_records_report_import_id_report_imports_report_import_id_f";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_assignment_id_daily_assignments_id_fk" TO "work_records_daily_assignment_id_daily_assignments_daily_assign";
--> statement-breakpoint
ALTER TABLE core."work_records" RENAME CONSTRAINT "work_records_extra_job_id_extra_jobs_id_fk" TO "work_records_extra_job_id_extra_jobs_extra_job_id_fk";
