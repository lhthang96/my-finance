// Root component: providers, then the gate that picks login, error, loading or the app shell.
import { Card, PageHeader, Skeleton, ToastProvider } from './components/ui';
import { Shell } from './components/Shell';
import { QuickAddProvider } from './components/QuickAdd';
import { LoginPage } from './pages/Login';
import { StoreProvider, useStore } from './lib/store';
import { t } from '../shared/i18n';

export function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <QuickAddProvider>
          <Gate />
        </QuickAddProvider>
      </StoreProvider>
    </ToastProvider>
  );
}

function Gate() {
  const { status, locale, reload } = useStore();
  if (status === 'login') return <LoginPage />;
  if (status === 'error') {
    return (
      <div className="login">
        <Card className="login-card">
          <PageHeader title={t(locale, 'appName')} />
          <p className="muted">{t(locale, 'loadFailed')}</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => void reload()}>
            {t(locale, 'retryLoad')}
          </button>
        </Card>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="splash" aria-busy="true">
        <Skeleton className="sk-hero" />
        <Skeleton className="sk-card" />
      </div>
    );
  }
  return <Shell />;
}
