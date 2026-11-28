import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { users } from '~/db/schema';
import { isLocale } from '~/i18n';
import { sendMail } from '~/integrations/mail';
import { loadDay } from './daily';
import { morningEmail } from './emails';
import { whatsappEnabled } from './features';

// The morning list by email, for the owner and dispatchers whose morning channel is "email" in Team access.
// n8n calls this at 6:30 AM with the WhatsApp list (n8n/workflows/morning-list.json). No money in it.
// While WhatsApp is off, people who chose WhatsApp get the email instead.

export async function sendMorningEmails(tx: Tx, date: string) {
  const day = await loadDay(tx, { userId: null, role: 'viewer', name: 'n8n', locale: 'en', source: 'system' }, date);
  const routes = day.rows.map((r) => ({
    code: r.code, driver: r.today.name, usual: r.usual.name, contractorRoute: r.contractorRoute,
    confirmed: r.status === 'confirmed' || r.status === 'changed',
  }));
  const people = await tx.select({ email: users.email, locale: users.locale }).from(users)
    .where(and(eq(users.active, true), inArray(users.morningChannel, whatsappEnabled() ? ['email'] : ['email', 'whatsapp']), inArray(users.role, ['owner', 'dispatcher'])));
  let sent = 0;
  for (const p of people) if (await sendMail(morningEmail(isLocale(p.locale) ? p.locale : 'en', p.email, date, routes))) sent++;
  return { date, recipients: people.length, sent };
}
