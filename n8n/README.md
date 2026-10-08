# n8n workflows

n8n moves messages and files in and out and calls the AI. It never writes to the database: every
flow calls the portal's integration API (`/api/integrations/*`, see `docs/integrations.md`), which
checks the service token, applies the business rules and writes the audit log.

The JSON files in `workflows/` are generated. Edit `scripts/build-n8n.mjs` or `prompts/*.md`, then run:

```bash
pnpm n8n:build
```

`tests/unit/n8n.test.ts` checks that every connection points at a real node, that portal calls use
endpoints that exist, and that the AI output schema matches what the portal accepts.

| File | Trigger | Does |
|---|---|---|
| `report-ingest.json` | New mail in the reports mailbox | Keeps CSV attachments from known senders and sends them to `POST /imports` (same four import states as an upload) |
| `morning-list.json` | 6:30 AM PT, Monday to Saturday | `GET /morning-list`, then the `morning_list` template to every owner/dispatcher whose morning channel is WhatsApp |
| `whatsapp-inbound.json` | WhatsApp Cloud API webhook | Checks the signature, logs the message, then: **All good** confirms usual drivers; **Change a route** asks what changed; voice notes are transcribed; text goes to Claude, which says whether it is a route change or an extra job and extracts it. Route changes go to `POST /daily-changes` (only known people with confidence ≥ 0.85 are applied); extra jobs go to `POST /extra-job-drafts`, and the reply carries a **Review and save** button. Nothing becomes a job until the person taps Save |
| `reminders.json` | 7:00 PM PT daily | `GET /reminders` and the `order_number_reminder` template for jobs saved today without an order number |

The Monday 9 AM late-payments digest comes with Settlements in Phase 3.

## Setup (first time)

Nothing here has been imported into the shared n8n on the VPS. Do it when the WhatsApp number and
the portal URL exist (open questions 7, 8, 15, 16).

1. **Credentials** in n8n (names must match):
   - `Aarisa portal service token` - Header Auth, name `Authorization`, value `Bearer <N8N_SERVICE_TOKEN>` (same value as the portal's `N8N_SERVICE_TOKEN` in Infisical)
   - `WhatsApp Cloud API token` - Header Auth, name `Authorization`, value `Bearer <WHATSAPP_TOKEN>`
   - `Anthropic API key` - Header Auth, name `x-api-key`, value `<AI_API_KEY>`
   - `Aarisa reports mailbox` - IMAP, for the inbox that receives the client reports
2. **Environment variables** for n8n:
   - `AARISA_PORTAL_URL` (e.g. `https://aarisa.dimetrics.com.co`, no trailing slash)
   - `AARISA_REPORT_SENDERS`, JSON map of sender (or `@domain`) to operation, e.g. `{"reports@hovership.com":"hovership","@tforce.com":"tforce"}`
   - `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`
   - `AI_MODEL` (default `claude-opus-5-5`)
   - `STT_URL`, `STT_API_KEY`: speech-to-text endpoint that takes a `file` and returns `{ "text": "..." }`
   - `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (signature check) and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
3. **WhatsApp templates** (Meta Business Manager, category Utility), in English (`en_US`) and Spanish (`es`):
   - `morning_list`: body with `{{1}}` = date, `{{2}}` = routes ("9000A Robert Arteaga; 9000B ..."), and two quick-reply buttons: `All good`, `Change a route`. Template parameters can't contain line breaks, so routes are joined with "; ".
   - `order_number_reminder`: body with `{{1}}` = how many jobs today have no order number.
4. **Import** the four JSON files, open each credential reference once to link it, and point the Meta
   webhook (callback URL `https://<n8n>/webhook/aarisa-whatsapp`, verify token `WHATSAPP_VERIFY_TOKEN`) at it.
5. **Activate** `whatsapp-inbound` first, then `report-ingest`, `morning-list` and `reminders`.
6. In the portal, add each owner and dispatcher phone in Team access and set "Gets the morning list on" to WhatsApp.

## The AI call

`Build AI request` sends one request to the Claude Messages API: the message, today's routes, the
people (with aliases) and contractors from `GET /context`, the system prompt in
`prompts/inbound-system.md`, and a JSON schema (`workflows/ai-output.schema.json`) as structured output,
so the answer is always valid JSON. Effort is `low` (it's extraction), and the server-side fallback
(`fallbacks: "default"`) keeps a safety refusal from dropping the message. A refusal or an unreadable
answer is treated as "other": nothing is applied. The portal validates the output again with zod and
keeps the original text, model and output in `ai_suggestions`.

## Testing without WhatsApp

With the portal running and its service token:

```bash
TOKEN=...; URL=http://127.0.0.1:3100/api/integrations
curl -H "Authorization: Bearer $TOKEN" "$URL/morning-list?date=2026-06-18"
curl -H "Authorization: Bearer $TOKEN" "$URL/context?date=2026-06-18"
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"phone":"+1...","date":"2026-06-18","inputText":"All good","model":"manual","output":{"confirm_all":true,"changes":[]}}' \
  "$URL/daily-changes"
```

The phone must belong to an active owner or dispatcher in Team access.
