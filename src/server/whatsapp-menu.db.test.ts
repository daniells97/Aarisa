import { describe, expect, it } from 'vitest';
import { users } from '~/db/schema';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { loadDay } from './daily';
import { pageOf, whatsappMenu } from './whatsapp-menu';

type T = Parameters<Parameters<typeof withRollback>[0]>[0];
const DATE = '2026-09-03';
async function person(tx: T, role: 'owner' | 'dispatcher' | 'viewer', phone: string) {
  await tx.insert(users).values({ zitadelSub: `test:${phone}`, name: `${role} ${phone}`, email: `${phone}@test`, role, phone, locale: 'es' });
}
type Msg = { type: string; to: string; text?: { body: string }; interactive?: {
  type: string; body: { text: string };
  action: { button?: string; sections?: { rows: { id: string; title: string; description?: string }[] }[]; buttons?: { reply: { id: string; title: string } }[]; parameters?: { url: string } };
} };
const ask = async (tx: T, phone: string, choice: string | null, button: string | null = null) =>
  (await whatsappMenu(tx, { phone, date: DATE, choice, button }, 'https://portal.test')).messages as Msg[];
const rows = (m: Msg) => m.interactive!.action.sections![0]!.rows;

describe('WhatsApp menu (server)', () => {
  it('pages hold nine rows and "More", or up to ten on the last one', () => {
    const xs = Array.from({ length: 19 }, (_, i) => i);
    expect(pageOf(xs, 0)).toMatchObject({ items: xs.slice(0, 9), more: true, pages: 2 });
    expect(pageOf(xs, 1)).toMatchObject({ items: xs.slice(9), more: false, pages: 2 });
    expect(pageOf(xs.slice(0, 10), 0)).toMatchObject({ more: false, pages: 1 });
  });

  it('a typed message gets the menu; a viewer only sees the list and what is pending', () =>
    withRollback(async (tx) => {
      await person(tx, 'dispatcher', '+19255550101');
      await person(tx, 'viewer', '+19255550102');
      const [m] = await ask(tx, '+1 925 555 0101', null);
      expect(m).toMatchObject({ to: '19255550101', type: 'interactive', interactive: { type: 'list', body: { text: '¿Qué necesitas hacer?' } } });
      expect(rows(m!).map((r) => r.id)).toEqual(['confirm', 'change', 'extra', 'list', 'pending']);
      for (const r of rows(m!)) expect(r.title.length).toBeLessThanOrEqual(24);
      expect(rows((await ask(tx, '+19255550102', null))[0]!).map((r) => r.id)).toEqual(['list', 'pending']);
      expect((await ask(tx, '+19255550102', 'confirm'))[0]!.text!.body).toMatch(/rol/);
    }));

  it('"Todo bien" from the morning template confirms the usual drivers', () =>
    withRollback(async (tx) => {
      await person(tx, 'dispatcher', '+19255550101');
      const [m] = await ask(tx, '+19255550101', null, 'Todo bien');
      expect(m!.interactive!.body.text).toMatch(/^Listo\. \d+ rutas confirmadas/);
      expect((await loadDay(tx, actorAs('owner'), DATE)).summary.proposed).toBe(0);
    }));

  it('change a driver: route, then person, applied as a WhatsApp change', () =>
    withRollback(async (tx) => {
      await person(tx, 'dispatcher', '+19255550101');
      const routes = rows((await ask(tx, '+19255550101', 'change'))[0]!);
      const day = await loadDay(tx, actorAs('owner'), DATE);
      expect(routes.length).toBe(Math.min(day.rows.length, 10));
      if (day.rows.length > 10) {
        expect(routes.at(-1)!.id).toBe('change:1');
        expect(rows((await ask(tx, '+19255550101', 'change:1'))[0]!)[0]!.title).toBe(day.rows[9]!.code);
      }
      const e = day.rows.find((r) => r.code === '9000E')!;
      const people = rows((await ask(tx, '+19255550101', `route:${e.routeId}`))[0]!);
      const norwin = await driverNamed(tx, 'Norwin Saloman');
      const pick = people.find((p) => p.title === 'Norwin Saloman') ?? people.find((p) => p.id === `set:${e.routeId}:more`);
      expect(people[0]!.id).toMatch(new RegExp(`^set:${e.routeId}:`));
      const id = pick?.id.startsWith('set:') ? pick.id : `set:${e.routeId}:d:${norwin!.id}`;
      const [done] = await ask(tx, '+19255550101', id);
      expect(done!.interactive!.body.text).toBe('Listo: 9000E → Norwin Saloman.');
      expect((await loadDay(tx, actorAs('owner'), DATE)).rows.find((r) => r.code === '9000E')).toMatchObject({ status: 'changed', source: 'whatsapp', today: { name: 'Norwin Saloman' } });
    }));

  it('extra job and the list are links into the portal', () =>
    withRollback(async (tx) => {
      await person(tx, 'dispatcher', '+19255550101');
      expect((await ask(tx, '+19255550101', 'extra'))[0]!.interactive!.action.parameters!.url).toBe(`https://portal.test/extra-jobs/new?date=${DATE}`);
      const [l] = await ask(tx, '+19255550101', 'list');
      expect(l!.interactive!.body.text).toMatch(/9000E/);
      expect(l!.interactive!.action.parameters!.url).toBe(`https://portal.test/tforce/today?date=${DATE}`);
      expect((await ask(tx, '+19255550101', 'pending'))[0]!.type).toBe('interactive');
    }));
});
