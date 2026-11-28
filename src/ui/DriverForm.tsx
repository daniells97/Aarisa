import { useId, useState } from 'react';
import { useT, type MessageKey } from '~/i18n';
import { Button } from './Button';
import { Sheet } from './Dialog';
import { CheckField, FormError, SelectField, TextField } from './Field';
import { useClientName } from './ClientNames';
import { createDriverToday } from '~/server/daily-fns';

/** What the form sends (the server's driver input). */
export interface DriverFormInput {
  fullName: string;
  hovershipCode: string | null;
  contractorId: string | null;
  phone: string | null;
  aliases: string[];
  active: boolean;
  worksTforce: boolean;
  worksHovership: boolean;
  email: string | null;
  address: string | null;
  licenseNumber: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
}

/** A driver as the form shows it when editing. */
export type DriverFormValue = Omit<DriverFormInput, 'aliases'> & { id: string; aliases: string[] };

type Saved = { ok: true; value: { id: string; name: string } } | { ok: false; code: string };

/**
 * The one driver form, used by Drivers and rates (add and edit) and by Daily operations ("+ New person"),
 * so a person created on the spot has the same details as one added in setup. A bottom sheet on phones.
 */
export function DriverDialog({ driver, initial, contractors, save, onSaved, onClose }: {
  driver?: DriverFormValue | null;
  /** For a new person: what's already known (the typed name, the platform of the list, the company). */
  initial?: Partial<DriverFormInput>;
  contractors: { id: string; name: string }[];
  save: (input: DriverFormInput) => Promise<Saved>;
  onSaved: (saved: { id: string; name: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const clientName = useClientName();
  const formId = useId();
  const start = driver ?? initial ?? {};
  const [form, setForm] = useState({
    fullName: start.fullName ?? '', phone: start.phone ?? '', email: start.email ?? '', address: start.address ?? '',
    licenseNumber: start.licenseNumber ?? '', emergencyName: start.emergencyName ?? '', emergencyPhone: start.emergencyPhone ?? '',
    hovershipCode: start.hovershipCode ?? '', contractorId: start.contractorId ?? '', aliases: (start.aliases ?? []).join(', '),
    active: start.active ?? true, worksTforce: start.worksTforce ?? true, worksHovership: start.worksHovership ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));
  const text = (k: 'fullName' | 'phone' | 'email' | 'address' | 'licenseNumber' | 'emergencyName' | 'emergencyPhone' | 'hovershipCode' | 'aliases') =>
    ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value), autoComplete: 'off' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await save({
        fullName: form.fullName, hovershipCode: form.hovershipCode || null, contractorId: form.contractorId || null,
        phone: form.phone || null, aliases: form.aliases.split(','), active: form.active,
        worksTforce: form.worksTforce, worksHovership: form.worksHovership,
        email: form.email || null, address: form.address || null, licenseNumber: form.licenseNumber || null,
        emergencyName: form.emergencyName || null, emergencyPhone: form.emergencyPhone || null,
      });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      await onSaved(res.value);
      onClose();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={driver ? t('drivers.editNamed', { name: driver.fullName }) : t('drivers.add')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form={formId} variant="primary" disabled={busy}>{t('drivers.save')}</Button>
      </>}>
      <form id={formId} onSubmit={submit} className="stack driver-form">
        <TextField label={t('drivers.fullName')} hint={t('drivers.fullNameHint')} required {...text('fullName')} autoFocus={!start.fullName} />
        <TextField label={t('drivers.license')} autoCapitalize="characters" spellCheck={false} {...text('licenseNumber')} />
        <div className="grid-2">
          <TextField label={t('drivers.phone')} type="tel" inputMode="tel" {...text('phone')} />
          <TextField label={t('drivers.email')} type="email" inputMode="email" autoCapitalize="off" spellCheck={false} {...text('email')} />
        </div>
        <TextField label={t('drivers.address')} {...text('address')} />
        <fieldset className="stack form-group">
          <legend>{t('drivers.emergency')}</legend>
          <div className="grid-2">
            <TextField label={t('drivers.emergencyName')} {...text('emergencyName')} />
            <TextField label={t('drivers.emergencyPhone')} type="tel" inputMode="tel" {...text('emergencyPhone')} />
          </div>
        </fieldset>
        <fieldset className="stack form-group">
          <legend>{t('drivers.sectionWork')}</legend>
          <div className="row" style={{ gap: 4 }} role="group" aria-labelledby={`${formId}-platform`}>
            <span id={`${formId}-platform`} className="form-sub">{t('drivers.drivesFor')}</span>
            <CheckField label={clientName('tforce')} checked={form.worksTforce} onChange={(e) => set('worksTforce', e.target.checked)} />
            <CheckField label={clientName('hovership')} checked={form.worksHovership} onChange={(e) => set('worksHovership', e.target.checked)} />
          </div>
          <div className="grid-2">
            <SelectField label={t('drivers.worksFor')} value={form.contractorId} onChange={(e) => set('contractorId', e.target.value)}>
              <option value="">{t('drivers.aarisa')}</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
            <TextField label={t('drivers.code')} autoCapitalize="characters" spellCheck={false} {...text('hovershipCode')} />
          </div>
          <TextField label={t('drivers.aliases')} hint={t('drivers.aliasesHint')} {...text('aliases')} />
          {driver && <CheckField label={t('drivers.activeLabel')} checked={form.active} onChange={(e) => set('active', e.target.checked)} />}
        </fieldset>
        <FormError>{error}</FormError>
      </form>
    </Sheet>
  );
}

/**
 * "+ New person…" in Daily operations: opens the driver form with the typed name, creates the person
 * (same details as Drivers and rates), then hands the new driver to `then` (assign, cover, add to the list).
 * Returns the opener and the dialog to render.
 */
export function useNewPerson(contractors: { id: string; name: string }[], defaults: Partial<DriverFormInput>) {
  const [req, setReq] = useState<{ initial: Partial<DriverFormInput>; then: (d: { id: string; name: string }) => void | Promise<void> } | null>(null);
  const open = (fullName: string, then: (d: { id: string; name: string }) => void | Promise<void>, extra?: Partial<DriverFormInput>) =>
    setReq({ initial: { ...defaults, fullName, ...extra }, then });
  const dialog = req && (
    <DriverDialog initial={req.initial} contractors={contractors} onClose={() => setReq(null)}
      save={(input) => createDriverToday({ data: input })} onSaved={(d) => req.then(d)} />
  );
  return [open, dialog] as const;
}
