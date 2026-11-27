// Email from Aarisa's own address (MAIL_FROM, e.g. no-reply@aarisaconsulting.com) through Resend's API.
// Zitadel sends nothing for Aarisa: the portal asks it for the invite or reset code and sends the email
// itself, so the shared Zitadel keeps its own mail settings (docs/deployment.md, "Email").

export interface MailConfig { apiKey: string; from: string }

export function mailConfig(): MailConfig | null {
  const { RESEND_API_KEY: apiKey, MAIL_FROM: from } = process.env;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export interface Mail { to: string; subject: string; html: string }

/** Sends one email. Returns false (and logs why) when mail isn't set up or Resend refuses it. */
export async function sendMail(mail: Mail, cfg = mailConfig()): Promise<boolean> {
  if (!cfg) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      // Mail from the test copy of the portal says so in the subject.
      body: JSON.stringify({ from: `Aarisa Consulting <${cfg.from}>`, to: [mail.to], subject: (process.env.APP_ENV === 'staging' ? '[PRUEBAS] ' : '') + mail.subject, html: mail.html }),
    });
    if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text()}`);
    return true;
  } catch (e) {
    console.error('[mail] not sent:', e);
    return false;
  }
}
