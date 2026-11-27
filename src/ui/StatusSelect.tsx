import { useEffect, useId, useRef, useState } from 'react';
import type { PillTone } from './Pill';
import { Icon } from './icons';

export type RowStatus = 'confirmed' | 'proposed' | 'off';

/** One color per status, the same in the row, the menu and the history. */
export const STATUS_TONE: Record<RowStatus, PillTone> = { confirmed: 'ok', proposed: 'waiting', off: 'bad' };

/**
 * The status of a row of Daily operations, changeable in place: the colored pill opens a small menu with the
 * statuses people choose, each in its color. Escape or a tap outside closes it; arrow keys move in the menu.
 */
export function StatusSelect({ value, label, options, onChange }: {
  value: RowStatus; label: string; tone?: PillTone;
  options: { value: RowStatus; label: string }[];
  onChange: (v: RowStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const menuId = useId();
  const current = options.find((o) => o.value === value) ?? options[0]!;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    // Focus the chosen option so arrows and Enter work right away.
    wrap.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);
  const keys = (e: React.KeyboardEvent) => {
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { setOpen(false); wrap.current?.querySelector<HTMLButtonElement>('.status-btn')?.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  return (
    <span className="status-select" ref={wrap} onKeyDown={keys}>
      <button type="button" className={`pill pill-${STATUS_TONE[current.value]} status-btn`} aria-haspopup="menu" aria-expanded={open}
        aria-controls={menuId} aria-label={`${label}: ${current.label}`} onClick={() => setOpen((o) => !o)}>
        {current.label}<Icon name="chevronDown" width={14} height={14} />
      </button>
      {open && (
        <span className="status-menu" role="menu" id={menuId} aria-label={label}>
          {options.map((o) => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} className="status-option"
              onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}>
              <span className={`pill pill-${STATUS_TONE[o.value]}`}>{o.label}</span>
              {o.value === value && <Icon name="check" width={16} height={16} />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
