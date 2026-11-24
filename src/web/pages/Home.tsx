// Home dashboard: FI hero ring, KPI cards, this month, category donut, projection, plans and upcoming maturities.
import { useMemo } from 'react';
import { byCategory, monthSpendingActual } from '../../shared/calc';
import { currentMonth, formatCompact, formatPercent, formatVND, todayISO } from '../../shared/format';
import { t } from '../../shared/i18n';
import type { AppState, Asset, Category, Locale, Transaction } from '../../shared/types';
import { Card, EmptyState, PageHeader, Skeleton, cls } from '../components/ui';
import { Donut, ProjectionChart, Ring, type DonutSlice } from '../components/charts';
import { useCountUp } from '../lib/hooks';
import { useStore } from '../lib/store';
import { addMonthsISO, daysInMonth, diffDays, formatDate, formatMonthYear } from '../lib/dates';

export function HomePage() {
  const { state, locale } = useStore();
  if (!state) return <HomeSkeleton />;
  return <HomeContent state={state} locale={locale} />;
}

function HomeSkeleton() {
  return (
    <div className="page-stack" aria-busy="true" data-testid="home-skeleton">
      <Skeleton className="sk-title" />
      <Skeleton className="sk-hero" />
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="sk-kpi" />
        ))}
      </div>
      <Skeleton className="sk-card" />
      <Skeleton className="sk-card" />
    </div>
  );
}

