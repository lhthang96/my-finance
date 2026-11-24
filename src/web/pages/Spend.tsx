// Spend: month switcher, month total against the plan, daily bars, category breakdown and entries grouped by day.
// Tap an entry to edit it in a sheet (amount, kind, category, note, date) or delete it.
import { useEffect, useMemo, useState } from 'react';
import { byCategory, monthSpendingActual } from '../../shared/calc';
import { currentMonth, formatCompact, formatVND, todayISO } from '../../shared/format';
import { t } from '../../shared/i18n';
import type { AppState, Category, Locale, Transaction } from '../../shared/types';
import { api } from '../lib/api';
import { addMonthsISO, daysInMonth, diffDays, formatDate, formatMonthYear } from '../lib/dates';
import { useStore } from '../lib/store';
import { AmountField } from '../components/fields';
import { useQuickAdd } from '../components/QuickAdd';
import { DailyBars, type DayBar } from '../components/charts';
import { Icon } from '../components/icons';
import { Card, Chip, EmptyState, PageHeader, Sheet, Skeleton, cls, useToast } from '../components/ui';

export function SpendPage() {
  const { state, locale } = useStore();
  if (!state) {
    return (
      <div className="page-stack" aria-busy="true">
        <Skeleton className="sk-title" />
        <Skeleton className="sk-card" />
        <Skeleton className="sk-card" />
      </div>
    );
  }
  return <SpendContent state={state} locale={locale} />;
}

