// Builds the n8n workflow files in n8n/workflows from small node definitions and the prompts in
// n8n/prompts. Run `pnpm n8n:build` after editing; import the JSON files into n8n (see n8n/README.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORTAL = '={{ $env.AARISA_PORTAL_URL }}/api/integrations';
const PORTAL_AUTH = { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' };
const PORTAL_CRED = { httpHeaderAuth: { id: '', name: 'Aarisa portal service token' } };
const WA_CRED = { httpHeaderAuth: { id: '', name: 'WhatsApp Cloud API token' } };
const AI_CRED = { httpHeaderAuth: { id: '', name: 'Anthropic API key' } };
const WA_URL = '=https://graph.facebook.com/v21.0/{{ $env.WHATSAPP_PHONE_NUMBER_ID }}/messages';
const TZ = 'America/Los_Angeles';
const todayLA = `new Intl.DateTimeFormat('en-CA', { timeZone: '${TZ}', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())`;

let x = 0;
const node = (name, type, typeVersion, parameters, extra = {}) => ({ id: `${name.toLowerCase().replace(/\W+/g, '-')}`, name, type, typeVersion, position: [(x += 260), 300], parameters, ...extra });
const code = (name, jsCode) => node(name, 'n8n-nodes-base.code', 2, { jsCode });
const portal = (name, method, path, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, {
  method, url: `${PORTAL}${path}`, ...PORTAL_AUTH, options: { response: { response: { neverError: true } } }, ...extra,
}, { credentials: PORTAL_CRED });
const jsonBody = (expr) => ({ sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${expr}) }}` });
const whatsapp = (name, bodyExpr) => node(name, 'n8n-nodes-base.httpRequest', 4.2, {
  method: 'POST', url: WA_URL, ...PORTAL_AUTH, ...jsonBody(bodyExpr), options: {},
}, { credentials: WA_CRED });
const schedule = (name, cron) => node(name, 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'cronExpression', expression: cron }] } });
const switchOn = (name, field, keys) => node(name, 'n8n-nodes-base.switch', 3, {
  mode: 'rules',
  rules: { values: keys.map((k) => ({
    conditions: { options: { caseSensitive: true, typeValidation: 'strict' }, combinator: 'and',
      conditions: [{ leftValue: `={{ $json.${field} }}`, rightValue: k, operator: { type: 'string', operation: 'equals' } }] },
    renameOutput: true, outputKey: k,
  })) },
  options: {},
});
const chain = (...names) => Object.fromEntries(names.slice(0, -1).map((n, i) => [n, { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }]));
const workflow = (name, nodes, connections) => ({ name, nodes, connections, settings: { timezone: TZ, executionOrder: 'v1' }, active: false, meta: { builtBy: 'scripts/build-n8n.mjs' } });

// ---------------------------------------------------------------- 1. report ingest
x = 0;
const ingest = workflow('Aarisa - report ingest', [
  node('Mailbox', 'n8n-nodes-base.emailReadImap', 2, { format: 'resolved', options: { customEmailConfig: '["UNSEEN"]' } }, { credentials: { imap: { id: '', name: 'Aarisa reports mailbox' } } }),
  code('Pick report attachments', `// Keep CSV attachments from known senders (open question 7) and tell which client sent them.
const senders = JSON.parse($env.AARISA_REPORT_SENDERS || '{}'); // {"reports@hovership.example": "hovership", "@tforce.example": "tforce"}
const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const from = String(item.json.from?.value?.[0]?.address || item.json.from || '').toLowerCase();
  const match = Object.entries(senders).find(([k]) => from === k || from.endsWith(k));
  if (!match) continue;
  for (const [key, bin] of Object.entries(item.binary || {})) {
    if (!/\\.csv$/i.test(bin.fileName || '')) continue;
    const buffer = await this.helpers.getBinaryDataBuffer(i, key);
    out.push({ json: { operation: match[1], fileName: bin.fileName, text: buffer.toString('utf8') } });
  }
}
return out;`),
  portal('Send to portal', 'POST', '/imports', jsonBody('{ operation: $json.operation, fileName: $json.fileName, text: $json.text }')),
], chain('Mailbox', 'Pick report attachments', 'Send to portal'));

// ---------------------------------------------------------------- 2. morning list
x = 0;
const morning = workflow('Aarisa - morning list', [
  schedule('6:30 AM Monday to Saturday', '30 6 * * 1-6'),
  portal('Get morning list', 'GET', '/morning-list', { sendQuery: true, queryParameters: { parameters: [{ name: 'date', value: `={{ ${todayLA} }}` }] } }),
  code('One message per recipient', `// WhatsApp template parameters can't contain line breaks, so routes are joined with "; ".
