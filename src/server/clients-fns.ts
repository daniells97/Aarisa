import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { run } from './fn';
import { createClientWithContract, removeContact, saveContact, saveLayout, updateClient, updateContractRules } from './clients';

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

export const createClient = createServerFn({ method: 'POST' })
  .validator(z.object({
    clientName: z.string().max(120), contractName: z.string().max(120), driverSource: z.enum(['report_code', 'daily_list']),
    payCycle: z.enum(['weekly', 'biweekly']), cycleAnchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentTermsDays: z.number().int().min(0).max(365), weeklySettlementKind: z.enum(['invoice', 'weekly_statement']),
  }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => createClientWithContract(tx, actor, data)));

const meaning = z.enum(['work_date', 'driver_code', 'driver_name', 'route_code', 'quantity', 'bonus', 'other_revenue', 'other_revenue_reason', 'expected_pay', 'ignore']);

export const saveReportLayout = createServerFn({ method: 'POST' })
  .validator(z.object({
    operationId: uuid,
    columns: z.array(z.object({
      sourceName: z.string().min(1).max(100), meaning, required: z.boolean(),
      serviceTypeId: uuid.nullable().optional(),
      newService: z.object({ name: z.string().min(1).max(60), unit: z.enum(['package', 'stop', 'piece']) }).nullable().optional(),
      tierCode: z.string().max(20).nullable().optional(), revenueName: z.string().max(60).nullable().optional(),
    })).min(1).max(60),
  }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await saveLayout(tx, actor, data.operationId, data.columns)).id));
