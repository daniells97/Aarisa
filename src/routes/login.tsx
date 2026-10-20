import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { ROLES } from '~/domain/permissions';
import { BrandLogo, buttonClass, RoutePlate, WarningDiamond } from '~/ui';
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
        <svg className="login-swoosh" viewBox="0 0 800 260" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
          <path d="M-60 250 C 220 120, 520 70, 860 96" fill="none" stroke="var(--brand-red)" strokeWidth="30" strokeLinecap="round" />
          <path d="M-60 292 C 230 162, 530 114, 860 140" fill="none" stroke="#FFFFFF" strokeOpacity=".9" strokeWidth="12" strokeLinecap="round" />
          <path d="M-60 330 C 240 200, 540 154, 860 180" fill="none" stroke="var(--brand-mid)" strokeWidth="24" strokeLinecap="round" />
        </svg>
        <div className="login-id">
          <span className="login-mark"><BrandLogo variant="mark" height={40} decorative /></span>
          <span>
            <span className="cond login-name">Aarisa Consulting</span>
            <span className="login-sub">Logistics Solutions DR / USA</span>
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, position: 'relative' }}>
          <div>
            <h1>{t('login.headline')}</h1>
            <p className="login-subhead cond">{t('login.subhead')}</p>
          </div>
          <div className="login-plates" aria-hidden="true">
            {['9000A', '9000B', '9000E', '9000K', '9000N', 'DUB1'].map((c) => <RoutePlate key={c} code={c} size="lg" />)}
            <RoutePlate code="9000Z" size="lg" needsDriver />
          </div>
          <p>{t('login.lead')}</p>
          <span className="login-built">{t('login.builtBy')}</span>
        </div>
        <span className="login-swoosh-space" aria-hidden="true" />
      </section>
      <section className="login-form">
        <div className="login-top">
          <span className="login-form-logo"><BrandLogo height={76} /></span>
          <LanguageSwitch />
        </div>
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
