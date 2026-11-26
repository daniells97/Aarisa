import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { throughPortal } from './invite-link';
import { driverInput } from './driver-input';
import { todayLA } from '~/domain/dates';
import { zitadelAdminConfig } from '~/integrations/zitadel';
import { read, run } from './fn';
import { addContractor, addDriver, addRate, addService, loadSetup, updateDriver, updateService } from './setup';
import { listTeam, recordInvite, recordRoleChange, updateTeamMember } from './team';
import { addSortCode, loadSortCodes, setUsualSortCodes, updateSortCode } from './sort-codes';
import { inviteUser, setUserRole } from '~/integrations/zitadel';
import { sendMail } from '~/integrations/mail';
import { translate } from '~/i18n';
import { inviteEmail, accessEmail } from './emails';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(100_000_00).nullable();
const uuid = z.string().uuid();

export const getSetup = createServerFn({ method: 'GET' }).handler(() => read('payroll.view', (tx, actor) => loadSetup(tx, actor, todayLA())));

export const createRate = createServerFn({ method: 'POST' })
  .validator(z.object({ serviceTypeId: uuid, tierId: uuid.nullable(), clientRateCents: cents, driverRateCents: cents, effectiveFrom: isoDate, reason: z.string().max(200).nullable().optional() }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await addRate(tx, actor, data)).id));



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
  .validator(z.object({ ...serviceFields, operation: z.string().regex(/^[a-z0-9_]{1,40}$/) }))
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
    locale: z.enum(['en', 'es']), active: z.boolean(), canRecordLoans: z.boolean().optional(),
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
  .handler(({ data }) => run('team.manage', async (tx, actor) => {
    const cfg = zitadelAdminConfig();
    if (!cfg) return { invited: false, emailed: false, link: null };
    const invited = await inviteUser(cfg, data);
    await recordInvite(tx, actor, { ...data, sub: invited.userId });
    // Already has a password: the email just says they have access, with a button to sign in.
    const link = invited.link ? throughPortal(invited.link) : `${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}/auth/login`;
    // From Aarisa's mailbox; without mail set up (or if Resend refuses) the owner gets the link to share.
    const emailed = await sendMail(invited.link ? inviteEmail(data.locale, data.email, link, data.givenName) : accessEmail(data.locale, data.email, data.givenName));
    return { invited: true, emailed, link: emailed ? null : link };
  }));

// ---------- routes (sort codes) and each driver code's usual routes ----------

export const getSortCodesSetup = createServerFn({ method: 'GET' }).handler(() => read('payroll.view', (tx, actor) => loadSortCodes(tx, actor)));

/** "Create a new route" from the route picker on Today's drivers. */
export const createSortCodeFromDay = createServerFn({ method: 'POST' })
  .validator(z.object({ operation: z.string().max(40), code: z.string().max(30) }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const row = await addSortCode(tx, actor, data, true);
    return { id: row.id, code: row.code };
  }));

export const createSortCode = createServerFn({ method: 'POST' })
  .validator(z.object({ operation: z.string().max(40), code: z.string().max(30) }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await addSortCode(tx, actor, data)).id));

export const saveSortCode = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, code: z.string().max(30), active: z.boolean() }))
  .handler(({ data }) => run('setup.edit', async (tx, actor) => (await updateSortCode(tx, actor, data.id, data)).id));

export const saveUsualSortCodes = createServerFn({ method: 'POST' })
  .validator(z.object({ routeId: uuid, sortCodeIds: z.array(uuid).max(20) }))
  .handler(({ data }) => run('setup.edit', (tx, actor) => setUsualSortCodes(tx, actor, data)));
