import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '~/db/client';
import { exceptions, extraJobView } from '~/db/schema';
import { can } from '~/domain/permissions';
import { isLocale, translate, type Locale, type MessageKey } from '~/i18n';
import { ForbiddenError, type Actor } from './actor';
import { confirmUsual, loadDay, setAssignment, type DayStatus, type PayeeInput } from './daily';
import { RuleError } from './errors';
import { actorForPhone } from './integrations';
import { operationFor } from './ops';
import { recheckForDate } from './tforce';

// The WhatsApp menu: every daily task as taps instead of free text, so nothing depends on the AI.
// The state lives in the id of the row or button tapped ("route:<id>", "set:<routeId>:d:<driverId>"),
// so n8n only passes the id through and sends back the messages this returns. A tap is the person's
// own choice, so a change applies right away (rule 5 is about AI output). Roles apply as in the portal.

export const menuInput = z.object({
  phone: z.string().min(5).max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Id of the list row or reply button tapped; null for a typed message (shows the menu). */
  choice: z.string().max(200).nullable().optional(),
  /** Text of a template quick reply ("Todo bien", "Cambiar una ruta"), which carries no id of ours. */
  button: z.string().max(100).nullable().optional(),
  /** WHATSAPP_LANGUAGE from n8n; empty = the person's portal language. */
  locale: z.string().max(5).nullable().optional(),
});

type Row = { id: string; title: string; description?: string };
type Day = Awaited<ReturnType<typeof loadDay>>;

// WhatsApp limits: list rows 10, row title 24, description 72, button 20, body 1024.
const PAGE = 10;
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Rows for one page of a list: nine and a "More" row, or up to ten on the last page. */
export function pageOf<T>(items: T[], page: number) {
  const start = page * (PAGE - 1);
  const rest = items.slice(start);
  const more = rest.length > PAGE;
  return { items: more ? rest.slice(0, PAGE - 1) : rest, more, pages: Math.max(1, Math.ceil((items.length - 1) / (PAGE - 1))) };
}