function HomeContent({ state, locale }: { state: AppState; locale: Locale }) {
  const s = state.summary;
  const tz = state.settings.timezone;
  const now = new Date();
  const today = todayISO(now, tz);
  const month = currentMonth(now, tz);
  const spent = monthSpendingActual(state.monthTransactions, month);
  const plan = s.monthlySpending;
  const todayTotal = monthSpendingActual(
    state.monthTransactions.filter((tx) => tx.date === today),
    today.slice(0, 7),
  );
  const daysLeft = daysInMonth(month) - Number(today.slice(8, 10));
  const categoryMap = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);
  const slices = useMemo(() => buildSlices(state.monthTransactions, month, categoryMap, locale), [
    state.monthTransactions,
    month,
    categoryMap,
    locale,
  ]);
  const upcoming = useMemo(() => upcomingMaturities(state.assets, today), [state.assets, today]);
  const startYear = Number(today.slice(0, 4));
  const fiYear = s.fiDate ? Number(s.fiDate.slice(0, 4)) : null;

  return (
    <div className="page-stack home">
      <PageHeader
        title={t(locale, 'navHome')}
        subtitle={t(locale, 'homeGreeting')}
        right={
          <a className="btn btn-ghost btn-sm" href="#/history" data-testid="view-history">
            {t(locale, 'viewHistory')}
          </a>
        }
      />

      <section className="card hero" data-testid="hero">
        <Ring value={s.progress} size={204} stroke={14}>
          <PercentCenter value={s.progress} locale={locale} label={t(locale, 'fiProgress')} />
        </Ring>
        <div className="hero-text">
          <div className="hero-target">{t(locale, 'fiTarget', { amount: formatCompact(s.fiTarget, locale) })}</div>
          <div className="hero-remaining">{t(locale, 'remaining', { amount: formatCompact(s.remaining, locale) })}</div>
          <div className="hero-date">
            {s.fiDate ? t(locale, 'expectedFiDate', { date: formatMonthYear(s.fiDate, locale) }) : t(locale, 'noFiDate')}
          </div>
          {s.yearsToGoal !== null && s.yearsToGoal > 0 && (
            <span className="pill">
              {t(locale, 'yearsToGo', { years: formatYears(s.yearsToGoal, locale) })}
            </span>
          )}
          {s.yearsToGoal === 0 && <span className="pill pill-good">{t(locale, 'fiReached')}</span>}
        </div>
      </section>

      <div className="kpi-grid">
        <Kpi label={t(locale, 'kpiNetWorth')} value={s.netWorth} locale={locale} full={formatVND(s.netWorth, locale)} />
        <Kpi
          label={t(locale, 'kpiFiAssets')}
          value={s.fiAssets}
          locale={locale}
          full={formatVND(s.fiAssets, locale)}
        />
        <Kpi
          label={t(locale, 'kpiPassive')}
          value={s.passiveMonthly}
          locale={locale}
          full={formatVND(s.passiveMonthly, locale)}
          bar={Math.min(1, s.coverage)}
          sub={t(locale, 'coverage', { pct: formatPercent(s.coverage, locale, 1) })}
        />
        <Kpi
          label={t(locale, 'kpiSavingsRate')}
          value={s.savingsRate}
          locale={locale}
          percent
          sub={`${t(locale, 'kpiMonthlySaving')}: ${formatCompact(s.monthlySaving, locale)}`}
        />
      </div>

      <div className="home-grid">
        <Card
          title={t(locale, 'thisMonth')}
          action={<span className="muted small">{t(locale, 'daysLeft', { n: daysLeft })}</span>}
        >
          <MonthBar spent={spent} plan={plan} locale={locale} />
          <div className="today-row" data-testid="today-total">
            {t(locale, 'todayTotal', { amount: formatVND(todayTotal, locale) })}
          </div>
          <div className="donut-row">
            <Donut
              slices={slices.slices}
              size={144}
              thickness={20}
              center={<span className="donut-total">{formatCompact(spent, locale)}</span>}
            />
            <ul className="legend">
              {slices.top.length === 0 && <li className="muted small">{t(locale, 'noEntries')}</li>}
              {slices.top.map((c) => (
                <li key={c.key}>
                  <span className="dot" style={{ background: c.color }} />
                  <span className="legend-name">{c.label}</span>
                  <span className="legend-amt">{formatCompact(c.value, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card title={t(locale, 'plans')} className="plans">
          <div className="plan-list">
            {s.plans.map((p) => {
              const behind = p.extraNeeded > 0;
              return (
                <div className="plan" key={p.years}>
                  <div className="plan-title">{t(locale, 'planYears', { years: p.years })}</div>
                  <div className="plan-req">
                    <span className="plan-big">{formatCompact(p.requiredMonthly, locale)}</span>
                    <span className="muted small">{t(locale, 'requiredSaving')}</span>
                  </div>
                  <div className="plan-meta">
                    <span className="muted small">
                      {t(locale, 'currentSaving')}: {formatCompact(s.monthlySaving, locale)}
                    </span>
                    <span className={cls('plan-gap', behind ? 'is-behind' : 'is-ok')}>
                      {behind ? t(locale, 'gap', { amount: formatCompact(p.extraNeeded, locale) }) : t(locale, 'onTrack')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title={t(locale, 'projection')} testId="projection-card">
        <p className="muted small card-note">{t(locale, 'projectionNote')}</p>
        <ProjectionChart
          fiAssets={s.fiAssets}
          monthlySaving={s.monthlySaving}
          expectedReturn={state.settings.expectedReturn}
          target={s.fiTarget}
          yearsToGoal={s.yearsToGoal}
          fiYear={fiYear}
          startYear={startYear}
          locale={locale}
        />
      </Card>

      <Card title={t(locale, 'upcoming')} action={<span className="muted small">{t(locale, 'next30')}</span>}>
        {upcoming.length === 0 ? (
          <EmptyState text={t(locale, 'noUpcoming')} />
        ) : (
          <ul className="list">
            {upcoming.map((u) => (
              <li className="row" key={u.maturity} data-testid={`upcoming-${u.maturity}`}>
                <div className="row-main">
                  <div className="row-title">{u.count === 1 ? u.name : t(locale, 'maturityGroup', { n: u.count })}</div>
                  <div className="muted small">{t(locale, 'maturesOn', { date: formatDate(u.maturity, locale) })}</div>
                </div>
                <div className="row-amt">{formatVND(u.amount, locale)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

    </div>
  );
}

// ---------- pieces ----------

function PercentCenter({ value, locale, label }: { value: number; locale: Locale; label: string }) {
  const shown = useCountUp(value);
  return (
    <>
      <div className="ring-pct">{formatPercent(shown, locale, 1)}</div>
      <div className="ring-label">{label}</div>
    </>
  );
}

function Kpi({
  label,
  value,
  locale,
  full,
  percent,
  bar,
  sub,
}: {
  label: string;
  value: number;
  locale: Locale;
  full?: string;
  percent?: boolean;
  bar?: number;
  sub?: string;
}) {
  const shown = useCountUp(value);
  const text = percent ? formatPercent(shown, locale, 1) : formatCompact(shown, locale);
  return (
    <div className="kpi card" title={full}>
      <div className="kpi-label muted small">{label}</div>
      <div className="kpi-value">{text}</div>
      {bar !== undefined && (
        <div className="bar" aria-hidden="true">
          <div className="bar-fill" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
      {sub ? <div className="kpi-sub muted small">{sub}</div> : full ? <div className="kpi-sub muted small">{full}</div> : null}
    </div>
  );
}

function MonthBar({ spent, plan, locale }: { spent: number; plan: number; locale: Locale }) {
  const ratio = plan > 0 ? spent / plan : 0;
  const shown = useCountUp(Math.min(ratio, 1));
  const over = ratio > 1;
  return (
    <div className="month">
      <div className="bar bar-tall" aria-hidden="true">
        <div className={cls('bar-fill', over && 'is-over')} style={{ width: `${Math.min(100, shown * 100)}%` }} />
      </div>
      <div className="month-nums">
        <strong>{formatCompact(spent, locale)}</strong>
        <span className="muted small">
          {t(locale, 'spentOf', { spent: formatCompact(spent, locale), plan: formatCompact(plan, locale) })}
        </span>
      </div>
    </div>
  );
}

function formatYears(years: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 }).format(years);
}

const CATEGORY_FALLBACK_COLOR = '#94A3B8';

function buildSlices(
  transactions: Transaction[],
  month: string,
  categories: Map<number, Category>,
  locale: Locale,
): { slices: DonutSlice[]; top: DonutSlice[] } {
  const rows = byCategory(transactions, month);
  const all: DonutSlice[] = rows.map((r) => {
    const cat = r.category_id === null ? undefined : categories.get(r.category_id);
    return {
      key: String(r.category_id ?? 'none'),
      label: cat ? (locale === 'vi' ? cat.name_vi : cat.name_en) : t(locale, 'typeOther'),
      value: r.amount,
      color: cat?.color ?? CATEGORY_FALLBACK_COLOR,
    };
  });
  return { slices: all.slice(0, 6), top: all.slice(0, 5) };
}

interface Maturity {
  /** YYYY-MM-DD; deposits sharing this date are grouped into one row. */
  maturity: string;
  name: string;
  count: number;
  amount: number;
}

/** Deposits whose maturity (start_date + term_months) falls within the next 30 days, grouped by maturity date. */
function upcomingMaturities(assets: Asset[], today: string): Maturity[] {
  const byDate = new Map<string, Maturity>();
  for (const a of assets) {
    if (a.type !== 'deposit' || !a.start_date || a.term_months == null) continue;
    const maturity = addMonthsISO(a.start_date, a.term_months);
    const days = diffDays(today, maturity);
    if (days < 0 || days > 30) continue;
    const group = byDate.get(maturity);
    if (group) {
      group.count += 1;
      group.amount += a.amount;
    } else {
      byDate.set(maturity, { maturity, name: a.name, count: 1, amount: a.amount });
    }
  }
  return [...byDate.values()].sort((x, y) => x.maturity.localeCompare(y.maturity));
}
