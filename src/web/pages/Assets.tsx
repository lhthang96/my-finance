// Assets: allocation bar and groups by type with subtotals. Tap a row to edit (fields depend on the type).
// "Update prices" lists every stock in one place and saves all changed prices at once.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { assetValue } from '../../shared/calc';
import { formatPercent, formatVND, todayISO } from '../../shared/format';
import { t, type TKey } from '../../shared/i18n';
import type { Asset, AssetType, AppState, Locale } from '../../shared/types';
import { api } from '../lib/api';
import { addMonthsISO, formatDate, formatInt } from '../lib/dates';
import { useStore } from '../lib/store';
import { AmountField, NumField } from '../components/fields';
import { Icon } from '../components/icons';
import { Card, EmptyState, PageHeader, Sheet, Skeleton, cls, useToast } from '../components/ui';

const TYPES: AssetType[] = ['deposit', 'cash', 'stock', 'receivable', 'other'];
const TYPE_LABEL: Record<AssetType, TKey> = {
  deposit: 'typeDeposit',
  cash: 'typeCash',
  stock: 'typeStock',
  receivable: 'typeReceivable',
  other: 'typeOther',
};
const TYPE_COLOR: Record<AssetType, string> = {
  deposit: '#22D3EE',
  cash: '#10B981',
  stock: '#A78BFA',
  receivable: '#F59E0B',
  other: '#94A3B8',
};

type SheetContent = { kind: 'pick' } | { kind: 'edit'; asset: Asset | null; type: AssetType };

export function AssetsPage() {
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
  return <AssetsContent state={state} locale={locale} />;
}

