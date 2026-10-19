import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { run } from './fn';
import { removeContact, saveContact, updateClient, updateContractRules } from './clients';

const uuid = z.string().uuid();
const text = (max: number) => z.string().max(max).nullable();

export const saveClient = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, displayName: z.string().max(120), legalName: text(160), taxId: text(40), billingAddress: text(300), notes: text(1000) }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => {
    const { id, ...input } = data;
    return (await updateClient(tx, actor, id, input)).id;
  }));

export const saveClientContact = createServerFn({ method: 'POST' })
  .validator(z.object({
    id: uuid.nullable(), clientId: uuid, role: z.enum(['billing', 'claims', 'operations', 'other']),
    fullName: text(120), email: text(200), phone: text(30), isPrimary: z.boolean(),
  }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => {
    const { id, ...input } = data;
    return (await saveContact(tx, actor, id, input)).id;
  }));

export const deleteClientContact = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await removeContact(tx, actor, data.id)).id));

export const saveContractRules = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, paymentTermsDays: z.number().int().min(0).max(365), blocksPayrollOnExceptions: z.boolean(), lowQuantityThresholdBp: z.number().int().min(0).max(10_000) }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => {
    const { id, ...input } = data;
    return (await updateContractRules(tx, actor, id, input)).id;
  }));
