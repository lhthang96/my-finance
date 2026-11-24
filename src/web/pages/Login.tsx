// Passcode screen. The passcode is sent once to /api/auth/login; the server sets a one-year session cookie.
import { useState, type FormEvent } from 'react';
import { t } from '../../shared/i18n';
import type { Locale } from '../../shared/types';
import { useStore } from '../lib/store';
import { cls } from '../components/ui';

export function LoginPage() {
  const { locale, login, setLocale } = useStore();
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    const res = await login(passcode);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.reason === 'wrong'
          ? t(locale, 'wrongPasscode')
          : res.reason === 'limited'
            ? t(locale, 'tooManyAttempts')
            : t(locale, 'errorGeneric'),
      );
      setPasscode('');
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true" />
        <h1>{t(locale, 'appName')}</h1>
        <p className="muted">{t(locale, 'loginSubtitle')}</p>
        <form onSubmit={submit} className="login-form">
          <label className="field">
            <span className="field-label">{t(locale, 'passcode')}</span>
            <input
              className={cls('input input-lg', error && 'is-invalid')}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              aria-invalid={error !== null}
              aria-label={t(locale, 'loginTitle')}
              data-testid="passcode"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!passcode || busy}>
            {t(locale, 'loginButton')}
          </button>
        </form>
        <p className="muted small login-hint">{t(locale, 'loginRemember')}</p>
        <LocaleToggle locale={locale} onChange={setLocale} />
      </div>
    </div>
  );
}

export function LocaleToggle({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  return (
    <div className="seg seg-sm" role="group" aria-label={t(locale, 'language')}>
      <button type="button" className={cls(locale === 'en' && 'is-active')} aria-pressed={locale === 'en'} onClick={() => onChange('en')}>
        EN
      </button>
      <button type="button" className={cls(locale === 'vi' && 'is-active')} aria-pressed={locale === 'vi'} onClick={() => onChange('vi')}>
        VI
      </button>
    </div>
  );
}
