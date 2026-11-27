import { translate, type Locale, type MessageKey } from '~/i18n';
import type { Mail } from '~/integrations/mail';

// The emails the portal sends: an invite, a password reset and the morning list. Plain layout with inline
// styles (email clients ignore stylesheets), the button link also written out for clients that block it.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const BRAND = '#122A5A';
const MUTED = '#718096';

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 22px;border-radius:8px">${esc(label)}</a>`;

/** The card, rows of content and the signature with the logo. `rows` is trusted HTML built here. */
function frame(locale: Locale, rows: string[]) {
  const portal = process.env.APP_BASE_URL ?? '';
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#172033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;padding:28px">
${rows.join('\n')}
<tr><td style="border-top:3px solid #C02430;padding-top:18px">
<a href="${esc(portal)}"><img src="${esc(portal)}/brand/aarisa-logo.png" width="160" height="51" alt="Aarisa Consulting" style="display:block;border:0;height:51px;width:160px"></a>
<div style="font-size:13px;line-height:1.5;color:${BRAND};font-weight:bold;padding-top:10px">Aarisa Consulting · Logistics Solutions DR / USA</div>
<div style="font-size:12px;line-height:1.5;color:${MUTED};padding-top:4px">${esc(translate(locale, 'mail.noReply'))}</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

function signIn(locale: Locale, to: string, p: { subject: MessageKey; lead: MessageKey; button: MessageKey; vars: Record<string, string> }, link: string): Mail {
  const t = (k: MessageKey) => translate(locale, k, p.vars);
  const portal = process.env.APP_BASE_URL ?? '';
  return { to, subject: t(p.subject), html: frame(locale, [
    `<tr><td style="font-size:16px;line-height:1.5;padding-bottom:20px">${esc(t(p.lead))}</td></tr>`,
    `<tr><td style="padding-bottom:20px">${button(link, t(p.button))}</td></tr>`,
    `<tr><td style="font-size:14px;line-height:1.5;color:#4A5568;padding-bottom:12px">${esc(t('mail.after'))} <a href="${esc(portal)}" style="color:${BRAND}">${esc(portal.replace(/^https?:\/\//, ''))}</a></td></tr>`,
    `<tr><td style="font-size:12px;line-height:1.5;color:${MUTED};padding-bottom:24px">${esc(t('mail.linkFallback'))}<br><span style="word-break:break-all">${esc(link)}</span></td></tr>`,
  ]) };
}

/** The invite says who is invited, not their role (client request, Nov 24 2026). */
export const inviteEmail = (locale: Locale, to: string, link: string, name: string) =>
  signIn(locale, to, { subject: 'mail.invite.subject', lead: 'mail.invite.lead', button: 'mail.invite.button', vars: { name } }, link);

/** For someone invited who already has a password: the button goes to the portal's sign-in. */
export const accessEmail = (locale: Locale, to: string, name: string) =>
  signIn(locale, to, { subject: 'mail.invite.subject', lead: 'mail.access.lead', button: 'mail.access.button', vars: { name } }, `${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}/auth/login`);

export const resetEmail = (locale: Locale, to: string, link: string) =>
  signIn(locale, to, { subject: 'mail.reset.subject', lead: 'mail.reset.lead', button: 'mail.reset.button', vars: {} }, link);

export interface MorningRoute { code: string; driver: string | null; usual: string | null; contractorRoute: boolean; confirmed: boolean }

/**
 * The morning list for people who chose email: what needs a look first (no driver, one driver on two
 * routes), then every route with its driver, and a button to Today's drivers to confirm or change it.
 */
export function morningEmail(locale: Locale, to: string, date: string, routes: MorningRoute[]): Mail {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(locale, k, v);
  const day = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const noDriver = routes.filter((r) => !r.driver).map((r) => r.code);
  const byDriver = new Map<string, string[]>();
  for (const r of routes) if (r.driver && !r.contractorRoute) byDriver.set(r.driver, [...(byDriver.get(r.driver) ?? []), r.code]);
  const doubles = [...byDriver].filter(([, rs]) => rs.length > 1).map(([d, rs]) => `${d} (${rs.join(', ')})`);
  const toConfirm = routes.filter((r) => r.driver && !r.confirmed).length;

  const look = [
    noDriver.length ? t('mail.morning.noDriver', { routes: noDriver.join(', ') }) : null,
    doubles.length ? t('mail.morning.doubles', { list: doubles.join(', ') }) : null,
  ].filter((x): x is string => !!x);
  const lookBox = look.length
    ? `<tr><td style="padding-bottom:20px"><div style="background:#FFF7E6;border-left:4px solid #E0A100;border-radius:6px;padding:12px 14px;font-size:15px;line-height:1.5">${look.map(esc).join('<br>')}</div></td></tr>`
    : `<tr><td style="padding-bottom:20px"><div style="background:#E9F6EE;border-left:4px solid #2E8B57;border-radius:6px;padding:12px 14px;font-size:15px;line-height:1.5">${esc(t('mail.morning.allGood'))}</div></td></tr>`;

  const cell = 'padding:7px 8px;border-bottom:1px solid #E2E8F0;font-size:14px;line-height:1.4;vertical-align:top';
  const rows = routes.map((r) => {
    const who = r.driver
      ? esc(r.driver) + (r.usual && r.usual !== r.driver ? `<br><span style="color:${MUTED};font-size:12px">${esc(t('mail.morning.usual', { name: r.usual }))}</span>` : '')
      : `<span style="color:#C02430;font-weight:bold">${esc(t('mail.morning.none'))}</span>`;
    const tag = r.contractorRoute ? ` <span style="color:${MUTED};font-size:12px">· ${esc(t('mail.morning.contractor'))}</span>` : '';
    return `<tr><td style="${cell};font-weight:bold;white-space:nowrap">${esc(r.code)}</td><td style="${cell}">${who}${tag}</td><td style="${cell};text-align:center">${r.confirmed ? '✓' : ''}</td></tr>`;
  }).join('');
  const link = `${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}/tforce/today?date=${date}`;

  return {
    to,
    subject: t('mail.morning.subject', { date: day, n: routes.length }),
    html: frame(locale, [
      `<tr><td style="font-size:16px;line-height:1.5;padding-bottom:16px">${esc(t('mail.morning.lead', { date: day, n: routes.length }))}</td></tr>`,
      lookBox,
      `<tr><td style="padding-bottom:20px">${button(link, t('mail.morning.button'))}<div style="font-size:13px;color:${MUTED};padding-top:8px">${esc(toConfirm ? t('mail.morning.toConfirm', { n: toConfirm }) : t('mail.morning.confirmed'))}</div></td></tr>`,
      `<tr><td style="padding-bottom:24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><th align="left" style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.morning.route'))}</th><th align="left" style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.morning.driver'))}</th><th style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.morning.ok'))}</th></tr>
${rows}</table></td></tr>`,
    ]),
  };
}

export type DayListStatus = 'confirmed' | 'proposed' | 'off';
export interface DayListPerson { name: string; code: string | null; routes: string[]; contractor: boolean; status?: DayListStatus }

/** What changed between two sends of the same day's list (by person). */
export interface DayListChanges { added: string[]; removed: string[]; codes: { name: string; from: string | null; to: string | null }[]; routes: { name: string; routes: string[] }[]; statuses: { name: string; status: DayListStatus }[] }

export function diffDayList(before: DayListPerson[], after: DayListPerson[]): DayListChanges {
  const was = new Map(before.map((p) => [p.name, p]));
  const now = new Map(after.map((p) => [p.name, p]));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return {
    added: after.filter((p) => !was.has(p.name)).map((p) => p.name),
    removed: before.filter((p) => !now.has(p.name)).map((p) => p.name),
    codes: after.filter((p) => was.has(p.name) && was.get(p.name)!.code !== p.code).map((p) => ({ name: p.name, from: was.get(p.name)!.code, to: p.code })),
    routes: after.filter((p) => was.has(p.name) && !same(was.get(p.name)!.routes, p.routes)).map((p) => ({ name: p.name, routes: p.routes })),
    // A list sent before statuses were in it says nothing about them.
    statuses: after.filter((p) => p.status && was.get(p.name)?.status && was.get(p.name)!.status !== p.status).map((p) => ({ name: p.name, status: p.status! })),
  };
}
export const hasChanges = (c: DayListChanges) => c.added.length + c.removed.length + c.codes.length + c.routes.length + c.statuses.length > 0;

/**
 * "Confirm and send list": who works today, confirmed by the operator, for the people who set driver codes
 * and routes. People without a driver code go first; then everyone with their code and routes. No money.
 */
/** The status of each person in the day's list email, in the portal's colors. */
const STATUS_KEY = { confirmed: 'td.status.confirmed', proposed: 'td.statusToConfirm', off: 'td.status.off' } as const;
const STATUS_STYLE = { confirmed: 'background:#E6F4EA;color:#1E7B3C', proposed: 'background:#E8F0FB;color:#1F4E9A', off: 'background:#FDECEA;color:#B42318' } as const;

export function dayListEmail(locale: Locale, to: string, date: string, sender: string, people: DayListPerson[], codesNoDriver: string[], operation: string, path = '/tforce/today',
  update?: { at: string; changes: DayListChanges }): Mail {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(locale, k, v);
  const day = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const noCode = people.filter((p) => !p.code && p.status !== 'off').map((p) => p.name);
  const look = [
    noCode.length ? t('mail.dayList.noCode', { names: noCode.join(', ') }) : null,
    codesNoDriver.length ? t('mail.dayList.codesNoDriver', { codes: codesNoDriver.join(', ') }) : null,
  ].filter((x): x is string => !!x);
  const lookBox = look.length
    ? `<tr><td style="padding-bottom:20px"><div style="background:#FFF7E6;border-left:4px solid #E0A100;border-radius:6px;padding:12px 14px;font-size:15px;line-height:1.5">${look.map(esc).join('<br>')}</div></td></tr>`
    : '';
  // A second send of the same day says what changed since the last one, before the full list.
  const time = update ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date(update.at)) : '';
  const c = update?.changes;
  const changeLines = c ? [
    ...c.added.map((n) => t('mail.dayList.added', { name: n })),
    ...c.removed.map((n) => t('mail.dayList.removed', { name: n })),
    ...c.codes.map((x) => t('mail.dayList.codeChanged', { name: x.name, from: x.from ?? t('mail.dayList.missing'), to: x.to ?? t('mail.dayList.missing') })),
    ...c.routes.map((x) => t('mail.dayList.routesChanged', { name: x.name, routes: x.routes.join(', ') || '–' })),
    ...c.statuses.map((x) => t('mail.dayList.statusChanged', { name: x.name, status: t(STATUS_KEY[x.status]) })),
  ] : [];
  const changesBox = update
    ? `<tr><td style="padding-bottom:20px"><div style="background:#EAF1FB;border-left:4px solid #1F4E9A;border-radius:6px;padding:12px 14px;font-size:15px;line-height:1.6"><strong>${esc(t('mail.dayList.changesSince', { time }))}</strong><br>${changeLines.length ? changeLines.map(esc).join('<br>') : esc(t('mail.dayList.noChanges'))}</div></td></tr>`
    : '';
  const cell = 'padding:7px 8px;border-bottom:1px solid #E2E8F0;font-size:14px;line-height:1.4;vertical-align:top';
  const sorted = [...people.filter((p) => !p.code), ...people.filter((p) => p.code)];
  const rows = sorted.map((p) => `<tr><td style="${cell};font-weight:bold">${esc(p.name)}${p.contractor ? ` <span style="color:${MUTED};font-size:12px">· ${esc(t('mail.morning.contractor'))}</span>` : ''}</td>`
    + `<td style="${cell};white-space:nowrap">${p.code ? esc(p.code) : `<span style="color:#C02430;font-weight:bold">${esc(t('mail.dayList.missing'))}</span>`}</td>`
    + `<td style="${cell}">${esc(p.routes.join(', ')) || `<span style="color:${MUTED}">–</span>`}</td>`
    + `<td style="${cell};white-space:nowrap"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;${STATUS_STYLE[p.status ?? 'confirmed']}">${esc(t(STATUS_KEY[p.status ?? 'confirmed']))}</span></td></tr>`).join('');
  const link = `${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}${path}?date=${date}`;
  return {
    to,
    subject: (update ? t('mail.dayList.updatedPrefix') : '') + t('mail.dayList.subject', { date: day, n: people.length, client: operation }),
    html: frame(locale, [
      `<tr><td style="font-size:16px;line-height:1.5;padding-bottom:16px">${esc(t(update ? 'mail.dayList.leadUpdate' : 'mail.dayList.lead', { name: sender, date: day, n: people.length, client: operation }))}</td></tr>`,
      changesBox,
      lookBox,
      `<tr><td style="padding-bottom:20px">${button(link, t('mail.dayList.button'))}</td></tr>`,
      `<tr><td style="padding-bottom:24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><th align="left" style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.morning.driver'))}</th><th align="left" style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.dayList.code'))}</th><th align="left" style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.dayList.routes'))}</th><th align="left" style="${cell};font-size:12px;color:${MUTED}">${esc(t('mail.dayList.status'))}</th></tr>
${rows}</table></td></tr>`,
    ]),
  };
}
