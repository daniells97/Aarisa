import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '~/i18n';

interface ToastItem { id: number; message: string; onUndo?: () => void }
type Show = (message: string, onUndo?: () => void) => void;

const ToastContext = createContext<Show>(() => {});
export const TOAST_MS = 10_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<Show>((message, onUndo) => {
    const id = next.current++;
    setItems((xs) => [...xs, { id, message, onUndo }]);
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
  useEffect(() => {
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <li className="toast">
      <span>{item.message}</span>
      {item.onUndo && (
        <button type="button" onClick={() => { item.onUndo!(); onDone(); }}>{t('common.undo')}</button>
      )}
    </li>
  );
}

/** Show a toast for 10 seconds, with an optional Undo action. */
export function useToast(): Show {
  return useContext(ToastContext);
}
