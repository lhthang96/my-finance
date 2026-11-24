// Route table. Each entry maps a hash path to its page component. `tab: true` entries appear in the bottom bar and sidebar;
// `tab: false` pages (History) are reached by link and show a back button.
import type { ComponentType } from 'react';
import type { TKey } from '../shared/i18n';
import { HomePage } from './pages/Home';
import { SpendPage } from './pages/Spend';
import { PlanPage } from './pages/Plan';
import { AssetsPage } from './pages/Assets';
import { SettingsPage } from './pages/Settings';
import { HistoryPage } from './pages/History';
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
    component: SpendPage,
  },
  {
    path: '/plan',
    titleKey: 'navPlan',
    icon: 'plan',
    tab: true,
    component: PlanPage,
  },
  {
    path: '/assets',
    titleKey: 'navAssets',
    icon: 'assets',
    tab: true,
    component: AssetsPage,
  },
  {
    path: '/settings',
    titleKey: 'navSettings',
    icon: 'settings',
    tab: true,
    component: SettingsPage,
  },
  {
    path: '/history',
    titleKey: 'viewHistory',
    icon: null,
    tab: false,
    component: HistoryPage,
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
