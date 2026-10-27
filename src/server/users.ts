import { eq } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { users } from '~/db/schema';
import type { Role } from '~/domain/permissions';
import { audit } from './audit';

/** Creates or updates the user from identity-provider claims. Role always follows Zitadel. */
export async function upsertUserFromIdentity(tx: Tx, p: { sub: string; name: string; email: string; role: Role; locale?: string }) {
  const [existing] = await tx.select().from(users).where(eq(users.zitadelSub, p.sub));
  if (!existing) {
    const [row] = await tx.insert(users).values({
      zitadelSub: p.sub, name: p.name, email: p.email, role: p.role,
      locale: p.locale === 'es' ? 'es' : 'en',
    }).returning();
    await audit(tx, { table: 'users', recordId: row!.id, action: 'insert', after: row, userId: row!.id, source: 'system' });
    return row!;
  }
  if (existing.role === p.role && existing.name === p.name && existing.email === p.email) return existing;
  const [row] = await tx.update(users).set({ role: p.role, name: p.name, email: p.email, updatedAt: new Date() })
    .where(eq(users.id, existing.id)).returning();
  await audit(tx, { table: 'users', recordId: row!.id, action: 'update', before: existing, after: row, userId: row!.id, source: 'system' });
  return row!;
}
