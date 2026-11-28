-- Hovership extra jobs get the "Other" service too (client request, Nov 24 2026), like T-Force:
-- free text, so the note is required. Amounts are agreed per job, no rate needed.
INSERT INTO "core"."service_types" ("operation_id", "service_code", "service_name", "service_name_es", "unit_type", "is_from_report", "requires_note")
SELECT "operation_id", 'other', 'Other', 'Otro', 'job', false, true FROM "core"."operations" WHERE "operation_code" = 'hovership'
ON CONFLICT ("operation_id", "service_code") DO NOTHING;
