import { and, eq, sql } from 'drizzle-orm';
import { db } from '~/db/client';
import { users } from '~/db/schema';
import { isLocale } from '~/i18n';
import { sendMail } from '~/integrations/mail';
import { passwordResetLink, zitadelAdminConfig } from '~/integrations/zitadel';
import { resetEmail } from './emails';

// "Forgot your password?" on the portal's sign-in page. Only people on the team get a link, from
// Aarisa's mailbox. The answer is the same whether or not the email is known, and the work runs after
// answering, so the page can't be used to find out who has an account.

const lastSent = new Map<string, number>();
const WAIT = 2 * 60_000; // one email per address every two minutes

export async function sendPasswordReset(email: string) {
  const key = email.trim().toLowerCase();
  if ((lastSent.get(key) ?? 0) > Date.now() - WAIT) return false;
  lastSent.set(key, Date.now());
  const cfg = zitadelAdminConfig();
  if (!cfg) return false;
  const [user] = await db().select({ email: users.email, locale: users.locale }).from(users)
    .where(and(eq(sql`lower(${users.email})`, key), eq(users.active, true)));
  if (!user) return false;
  const link = await passwordResetLink(cfg, user.email);
  if (!link) return false;
  return sendMail(resetEmail(isLocale(user.locale) ? user.locale : 'en', user.email, link));
}
