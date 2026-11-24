// Quick add: bottom sheet with a numpad, quick amount chips, category chips (last used first), note, date and Save.
// Keyboard: digits, Backspace, Enter (save) and Escape (close) work while the sheet is open.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatCompact, parseAmount, todayISO } from '../../shared/format';
import { t } from '../../shared/i18n';
import type { Category } from '../../shared/types';
import { useStore } from '../lib/store';
import { formatDate, formatInt } from '../lib/dates';
import { loadRecentCategories, rememberCategory } from '../lib/outbox';
import { Icon } from './icons';
import { Chip, Sheet, cls, useToast } from './ui';

interface QuickAddApi {
  open: () => void;
  close: () => void;
}

const QuickAddContext = createContext<QuickAddApi>({ open: () => undefined, close: () => undefined });

/** Opens the Quick add sheet from anywhere: `const quick = useQuickAdd(); quick.open();` */
export function useQuickAdd(): QuickAddApi {
  return useContext(QuickAddContext);
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const api = useMemo<QuickAddApi>(() => ({ open: () => setOpen(true), close: () => setOpen(false) }), []);
  return (
    <QuickAddContext.Provider value={api}>
      {children}
      <QuickAddSheet open={open} onClose={api.close} />
    </QuickAddContext.Provider>
  );
}

function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale } = useStore();
  return (
    <Sheet open={open} onClose={onClose} label={t(locale, 'quickAdd')}>
      <QuickAddPanel onClose={onClose} />
    </Sheet>
  );
}

