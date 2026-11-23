import { useT } from '~/i18n';
import { Icon } from './icons';

type SortCode = { id: string; code: string };

/**
 * The routes (sort codes) a driver ran on a day: one chip per route, × takes it off, and a select adds
 * one ("Add a route", then "Add another"). Read-only shows the chips alone.
 */
export function SortCodes({ value, options, label, disabled, onChange }: {
  value: SortCode[]; options: SortCode[]; label: string; disabled?: boolean; onChange: (ids: string[]) => void;
}) {
  const t = useT();
  const ids = value.map((v) => v.id);
  const left = options.filter((o) => !ids.includes(o.id));
  if (disabled) return value.length ? <span className="sort-codes">{value.map((v) => <span key={v.id} className="sort-chip">{v.code}</span>)}</span> : <span className="muted">—</span>;
  return (
    <span className="sort-codes" role="group" aria-label={label}>
      {value.map((v) => (
        <span key={v.id} className="sort-chip">
          {v.code}
          <button type="button" className="sort-chip-x" aria-label={t('td.removeSortCode', { code: v.code })} onClick={() => onChange(ids.filter((x) => x !== v.id))}>
            <Icon name="close" width={14} height={14} />
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select className="input sort-add" aria-label={t(value.length ? 'td.addAnotherSortCode' : 'td.addSortCode')} value=""
          onChange={(e) => e.target.value && onChange([...ids, e.target.value])}>
          <option value="">{t(value.length ? 'td.addAnotherSortCode' : 'td.addSortCode')}</option>
          {left.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
        </select>
      )}
    </span>
  );
}
