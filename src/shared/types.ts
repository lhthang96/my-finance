export type Locale = 'en' | 'vi';

export interface ReminderSetting {
  enabled: boolean;
  hour: number;
}

export interface Settings {
  salary: number;
  targetMultiple: number;
  expectedReturn: number;
  horizons: number[];
  locale: Locale;
  reminders: {
    dailyLog: ReminderSetting;
    monthEnd: ReminderSetting;
    maturity: ReminderSetting;
  };
  timezone: string;
}

export const DEFAULT_SETTINGS: Settings = {
  salary: 58000000,
  targetMultiple: 30,
  expectedReturn: 0.065,
  horizons: [5, 10],
  locale: 'vi',
  reminders: {
    dailyLog: { enabled: true, hour: 21 },
    monthEnd: { enabled: true, hour: 20 },
    maturity: { enabled: true, hour: 9 },
  },
  timezone: 'Asia/Ho_Chi_Minh',
};

/** Keys of the settings table that map to Settings fields (internal keys such as loginFailures are excluded). */
export const SETTINGS_KEYS: readonly (keyof Settings)[] = [
  'salary',
  'targetMultiple',
  'expectedReturn',
  'horizons',
  'locale',
  'reminders',
  'timezone',
];

export interface SpendingItem {
  id: number;
  name: string;
  amount: number;
  period: 'month' | 'year';
  sort: number;
}

export type AssetType = 'deposit' | 'cash' | 'stock' | 'receivable' | 'other';

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  /** null for plain amounts; otherwise amount is the unit price. */
  quantity: number | null;
  amount: number;
  /** 0 | 1 (SQLite integer). */
  counts_toward_fi: number;
  /** Decimal fraction, e.g. 0.065 for 6.5%. */
  interest_rate: number | null;
  /** YYYY-MM-DD */
  start_date: string | null;
  term_months: number | null;
  note: string;
  sort: number;
  updated_at: string | null;
}

export interface Category {
  id: number;
  key: string;
  name_en: string;
  name_vi: string;
  icon: string;
  color: string;
  sort: number;
  /** 0 | 1 */
  archived: number;
}

export interface Transaction {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  kind: 'expense' | 'income';
  category_id: number | null;
  note: string;
  created_at: string;
}

export interface Snapshot {
  /** YYYY-MM */
  month: string;
  net_worth: number;
  fi_assets: number;
  income: number;
  spending: number | null;
  created_at: string;
}

export interface PlanRow {
  years: number;
  requiredMonthly: number;
  /** max(0, requiredMonthly - monthlySaving) */
  extraNeeded: number;
}

export interface Summary {
  monthlySpending: number;
  annualSpending: number;
  fiTarget: number;
  netWorth: number;
  fiAssets: number;
  progress: number;
  remaining: number;
  passiveMonthly: number;
  coverage: number;
  monthlySaving: number;
  savingsRate: number;
  /** null when saving <= 0 and the target is not yet reached. */
  yearsToGoal: number | null;
  /** YYYY-MM-DD, or null when yearsToGoal is null. */
  fiDate: string | null;
  plans: PlanRow[];
}

export interface AppState {
  settings: Settings;
  spendingItems: SpendingItem[];
  assets: Asset[];
  categories: Category[];
  snapshots: Snapshot[];
  monthTransactions: Transaction[];
  summary: Summary;
}
