// Email from Aarisa's own Microsoft 365 mailbox (MAIL_FROM, e.g. no-reply@aarisaconsulting.com) through
// Microsoft Graph with an app registration (client credentials). Zitadel sends nothing for Aarisa: the
// portal asks it for the invite or reset code and sends the email itself, so the shared Zitadel keeps
// its own mail settings. In Microsoft 365 the app may only send as that one mailbox (docs/deployment.md, "Email").

export interface MailConfig { tenantId: string; clientId: string; clientSecret: string; from: string }

export function mailConfig(): MailConfig | null {
  const { MAIL_TENANT_ID: tenantId, MAIL_CLIENT_ID: clientId, MAIL_CLIENT_SECRET: clientSecret, MAIL_FROM: from } = process.env;
  if (!tenantId || !clientId || !clientSecret || !from) return null;
  return { tenantId, clientId, clientSecret, from };
}

let cached: { key: string; token: string; expires: number } | null = null;

async function accessToken(cfg: MailConfig) {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  if (cached && cached.key === key && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Microsoft token request failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { key, token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

export interface Mail { to: string; subject: string; html: string }

/** Sends one email. Returns false (and logs why) when mail isn't set up or Microsoft refuses it. */
export async function sendMail(mail: Mail, cfg = mailConfig()): Promise<boolean> {
  if (!cfg) return false;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken(cfg)}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: 'HTML', content: mail.html },
          toRecipients: [{ emailAddress: { address: mail.to } }],
        },
        saveToSentItems: false,
      }),
    });
    if (res.status !== 202) throw new Error(`Microsoft Graph sendMail failed: ${res.status} ${await res.text()}`);
    return true;
  } catch (e) {
    console.error('[mail] not sent:', e);
    return false;
  }
}