const list = $input.first().json;
const routes = list.routes.map((r) => r.route + ' ' + (r.driver ?? '?')).join('; ');
return list.recipients.map((p) => ({ json: { to: p.phone.replace(/^\\+/, ''), phone: p.phone, lang: p.locale === 'es' ? 'es' : 'en_US', date: list.date, routes } }));`),
  whatsapp('Send morning template', `{ messaging_product: 'whatsapp', to: $json.to, type: 'template', template: { name: 'morning_list', language: { code: $json.lang },
    components: [{ type: 'body', parameters: [{ type: 'text', text: $json.date }, { type: 'text', text: $json.routes }] }] } }`),
  portal('Log sent message', 'POST', '/messages', jsonBody(`{ direction: 'out', phone: $('One message per recipient').item.json.phone, type: 'template', body: 'morning_list ' + $('One message per recipient').item.json.date,
    waMessageId: $json.messages?.[0]?.id ?? null, relatedDate: $('One message per recipient').item.json.date }`)),
], chain('6:30 AM Monday to Saturday', 'Get morning list', 'One message per recipient', 'Send morning template', 'Log sent message'));

// ---------------------------------------------------------------- 3. WhatsApp inbound
x = 0;
const system = readFileSync(new URL('../n8n/prompts/inbound-system.md', import.meta.url), 'utf8').trim();
const nullable = (t) => ({ type: [t, 'null'] });
const outputSchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'daily_changes', 'extra_job'],
  properties: {
    kind: { type: 'string', enum: ['daily_changes', 'extra_job', 'other'] },
    daily_changes: { anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['confirm_all', 'changes'],
      properties: {
        confirm_all: { type: 'boolean' },
        changes: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['route', 'driver_name', 'matched_driver_id', 'matched_contractor_id', 'confidence'],
          properties: { route: { type: 'string' }, driver_name: nullable('string'), matched_driver_id: nullable('string'), matched_contractor_id: nullable('string'), contractor_hint: nullable('string'), confidence: { type: 'number' } } } },
      },
    }] },
    extra_job: { anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false,
      required: ['service', 'date', 'near_route', 'driver_id', 'contractor_id', 'payee_name', 'client_amount', 'driver_amount', 'order_number', 'note', 'missing'],
      properties: {
        service: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['recovery_route', 'pickup', 'grainger', 'other'] }] },
        date: nullable('string'), near_route: nullable('string'), driver_id: nullable('string'), contractor_id: nullable('string'), payee_name: nullable('string'),
        client_amount: nullable('number'), driver_amount: nullable('number'), order_number: nullable('string'), note: nullable('string'),
        missing: { type: 'array', items: { type: 'string' } },
      },
    }] },
  },
};
const inbound = workflow('Aarisa - WhatsApp inbound', [
  node('Webhook verify (GET)', 'n8n-nodes-base.webhook', 2, { httpMethod: 'GET', path: 'aarisa-whatsapp', responseMode: 'responseNode', options: {} }),
  code('Check verify token', `const q = $input.first().json.query || {};
const ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === $env.WHATSAPP_VERIFY_TOKEN;
return [{ json: { ok, challenge: ok ? q['hub.challenge'] : 'forbidden' } }];`),
  node('Answer Meta', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'text', responseBody: '={{ $json.challenge }}', options: { responseCode: '={{ $json.ok ? 200 : 403 }}' } }),
  node('Webhook messages (POST)', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'aarisa-whatsapp', responseMode: 'onReceived', options: { rawBody: true } }),
  code('Verify signature and read messages', `// Meta signs the raw body with the app secret (X-Hub-Signature-256). Unsigned or wrong: drop it.
