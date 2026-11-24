import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '~/i18n';

interface ToastItem { id: number; message: string; onUndo?: () => void }
type Show = (message: string, onUndo?: () => void) => void;

const ToastContext = createContext<Show>(() => {});
/** A plain message goes away after 4 seconds; one with Undo stays 7 so there is time to tap it. */
export const TOAST_MS = 4_000;
export const TOAST_UNDO_MS = 7_000;
/** At most this many on screen; a new one pushes out the oldest. */
const MAX_TOASTS = 2;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<Show>((message, onUndo) => {
    const id = next.current++;
    setItems((xs) => [...xs, { id, message, onUndo }].slice(-MAX_TOASTS));
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <ul className="toasts" role="status" aria-live="polite">
        {items.map((t) => <Toast key={t.id} item={t} onDone={() => dismiss(t.id)} />)}
      </ul>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const t = useT();
  // The timer starts once: onDone is a new function on every render, and restarting the timer with it
  // kept older messages on screen while new ones arrived.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), item.onUndo ? TOAST_UNDO_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [item.onUndo]);
  return (
    <li className="toast">
      <span onClick={onDone}>{item.message}</span>
      {item.onUndo && (
        <button type="button" onClick={() => { item.onUndo!(); onDone(); }}>{t('common.undo')}</button>
      )}
    </li>
  );
}

/** Show a short message (4 s; 7 s with Undo). Tapping the message closes it. */
export function useToast(): Show {
  return useContext(ToastContext);
}
