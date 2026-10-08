import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { ROLES } from '~/domain/permissions';
import { buttonClass, RoutePlate, WarningDiamond } from '~/ui';
import { LanguageSwitch } from '~/ui/LanguageSwitch';

const search = z.object({ returnTo: z.string().optional(), error: z.string().optional() });

export const Route = createFileRoute('/login')({
  validateSearch: search,
  beforeLoad: ({ context, search: s }) => {
    if (context.session.user) throw redirect({ href: s.returnTo?.startsWith('/') && !s.returnTo.startsWith('//') ? s.returnTo : '/' });
  },
  component: Login,
});

const errors = ['no_role', 'state', 'provider', 'inactive', 'not_configured'] as const;

function Login() {
  const t = useT();
  const { returnTo, error } = Route.useSearch();
  const { session } = Route.useRouteContext();
  const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  const errorKey = errors.find((e) => e === error);
  return (
    <div className="login">
      <section className="login-brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoutePlate code="A" size="lg" /><span className="cond" style={{ fontSize: 28, fontWeight: 700 }}>{t('app.name')}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <h1>{t('login.tagline1')}<br />{t('login.tagline2')}<br />{t('login.tagline3')}</h1>
          <div className="login-plates" aria-hidden="true">
            {['9000A', '9000B', '9000E', '9000K', '9000N', 'DUB1'].map((c) => <RoutePlate key={c} code={c} size="lg" />)}
            <RoutePlate code="9000Z" size="lg" needsDriver />
          </div>
          <p>{t('login.lead')}</p>
        </div>
        <span style={{ fontSize: 14, color: '#9AA5A0' }}>{t('login.builtBy')}</span>
      </section>
      <section className="login-form">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><LanguageSwitch /></div>
        <div className="login-card">
          <h2>{t('login.title')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('login.hint')}</p>
          {errorKey && (
            <p className="notice" role="alert" style={{ margin: 0 }}><WarningDiamond size={22} />{t(`login.error.${errorKey}` as MessageKey)}</p>
          )}
          <a className={buttonClass('primary', 'lg')} href={`/auth/login${qs}`}>{t('login.button')}</a>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('login.noAccount')}</p>
          {session.devLogin && (
            <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong>{t('login.dev')}</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ROLES.map((r) => (
                  <a key={r} className={buttonClass('secondary', 'sm')} href={`/auth/dev?role=${r}&lang=${session.locale}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`}>
                    {t('login.devAs', { role: t(`role.${r}`) })}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
