import { describe, expect, it, vi } from 'vitest';
import { users } from '~/db/schema';
import type { Mail } from '~/integrations/mail';
import { withRollback } from '../../tests/helpers/db';
import { morningEmail } from './emails';
import { sendMorningEmails } from './morning-email';

const sent: Mail[] = [];
vi.mock('~/integrations/mail', () => ({ sendMail: vi.fn(async (m: Mail) => { sent.push(m); return true; }) }));

describe('morning list by email', () => {
  it('goes to the owner and dispatchers who chose email, with every route of the day', () =>
    withRollback(async (tx) => {
      vi.stubEnv('WHATSAPP_ENABLED', 'true');
      sent.length = 0;
      await tx.update(users).set({ morningChannel: 'none' });
      await tx.insert(users).values([
        { zitadelSub: 'test:m1', name: 'Disp', email: 'disp@test.com', role: 'dispatcher', morningChannel: 'email', locale: 'es' },
        { zitadelSub: 'test:m2', name: 'Fin', email: 'fin@test.com', role: 'finance', morningChannel: 'email' },
        { zitadelSub: 'test:m3', name: 'Wa', email: 'wa@test.com', role: 'owner', morningChannel: 'whatsapp' },
      ]);
      const res = await sendMorningEmails(tx, '2026-09-03');
      expect(res).toMatchObject({ recipients: 1, sent: 1 });
      expect(sent[0]!.to).toBe('disp@test.com');
      expect(sent[0]!.subject).toMatch(/^Conductores de hoy, jueves, 3 de septiembre: \d+ rutas$/);
      expect(sent[0]!.html).toContain('9000E');
      expect(sent[0]!.html).toContain('/tforce/today?date=2026-09-03');
      // While WhatsApp is off, the owner on WhatsApp gets it by email too.
      vi.stubEnv('WHATSAPP_ENABLED', '');
      sent.length = 0;
      expect(await sendMorningEmails(tx, '2026-09-03')).toMatchObject({ recipients: 2, sent: 2 });
      expect(sent.map((m) => m.to).sort()).toEqual(['disp@test.com', 'wa@test.com']);
      vi.unstubAllEnvs();
    }));

  it('names what needs a look: routes without a driver and one driver on two routes', () => {
    const m = morningEmail('en', 'a@test.com', '2026-09-03', [
      { code: '9000A', driver: 'Ann Lee', usual: 'Ann Lee', contractorRoute: false, confirmed: true },
      { code: '9000B', driver: 'Ann Lee', usual: 'Bo Diaz', contractorRoute: false, confirmed: false },
      { code: '9000C', driver: null, usual: null, contractorRoute: false, confirmed: false },
      { code: 'DUB1', driver: 'Puma LLC', usual: 'Puma LLC', contractorRoute: true, confirmed: false },
    ]);
    expect(m.html).toContain('Without a driver: 9000C.');
    expect(m.html).toContain('On two routes: Ann Lee (9000A, 9000B).');
    expect(m.html).toContain('usual: Bo Diaz');
    expect(m.html).toContain('2 routes still to confirm.');
    expect(morningEmail('en', 'a@test.com', '2026-09-03', [{ code: '9000A', driver: 'Ann', usual: 'Ann', contractorRoute: false, confirmed: true }]).html)
      .toContain('Every route has a driver and nobody has two routes.');
  });
});
