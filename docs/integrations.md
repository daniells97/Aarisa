# Integrations

The portal owns the data and the rules. n8n moves messages and files in and out and calls
the AI. n8n never writes to the database directly: it calls the portal's integration API.

Time zone for everything operational: **America/Los_Angeles** (Aarisa is in the Bay Area).

## Integration API (portal side)

Authenticated with a service token stored in Infisical (`N8N_SERVICE_TOKEN`), sent as
`Authorization: Bearer …`. Every call is idempotent on its natural key and audited with
`source = whatsapp | email-import`.

| Method and path | Used by | Does |
|---|---|---|
| `POST /api/integrations/imports` | report ingest | Receives a file + operation; starts the import (§6.12 states) |
| `GET /api/integrations/morning-list?date=` | morning list | Routes with proposed drivers for that date |
| `POST /api/integrations/daily-changes` | WhatsApp inbound | Applies AI-parsed changes; returns applied and unresolved items |
| `POST /api/integrations/extra-job-drafts` | WhatsApp inbound | Stores an AI draft; returns a short-lived signed link to the pre-filled form |
| `POST /api/integrations/messages` | all flows | Logs inbound and outbound WhatsApp messages |

## n8n flows

### 1. Report ingest
Mailbox trigger (inbox to confirm) → keep attachments from known senders → detect operation
by sender and file shape → `POST /imports`. If nothing arrives by Monday 12:00 PT for
Hovership or Tuesday 12:00 PT for T-Force, the portal shows the waiting state and notifies.

### 2. Morning list
Cron 6:30 AM PT, Monday to Saturday → `GET /morning-list` → for each user with
`morning_channel = whatsapp` and the dispatch role, send the approved **utility template**
with two quick replies: `All good`, `Change a route`.

### 3. WhatsApp inbound
Webhook from WhatsApp Cloud API (verify token + signature) → log message → route by type:

- Quick reply `All good` → confirm all proposed assignments for that date.
- Quick reply `Change a route` or free text about routes → AI `daily_changes` → `POST /daily-changes`
  → reply with what was applied and a question for each unresolved name.
- Text or audio about a job (call, pickup, recovery, Grainger, "extra") → audio to
  speech-to-text → AI `extra_job` → `POST /extra-job-drafts` → reply with the summary and a
  `Review and save` button linking to the pre-filled form.
- Anything else → short help reply listing what the number can do.

Free-form replies are allowed inside the 24-hour window that opens when the user writes.
Interactive messages allow at most 3 reply buttons, so every bot message offers 3 choices or fewer.

### 4. Reminders
- 7:00 PM PT: extra jobs saved today without an order number → message the person who saved them.
- Monday 9:00 AM PT: late settlement lines digest to Finance and Owner (email).

## AI tasks

Both return strict JSON validated with zod on the portal side. Invalid output is treated as
"needs you", never applied.

**daily_changes** input: the message text, the date, the list of routes and known driver names
and aliases. Output:
```json
{ "changes": [ { "route": "9000E", "driver_name": "Norwin Saloman", "matched_driver_id": "uuid", "confidence": 0.94 },
               { "route": "9000Z", "driver_name": "the new guy from Puma", "matched_driver_id": null, "contractor_hint": "Puma" } ] }
```
Apply only matches with a known id and confidence ≥ 0.85; ask about the rest.

**extra_job** input: transcript or text, today's date, routes, drivers, contractors, service
list. Output: service code, date, near route, payee, client amount, driver amount, order number,
plus a list of missing fields. Amounts are never guessed; missing stays null.

Model and provider are configuration (`AI_MODEL`, `AI_API_KEY` in Infisical). Speech-to-text
provider: to choose (open question).

## WhatsApp setup checklist (Aarisa)
1. Meta Business account verified for Aarisa.
2. A dedicated phone number on WhatsApp Business Platform (Cloud API).
3. Templates approved: `morning_list` (utility), `order_number_reminder` (utility).
4. Webhook URL pointing to n8n, token and app secret stored in Infisical.
5. Users' phone numbers stored in Team access, so inbound messages map to a person and role.
