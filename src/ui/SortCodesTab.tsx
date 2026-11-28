import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { createSortCode, saveSortCode, saveUsualSortCodes, type getSortCodesSetup } from '~/server/setup-fns';
import { saveHovershipUsual } from '~/server/hovership-fns';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { CheckField, FormError, TextField } from './Field';
import { Panel } from './Panel';
import { RoutePlate } from './RoutePlate';
import { SortCodes } from './SortCodes';
import { useToast } from './Toast';

type Data = Awaited<ReturnType<typeof getSortCodesSetup>>;
type Op = Data['operations'][number];
type Code = Op['sortCodes'][number];

/** Drivers and rates → Routes: each contract's routes (sort codes) and each T-Force driver's usual routes. */
export function SortCodesTab({ data }: { data: Data }) {
  const t = useT();
  const [editing, setEditing] = useState<Code | null>(null);
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('sc.lead')}</p>
      {data.operations.map((op) => <OpCodes key={op.code} op={op} canEdit={data.canEdit} onEdit={setEditing} />)}
      {data.operations.filter((op) => op.drivers.length > 0).map((op) => <UsualRoutes key={op.code} op={op} canEdit={data.canEdit} />)}
      {data.operations.filter((op) => op.people.length > 0).map((op) => <PeopleUsualRoutes key={op.code} op={op} canEdit={data.canEdit} />)}
      {editing && <EditDialog code={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OpCodes({ op, canEdit, onEdit }: { op: Op; canEdit: boolean; onEdit: (c: Code) => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await createSortCode({ data: { operation: op.code, code } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    setError(null);
    setCode('');
    await router.invalidate();
    toast(t('sc.added', { code: code.trim() }));
  };
  const active = op.sortCodes.filter((c) => c.active);
  const inactive = op.sortCodes.filter((c) => !c.active);
  return (
    <Panel title={t('sc.opTitle', { client: op.name, count: active.length })}>
      <div className="panel-body stack">
        <div className="sort-codes">
          {active.length === 0 && <span className="muted">{t('sc.none')}</span>}
          {active.map((c) => canEdit
            ? <button key={c.id} type="button" className="sort-chip sort-chip-btn" onClick={() => onEdit(c)} aria-label={t('sc.editCode', { code: c.code })}>{c.code}</button>
            : <span key={c.id} className="sort-chip">{c.code}</span>)}
        </div>
        {inactive.length > 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {t('sc.inactive')}{' '}
            {inactive.map((c, i) => (
              <span key={c.id}>{i > 0 && ', '}{canEdit ? <button type="button" className="link-btn" onClick={() => onEdit(c)}>{c.code}</button> : c.code}</span>
            ))}
          </p>
        )}
        {canEdit && (
          <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
            <TextField label={t('sc.newCode')} hint={t('sc.newCodeHint')} required maxLength={30} value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit">{t('sc.add')}</Button>
          </form>
        )}
        <FormError>{error}</FormError>
      </div>
    </Panel>
  );
}

function UsualRoutes({ op, canEdit }: { op: Op; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const options = op.sortCodes.filter((c) => c.active);
  const create = async (code: string) => {
    const res = await createSortCode({ data: { operation: op.code, code } });
    if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); return null; }
    toast(t('sc.added', { code: code.trim() }));
    return res.value;
  };
  return (
    <Panel title={t('sc.usualTitle', { client: op.name })}>
      <p className="panel-body muted" style={{ margin: 0 }}>{t('sc.usualLead')}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('td.route')}</th><th scope="col">{t('sc.usualRoutes')}</th></tr></thead>
          <tbody>
            {op.drivers.map((d) => (
              <tr key={d.routeId}>
                <td><RoutePlate code={d.code} /></td>
                <td>
                  <SortCodes onCreate={create} value={d.usual} options={options} disabled={!canEdit} label={t('sc.usualFor', { route: d.code })}
                    onChange={async (ids) => {
                      const res = await saveUsualSortCodes({ data: { routeId: d.routeId, sortCodeIds: ids } });
                      if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
                      await router.invalidate();
                    }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Hovership has no driver codes: each person on Hovership keeps usual routes of their own. */
function PeopleUsualRoutes({ op, canEdit }: { op: Op; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const options = op.sortCodes.filter((c) => c.active);
  const create = async (code: string) => {
    const res = await createSortCode({ data: { operation: op.code, code } });
    if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); return null; }
    toast(t('sc.added', { code: code.trim() }));
    return res.value;
  };
  return (
    <Panel title={t('sc.usualPeopleTitle', { client: op.name })}>
      <p className="panel-body muted" style={{ margin: 0 }}>{t('sc.usualPeopleLead')}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('hd.person')}</th><th scope="col">{t('sc.usualRoutes')}</th></tr></thead>
          <tbody>
            {op.people.map((p) => (
              <tr key={p.driverId}>
                <td><strong>{p.name}</strong>{p.code && <span className="sub">{p.code}</span>}</td>
                <td>
                  <SortCodes onCreate={create} value={p.usual} options={options} disabled={!canEdit} label={t('sc.usualForPerson', { name: p.name })}
                    onChange={async (ids) => {
                      const res = await saveHovershipUsual({ data: { driverId: p.driverId, sortCodeIds: ids, operation: op.code } });
                      if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
                      await router.invalidate();
                    }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function EditDialog({ code, onClose }: { code: Code; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ code: code.code, active: code.active });
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await saveSortCode({ data: { id: code.id, ...form } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('sc.saved', { code: form.code.trim() }));
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={t('sc.editTitle', { code: code.code })}>
      <form onSubmit={submit} className="stack">
        <TextField label={t('sc.code')} required maxLength={30} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        <CheckField label={t('sc.activeLabel')} checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('sc.activeHint')}</p>
        {code.used && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('sc.usedNote')}</p>}
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">{t('sc.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
