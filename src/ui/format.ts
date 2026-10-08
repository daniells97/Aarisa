import { formatCents } from '~/domain/money';
import { formatDate } from '~/domain/dates';
import { useLocale } from '~/i18n';

/** Locale-aware formatters for the edge of the UI. */
export function useFormat() {
  const locale = useLocale();
  const tag = locale === 'es' ? 'es-US' : 'en-US';
  return {
    money: (c: number | null | undefined) => (c == null ? '–' : formatCents(c, tag)),
    number: (n: number) => new Intl.NumberFormat(tag).format(n),
    date: (d: string, opts?: Intl.DateTimeFormatOptions) => formatDate(d, tag, opts),
  };
}

/** Parses a typed amount ("2.50", "$1,234.5") to cents; '' → null; invalid → undefined. */
export function parseAmount(text: string): number | null | undefined {
  const s = text.replace(/[$,\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

export function centsToInput(c: number | null | undefined) {
  return c == null ? '' : (c / 100).toFixed(2);
}