export async function whatsappMenu(tx: Tx, input: z.infer<typeof menuInput>, baseUrl = process.env.APP_BASE_URL ?? '') {
  const actor = await actorForPhone(tx, input.phone);
  if (!actor) throw new RuleError('unknown_phone');
  const locale: Locale = isLocale(input.locale) ? input.locale : actor.locale;
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const to = input.phone.replace(/[^\d]/g, '');
  const base = baseUrl.replace(/\/$/, '');
  const date = input.date;

  const text = (body: string) => ({ messaging_product: 'whatsapp', to, type: 'text', text: { body: cut(body, 4096), preview_url: false } });
  const list = (body: string, button: string, section: string, rows: Row[]) => ({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: { type: 'list', body: { text: cut(body, 1024) }, action: { button: cut(button, 20), sections: [{ title: cut(section, 24), rows: rows.map((r) => ({ id: r.id, title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })) }] } },
  });
  const buttons = (body: string, btns: { id: string; title: string }[]) => ({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: { type: 'button', body: { text: cut(body, 1024) }, action: { buttons: btns.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })) } },
  });
  const link = (body: string, label: string, path: string) => ({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: { type: 'cta_url', body: { text: cut(body, 1024) }, action: { name: 'cta_url', parameters: { display_text: cut(label, 20), url: `${base}${path}` } } },
  });
  const after = (body: string, again: { id: string; title: string }) => buttons(body, [again, { id: 'menu', title: t('wa.btn.menu') }]);

  const canEdit = can(actor.role, 'drivers.confirm_today');
  const choice = input.choice ?? (input.button ? (/todo bien|all good/i.test(input.button) ? 'confirm' : 'change') : 'menu');
  const [what, ...args] = choice.split(':');
  const day = await loadDay(tx, actor, date);

  const menu = () => {
    const rows: Row[] = [];
    if (canEdit) {
      rows.push({ id: 'confirm', title: t('wa.menu.confirm'), description: day.summary.proposed ? t('wa.menu.confirmDesc', { n: day.summary.proposed }) : t('wa.menu.confirmNone') });
      rows.push({ id: 'change', title: t('wa.menu.change'), description: t('wa.menu.changeDesc') });
    }
    if (can(actor.role, 'extra_jobs.log')) rows.push({ id: 'extra', title: t('wa.menu.extra'), description: t('wa.menu.extraDesc') });
    rows.push({ id: 'list', title: t('wa.menu.list'), description: t('wa.menu.listDesc') });
    rows.push({ id: 'pending', title: t('wa.menu.pending'), description: t('wa.menu.pendingDesc') });
    return [list(t('wa.menu.body'), t('wa.menu.button'), t('wa.menu.section'), rows)];
  };

  try {
    switch (what) {
      case 'confirm': {
        if (!canEdit) return { messages: [text(t('wa.notAllowed'))] };
        const n = await confirmUsual(tx, actor, date);
        await recheckForDate(tx, actor, date);
        const left = day.rows.filter((r) => r.status === 'no_driver').map((r) => r.code);
        const body = [n ? t('wa.confirmed', { n }) : t('wa.confirmedNone'), left.length ? t('wa.noDriverLeft', { routes: left.join(', ') }) : ''].filter(Boolean).join('\n');
        return { messages: [after(body, { id: 'change', title: t('wa.btn.change') })] };
      }
      case 'change': {
        if (!canEdit) return { messages: [text(t('wa.notAllowed'))] };
        const page = Number(args[0] ?? 0) || 0;
        const p = pageOf(day.rows, page);
        const rows: Row[] = p.items.map((r) => ({ id: `route:${r.routeId}`, title: r.code, description: `${r.today.name ?? t('wa.noDriver')} · ${t(`wa.status.${r.status}` as MessageKey)}` }));
        if (p.more) rows.push({ id: `change:${page + 1}`, title: t('wa.more'), description: t('wa.moreDesc') });
        return { messages: [list(t('wa.routes.body', { page: page + 1, pages: p.pages }), t('wa.routes.button'), t('wa.routes.section'), rows)] };
      }
      case 'route': {
        if (!canEdit) return { messages: [text(t('wa.notAllowed'))] };
        const r = day.rows.find((x) => x.routeId === args[0]);
        if (!r) return { messages: menu() };
        const page = Number(args[1] ?? 0) || 0;
        const p = pageOf(payeeOptions(day, r, t), page);
        const rows = p.items.map((o) => ({ ...o, id: `set:${r.routeId}:${o.id}` }));
        if (p.more) rows.push({ id: `route:${r.routeId}:${page + 1}`, title: t('wa.more'), description: t('wa.moreDesc') });
        return { messages: [list(t('wa.drivers.body', { route: r.code, name: r.today.name ?? t('wa.noDriver') }), t('wa.drivers.button'), t('wa.drivers.section'), rows)] };
      }
      case 'set': {
        if (!canEdit) return { messages: [text(t('wa.notAllowed'))] };
        const r = day.rows.find((x) => x.routeId === args[0]);
        if (!r) return { messages: menu() };
        const payee: PayeeInput = args[1] === 'd' && args[2] ? { driverId: args[2] } : args[1] === 'c' && args[2] ? { contractorId: args[2] } : null;
        await setAssignment(tx, actor, { date, routeId: r.routeId, payee });
        await recheckForDate(tx, actor, date);
        const name = payee ? (day.options.drivers.find((d) => 'driverId' in payee && d.id === payee.driverId)?.name
          ?? day.options.contractors.find((c) => 'contractorId' in payee && c.id === payee.contractorId)?.name ?? '') : t('wa.noDriver');
        return { messages: [after(t('wa.set', { route: r.code, name }), { id: 'change', title: t('wa.btn.changeAnother') })] };
      }
      case 'extra':
        if (!can(actor.role, 'extra_jobs.log')) return { messages: [text(t('wa.notAllowed'))] };
        return { messages: [link(t('wa.extra.body'), t('wa.extra.button'), `/extra-jobs/new?date=${date}`)] };
      case 'list': {
        const icon: Record<DayStatus, string> = { confirmed: '✓', changed: '✓', proposed: '?', waiting: '…', no_driver: '—' };
        const lines = day.rows.map((r) => `${icon[r.status]} ${r.code} ${r.today.name ?? t('wa.noDriver')}`);
        return { messages: [link([t('wa.list.title', { date: longDate(date, locale) }), ...lines, '', t('wa.list.legend')].join('\n'), t('wa.list.button'), `/tforce/today?date=${date}`)] };
      }
      case 'pending': {
        const op = await operationFor(tx, undefined, 'daily_list');
        const openExceptions = (await tx.select({ id: exceptions.id }).from(exceptions).where(and(eq(exceptions.operationId, op.id), eq(exceptions.status, 'open')))).length;
        const noOrder = (await tx.select({ id: extraJobView.id }).from(extraJobView).where(and(eq(extraJobView.date, date), isNull(extraJobView.orderNumber)))).length;
        const s = day.summary;
        const lines = [
          s.proposed + s.waiting ? t('wa.pending.unconfirmed', { n: s.proposed + s.waiting }) : '',
          s.noDriver ? t('wa.pending.noDriver', { n: s.noDriver }) : '',
          noOrder ? t('wa.pending.orders', { n: noOrder }) : '',
          openExceptions ? t('wa.pending.exceptions', { n: openExceptions }) : '',
        ].filter(Boolean).map((l) => `• ${l}`);
        if (!lines.length) return { messages: [buttons(t('wa.pending.none'), [{ id: 'menu', title: t('wa.btn.menu') }])] };
        const body = [t('wa.pending.title'), ...lines].join('\n');
        if (openExceptions) return { messages: [link(body, t('wa.pending.button'), '/exceptions')] };
        return { messages: [canEdit && s.proposed ? after(body, { id: 'confirm', title: t('wa.btn.confirm') }) : buttons(body, [{ id: 'menu', title: t('wa.btn.menu') }])] };
      }
      default:
        return { messages: menu() };
    }
  } catch (e) {
    // A locked week or a person turned off: say so in the chat instead of going quiet.
    if (e instanceof ForbiddenError) return { messages: [text(t('wa.notAllowed'))] };
    if (e instanceof RuleError) return { messages: [text(t('wa.failed', { code: e.code }))] };
    throw e;
  }
}

