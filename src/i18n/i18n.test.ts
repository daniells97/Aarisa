import { describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import { localeFromHeader, translate } from './index';

describe('i18n', () => {
  it('has a Spanish string for every English key', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const v of Object.values(es)) expect(v.trim()).not.toBe('');
  });
  it('uses sentence case (no all-caps labels)', () => {
    for (const v of [...Object.values(en), ...Object.values(es)]) {
      expect(v.length < 4 || v !== v.toUpperCase() || /^[A-Z]-?[A-Za-z]*$/.test(v)).toBe(true);
    }
  });
  it('translates and fills placeholders', () => {
    expect(translate('es', 'nav.payroll')).toBe('Nómina');
    expect(translate('en', 'nav.payroll', { x: 1 })).toBe('Payroll');
  });
  it('reads Accept-Language', () => {
    expect(localeFromHeader('es-419,es;q=0.9')).toBe('es');
    expect(localeFromHeader('en-US')).toBe('en');
    expect(localeFromHeader(undefined)).toBe('en');
  });
});
