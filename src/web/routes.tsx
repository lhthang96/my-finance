// Route table. Each entry maps a hash path to a page component.
//
// To register a real page (B2): create src/web/pages/<Name>.tsx exporting a component, import it here and
// replace the ComingSoon placeholder in that entry's `component`. Set `tab: true` for bottom-bar / sidebar
// entries; `tab: false` pages (like History) are reached by link and show a back button.
import type { ComponentType } from 'react';
import type { TKey } from '../shared/i18n';
import { HomePage } from './pages/Home';
import { ComingSoon } from './pages/ComingSoon';
import { useHashPath } from './lib/router';
import type { IconName } from './components/icons';

export interface RouteDef {
  path: string;
  titleKey: TKey;
  icon: IconName | null;
  /** Shown in the bottom tab bar and sidebar. */
  tab: boolean;
  component: ComponentType;
}

export const ROUTES: RouteDef[] = [
  { path: '/', titleKey: 'navHome', icon: 'home', tab: true, component: HomePage },
  {
    path: '/spend',
    titleKey: 'navSpend',
    icon: 'receipt',
    tab: true,
    component: () => <ComingSoon titleKey="spendTitle" />,
  },
  {
    path: '/plan',
    titleKey: 'navPlan',
    icon: 'plan',
    tab: true,
    component: () => <ComingSoon titleKey="planTitle" />,
  },
  {
    path: '/assets',
    titleKey: 'navAssets',
    icon: 'assets',
    tab: true,
    component: () => <ComingSoon titleKey="assetsTitle" />,
  },
  {
    path: '/settings',
    titleKey: 'navSettings',
    icon: 'settings',
    tab: true,
    component: () => <ComingSoon titleKey="settingsTitle" />,
  },
  {
    path: '/history',
    titleKey: 'viewHistory',
    icon: null,
    tab: false,
    component: () => <ComingSoon titleKey="viewHistory" back />,
  },
];

export const HOME_ROUTE: RouteDef = ROUTES[0];

/** Route for a hash path; unknown paths fall back to Home. */
export function findRoute(path: string): RouteDef {
  return ROUTES.find((r) => r.path === path) ?? HOME_ROUTE;
}

export function useRoute(): RouteDef {
  return findRoute(useHashPath());
}
