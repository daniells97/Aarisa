import { useRouter } from '@tanstack/react-router';
import { useLocale, useT, type Locale } from '~/i18n';
import { setLocale } from '~/server/session-fns';

/** Two-option language switch (English / Español), shown as a segmented control. */
export function LanguageSwitch({ dark = false }: { dark?: boolean }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const choose = async (l: Locale) => {
    if (l === locale) return;
    await setLocale({ data: { locale: l } });
    await router.invalidate();
  };
  return (
    <div role="group" aria-label={t('lang.label')} className={dark ? 'seg seg-dark' : 'seg'}>
      {(['en', 'es'] as const).map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={locale === l} onClick={() => choose(l)}>
          {l === 'en' ? 'English' : 'Español'}
        </button>
      ))}
    </div>
  );
}