/** Who can drive a route, best guesses first: the usual payee, drivers (with routes they already have today), companies, nobody. */
function payeeOptions(day: Day, r: Day['rows'][number], t: (k: MessageKey, v?: Record<string, string | number>) => string): Row[] {
  const isToday = (p: { driverId?: string | null; contractorId?: string | null }) =>
    (p.driverId ?? null) === r.today.driverId && (p.contractorId ?? null) === r.today.contractorId;
  const routesOf = new Map<string, string[]>();
  for (const x of day.rows) if (x.routeId !== r.routeId && x.status !== 'no_driver') {
    const key = x.today.driverId ? `d:${x.today.driverId}` : x.today.contractorId ? `c:${x.today.contractorId}` : null;
    if (key) routesOf.set(key, [...(routesOf.get(key) ?? []), x.code]);
  }
  const usualKey = r.usual.driverId ? `d:${r.usual.driverId}` : r.usual.contractorId ? `c:${r.usual.contractorId}` : null;
  const describe = (key: string, fallback?: string | null) => {
    const also = routesOf.get(key);
    const parts = [key === usualKey ? t('wa.drivers.usual') : null, also ? t('wa.drivers.also', { routes: also.join(', ') }) : null, fallback ?? null].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  };
  const drivers = day.options.drivers.filter((d) => !isToday({ driverId: d.id }))
    .map((d) => ({ id: `d:${d.id}`, title: d.name, description: describe(`d:${d.id}`, d.contractor) }))
    .sort((a, b) => Number(b.id === usualKey) - Number(a.id === usualKey) || a.title.localeCompare(b.title));
  const companies = day.options.contractors.filter((c) => !isToday({ contractorId: c.id }))
    .map((c) => ({ id: `c:${c.id}`, title: c.name, description: describe(`c:${c.id}`, t('wa.drivers.company')) }));
  const usualCompany = companies.findIndex((c) => c.id === usualKey);
  if (usualCompany >= 0) drivers.unshift(...companies.splice(usualCompany, 1));
  const nobody = r.today.driverId || r.today.contractorId ? [{ id: 'none', title: t('wa.drivers.none') }] : [];
  return [...drivers, ...companies, ...nobody];
}

function longDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
