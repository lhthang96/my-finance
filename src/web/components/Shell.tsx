// App chrome: left sidebar (>= 900px), bottom tab bar (< 900px), floating + button, status chip.
// Tabs come from the route table (routes.tsx), so adding a page there adds its tab here.
import { t } from '../../shared/i18n';
import { ROUTES, useRoute, type RouteDef } from '../routes';
import { useStore } from '../lib/store';
import { Icon } from './icons';
import { useQuickAdd } from './QuickAdd';
import { cls } from './ui';

export function Shell() {
  const route = useRoute();
  const { locale, pending, online } = useStore();
  const quick = useQuickAdd();
  const tabs = ROUTES.filter((r) => r.tab);
  const Page = route.component;

  return (
    <div className="app">
      <aside className="sidebar" aria-label={t(locale, 'appName')}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{t(locale, 'appName')}</span>
        </div>
        <nav className="side-nav">
          {tabs.map((r) => (
            <NavItem key={r.path} route={r} locale={locale} active={r.path === route.path} variant="side" />
          ))}
        </nav>
      </aside>

      <div className="content">
        {(pending > 0 || !online) && (
          <div className="status-chip" data-testid="pending-badge" role="status">
            {!online && <span>{t(locale, 'statusOffline')}</span>}
            {pending > 0 && <span>{t(locale, 'pendingCount', { n: pending })}</span>}
          </div>
        )}
        <main className="main" id="main">
          <div key={route.path} className="route-enter">
            <Page />
          </div>
        </main>
      </div>

      <nav className="tabbar" aria-label={t(locale, 'appName')}>
        {tabs.map((r) => (
          <NavItem key={r.path} route={r} locale={locale} active={r.path === route.path} variant="tab" />
        ))}
      </nav>

      <button
        type="button"
        className="fab"
        data-testid="quick-add-fab"
        onClick={quick.open}
        aria-label={t(locale, 'quickAdd')}
        title={t(locale, 'quickAdd')}
      >
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}

function NavItem({
  route,
  locale,
  active,
  variant,
}: {
  route: RouteDef;
  locale: 'en' | 'vi';
  active: boolean;
  variant: 'tab' | 'side';
}) {
  const label = t(locale, route.titleKey);
  return (
    <a
      href={`#${route.path}`}
      className={cls(variant === 'tab' ? 'tab' : 'side-item', active && 'is-active')}
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${route.path.slice(1) || 'home'}`}
    >
      {route.icon && <Icon name={route.icon} size={variant === 'tab' ? 22 : 20} />}
      <span>{label}</span>
    </a>
  );
}
