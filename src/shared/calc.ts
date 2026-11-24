import type { Asset, PlanRow, Settings, SpendingItem, Summary, Transaction } from './types';

type ValueLike = Pick<Asset, 'quantity' | 'amount'>;
type FiLike = ValueLike & Pick<Asset, 'counts_toward_fi'>;
type ItemLike = Pick<SpendingItem, 'amount' | 'period'>;

/** Value of one asset in VND: quantity x unit price when quantity is set, else amount. */
export function assetValue(a: ValueLike): number {
  return a.quantity != null ? a.quantity * a.amount : a.amount;
}

/** Monthly spending: yearly items are divided by 12. Not rounded. */
export function monthlySpending(items: ItemLike[]): number {
  return items.reduce((sum, i) => sum + (i.period === 'year' ? i.amount / 12 : i.amount), 0);
}

export function annualSpending(items: ItemLike[]): number {
  return monthlySpending(items) * 12;
}

export function fiTarget(items: ItemLike[], targetMultiple: number): number {
  return annualSpending(items) * targetMultiple;
}

export function netWorth(assets: ValueLike[]): number {
  return assets.reduce((sum, a) => sum + assetValue(a), 0);
}

/** Sum of asset values where counts_toward_fi is set. */
export function fiAssetsTotal(assets: FiLike[]): number {
  return assets.reduce((sum, a) => (a.counts_toward_fi ? sum + assetValue(a) : sum), 0);
}

/** Monthly equivalent of an annual rate: (1+r)^(1/12) - 1. */
export function monthlyRate(annualRate: number): number {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

/** Spreadsheet PMT(rate, nper, pv, fv, type). */
export function pmt(rate: number, nper: number, pv: number, fv = 0, type = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const f = Math.pow(1 + rate, nper);
  return (-(pv * f + fv) * rate) / ((1 + rate * type) * (f - 1));
}

/** Spreadsheet FV(rate, nper, pmt, pv, type). */
export function fv(rate: number, nper: number, payment: number, pv = 0, type = 0): number {
  if (rate === 0) return -(pv + payment * nper);
  const f = Math.pow(1 + rate, nper);
  return -(pv * f + (payment * (1 + rate * type) * (f - 1)) / rate);
}

/** Spreadsheet NPER(rate, pmt, pv, fv, type). */
export function nper(rate: number, payment: number, pv: number, fv = 0, type = 0): number {
  if (rate === 0) return -(pv + fv) / payment;
  const z = (payment * (1 + rate * type)) / rate;
  return Math.log((z - fv) / (z + pv)) / Math.log(1 + rate);
}

/** Monthly saving needed to reach target within `years`, from current FI assets. */
export function requiredMonthly(years: number, fiAssets: number, target: number, annualRate: number): number {
  return Math.max(0, -pmt(monthlyRate(annualRate), years * 12, -fiAssets, target));
}

/** Years until FI assets reach target at the given monthly saving. 0 if already there; null if not saving. */
export function yearsToGoal(
  fiAssets: number,
  target: number,
  monthlySaving: number,
  annualRate: number,
): number | null {
  if (fiAssets >= target) return 0;
  if (monthlySaving <= 0) return null;
  return nper(monthlyRate(annualRate), -monthlySaving, -fiAssets, target) / 12;
}

/** now + ceil(years x 12) months. */
export function fiDate(now: Date, years: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + Math.ceil(years * 12));
  return d;
}

/** Projected FI assets at the end of each year (1..years) at the current monthly saving. */
export function projection(
  fiAssets: number,
  monthlySaving: number,
  annualRate: number,
  years = 20,
): { year: number; value: number }[] {
  const rm = monthlyRate(annualRate);
  const out: { year: number; value: number }[] = [];
  for (let year = 1; year <= years; year++) {
    out.push({ year, value: fv(rm, year * 12, -monthlySaving, -fiAssets) });
  }
  return out;
}

export function computeSummary(
  settings: Settings,
  items: ItemLike[],
  assets: FiLike[],
  now: Date,
): Summary {
  const monthly = monthlySpending(items);
  const annual = monthly * 12;
  const target = annual * settings.targetMultiple;
  const nw = netWorth(assets);
  const fi = fiAssetsTotal(assets);
  const passive = (fi * settings.expectedReturn) / 12;
  const saving = settings.salary - monthly;
  const years = yearsToGoal(fi, target, saving, settings.expectedReturn);

  const plans: PlanRow[] = settings.horizons.map((y) => {
    const req = requiredMonthly(y, fi, target, settings.expectedReturn);
    return { years: y, requiredMonthly: req, extraNeeded: Math.max(0, req - saving) };
  });

  return {
    monthlySpending: monthly,
    annualSpending: annual,
    fiTarget: target,
    netWorth: nw,
    fiAssets: fi,
    progress: target > 0 ? fi / target : 0,
    remaining: Math.max(0, target - fi),
    passiveMonthly: passive,
    coverage: monthly > 0 ? passive / monthly : 0,
    monthlySaving: saving,
    savingsRate: settings.salary > 0 ? saving / settings.salary : 0,
    yearsToGoal: years,
    fiDate: years == null ? null : fiDate(now, years).toISOString().slice(0, 10),
    plans,
  };
}

/** Total expenses (kind = expense) dated within the given YYYY-MM month. */
export function monthSpendingActual(
  transactions: Pick<Transaction, 'date' | 'amount' | 'kind'>[],
  month: string,
): number {
  return transactions
    .filter((t) => t.kind === 'expense' && t.date.startsWith(month))
    .reduce((sum, t) => sum + t.amount, 0);
}

/** Expenses in the given YYYY-MM month grouped by category, largest first. */
export function byCategory(
  transactions: Pick<Transaction, 'date' | 'amount' | 'kind' | 'category_id'>[],
  month: string,
): { category_id: number | null; amount: number }[] {
  const totals = new Map<number | null, number>();
  for (const t of transactions) {
    if (t.kind !== 'expense' || !t.date.startsWith(month)) continue;
    totals.set(t.category_id, (totals.get(t.category_id) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([category_id, amount]) => ({ category_id, amount }))
    .sort((a, b) => b.amount - a.amount);
}
