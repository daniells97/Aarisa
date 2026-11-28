import { useT } from '~/i18n';
import type { Sort, SortKey } from './useLineOrder';

/** A column title you can tap to sort by it (again: reversed). */
export function SortTh({ label, k, sort, choose }: { label: string; k: Exclude<SortKey, 'entry'>; sort: Sort; choose: (k: SortKey) => void }) {
  const on = sort.key === k;
  return (
    <th scope="col" aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className={on ? 'th-sort on' : 'th-sort'} onClick={() => choose(k)}>
        {label}<span aria-hidden="true" className="th-arrow">{on ? (sort.desc ? '↓' : '↑') : '↕'}</span>
      </button>
    </th>
  );
}

/** On a phone: "Sort by" above the cards. */
export function SortSelect({ sort, choose, labels }: { sort: Sort; choose: (k: SortKey) => void; labels: Record<SortKey, string> }) {
  const t = useT();
  return (
    <label className="sort-select phone-only">
      <span>{t('sort.by')}</span>
      <select className="input" value={sort.key} onChange={(e) => choose(e.target.value as SortKey)}>
        {(Object.keys(labels) as SortKey[]).map((k) => <option key={k} value={k}>{labels[k]}</option>)}
      </select>
    </label>
  );
}
