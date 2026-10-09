import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '~/i18n';

export interface PickerOptions {
  drivers: { id: string; name: string; contractor?: string | null }[];
  contractors: { id: string; name: string }[];
}

interface Props {
  /** `d:<id>`, `c:<id>` or '' for nobody. */
  value: string;
  options: PickerOptions;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  allowNone?: boolean;
  state?: 'changed' | 'missing';
  onPick: (value: string) => void;
  /** Called with the typed name when the person isn't on the list. */
  onCreate?: (name: string) => void;
}

type Item = { key: string; value: string; label: string; hint?: string; kind: 'none' | 'contractor' | 'driver' | 'create' };

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Type to find a driver or contractor (ARIA 1.2 combobox with a listbox). When nobody matches,
 * the last option adds the typed name as a new driver, so the whole change happens in the list.
 */
export function PersonPicker({ value, options, label, placeholder, disabled, allowNone = true, state, onPick, onCreate }: Props) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = value.startsWith('d:') ? options.drivers.find((d) => d.id === value.slice(2))?.name
    : value.startsWith('c:') ? options.contractors.find((c) => c.id === value.slice(2))?.name : '';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const items = useMemo<Item[]>(() => {
    const q = norm(query);
    const match = (name: string) => !q || norm(name).includes(q);
    const list: Item[] = [];
    if (allowNone && !q) list.push({ key: 'none', value: '', label: t('td.noDriver'), kind: 'none' });
    for (const c of options.contractors) if (match(c.name)) list.push({ key: `c:${c.id}`, value: `c:${c.id}`, label: c.name, hint: t('pill.contractor'), kind: 'contractor' });
    for (const d of options.drivers) if (match(d.name)) list.push({ key: `d:${d.id}`, value: `d:${d.id}`, label: d.name, hint: d.contractor ?? undefined, kind: 'driver' });
    const exact = [...options.drivers, ...options.contractors].some((p) => norm(p.name) === q);
    if (onCreate && q && !exact) list.push({ key: 'create', value: '', label: t('picker.create', { name: query.trim() }), kind: 'create' });
    return list.slice(0, 60);
  }, [query, options, allowNone, onCreate, t]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery('');
    if (item.kind === 'create') onCreate?.(query.trim().replace(/\s+/g, ' '));
    else if (item.value !== value) onPick(item.value);
    input.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div className="picker" ref={wrap} data-state={state} data-filled={current ? '' : undefined}>
      <input
        ref={input}
        className="input picker-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${items[active]!.key}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={current || placeholder || t('picker.typeName')}
        value={open ? query : current ?? ''}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="picker-list" role="listbox" id={listId} aria-label={label}>
          {items.length === 0 && <li className="picker-empty" role="presentation">{t('picker.noMatch')}</li>}
          {items.map((item, i) => (
            <li
              key={item.key}
              id={`${id}-${item.key}`}
              role="option"
              aria-selected={i === active}
              data-kind={item.kind}
              onMouseDown={(e) => { e.preventDefault(); choose(item); }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{item.label}</span>{item.hint && <span className="picker-hint">{item.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