function AssetsContent({ state, locale }: { state: AppState; locale: Locale }) {
  const { refresh, mutate } = useStore();
  const toast = useToast();
  const [priceMode, setPriceMode] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetContent | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const values = useMemo(() => new Map(state.assets.map((a) => [a.id, assetValue(a)])), [state.assets]);
  const total = state.assets.reduce((s, a) => s + (values.get(a.id) ?? 0), 0);
  const groups = TYPES.map((type) => {
    const items = state.assets.filter((a) => a.type === type);
    return { type, items, sum: items.reduce((s, a) => s + (values.get(a.id) ?? 0), 0) };
  }).filter((g) => g.items.length > 0);

  const openNew = () => {
    setSheet({ kind: 'pick' });
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };
  const openEdit = (asset: Asset) => {
    setSheet({ kind: 'edit', asset, type: asset.type });
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };
  const pickType = (type: AssetType) => setSheet({ kind: 'edit', asset: null, type });

  return (
    <div className="page-stack assets">
      <PageHeader
        title={t(locale, 'assetsTitle')}
        right={
          !priceMode ? (
            <div className="page-head-buttons">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPriceMode(true)} data-testid="update-prices">
                {t(locale, 'updatePrices')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNew} data-testid="add-asset">
                {t(locale, 'addAsset')}
              </button>
            </div>
          ) : null
        }
      />

      {state.assets.length > 0 && (
        <Card title={t(locale, 'allocation')} action={<span className="muted small">{formatVND(total, locale)}</span>}>
          <div className="alloc-bar" role="img" aria-label={t(locale, 'allocation')} data-testid="alloc-bar">
            {groups.map((g) => (
              <span
                key={g.type}
                className="alloc-seg"
                style={{ width: `${total > 0 ? (g.sum / total) * 100 : 0}%`, background: TYPE_COLOR[g.type] }}
                title={t(locale, TYPE_LABEL[g.type])}
              />
            ))}
          </div>
          <ul className="alloc-legend">
            {groups.map((g) => (
              <li key={g.type}>
                <span className="dot" style={{ background: TYPE_COLOR[g.type] }} />
                <span className="legend-name">{t(locale, TYPE_LABEL[g.type])}</span>
                <span className="legend-amt">{total > 0 ? formatPercent(g.sum / total, locale, 0) : '0%'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {priceMode ? (
        <PriceEditor
          stocks={state.assets.filter((a) => a.type === 'stock')}
          locale={locale}
          busy={busy}
          onCancel={() => setPriceMode(false)}
          onSave={async (changes) => {
            setBusy(true);
            try {
              for (const [id, amount] of changes) await api('PUT', `/api/assets/${id}`, { amount });
              await refresh();
              toast({ message: t(locale, 'pricesSaved') });
              setPriceMode(false);
            } catch {
              toast({ message: t(locale, 'errorGeneric') });
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : state.assets.length === 0 ? (
        <Card>
          <EmptyState text={t(locale, 'emptyState')} />
        </Card>
      ) : (
        groups.map((g) => (
          <Card
            key={g.type}
            title={t(locale, TYPE_LABEL[g.type])}
            action={<span className="muted small">{t(locale, 'subtotal')}: {formatVND(g.sum, locale)}</span>}
            className="asset-group"
          >
            <ul className="list">
              {g.items.map((a) => (
                <li key={a.id}>
                  <button type="button" className="row row-btn" data-testid={`asset-${a.id}`} onClick={() => openEdit(a)}>
                    <span className="row-main">
                      <span className="row-title">
                        {a.name}
                        {a.counts_toward_fi === 1 && <span className="fi-badge">{t(locale, 'fiBadge')}</span>}
                      </span>
                      <span className="muted small">{assetMeta(a, locale)}</span>
                    </span>
                    <span className="row-amt">{formatVND(values.get(a.id) ?? 0, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label={t(locale, 'addAsset')}>
        {sheet?.kind === 'pick' && (
          <div className="type-picker">
            <h2>{t(locale, 'pickType')}</h2>
            <div className="type-grid">
              {TYPES.map((type) => (
                <button key={type} type="button" className="type-btn" style={{ '--c': TYPE_COLOR[type] } as CSSProperties} onClick={() => pickType(type)} data-testid={`pick-${type}`}>
                  <span className="dot" style={{ background: TYPE_COLOR[type] }} />
                  {t(locale, TYPE_LABEL[type])}
                </button>
              ))}
            </div>
          </div>
        )}
        {sheet?.kind === 'edit' && (
          <AssetForm
            key={`${sheetKey}-${sheet.asset?.id ?? 'new'}-${sheet.type}`}
            asset={sheet.asset}
            type={sheet.type}
            locale={locale}
            onDone={() => setSheetOpen(false)}
          />
        )}
      </Sheet>
    </div>
  );
}

function assetMeta(a: Asset, locale: Locale): string {
  const parts: string[] = [];
  if (a.type === 'stock' && a.quantity !== null) parts.push(`${formatInt(a.quantity, locale)} × ${formatInt(a.amount, locale)}`);
  if (a.type === 'deposit' && a.start_date && a.term_months !== null) {
    parts.push(t(locale, 'maturesOn', { date: formatDate(addMonthsISO(a.start_date, a.term_months), locale) }));
  }
  if (a.type === 'deposit' && a.interest_rate !== null) parts.push(formatPercent(a.interest_rate, locale, 2));
  if (a.note) parts.push(a.note);
  return parts.join(' · ');
}

function PriceEditor({
  stocks,
  locale,
  busy,
  onSave,
  onCancel,
}: {
  stocks: Asset[];
  locale: Locale;
  busy: boolean;
  onSave: (changes: [number, number][]) => void;
  onCancel: () => void;
}) {
  const [prices, setPrices] = useState<Record<number, number>>(() => Object.fromEntries(stocks.map((s) => [s.id, s.amount])));
  const changes = stocks.filter((s) => prices[s.id] !== s.amount).map((s) => [s.id, prices[s.id]] as [number, number]);
  return (
    <Card title={t(locale, 'updatePrices')} testId="price-editor">
      {stocks.length === 0 ? (
        <EmptyState text={t(locale, 'emptyState')} />
      ) : (
        <ul className="list">
          {stocks.map((s) => (
            <li className="row price-row" key={s.id}>
              <span className="row-main">
                <span className="row-title">{s.name}</span>
                <span className="muted small">
                  {t(locale, 'quantity')}: {formatInt(s.quantity ?? 0, locale)}
                </span>
              </span>
              <AmountField
                value={prices[s.id] ?? 0}
                locale={locale}
                label={`${s.name} · ${t(locale, 'unitPrice')}`}
                testId={`price-${s.id}`}
                className="price-input"
                onChange={(n) => setPrices((p) => ({ ...p, [s.id]: n }))}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {t(locale, 'cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="prices-save"
          disabled={busy || changes.length === 0}
          onClick={() => onSave(changes)}
        >
          {t(locale, 'save')}
        </button>
      </div>
    </Card>
  );
}

function AssetForm({
  asset,
  type,
  locale,
  onDone,
}: {
  asset: Asset | null;
  type: AssetType;
  locale: Locale;
  onDone: () => void;
}) {
  const { mutate } = useStore();
  const toast = useToast();
  const today = todayISO(new Date(), 'Asia/Ho_Chi_Minh');
  const isStock = type === 'stock';
  const isDeposit = type === 'deposit';
  const [name, setName] = useState(asset?.name ?? '');
  const [quantity, setQuantity] = useState(asset?.quantity ?? 0);
  const [amount, setAmount] = useState(asset?.amount ?? 0);
  const [rate, setRate] = useState(asset?.interest_rate != null ? Math.round(asset.interest_rate * 10000) / 100 : 0);
  const [startDate, setStartDate] = useState(asset?.start_date ?? today);
  const [termMonths, setTermMonths] = useState(asset?.term_months ?? 1);
  const [note, setNote] = useState(asset?.note ?? '');
  const [countsFi, setCountsFi] = useState(asset ? asset.counts_toward_fi === 1 : true);
  const [busy, setBusy] = useState(false);

  const maturity = isDeposit && startDate && termMonths > 0 ? addMonthsISO(startDate, termMonths) : null;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ message: t(locale, 'errorGeneric') });
      return;
    }
    const body = {
      name: trimmed,
      type,
      quantity: isStock ? quantity : null,
      amount,
      counts_toward_fi: countsFi ? 1 : 0,
      interest_rate: isDeposit && rate > 0 ? rate / 100 : null,
      start_date: isDeposit && startDate ? startDate : null,
      term_months: isDeposit && termMonths > 0 ? termMonths : null,
      note: note.trim(),
    };
    setBusy(true);
    try {
      if (asset) await mutate('PUT', `/api/assets/${asset.id}`, body);
      else await mutate('POST', '/api/assets', body);
      setBusy(false);
      toast({ message: t(locale, 'saved') });
      onDone();
    } catch {
      setBusy(false);
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  const remove = async () => {
    if (!asset) return;
    if (!window.confirm(t(locale, 'confirmDelete'))) return;
    setBusy(true);
    try {
      await mutate('DELETE', `/api/assets/${asset.id}`);
      setBusy(false);
      toast({ message: t(locale, 'assetDeleted') });
      onDone();
    } catch {
      setBusy(false);
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  return (
    <div className="qa asset-form">
      <h2 className="sheet-title">{asset ? t(locale, 'editAsset') : t(locale, 'newAsset')}</h2>
      <p className="muted small">{t(locale, TYPE_LABEL[type])}</p>

      <Field label={t(locale, 'name')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label={t(locale, 'name')} data-testid="asset-name" />
      </Field>

      {isStock ? (
        <>
          <Field label={t(locale, 'quantity')}>
            <NumField value={quantity} min={0} max={1e9} step={1} label={t(locale, 'quantity')} testId="asset-quantity" onChange={setQuantity} />
          </Field>
          <Field label={t(locale, 'unitPrice')}>
            <AmountField value={amount} locale={locale} label={t(locale, 'unitPrice')} testId="asset-amount" onChange={setAmount} />
          </Field>
          <p className="muted small" data-testid="asset-stock-value">{t(locale, 'stockValue', { amount: formatVND(quantity * amount, locale) })}</p>
        </>
      ) : (
        <Field label={t(locale, 'amount')}>
          <AmountField value={amount} locale={locale} label={t(locale, 'amount')} testId="asset-amount" onChange={setAmount} />
        </Field>
      )}

      {isDeposit && (
        <>
          <Field label={t(locale, 'interestRate')}>
            <NumField value={rate} min={0} max={100} step={0.01} suffix="%" label={t(locale, 'interestRate')} testId="asset-rate" onChange={setRate} />
          </Field>
          <Field label={t(locale, 'startDate')}>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label={t(locale, 'startDate')} data-testid="asset-start" />
          </Field>
          <Field label={t(locale, 'termMonths')}>
            <NumField value={termMonths} min={1} max={120} label={t(locale, 'termMonths')} testId="asset-term" onChange={setTermMonths} />
          </Field>
          {maturity && (
            <p className="pill pill-good" data-testid="asset-maturity">{t(locale, 'maturesOn', { date: formatDate(maturity, locale) })}</p>
          )}
        </>
      )}

      <Field label={t(locale, 'assetNote')}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label={t(locale, 'assetNote')} />
      </Field>

      <div className="switch-row">
        <span>{t(locale, 'countsTowardFi')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={countsFi}
          aria-label={t(locale, 'countsTowardFi')}
          className={cls('switch', countsFi && 'is-on')}
          data-testid="fi-toggle"
          onClick={() => setCountsFi(!countsFi)}
        >
          <span className="switch-knob" />
        </button>
      </div>

      <div className="sheet-actions">
        {asset && (
          <button type="button" className="btn btn-ghost btn-danger" onClick={remove} disabled={busy} data-testid="asset-delete">
            {t(locale, 'delete')}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-testid="asset-save">
          {t(locale, 'save')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