const crypto = require('crypto');
const item = $input.first();
const raw = item.binary?.data ? Buffer.from(item.binary.data.data, 'base64') : Buffer.from(JSON.stringify(item.json.body));
const expected = 'sha256=' + crypto.createHmac('sha256', $env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
const given = String(item.json.headers?.['x-hub-signature-256'] || '');
if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return [];
const body = JSON.parse(raw.toString('utf8'));
const out = [];
for (const entry of body.entry || []) for (const change of entry.changes || []) for (const m of change.value?.messages || []) {
  const kind = m.type === 'interactive' || m.type === 'button' ? 'button' : m.type === 'audio' ? 'audio' : m.type === 'text' ? 'text' : 'other';
  out.push({ json: { waMessageId: m.id, phone: '+' + m.from, kind, text: m.text?.body ?? null,
    button: m.button?.text ?? m.interactive?.button_reply?.title ?? null, mediaId: m.audio?.id ?? null, date: ${todayLA} } });
}
return out;`),
  portal('Log incoming message', 'POST', '/messages', jsonBody(`{ waMessageId: $json.waMessageId, direction: 'in', phone: $json.phone,
    type: $json.kind === 'button' ? 'interactive' : $json.kind === 'audio' ? 'audio' : 'text', body: $json.text ?? $json.button, relatedDate: $json.date }`)),
  code('Who wrote and what to do', `// Unknown numbers get a short reply; quick replies skip the AI.
const msg = $('Verify signature and read messages').item.json;
const logged = $json;
let route = 'ai';
if (!logged.userId) route = 'unknown_number';
else if (msg.kind === 'button' && /all good|todo bien/i.test(msg.button || '')) route = 'all_good';
else if (msg.kind === 'button') route = 'ask_change';
else if (msg.kind === 'audio') route = 'transcribe';
return [{ json: { ...msg, messageId: logged.id, route } }];`),
  switchOn('Route message', 'route', ['all_good', 'ask_change', 'transcribe', 'ai', 'unknown_number']),
  portal('Confirm usual drivers', 'POST', '/daily-changes', jsonBody(`{ phone: $json.phone, date: $json.date, messageId: $json.messageId, inputText: $json.button, model: 'quick-reply', output: { confirm_all: true, changes: [] } }`)),
  whatsapp('Reply: confirmed', `{ messaging_product: 'whatsapp', to: $('Route message').item.json.phone.replace(/^\\+/, ''), type: 'text', text: { body: 'Done. ' + ($json.confirmedAll ?? 0) + ' routes confirmed with their usual driver.' } }`),
  whatsapp('Reply: what changed?', `{ messaging_product: 'whatsapp', to: $json.phone.replace(/^\\+/, ''), type: 'text', text: { body: 'Tell me what changed, for example: "E is Norwin today".' } }`),
  whatsapp('Reply: number not registered', `{ messaging_product: 'whatsapp', to: $json.phone.replace(/^\\+/, ''), type: 'text', text: { body: 'This number is not set up in the Aarisa portal. Ask the owner to add it in Team access.' } }`),
  node('Get audio file link', 'n8n-nodes-base.httpRequest', 4.2, { method: 'GET', url: '=https://graph.facebook.com/v21.0/{{ $json.mediaId }}', ...PORTAL_AUTH, options: {} }, { credentials: WA_CRED }),
  node('Download audio', 'n8n-nodes-base.httpRequest', 4.2, { method: 'GET', url: '={{ $json.url }}', ...PORTAL_AUTH, options: { response: { response: { responseFormat: 'file' } } } }, { credentials: WA_CRED }),
  node('Speech to text', 'n8n-nodes-base.httpRequest', 4.2, {
    // Provider to choose (open question 16): any endpoint that takes the audio file and returns { text }.
    method: 'POST', url: '={{ $env.STT_URL }}', sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.STT_API_KEY }}' }] },
    sendBody: true, contentType: 'multipart-form-data', bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' }] }, options: {},
  }),
  code('Use transcript', `const msg = $('Route message').item.json;
return [{ json: { ...msg, text: $json.text ?? '', transcribed: true } }];`),
  portal('Get names and routes', 'GET', '/context', { sendQuery: true, queryParameters: { parameters: [{ name: 'date', value: '={{ $json.date }}' }] } }),
  code('Build AI request', `// Claude reads the message against today's routes and people. Structured output keeps the JSON valid;
// the portal validates it again and applies nothing below its own rules.
const msg = $('Route message').item.json.transcribed ? $('Use transcript').item.json : $('Route message').item.json;
const context = $json;
const system = ${JSON.stringify(system)};
const body = {
  model: $env.AI_MODEL || 'claude-opus-5-5',
  max_tokens: 4000,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: ${JSON.stringify(outputSchema)} } },
  fallbacks: 'default',
  system,
  messages: [{ role: 'user', content: 'Context (today, routes, people):\\n' + JSON.stringify({ date: context.date, routes: context.routes.map((r) => ({ route: r.route, driver: r.driver })), drivers: context.drivers, contractors: context.contractors }) + '\\n\\nMessage:\\n' + msg.text }],
};
return [{ json: { ...msg, aiBody: body } }];`),
  node('Ask Claude', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST', url: 'https://api.anthropic.com/v1/messages', ...PORTAL_AUTH,
    sendHeaders: true, headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }, { name: 'anthropic-beta', value: 'server-side-fallback-2026-07-01' }] },
    ...jsonBody('$json.aiBody'), options: { timeout: 30000 },
  }, { credentials: AI_CRED }),
  code('Read AI answer', `// A refusal or unreadable answer is treated as "other": nothing is applied.
