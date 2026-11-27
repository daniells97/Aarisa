import type { PillTone } from './Pill';

export type RowStatus = 'confirmed' | 'proposed' | 'off';

/**
 * The status of a row of Daily operations, changeable in place: looks like the status pill, opens the
 * phone's own list. Only the three statuses people choose; the rest (no driver, contractor…) stay a plain pill.
 */
export function StatusSelect({ value, label, options, tone, onChange }: {
  value: RowStatus; label: string; tone: PillTone;
  options: { value: RowStatus; label: string }[];
  onChange: (v: RowStatus) => void;
}) {
  return (
    <span className={`pill pill-${tone} status-select`}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as RowStatus)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}