function SpendContent({ state, locale }: { state: AppState; locale: Locale }) {
  const tz = state.settings.timezone;
  const today = todayISO(new Date(), tz);
  const current = currentMonth(new Date(), tz);
  const [month, setMonth] = useState(current);
  const [past, setPast] = useState<Transaction[]>([]);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const quick = useQuickAdd();
  const isCurrent = month === current;
  const categoryMap = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);

  // The current month comes from the store (it includes queued entries); other months are fetched.
  useEffect(() => {
    if (isCurrent) return;
    let alive = true;
    api<Transaction[]>('GET', `/api/transactions?month=${month}`)
      .then((rows) => {
        if (alive) setPast(rows);
      })
      .catch(() => {
        if (alive) setPast([]);
      });
    return () => {
      alive = false;
    };
  }, [month, isCurrent, tick, state.monthTransactions]);

  const txs = isCurrent ? state.monthTransactions : past;
  const spent = monthSpendingActual(txs, month);
  const plan = state.summary.monthlySpending;
  const ratio = plan > 0 ? spent / plan : 0;
  const over = ratio > 1;
  const warn = ratio > 0.9 && !over;
  const days = daysInMonth(month);
  const planDaily = plan / days;

  const bars: DayBar[] = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const tx of txs) {
      if (tx.kind !== 'expense') continue;
      perDay.set(tx.date, (perDay.get(tx.date) ?? 0) + tx.amount);
    }
    return Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const iso = `${month}-${String(day).padStart(2, '0')}`;
      return { day, value: perDay.get(iso) ?? 0, isToday: iso === today };
    });
  }, [txs, month, days, today]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of txs) {
      const list = map.get(tx.date) ?? [];
      list.push(tx);
      map.set(tx.date, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [txs]);

  const categories = useMemo(() => byCategory(txs, month), [txs, month]);
  const maxCategory = categories[0]?.amount ?? 0;

  const shift = (delta: number) => setMonth(addMonthsISO(`${month}-01`, delta).slice(0, 7));
  const openEdit = (tx: Transaction) => {
    setEditing(tx);
    setSheetOpen(true);
  };

  const dayLabel = (iso: string) => {
    if (iso === today) return t(locale, 'today');
    if (diffDays(iso, today) === 1) return t(locale, 'yesterday');
    return formatDate(iso, locale);
  };

  return (
    <div className="page-stack spend">
      <PageHeader
        title={t(locale, 'spendTitle')}
        right={
          <div className="month-switch" role="group" aria-label={t(locale, 'monthlyPlan')}>
            <button
              type="button"
              className="icon-btn"
              aria-label={t(locale, 'prevMonth')}
              data-testid="month-prev"
              onClick={() => shift(-1)}
            >
              <Icon name="chevronLeft" />
            </button>
            <span className="month-switch-label" data-testid="month-label">
              {formatMonthYear(`${month}-01`, locale)}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t(locale, 'nextMonth')}
              data-testid="month-next"
              disabled={isCurrent}
              onClick={() => shift(1)}
            >
              <Icon name="chevronRight" />
            </button>
          </div>
        }
      />

      <Card testId="spend-summary" title={t(locale, 'monthlyPlan')} action={over ? <span className="plan-gap is-behind">{t(locale, 'overPlan')}</span> : null}>
        <div className="month">
          <div className="bar bar-tall" aria-hidden="true">
            <div
              className={cls('bar-fill', warn && 'is-warn', over && 'is-over')}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          <div className="month-nums">
            <strong data-testid="spend-total">{formatVND(spent, locale)}</strong>
            <span className="muted small">
              {t(locale, 'spentVsPlan', { spent: formatCompact(spent, locale), plan: formatCompact(plan, locale) })}
            </span>
          </div>
        </div>
      </Card>

      {txs.length === 0 ? (
        <Card>
          <EmptyState text={t(locale, 'noEntries')} />
          <div className="empty-action">
            <button type="button" className="btn btn-primary" onClick={quick.open} data-testid="spend-add-empty">
              {t(locale, 'spendAdd')}
            </button>
          </div>
        </Card>
      ) : (
        <>
          <Card title={t(locale, 'dailyChart')} action={<span className="muted small">{t(locale, 'dailyAverage', { amount: formatCompact(planDaily, locale) })}</span>}>
            <DailyBars bars={bars} planDaily={planDaily} label={t(locale, 'dailyChart')} />
          </Card>

          <Card title={t(locale, 'byCategory')}>
            <ul className="cat-list" data-testid="category-breakdown">
              {categories.map((c) => {
                const cat = c.category_id === null ? undefined : categoryMap.get(c.category_id);
                return (
                  <li className="cat-row" key={String(c.category_id)}>
                    <span className="dot" style={{ background: cat?.color ?? '#94A3B8' }} />
                    <span className="cat-name">{categoryName(cat, locale)}</span>
                    <span className="bar cat-bar" aria-hidden="true">
                      <span className="bar-fill" style={{ width: `${maxCategory > 0 ? (c.amount / maxCategory) * 100 : 0}%` }} />
                    </span>
                    <span className="legend-amt">{formatCompact(c.amount, locale)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="day-groups" data-testid="spend-list">
            {groups.map(([date, items]) => {
              const dayTotal = items.reduce((s, tx) => (tx.kind === 'expense' ? s + tx.amount : s), 0);
              return (
                <section className="day-group" key={date} data-testid={`day-${date}`}>
                  <div className="day-head">
                    <span>{dayLabel(date)}</span>
                    <span className="day-total">{formatVND(dayTotal, locale)}</span>
                  </div>
                  <ul className="list">
                    {items.map((tx) => {
                      const cat = tx.category_id === null ? undefined : categoryMap.get(tx.category_id);
                      const pending = tx.id < 0;
                      return (
                        <li key={tx.id}>
                          <button
                            type="button"
                            className="row row-btn tx-row"
                            data-testid={`tx-${tx.id}`}
                            disabled={pending}
                            onClick={() => openEdit(tx)}
                          >
                            <span className="tx-icon" style={{ background: cat?.color ?? '#94A3B8' }} aria-hidden="true">
                              {cat?.icon ?? '✨'}
                            </span>
                            <span className="row-main">
                              <span className="row-title">{categoryName(cat, locale)}</span>
                              {tx.note && <span className="muted small tx-note">{tx.note}</span>}
                              {pending && <span className="muted small">{t(locale, 'pendingSync')}</span>}
                            </span>
                            <span className={cls('row-amt', tx.kind === 'income' && 'is-income')}>
                              {tx.kind === 'income' ? '+' : ''}
                              {formatVND(tx.amount, locale)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label={t(locale, 'spendEdit')}>
        {editing && (
          <EntryForm
            key={editing.id}
            tx={editing}
            categories={state.categories}
            locale={locale}
            onDone={() => {
              setSheetOpen(false);
              setTick((n) => n + 1);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function categoryName(cat: Category | undefined, locale: Locale): string {
  if (!cat) return t(locale, 'noCategory');
  return locale === 'vi' ? cat.name_vi : cat.name_en;
}

function EntryForm({
  tx,
  categories,
  locale,
  onDone,
}: {
  tx: Transaction;
  categories: Category[];
  locale: Locale;
  onDone: () => void;
}) {
  const { mutate } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState(tx.amount);
  const [kind, setKind] = useState<Transaction['kind']>(tx.kind);
  const [categoryId, setCategoryId] = useState<number | null>(tx.category_id);
  const [note, setNote] = useState(tx.note);
  const [date, setDate] = useState(tx.date);
  const [busy, setBusy] = useState(false);
  const visible = categories.filter((c) => !c.archived || c.id === tx.category_id);

  const save = async () => {
    if (amount <= 0) {
      toast({ message: t(locale, 'entryInvalid') });
      return;
    }
    const body = { date, amount, kind, category_id: categoryId, note: note.trim() };
    setBusy(true);
    try {
      await mutate('PUT', `/api/transactions/${tx.id}`, body, (s) => ({
        ...s,
        monthTransactions: s.monthTransactions.map((x) => (x.id === tx.id ? { ...x, ...body } : x)),
      }));
      setBusy(false);
      toast({ message: t(locale, 'entryUpdated') });
      onDone();
    } catch {
      setBusy(false);
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  const remove = async () => {
    if (!window.confirm(t(locale, 'deleteEntry'))) return;
    setBusy(true);
    try {
      await mutate('DELETE', `/api/transactions/${tx.id}`, undefined, (s) => ({
        ...s,
        monthTransactions: s.monthTransactions.filter((x) => x.id !== tx.id),
      }));
      setBusy(false);
      toast({ message: t(locale, 'entryDeleted') });
      onDone();
    } catch {
      setBusy(false);
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  return (
    <div className="qa entry-form">
      <div className="qa-head">
        <div className="seg" role="group" aria-label={t(locale, 'type')}>
          <button type="button" className={cls(kind === 'expense' && 'is-active')} aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
            {t(locale, 'qaExpense')}
          </button>
          <button type="button" className={cls(kind === 'income' && 'is-active')} aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
            {t(locale, 'qaIncome')}
          </button>
        </div>
      </div>

      <AmountField value={amount} onChange={setAmount} locale={locale} label={t(locale, 'amount')} testId="entry-amount" className="entry-amount" />

      <div className="qa-cats" data-testid="entry-categories">
        {visible.map((c) => (
          <Chip key={c.id} active={c.id === categoryId} color={c.color} className="chip-cat" onClick={() => setCategoryId(c.id)}>
            <span aria-hidden="true">{c.icon}</span>
            <span>{locale === 'vi' ? c.name_vi : c.name_en}</span>
          </Chip>
        ))}
      </div>

      <div className="qa-row">
        <input
          className="input qa-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t(locale, 'qaNotePlaceholder')}
          maxLength={200}
          aria-label={t(locale, 'qaNote')}
          data-testid="entry-note"
        />
        <label className="date-pill">
          <Icon name="calendar" size={16} />
          <span>{formatDate(date, locale)}</span>
          <input
            type="date"
            className="date-native"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label={t(locale, 'qaDate')}
            data-testid="entry-date"
          />
        </label>
      </div>

      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost btn-danger" onClick={remove} disabled={busy} data-testid="entry-delete">
          {t(locale, 'delete')}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-testid="entry-save">
          {t(locale, 'save')}
        </button>
      </div>
    </div>
  );
}
