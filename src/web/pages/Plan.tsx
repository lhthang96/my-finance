// Plan: what-if editor. Draft values recompute the summary live (calc.ts); Save writes settings and spending items.
import { useMemo, useState, type ReactNode } from 'react';
import { computeSummary } from '../../shared/calc';
import { formatCompact, formatVND } from '../../shared/format';
import { t } from '../../shared/i18n';
import type { AppState, Locale, Summary } from '../../shared/types';
import { api } from '../lib/api';
import { formatMonthYear } from '../lib/dates';
import { useStore } from '../lib/store';
import { useToast, Card, PageHeader, Skeleton, cls } from '../components/ui';
import { AmountField, NumField } from '../components/fields';
import { Icon } from '../components/icons';
import { formatSigned, formatYears, roundPct } from '../lib/ui-format';

interface DraftItem {
  /** Stable React key. Existing rows use the server id. */
  key: string;
  id: number | null;
  name: string;
  amount: number;
  period: 'month' | 'year';
}

interface Draft {
  salary: number;
  targetMultiple: number;
  expectedReturn: number;
  horizons: [number, number];
  items: DraftItem[];
}

let newKeyCounter = 0;

function draftFrom(state: AppState): Draft {
  const hs = state.settings.horizons;
  return {
    salary: state.settings.salary,
    targetMultiple: state.settings.targetMultiple,
    expectedReturn: state.settings.expectedReturn,
    horizons: [hs[0] ?? 5, hs[1] ?? 10],
    items: state.spendingItems.map((i) => ({
      key: `s${i.id}`,
      id: i.id,
      name: i.name,
      amount: i.amount,
      period: i.period,
    })),
  };
}

/** The comparable part of a draft (keys and draft-only fields left out). */
function comparable(d: Draft): unknown {
  return {
    salary: d.salary,
    targetMultiple: d.targetMultiple,
    expectedReturn: d.expectedReturn,
    horizons: d.horizons,
    items: d.items.map((i) => ({ id: i.id, name: i.name.trim(), amount: i.amount, period: i.period })),
  };
}

export function PlanPage() {
  const { state, locale } = useStore();
  const [version, setVersion] = useState(0);
  if (!state) {
    return (
      <div className="page-stack" aria-busy="true">
        <Skeleton className="sk-title" />
        <Skeleton className="sk-card" />
        <Skeleton className="sk-card" />
      </div>
    );
  }
  // Remounting after a save re-reads the server state as the new baseline.
  return <PlanEditor key={version} state={state} locale={locale} onSaved={() => setVersion((v) => v + 1)} />;
}

