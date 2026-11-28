#!/usr/bin/env bash
# Loads the Aarisa credentials and workflows into Aarisa's own n8n container (n8n/README.md).
# Run on the VPS after filling /docker/aarisa/n8n.env and creating the n8n owner. Safe to re-run:
# credentials and workflows keep fixed ids, so a second run replaces them instead of adding copies.
# Workflows are imported unpublished; publish them in the editor once the WhatsApp test passes.
set -euo pipefail
cd "$(dirname "$0")/.."
C=${N8N_CONTAINER:-aarisa-n8n}

# Credential values come from the container's own environment (n8n.env), never from this repo.
docker exec -i "$C" node - <<'JS'
const fs = require('fs');
const e = process.env;
const header = (id, name, header, value) => ({ id, name, type: 'httpHeaderAuth', data: { name: header, value } });
const creds = [header('aarisaPortalTokn', 'Aarisa portal service token', 'Authorization', `Bearer ${e.N8N_SERVICE_TOKEN}`)];
if (e.WHATSAPP_TOKEN) creds.push(header('aarisaWhatsAppTk', 'WhatsApp Cloud API token', 'Authorization', `Bearer ${e.WHATSAPP_TOKEN}`));
if (e.AI_API_KEY) creds.push(header('aarisaAnthropicK', 'Anthropic API key', 'x-api-key', e.AI_API_KEY));
fs.writeFileSync('/tmp/aarisa-creds.json', JSON.stringify(creds), { mode: 0o600 });
console.log('credentials:', creds.map((c) => c.name).join(', '));
JS
docker exec "$C" n8n import:credentials --input=/tmp/aarisa-creds.json
docker exec "$C" rm -f /tmp/aarisa-creds.json

# Point each credential reference at the fixed id, and give each workflow a fixed id.
ids='{"Aarisa portal service token":"aarisaPortalTokn","WhatsApp Cloud API token":"aarisaWhatsAppTk","Anthropic API key":"aarisaAnthropicK"}'
for f in n8n/workflows/{whatsapp-inbound,morning-list,reminders,report-ingest}.json; do
  wid="aarisa$(basename "$f" .json | tr -d '-' | cut -c1-10)"
  node -e '
    const w = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ids = JSON.parse(process.argv[2]);
    w.id = process.argv[3]; w.active = false;
    for (const n of w.nodes) for (const c of Object.values(n.credentials ?? {})) if (ids[c.name]) c.id = ids[c.name];
    process.stdout.write(JSON.stringify(w));
  ' "$f" "$ids" "$wid" | docker exec -i "$C" sh -c 'cat > /tmp/aarisa-wf.json'
  docker exec "$C" n8n import:workflow --input=/tmp/aarisa-wf.json
  echo "imported $(basename "$f") as $wid"
done
docker exec "$C" rm -f /tmp/aarisa-wf.json
