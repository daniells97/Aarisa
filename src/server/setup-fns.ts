import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { zitadelAdminConfig } from '~/integrations/zitadel';
import { read, run } from './fn';
import { addContractor, addDriver, addRate, addService, loadSetup, updateDriver, updateService } from './setup';
import { listTeam, recordRoleChange, updateTeamMember } from './team';
import { inviteUser, setUserRole } from '~/integrations/zitadel';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(100_000_00).nullable();
const uuid = z.string().uuid();

export const getSetup = createServerFn({ method: 'GET' }).handler(() => read('payroll.view', (tx, actor) => loadSetup(tx, actor, todayLA())));

export const createRate = createServerFn({ method: 'POST' })
  .validator(z.object({ serviceTypeId: uuid, tier: z.enum(['t1_3', 't4']).nullable(), clientRateCents: cents, driverRateCents: cents, effectiveFrom: isoDate }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await addRate(tx, actor, data)).id));

const driverInput = z.object({
  fullName: z.string().max(120),
  hovershipCode: z.string().max(20).nullable(),
  contractorId: uuid.nullable(),
  phone: z.string().max(30).nullable(),
  aliases: z.array(z.string().max(80)).max(20),
  active: z.boolean(),
});

export const saveDriver = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid.nullable(), driver: driverInput }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) =>
    (data.id ? await updateDriver(tx, actor, data.id, data.driver) : await addDriver(tx, actor, data.driver)).id));

const serviceFields = {
  name: z.string().max(80),
  nameEs: z.string().max(80).nullable(),
  requiresOrderNumber: z.boolean(),
  requiresNote: z.boolean(),
};

export const createService = createServerFn({ method: 'POST' })
  .validator(z.object({ ...serviceFields, operation: z.enum(['tforce', 'hovership']) }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await addService(tx, actor, data)).id));

export const saveService = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid(), ...serviceFields, active: z.boolean() }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => {
    const { id, ...input } = data;
    return (await updateService(tx, actor, id, input)).id;
  }));

export const createContractor = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().max(120) }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await addContractor(tx, actor, data.name)).id));

export const getTeam = createServerFn({ method: 'GET' }).handler(() =>
  read('team.manage', async (tx, actor) => ({ members: await listTeam(tx, actor), zitadelConnected: zitadelAdminConfig() !== null })));

export const saveTeamMember = createServerFn({ method: 'POST' })
  .validator(z.object({
    id: uuid, phone: z.string().max(30).nullable(), morningChannel: z.enum(['whatsapp', 'email', 'none']),
    locale: z.enum(['en', 'es']), active: z.boolean(),
  }))
  .handler(({ data }) => run('team.manage', async (tx, actor) => {
    const { id, ...input } = data;
    return (await updateTeamMember(tx, actor, id, input)).id;
  }));

const role = z.enum(['owner', 'dispatcher', 'finance', 'viewer']);

export const changeRole = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, role }))
  .handler(({ data }) => run('team.manage', async (tx, actor) => {
    const cfg = zitadelAdminConfig();
    if (!cfg) return { pending: true };
    const user = await recordRoleChange(tx, actor, data.id, data.role);
    await setUserRole(cfg, user.zitadelSub, data.role); // the transaction rolls back if Zitadel refuses
    return { pending: false };
  }));

export const invite = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().email(), givenName: z.string().min(1).max(60), familyName: z.string().min(1).max(60), role, locale: z.enum(['en', 'es']) }))
  .handler(({ data }) => run('team.manage', async () => {
    const cfg = zitadelAdminConfig();
    if (!cfg) return { invited: false };
    await inviteUser(cfg, data);
    return { invited: true };
  }));
