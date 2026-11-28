import { useT } from '~/i18n';
import { Icon } from './icons';
import { PersonPicker } from './PersonPicker';

type SortCode = { id: string; code: string };

/**
 * The routes (sort codes) a driver ran on a day: one chip per route, × takes it off, and a search field adds
 * one ("Add a route", then "Add another"): type to filter. Read-only shows the chips alone. `suggested` chips
 * are the driver's usual routes, not saved yet: dashed, until the day is confirmed or someone edits them.
 * With `onCreate`, a typed route that isn't on the list can be created right there (first option).
 */
export function SortCodes({ value, options, label, disabled, suggested = false, onChange, onCreate }: {
  value: SortCode[]; options: SortCode[]; label: string; disabled?: boolean; suggested?: boolean; onChange: (ids: string[]) => void;
  /** Creates a route with the typed code; returns its id, or null when it couldn't (the caller says why). */
  onCreate?: (code: string) => Promise<string | null>;
}) {
  const t = useT();
  const ids = value.map((v) => v.id);
  const left = options.filter((o) => !ids.includes(o.id));
  const chip = ['sort-chip', suggested && 'suggested'].filter(Boolean).join(' ');
  const hint = suggested ? <span className="sort-hint">{t('td.usualRoutes')}</span> : null;
  if (disabled) return value.length ? <span className="sort-codes">{value.map((v) => <span key={v.id} className={chip}>{v.code}</span>)}{hint}</span> : <span className="muted">—</span>;
  const create = async (typed: string) => {
    if (!onCreate) return;
    // A route that already exists (maybe already on this row) is just added.
    const known = options.find((o) => o.code.toLowerCase() === typed.toLowerCase());
    const id = known?.id ?? (await onCreate(typed));
    if (id && !ids.includes(id)) onChange([...ids, id]);
  };
  const addLabel = t(value.length ? 'td.addAnotherSortCode' : 'td.addSortCode');
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
      {(left.length > 0 || onCreate) && (
        <span className="sort-add">
          <PersonPicker value="" options={{ drivers: left.map((o) => ({ id: o.id, name: o.code })), contractors: [] }} label={addLabel} placeholder={addLabel}
            allowNone={false} onPick={(v) => v.startsWith('d:') && onChange([...ids, v.slice(2)])}
            onCreate={onCreate ? (typed) => void create(typed) : undefined} createFirst
            createLabel={(typed) => t('td.createSortCodeNamed', { code: typed })} emptyHint={t(onCreate ? 'td.sortCodeSearchOrCreate' : 'td.sortCodeSearch')} />
        </span>
      )}
    </span>
  );
}
