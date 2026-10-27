import type { Locale } from '~/i18n';

/** Service name in the user's language: the Spanish name when set, else the English one. Names are edited in Drivers and rates. */
export function serviceLabel(s: { name: string; nameEs?: string | null }, locale: Locale) {
  return locale === 'es' && s.nameEs ? s.nameEs : s.name;
}
