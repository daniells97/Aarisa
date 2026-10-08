import { useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useLocale, useT, type MessageKey } from '~/i18n';
import { ROLES, can, type Permission, type Role } from '~/domain/permissions';
import { changeRole, getTeam, invite, saveTeamMember } from '~/server/setup-fns';
import { Button, CheckField, Dialog, FormError, PageHead, Panel, Pill, SelectField, TextField, useToast } from '~/ui';

type Team = Awaited<ReturnType<typeof getTeam>>;
type Member = Team['members'][number];

export const Route = createFileRoute('/_app/settings/team')({
  loader: () => getTeam(),
  component: TeamPage,
});

const MATRIX: Permission[] = [
  'drivers.confirm_today', 'extra_jobs.log', 'exceptions.clear', 'hovership.enter_bonus', 'payroll.approve',
  'money.view', 'settlements.record', 'setup.edit', 'team.manage',
];

function TeamPage() {
  const t = useT();
  const { members, zitadelConnected } = Route.useLoaderData();
  const [editing, setEditing] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <PageHead title={t('team.title')} lead={t('team.lead')}
        actions={<Button variant="primary" id="invite" onClick={() => setInviting(true)} disabledReason={zitadelConnected ? undefined : t('team.zitadelOff')}>{t('team.invite')}</Button>} />
      <Panel title={t('team.people')} id="people">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('drivers.name')}</th><th scope="col">{t('team.role')}</th><th scope="col">{t('team.morning')}</th>
                <th scope="col">{t('team.status')}</th><th scope="col"><span className="visually-hidden">{t('team.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong>{m.isSelf && <> <Pill tone="muted">{t('team.you')}</Pill></>}<span className="sub">{m.email}</span></td>
                  <td>{t(`role.${m.role}`)}</td>
                  <td>{t(`channel.${m.morningChannel}` as MessageKey)}</td>
                  <td>{m.active ? <Pill tone="ok">{t('team.active')}</Pill> : <Pill tone="muted">{t('team.paused')}</Pill>}</td>
                  <td className="r"><Button size="sm" aria-label={t('team.editTitle', { name: m.name })} onClick={() => setEditing(m)}>{t('drivers.edit')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={t('team.matrixTitle')} id="matrix">
        <p className="panel-body muted" style={{ margin: 0 }}>{t('team.matrixLead')}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">{t('team.action')}</th>{ROLES.map((r) => <th key={r} scope="col" style={{ textAlign: 'center' }}>{t(`role.${r}`)}</th>)}</tr></thead>
            <tbody>
              {MATRIX.map((p) => (
                <tr key={p}>
                  <th scope="row" style={{ fontWeight: 400, color: 'var(--ink)', fontSize: 14.5, whiteSpace: 'normal' }}>{t(`perm.${p}` as MessageKey)}</th>
                  {ROLES.map((r) => (
                    <td key={r} style={{ textAlign: 'center' }}>
                      {can(r, p) ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓<span className="visually-hidden"> {t('team.yes')}</span></span>
                        : <span className="muted">–<span className="visually-hidden"> {t('team.no')}</span></span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {editing && <MemberDialog member={editing} zitadelConnected={zitadelConnected} onClose={() => setEditing(null)} />}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </>
  );
}

function MemberDialog({ member, zitadelConnected, onClose }: { member: Member; zitadelConnected: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    phone: member.phone ?? '', morningChannel: member.morningChannel, locale: member.locale === 'es' ? 'es' as const : 'en' as const,
    active: member.active, role: member.role,
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await saveTeamMember({ data: { id: member.id, phone: form.phone || null, morningChannel: form.morningChannel, locale: form.locale, active: form.active } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      if (form.role !== member.role) {
        const r = await changeRole({ data: { id: member.id, role: form.role } });
        if (!r.ok) return setError(t(`error.${r.code}` as MessageKey));
        toast(t('team.roleSaved'));
      } else toast(t('team.saved'));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('team.editTitle', { name: member.name })}>
      <form onSubmit={submit} className="stack">
        <SelectField label={t('team.role')} value={form.role} disabled={!zitadelConnected || member.isSelf}
          hint={!zitadelConnected ? t('team.zitadelOff') : undefined} onChange={(e) => set('role', e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </SelectField>
        <TextField label={t('drivers.phone')} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        <div className="grid-2">
          <SelectField label={t('team.morning')} value={form.morningChannel} onChange={(e) => set('morningChannel', e.target.value as Member['morningChannel'])}>
            {(['whatsapp', 'email', 'none'] as const).map((c) => <option key={c} value={c}>{t(`channel.${c}`)}</option>)}
          </SelectField>
          <SelectField label={t('team.language')} value={form.locale} onChange={(e) => set('locale', e.target.value as 'en' | 'es')}>
            <option value="en">English</option><option value="es">Español</option>
          </SelectField>
        </div>
        <CheckField label={t('team.canSignIn')} checked={form.active} disabled={member.isSelf} onChange={(e) => set('active', e.target.checked)} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">{t('team.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', givenName: '', familyName: '', role: 'dispatcher' as Role, locale });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await invite({ data: form });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      if (!res.value.invited) return setError(t('team.zitadelOff'));
      toast(t('team.invited', { email: form.email }));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('team.invite')}>
      <form onSubmit={submit} className="stack">
        <TextField label={t('team.email')} type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
        <div className="grid-2">
          <TextField label={t('team.givenName')} required value={form.givenName} onChange={(e) => set('givenName', e.target.value)} />
          <TextField label={t('team.familyName')} required value={form.familyName} onChange={(e) => set('familyName', e.target.value)} />
        </div>
        <div className="grid-2">
          <SelectField label={t('team.role')} value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </SelectField>
          <SelectField label={t('team.language')} value={form.locale} onChange={(e) => set('locale', e.target.value as 'en' | 'es')}>
            <option value="en">English</option><option value="es">Español</option>
          </SelectField>
        </div>
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">{t('team.sendInvite')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
