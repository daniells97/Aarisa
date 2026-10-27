import { createContext, useContext, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { es } from './es';

export type Locale = 'en' | 'es';
export const LOCALES: Locale[] = ['en', 'es'];
const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, es };

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'es';
}

/** Translate with {name} placeholders. Falls back to English, then to the key. */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = dictionaries[locale][key] ?? en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}

/** Picks a locale from an Accept-Language header. */
export function localeFromHeader(header: string | null | undefined): Locale {
  return header && /^\s*es\b/i.test(header) ? 'es' : 'en';
}

const LocaleContext = createContext<Locale>('en');

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export type { MessageKey };
