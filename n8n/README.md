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
| `morning-list.json` | 6:30 AM PT, Monday to Saturday | `GET /morning-list`, then the `morning_summary` template to every owner/dispatcher whose morning channel is WhatsApp: how many routes, which have no driver and who has two routes; the full list is one tap away in Today's drivers |
| `whatsapp-inbound.json` | WhatsApp Cloud API webhook | Checks the signature, logs the message, then: **All good** confirms usual drivers; **Change a route** asks what changed; voice notes are transcribed; text goes to Claude, which says whether it is a route change or an extra job and extracts it. Route changes go to `POST /daily-changes` (only known people with confidence ≥ 0.85 are applied); extra jobs go to `POST /extra-job-drafts`, and the reply carries a **Review and save** button. Nothing becomes a job until the person taps Save |
| `reminders.json` | 7:00 PM PT daily | `GET /reminders` and the `order_number_reminder` template for jobs saved today without an order number |

The Monday 9 AM late-payments digest comes with Settlements in Phase 3.

## Setup (first time)

Aarisa runs its own n8n (`aarisa-n8n` in `/docker/aarisa/docker-compose.yml`), not the shared ones:
the flows need `crypto` and `$env` in Code nodes, which the shared instances don't allow and can't be
restarted for. It reaches the portal over the `app` network (`http://aarisa-portal:3000`) and is
published at `https://n8n-aarisa.srv1986534.hstgr.cloud` only after the owner account exists.

1. **Secrets** in `/docker/aarisa/n8n.env` (mode 600; `N8N_SERVICE_TOKEN` is also in the portal's `.env`):
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN` (permanent system-user token),
   `AI_API_KEY`, and optionally `STT_URL` / `STT_API_KEY` and `AARISA_REPORT_SENDERS`
   (JSON map of sender or `@domain` to contract code). `WHATSAPP_VERIFY_TOKEN` and the encryption key are generated.
   Then `cd /docker/aarisa && docker compose up -d n8n`.
2. **Owner account**: create it from inside the container before publishing the editor
   (`POST http://127.0.0.1:5678/rest/owner/setup`), then set the n8n `traefik.enable` label to `"true"` and `docker compose up -d n8n`.
3. **Credentials and workflows**: `scripts/n8n-setup.sh` loads the header credentials from `n8n.env`
   and imports the four workflows with fixed ids (re-runnable). The IMAP credential
   `Aarisa reports mailbox` is added in the editor when the mailbox exists.
4. **WhatsApp templates** (Meta Business Manager, category Utility), in English (`en_US`) and Spanish (`es`):
   - `morning_summary` (Spanish `es`):
     `Buenos días. Rutas para {{1}}: {{2}} rutas. Sin conductor: {{3}}. Con dos rutas: {{4}}. ¿Confirmas?`
     English (`en_US`): `Good morning. Routes for {{1}}: {{2}} routes. No driver: {{3}}. Two routes: {{4}}. All good?`
     `{{1}}` = day ("martes, 20 de octubre"), `{{2}}` = route count, `{{3}}` = routes with no driver or "ninguna",
     `{{4}}` = drivers on two routes, e.g. "Nayibi Perez (9000D, 9000E)", or "ninguno". Buttons, in this order:
     quick reply `Todo bien` / `All good`, quick reply `Cambiar una ruta` / `Change a route`, and a URL button
     `Ver lista` / `See list` to `https://aarisa.dimetrics.com.co/tforce/today`. The message names only what needs a look,
     because a list of 19+ routes on one line (parameters can't hold line breaks) is unreadable on a phone.
   - `order_number_reminder`: body with `{{1}}` = how many jobs today have no order number.
5. **Meta webhook**: callback URL `https://n8n-aarisa.srv1986534.hstgr.cloud/webhook/aarisa-whatsapp`,
   verify token `WHATSAPP_VERIFY_TOKEN`, subscribed to `messages`.
6. **Publish** `whatsapp-inbound` first, then `morning-list` and `reminders`; `report-ingest` once the mailbox is set.
7. In the portal, add each owner and dispatcher phone in Team access and set "Gets the morning list on" to WhatsApp.

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