const msg = $('Build AI request').item.json;
let out = { kind: 'other' };
if ($json.stop_reason !== 'refusal') {
  const text = ($json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { out = JSON.parse(text); } catch {}
}
return [{ json: { ...msg, kind: out.kind, output: out.kind === 'daily_changes' ? out.daily_changes : out.kind === 'extra_job' ? out.extra_job : null, model: $json.model || msg.aiBody.model } }];`),
  switchOn('What the message is', 'kind', ['daily_changes', 'extra_job', 'other']),
  portal('Apply route changes', 'POST', '/daily-changes', jsonBody(`{ phone: $json.phone, date: $json.date, messageId: $json.messageId, inputText: $json.text, model: $json.model, output: $json.output }`)),
  code('Write changes reply', `const r = $json;
const lines = [];
if (r.applied?.length) lines.push('Updated: ' + r.applied.map((a) => a.route + ' ' + a.name).join(', ') + '.');
for (const u of r.unresolved || []) {
  if (u.reason === 'unknown_name') lines.push(u.route + ': who is "' + u.name + '"? Reply with the full name, or add them in the portal.');
  else if (u.reason === 'unknown_route') lines.push('I could not find route ' + u.route + '.');
  else if (u.reason === 'low_confidence') lines.push(u.route + ': I was not sure about "' + u.name + '". Please write the full name.');
  else lines.push('I could not read that. Try: "E is Norwin today".');
}
if (r.error) lines.push('Nothing was changed (' + r.error + ').');
return [{ json: { to: $('What the message is').item.json.phone.replace(/^\\+/, ''), body: lines.join('\\n') || 'Got it.' } }];`),
  whatsapp('Reply: changes', `{ messaging_product: 'whatsapp', to: $json.to, type: 'text', text: { body: $json.body } }`),
  portal('Save job draft', 'POST', '/extra-job-drafts', jsonBody(`{ phone: $json.phone, messageId: $json.messageId, inputText: $json.text, model: $json.model, output: $json.output }`)),
  whatsapp('Reply: review and save', `{ messaging_product: 'whatsapp', to: $('What the message is').item.json.phone.replace(/^\\+/, ''), type: 'interactive',
    interactive: { type: 'cta_url', body: { text: 'I filled in the extra job' + ($json.missing?.length ? ' (missing: ' + $json.missing.join(', ') + ')' : '') + '. Check it and tap Save. Nothing is saved until you do.' },
      action: { name: 'cta_url', parameters: { display_text: 'Review and save', url: $json.link } } } }`),
  whatsapp('Reply: help', `{ messaging_product: 'whatsapp', to: $json.phone.replace(/^\\+/, ''), type: 'text', text: { body: 'I can update today\\'s drivers ("E is Norwin today") or log an extra job (a pickup, Grainger or recovery route, with what T-Force pays and the order number).' } }`),
], {
  ...chain('Webhook verify (GET)', 'Check verify token', 'Answer Meta'),
  ...chain('Webhook messages (POST)', 'Verify signature and read messages', 'Log incoming message', 'Who wrote and what to do', 'Route message'),
  'Route message': { main: [
    [{ node: 'Confirm usual drivers', type: 'main', index: 0 }],
    [{ node: 'Reply: what changed?', type: 'main', index: 0 }],
    [{ node: 'Get audio file link', type: 'main', index: 0 }],
    [{ node: 'Get names and routes', type: 'main', index: 0 }],
    [{ node: 'Reply: number not registered', type: 'main', index: 0 }],
  ] },
  ...chain('Confirm usual drivers', 'Reply: confirmed'),
  ...chain('Get audio file link', 'Download audio', 'Speech to text', 'Use transcript', 'Get names and routes', 'Build AI request', 'Ask Claude', 'Read AI answer', 'What the message is'),
  'What the message is': { main: [
    [{ node: 'Apply route changes', type: 'main', index: 0 }],
    [{ node: 'Save job draft', type: 'main', index: 0 }],
    [{ node: 'Reply: help', type: 'main', index: 0 }],
  ] },
  ...chain('Apply route changes', 'Write changes reply', 'Reply: changes'),
  ...chain('Save job draft', 'Reply: review and save'),
});

// ---------------------------------------------------------------- 4. reminders
x = 0;
const reminders = workflow('Aarisa - reminders', [
  schedule('7:00 PM every day', '0 19 * * *'),
  portal('Jobs without order number', 'GET', '/reminders', { sendQuery: true, queryParameters: { parameters: [{ name: 'date', value: `={{ ${todayLA} }}` }] } }),
  code('One reminder per person', `const r = $input.first().json;
return (r.recipients || []).map((p) => ({ json: { to: p.phone.replace(/^\\+/, ''), phone: p.phone, lang: p.locale === 'es' ? 'es' : 'en_US', count: String(p.jobs.length), date: r.date } }));`),
  whatsapp('Send reminder template', `{ messaging_product: 'whatsapp', to: $json.to, type: 'template', template: { name: 'order_number_reminder', language: { code: $json.lang },
    components: [{ type: 'body', parameters: [{ type: 'text', text: $json.count }] }] } }`),
  portal('Log reminder', 'POST', '/messages', jsonBody(`{ direction: 'out', phone: $('One reminder per person').item.json.phone, type: 'template', body: 'order_number_reminder ' + $('One reminder per person').item.json.count, waMessageId: $json.messages?.[0]?.id ?? null }`)),
], chain('7:00 PM every day', 'Jobs without order number', 'One reminder per person', 'Send reminder template', 'Log reminder'));

mkdirSync(new URL('../n8n/workflows/', import.meta.url), { recursive: true });
for (const [file, wf] of Object.entries({ 'report-ingest': ingest, 'morning-list': morning, 'whatsapp-inbound': inbound, reminders })) {
  writeFileSync(new URL(`../n8n/workflows/${file}.json`, import.meta.url), JSON.stringify(wf, null, 2) + '\n');
  console.log(`n8n/workflows/${file}.json (${wf.nodes.length} nodes)`);
}
writeFileSync(new URL('../n8n/workflows/ai-output.schema.json', import.meta.url), JSON.stringify(outputSchema, null, 2) + '\n');
