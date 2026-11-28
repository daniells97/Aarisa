import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '~/i18n';
import { requestPasswordReset } from '~/server/password-fns';
import { BrandLogo, Button } from '~/ui';
import { FormError, TextField } from '~/ui/Field';
import { LanguageSwitch } from '~/ui/LanguageSwitch';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPassword });

function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await requestPasswordReset({ data: { email } });
      setSent(true);
    } catch {
      setError(t('error.generic'));
    }
  };
  return (
    <div className="login">
      <section className="login-form">
        <div className="login-top">
          <span className="login-form-logo"><BrandLogo height={76} /></span>
          <LanguageSwitch />
        </div>
        <div className="login-card">
          <h2>{t('forgot.title')}</h2>
          {sent ? (
            <p role="status" style={{ margin: 0 }}>{t('forgot.sent', { email })}</p>
          ) : (
            <form onSubmit={submit} className="stack">
              <p className="muted" style={{ margin: 0 }}>{t('forgot.lead')}</p>
              <TextField label={t('team.email')} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <FormError>{error}</FormError>
              <Button type="submit" variant="primary" size="lg">{t('forgot.send')}</Button>
            </form>
          )}
          <Link to="/login">{t('forgot.back')}</Link>
        </div>
      </section>
    </div>
  );
}