/** Last-used categories first, then the rest by sort order. Archived categories are hidden. */
function orderCategories(cats: Category[]): Category[] {
  const recent = loadRecentCategories();
  const rank = (c: Category) => {
    const i = recent.indexOf(c.id);
    return i === -1 ? 1000 + c.sort : i;
  };
  return cats.filter((c) => !c.archived).sort((a, b) => rank(a) - rank(b) || a.sort - b.sort);
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'] as const;
const QUICK_CHIPS = [50_000, 100_000, 200_000, 500_000];
const CHIP_LABELS = ['+50k', '+100k', '+200k', '+500k'];

function QuickAddPanel({ onClose }: { onClose: () => void }) {
  const { state, locale, online, enqueueTransaction, undoTransaction } = useStore();
  const toast = useToast();
  const tz = state?.settings.timezone ?? 'Asia/Ho_Chi_Minh';
  const today = todayISO(new Date(), tz);

  const categories = useMemo(() => orderCategories(state?.categories ?? []), [state?.categories]);

  const [digits, setDigits] = useState('');
  const [typed, setTyped] = useState('');
  const [typedInvalid, setTypedInvalid] = useState(false);
  const [shake, setShake] = useState(false);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [pickedCategory, setPickedCategory] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);

  const amount = digits === '' ? 0 : Number(digits);
  const categoryId = pickedCategory ?? categories[0]?.id ?? null;

  const clearTyped = () => {
    setTyped('');
    setTypedInvalid(false);
  };

  const pushDigits = (d: string) => {
    const next = (digits + d).replace(/^0+(?=\d)/, '');
    if (next.length > 12) return;
    setDigits(next);
    clearTyped();
  };

  const backspace = () => {
    setDigits(digits.slice(0, -1));
    clearTyped();
  };

  const addChip = (n: number) => {
    setDigits(String(amount + n));
    clearTyped();
  };

  const onTyped = (text: string) => {
    setTyped(text);
    const value = parseAmount(text);
    if (value === null) {
      setTypedInvalid(text.trim() !== '');
      return;
    }
    setTypedInvalid(false);
    setDigits(value > 0 ? String(value) : '');
  };

  const save = () => {
    if (amount <= 0) {
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
      return;
    }
    const localId = enqueueTransaction({
      date,
      amount,
      kind,
      category_id: categoryId,
      note: note.trim(),
    });
    rememberCategory(categoryId);
    navigator.vibrate?.(12);
    toast({
      message: online ? t(locale, 'qaSaved') : t(locale, 'toastSavedOffline'),
      actionLabel: t(locale, 'qaUndo'),
      onAction: () => void undoTransaction(localId),
      duration: 5000,
    });
    onClose();
  };

  // Keyboard shortcuts. Re-bound after every render so the handler always sees current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        if (el?.tagName === 'BUTTON') return;
        e.preventDefault();
        save();
        return;
      }
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pushDigits(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const formatted = formatInt(amount, locale);
  const dateLabel = date === today ? t(locale, 'dateToday') : formatDate(date, locale);

  return (
    <div className="qa">
      <div className="qa-head">
        <div className="seg" role="group" aria-label={t(locale, 'qaExpense')}>
          <button
            type="button"
            className={cls(kind === 'expense' && 'is-active')}
            aria-pressed={kind === 'expense'}
            onClick={() => setKind('expense')}
          >
            {t(locale, 'qaExpense')}
          </button>
          <button
            type="button"
            className={cls(kind === 'income' && 'is-active')}
            aria-pressed={kind === 'income'}
            onClick={() => setKind('income')}
          >
            {t(locale, 'qaIncome')}
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t(locale, 'close')}>
          <Icon name="close" />
        </button>
      </div>

      <div className={cls('qa-amount', shake && 'is-shake')} data-testid="qa-amount" aria-live="polite">
        <span className="qa-value">{formatted}</span>
        <span className="qa-unit">₫</span>
      </div>
      <div className="qa-sub muted">{amount > 0 ? formatCompact(amount, locale) : t(locale, 'qaAmountInvalid')}</div>

      <div className="qa-typed">
        <input
          className={cls('input', typedInvalid && 'is-invalid')}
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          placeholder="150k"
          inputMode="text"
          autoComplete="off"
          aria-label={t(locale, 'qaAmount')}
          data-testid="qa-typed"
        />
        <span className={cls('qa-hint', typedInvalid ? 'is-error' : 'muted')}>
          {typedInvalid ? t(locale, 'qaTypedInvalid') : t(locale, 'qaTypeHint')}
        </span>
      </div>

      <div className="qa-chips">
        {QUICK_CHIPS.map((n, i) => (
          <Chip key={n} className="chip-quick" onClick={() => addChip(n)}>
            {CHIP_LABELS[i]}
          </Chip>
        ))}
      </div>

      <div className="numpad" role="group" aria-label={t(locale, 'quickAdd')}>
        {KEYS.map((k) =>
          k === 'back' ? (
            <button
              key={k}
              type="button"
              className="np-key np-back"
              data-testid="np-back"
              aria-label="Backspace"
              onClick={backspace}
            >
              <Icon name="backspace" />
            </button>
          ) : (
            <button
              key={k}
              type="button"
              className="np-key"
              data-testid={`np-${k}`}
              onClick={() => pushDigits(k)}
            >
              {k}
            </button>
          ),
        )}
      </div>

      <div className="qa-section-label muted">
        {t(locale, 'qaCategory')} · {t(locale, 'qaRecentHint')}
      </div>
      <div className="qa-cats" data-testid="qa-categories">
        {categories.map((c) => (
          <Chip
            key={c.id}
            active={c.id === categoryId}
            color={c.color}
            onClick={() => setPickedCategory(c.id)}
            className="chip-cat"
          >
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
        />
        <label className="date-pill">
          <Icon name="calendar" size={16} />
          <span>{dateLabel}</span>
          <input
            type="date"
            className="date-native"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label={t(locale, 'qaDate')}
          />
        </label>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block qa-save"
        disabled={amount <= 0}
        onClick={save}
        data-testid="qa-save"
      >
        {kind === 'expense' ? t(locale, 'qaSave') : t(locale, 'qaSaveIncome')}
      </button>
    </div>
  );
}