function PlanEditor({ state, locale, onSaved }: { state: AppState; locale: Locale; onSaved: () => void }) {
  const { refresh } = useStore();
  const toast = useToast();
  const base = useMemo(() => draftFrom(state), [state]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(state));
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(comparable(draft)) !== JSON.stringify(comparable(base));
  const invalid = draft.items.some((i) => i.name.trim() === '');
  const saved: Summary = state.summary;

  const preview = useMemo(
    () =>
      computeSummary(
        {
          ...state.settings,
          salary: draft.salary,
          targetMultiple: draft.targetMultiple,
          expectedReturn: draft.expectedReturn,
          horizons: draft.horizons,
        },
        draft.items,
        state.assets,
        new Date(),
      ),
    [draft, state],
  );

  const patch = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));
  const patchItem = (key: string, next: Partial<DraftItem>) =>
    patch((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...next } : i)) }));
  const removeItem = (key: string) => patch((d) => ({ ...d, items: d.items.filter((i) => i.key !== key) }));
  const addItem = () =>
    patch((d) => ({
      ...d,
      items: [...d.items, { key: `n${++newKeyCounter}`, id: null, name: '', amount: 0, period: 'month' }],
    }));

  const save = async () => {
    if (invalid) {
      toast({ message: t(locale, 'planInvalid') });
      return;
    }
    setBusy(true);
    try {
      await api('PUT', '/api/settings', {
        salary: draft.salary,
        targetMultiple: draft.targetMultiple,
        expectedReturn: draft.expectedReturn,
        horizons: draft.horizons,
      });
      const keep = new Set(draft.items.map((i) => i.id).filter((id): id is number => id !== null));
      for (const orig of state.spendingItems) {
        if (!keep.has(orig.id)) await api('DELETE', `/api/spending-items/${orig.id}`);
      }
      for (const item of draft.items) {
        const body = { name: item.name.trim(), amount: item.amount, period: item.period };
        if (item.id === null) {
          await api('POST', '/api/spending-items', body);
        } else {
          const orig = state.spendingItems.find((s) => s.id === item.id);
          if (orig && (orig.name !== body.name || orig.amount !== body.amount || orig.period !== body.period)) {
            await api('PUT', `/api/spending-items/${item.id}`, body);
          }
        }
      }
      await refresh();
      toast({ message: t(locale, 'planSaved') });
      onSaved();
    } catch {
      toast({ message: t(locale, 'errorGeneric') });
      setBusy(false);
    }
  };

  // Delta text for each output; null when the draft matches the saved value.
  const moneyDelta = (a: number, b: number): string | null =>
    Math.abs(a - b) < 1 ? null : formatSigned(a - b, (n) => formatCompact(n, locale));
  const yearsDelta = (a: number | null, b: number | null): { text: string; good: boolean } | null => {
    if (a === null || b === null || Math.abs(a - b) < 0.05) return null;
    return {
      text: formatSigned(a - b, (n) => `${formatYears(n, locale)} ${t(locale, 'yearsUnit')}`),
      good: a < b,
    };
  };

  const vsSaved = (delta: string | null): string | null => (delta ? t(locale, 'deltaVsSaved', { delta }) : null);
  const years = yearsDelta(preview.yearsToGoal, saved.yearsToGoal);
  const targetDelta = moneyDelta(preview.fiTarget, saved.fiTarget);
  const yearsText =
    preview.yearsToGoal === null
      ? t(locale, 'noFiDate')
      : preview.yearsToGoal === 0
        ? t(locale, 'fiReached')
        : `${formatYears(preview.yearsToGoal, locale)} ${t(locale, 'yearsUnit')}`;

  return (
    <div className={cls('page-stack plan', dirty && 'is-dirty')}>
      <PageHeader title={t(locale, 'planTitle')} />

      <div className="out-grid" data-testid="plan-outputs">
        <OutputCard label={t(locale, 'outTarget')} testId="plan-target" value={formatCompact(preview.fiTarget, locale)} title={formatVND(preview.fiTarget, locale)} delta={vsSaved(targetDelta)} deltaGood={preview.fiTarget < saved.fiTarget} />
        <OutputCard
          label={t(locale, 'outYears')}
          testId="plan-years"
          value={yearsText}
          delta={vsSaved(years?.text ?? null)}
          deltaGood={years?.good ?? false}
          deltaTestId="plan-years-delta"
        />
        <OutputCard
          label={t(locale, 'outFiDate')}
          testId="plan-fidate"
          value={preview.fiDate ? formatMonthYear(preview.fiDate, locale) : t(locale, 'noFiDate')}
        />
        {preview.plans.map((p, i) => {
          const savedPlan = saved.plans[i];
          const delta = savedPlan ? moneyDelta(p.requiredMonthly, savedPlan.requiredMonthly) : null;
          return (
            <OutputCard
              key={`${p.years}-${i}`}
              label={`${t(locale, 'requiredSaving')} · ${t(locale, 'planYears', { years: p.years })}`}
              testId={`plan-req-${i}`}
              value={formatCompact(p.requiredMonthly, locale)}
              delta={vsSaved(delta)}
              deltaGood={savedPlan ? p.requiredMonthly < savedPlan.requiredMonthly : false}
            />
          );
        })}
      </div>

      <Card title={t(locale, 'assumptions')}>
        <div className="field-stack">
          <Field label={t(locale, 'expectedReturn')} value={`${roundPct(draft.expectedReturn * 100)}%`}>
            <input
              type="range"
              className="range"
              min={0}
              max={15}
              step={0.1}
              value={roundPct(draft.expectedReturn * 100)}
              aria-label={t(locale, 'expectedReturn')}
              onChange={(e) => patch((d) => ({ ...d, expectedReturn: Math.round(Number(e.target.value) * 10) / 1000 }))}
            />
            <NumField
              value={roundPct(draft.expectedReturn * 100)}
              min={0}
              max={15}
              step={0.1}
              suffix="%"
              label={t(locale, 'expectedReturn')}
              testId="plan-return-input"
              onChange={(v) => patch((d) => ({ ...d, expectedReturn: Math.round(v * 10) / 1000 }))}
            />
          </Field>

          <Field label={t(locale, 'targetMultiple')} value={`${draft.targetMultiple}`} hint={t(locale, 'targetMultipleHint')}>
            <input
              type="range"
              className="range"
              min={10}
              max={50}
              step={1}
              value={draft.targetMultiple}
              aria-label={t(locale, 'targetMultiple')}
              onChange={(e) => patch((d) => ({ ...d, targetMultiple: Number(e.target.value) }))}
            />
            <NumField
              value={draft.targetMultiple}
              min={10}
              max={50}
              label={t(locale, 'targetMultiple')}
              testId="plan-target-input"
              onChange={(v) => patch((d) => ({ ...d, targetMultiple: v }))}
            />
          </Field>

          <Field label={t(locale, 'horizons')} value="">
            <div className="horizon-row">
              {([0, 1] as const).map((idx) => (
                <NumField
                  key={idx}
                  value={draft.horizons[idx]}
                  min={1}
                  max={40}
                  suffix={t(locale, 'yearsUnit')}
                  label={t(locale, 'horizonN', { n: idx + 1 })}
                  testId={`plan-horizon-${idx}`}
                  onChange={(v) =>
                    patch((d) => {
                      const next = [...d.horizons] as [number, number];
                      next[idx] = v;
                      return { ...d, horizons: next };
                    })
                  }
                />
              ))}
            </div>
          </Field>

          <Field label={t(locale, 'salary')} value={formatVND(draft.salary, locale)}>
            <AmountField
              value={draft.salary}
              locale={locale}
              label={t(locale, 'salary')}
              testId="plan-salary"
              onChange={(n) => patch((d) => ({ ...d, salary: n }))}
            />
          </Field>
        </div>
      </Card>

      <Card title={t(locale, 'spendingItems')} action={<span className="muted small">{formatCompact(preview.monthlySpending, locale)} {t(locale, 'perMonth')}</span>}>
        <div className="item-list" data-testid="plan-items">
          {draft.items.map((item) => (
            <div className="item-row" key={item.key} data-testid="plan-item">
              <input
                className="input item-name"
                value={item.name}
                placeholder={t(locale, 'itemName')}
                aria-label={t(locale, 'itemName')}
                data-testid="item-name"
                onChange={(e) => patchItem(item.key, { name: e.target.value })}
              />
              <div className="item-meta">
                <AmountField
                  className="item-amount"
                  value={item.amount}
                  locale={locale}
                  label={t(locale, 'itemAmount')}
                  testId="item-amount"
                  onChange={(n) => patchItem(item.key, { amount: n })}
                />
                <div className="seg seg-sm" role="group" aria-label={t(locale, 'period')}>
                  <button
                    type="button"
                    aria-pressed={item.period === 'month'}
                    className={cls(item.period === 'month' && 'is-active')}
                    onClick={() => patchItem(item.key, { period: 'month' })}
                  >
                    {t(locale, 'monthLabel')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={item.period === 'year'}
                    className={cls(item.period === 'year' && 'is-active')}
                    onClick={() => patchItem(item.key, { period: 'year' })}
                  >
                    {t(locale, 'yearLabel')}
                  </button>
                </div>
                <button type="button" className="icon-btn" aria-label={t(locale, 'removeItem')} onClick={() => removeItem(item.key)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm add-item" onClick={addItem} data-testid="plan-add-item">
          <Icon name="plus" size={16} />
          {t(locale, 'addItem')}
        </button>
      </Card>

      {dirty && (
        <div className="plan-bar" role="region" aria-label={t(locale, 'unsavedChanges')} data-testid="plan-bar">
          <span className="muted small">{t(locale, 'unsavedChanges')}</span>
          <div className="plan-bar-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(base)} data-testid="plan-reset">
              {t(locale, 'reset')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || invalid} data-testid="plan-save">
              {t(locale, 'savePlan')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {value && <strong className="field-value">{value}</strong>}
      </div>
      {hint && <span className="muted small">{hint}</span>}
      <div className="field-inputs">{children}</div>
    </div>
  );
}

function OutputCard({
  label,
  value,
  title,
  delta,
  deltaGood,
  testId,
  deltaTestId,
}: {
  label: string;
  value: string;
  title?: string;
  delta?: string | null;
  deltaGood?: boolean;
  testId: string;
  deltaTestId?: string;
}) {
  return (
    <div className="out-card card" data-testid={`${testId}-card`}>
      <span className="muted small">{label}</span>
      <strong className="out-value" data-testid={testId} title={title}>
        {value}
      </strong>
      {delta && (
        <span
          className={cls('out-delta', deltaGood ? 'is-good' : 'is-bad')}
          data-testid={deltaTestId ?? `${testId}-delta`}
        >
          {delta}
        </span>
      )}
    </div>
  );
}
