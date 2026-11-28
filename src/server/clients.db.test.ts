import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clientContacts, clients } from '~/db/schema';
import { ForbiddenError } from './actor';
import { TFORCE_CSV, actorAs, clearTforceReports, withRollback } from '../../tests/helpers/db';
import { loadClients, saveContact, updateContractRules } from './clients';
import { getOperation } from './ops';
import { loadRun } from './payroll';
import { importTforce, loadTforceWeek } from './tforce';

const owner = actorAs('owner');

describe('clients and contract rules (stage 6a of the redesign)', () => {
  it('lists each client with its contracts and the rules they run with today', () => withRollback(async (tx) => {
    const { clients: rows } = await loadClients(tx, actorAs('viewer'));
    const tforce = rows.find((c) => c.code === 'tforce')!;
    expect(tforce).toMatchObject({ displayName: 'T-Force' });
    expect(tforce.contracts[0]).toMatchObject({ driverSource: 'daily_list', blocksPayrollOnExceptions: true, lowQuantityThresholdBp: 1000, paymentTermsDays: 30 });
    expect(rows.find((c) => c.code === 'hovership')!.contracts[0]).toMatchObject({ driverSource: 'report_code' });
  }));

  it('only the owner edits; one main contact per role', () => withRollback(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.code, 'tforce'));
    const input = { clientId: client!.id, role: 'claims' as const, fullName: 'Ana', email: 'claims@example.com', phone: null, isPrimary: true };
    await expect(saveContact(tx, actorAs('finance'), null, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveContact(tx, owner, null, { ...input, email: null })).rejects.toMatchObject({ code: 'contact_unreachable' });
    await saveContact(tx, owner, null, input);
    await saveContact(tx, owner, null, { ...input, fullName: 'Ben', email: 'ben@example.com' });
    const primaries = (await tx.select().from(clientContacts).where(eq(clientContacts.clientId, client!.id))).filter((c) => c.role === 'claims' && c.isPrimary);
    expect(primaries.map((c) => c.fullName)).toEqual(['Ben']);
  }));

  it('the contract decides whether exceptions block payroll and what counts as low pieces', () => withRollback(async (tx) => {
    const op = await getOperation(tx, 'tforce');
    await clearTforceReports(tx);
    await importTforce(tx, owner, { fileName: 't.csv', text: TFORCE_CSV });
    const lows = async () => (await loadTforceWeek(tx, owner, '2026-06-15')).exceptions.filter((e) => e.type === 'low_pieces').length;
    expect(await lows()).toBe(2); // spec §9: 9000W Thu and 9000Z Fri
    expect((await loadRun(tx, owner, 'tforce-2026-06-15')).blockers.some((b) => b.kind === 'open_exceptions')).toBe(true);

    await expect(updateContractRules(tx, actorAs('finance'), op.id, { paymentTermsDays: 30, blocksPayrollOnExceptions: false, lowQuantityThresholdBp: 2000 })).rejects.toBeInstanceOf(ForbiddenError);
    await updateContractRules(tx, owner, op.id, { paymentTermsDays: 30, blocksPayrollOnExceptions: false, lowQuantityThresholdBp: 2000 });
    expect((await loadRun(tx, owner, 'tforce-2026-06-15')).blockers.some((b) => b.kind === 'open_exceptions')).toBe(false);
    // Open question 12: at 20% 9000J on Jun 17 (15 pieces) is flagged too.
    await clearTforceReports(tx);
    await importTforce(tx, owner, { fileName: 't2.csv', text: TFORCE_CSV });
    expect(await lows()).toBe(3);
  }));
});
