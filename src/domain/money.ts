/** Money is integer cents everywhere. Format only at the edge. */
export type Cents = number;

/** Parses a decimal amount such as "909.75" or 20 into integer cents without float drift. */
export function toCents(value: string | number): Cents {
  const s = typeof value === 'number' ? value.toString() : value.trim();
  if (s === '') return 0;
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${value}`);
  const [, sign, whole = '', frac = ''] = m;
  const fracPadded = (frac + '00').slice(0, 2);
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new Error(`More than 2 decimals: ${value}`);
  const cents = Number(whole || '0') * 100 + Number(fracPadded);
  return sign ? -cents : cents;
}

export function formatCents(cents: Cents, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
}
