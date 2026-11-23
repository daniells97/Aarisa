import { translate, type Locale, type MessageKey } from '~/i18n';
import type { Mail } from '~/integrations/mail';

// The two emails the portal sends for sign-in: an invite and a password reset. Plain layout with inline
// styles (email clients ignore stylesheets), the button link also written out for clients that block it.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(locale: Locale, to: string, p: { subject: MessageKey; lead: MessageKey; button: MessageKey; after: MessageKey; vars: Record<string, string> }, link: string): Mail {
  const t = (k: MessageKey) => translate(locale, k, p.vars);
  const portal = process.env.APP_BASE_URL ?? '';
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#172033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:12px;padding:28px">
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:20px">${esc(t(p.lead))}</td></tr>
<tr><td style="padding-bottom:20px"><a href="${esc(link)}" style="display:inline-block;background:#122A5A;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 22px;border-radius:8px">${esc(t(p.button))}</a></td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#4A5568;padding-bottom:12px">${esc(t(p.after))} <a href="${esc(portal)}" style="color:#122A5A">${esc(portal.replace(/^https?:\/\//, ''))}</a></td></tr>
<tr><td style="font-size:12px;line-height:1.5;color:#718096;padding-bottom:24px">${esc(t('mail.linkFallback'))}<br><span style="word-break:break-all">${esc(link)}</span></td></tr>
<tr><td style="border-top:3px solid #C02430;padding-top:18px">
<a href="${esc(portal)}"><img src="${esc(portal)}/brand/aarisa-logo.png" width="160" height="51" alt="Aarisa Consulting" style="display:block;border:0;height:51px;width:160px"></a>
<div style="font-size:13px;line-height:1.5;color:#122A5A;font-weight:bold;padding-top:10px">Aarisa Consulting · Logistics Solutions DR / USA</div>
<div style="font-size:12px;line-height:1.5;color:#718096;padding-top:4px">${esc(t('mail.noReply'))}</div>
</td></tr>
</table></td></tr></table></body></html>`;
  return { to, subject: t(p.subject), html };
}

export const inviteEmail = (locale: Locale, to: string, link: string, name: string, role: string) =>
  layout(locale, to, { subject: 'mail.invite.subject', lead: 'mail.invite.lead', button: 'mail.invite.button', after: 'mail.after', vars: { name, role } }, link);

export const resetEmail = (locale: Locale, to: string, link: string) =>
  layout(locale, to, { subject: 'mail.reset.subject', lead: 'mail.reset.lead', button: 'mail.reset.button', after: 'mail.after', vars: {} }, link);
