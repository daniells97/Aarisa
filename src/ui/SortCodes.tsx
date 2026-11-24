import { useState } from 'react';
import { useT } from '~/i18n';
import { Icon } from './icons';

type SortCode = { id: string; code: string };
const NEW = '__new__';

/**
 * The routes (sort codes) a driver ran on a day: one chip per route, × takes it off, and a select adds
 * one ("Add a route", then "Add another"). Read-only shows the chips alone. `suggested` chips are the
 * driver's usual routes, not saved yet: dashed, until the day is confirmed or someone edits them.
 * With `onCreate`, the select's last option creates a route that isn't on the list yet, right there.
 */
export function SortCodes({ value, options, label, disabled, suggested = false, onChange, onCreate }: {
  value: SortCode[]; options: SortCode[]; label: string; disabled?: boolean; suggested?: boolean; onChange: (ids: string[]) => void;
  /** Creates a route with the typed code; returns its id, or null when it couldn't (the caller says why). */
  onCreate?: (code: string) => Promise<string | null>;
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = value.map((v) => v.id);
  const left = options.filter((o) => !ids.includes(o.id));
  const chip = ['sort-chip', suggested && 'suggested'].filter(Boolean).join(' ');
  const hint = suggested ? <span className="sort-hint">{t('td.usualRoutes')}</span> : null;
  if (disabled) return value.length ? <span className="sort-codes">{value.map((v) => <span key={v.id} className={chip}>{v.code}</span>)}{hint}</span> : <span className="muted">—</span>;
  const save = async () => {
    const typed = code.trim();
    if (!typed || !onCreate) return;
    // Typed a route that already exists: just add it.
    const known = options.find((o) => o.code.toLowerCase() === typed.toLowerCase());
    setBusy(true);
    try {
      const id = known?.id ?? (await onCreate(typed));
      if (!id) return;
      setCreating(false); setCode('');
      if (!ids.includes(id)) onChange([...ids, id]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="sort-codes" role="group" aria-label={label}>
      {value.map((v) => (
        <span key={v.id} className={chip}>
          {v.code}
          <button type="button" className="sort-chip-x" aria-label={t('td.removeSortCode', { code: v.code })} onClick={() => onChange(ids.filter((x) => x !== v.id))}>
            <Icon name="close" width={14} height={14} />
          </button>
        </span>
      ))}
      {hint}
      {creating ? (
        <span className="sort-new">
          <input className="input sort-add" autoFocus maxLength={30} placeholder={t('td.newSortCodePlaceholder')} aria-label={t('td.newSortCode')} value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } if (e.key === 'Escape') { setCreating(false); setCode(''); } }} />
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !code.trim()} onClick={() => void save()}>{t('td.saveSortCode')}</button>
          <button type="button" className="btn btn-sm" onClick={() => { setCreating(false); setCode(''); }}>{t('common.cancel')}</button>
        </span>
      ) : (left.length > 0 || onCreate) && (
        <select className="input sort-add" aria-label={t(value.length ? 'td.addAnotherSortCode' : 'td.addSortCode')} value=""
          onChange={(e) => { if (e.target.value === NEW) setCreating(true); else if (e.target.value) onChange([...ids, e.target.value]); }}>
          <option value="">{t(value.length ? 'td.addAnotherSortCode' : 'td.addSortCode')}</option>
          {left.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
          {onCreate && <option value={NEW}>{t('td.createSortCode')}</option>}
        </select>
      )}
    </span>
  );
}
