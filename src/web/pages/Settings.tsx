// Settings: language, notifications, reminders, categories, data import/export, log out and the app version.
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayISO } from '../../shared/format';
import { t, type TKey } from '../../shared/i18n';
import type { Category, Locale, Settings } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { disablePush, enablePush, getPushStatus, sendTestPush, type PushStatus } from '../lib/push-client';
import { Card, PageHeader, Skeleton, cls, useToast } from '../components/ui';
import { Icon } from '../components/icons';

// Declared by the build (scripts/build.mjs defines it); "dev" when running unbuilt sources.
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const PALETTE = ['#F59E0B', '#38BDF8', '#F472B6', '#A78BFA', '#FB7185', '#34D399', '#F97316', '#22D3EE', '#94A3B8', '#FACC15'];
const REMINDERS: { key: keyof Settings['reminders']; label: TKey }[] = [
  { key: 'dailyLog', label: 'reminderDailyLog' },
  { key: 'monthEnd', label: 'reminderMonthEnd' },
  { key: 'maturity', label: 'reminderMaturity' },
];

export function SettingsPage() {
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
  return (
    <div className="page-stack settings">
      <PageHeader title={t(locale, 'settingsTitle')} />
      <LanguageCard locale={locale} />
      <NotificationsCard locale={locale} />
      <RemindersCard locale={locale} settings={state.settings} />
      <CategoriesCard locale={locale} categories={state.categories} />
      <DataCard locale={locale} />
      <AccountCard locale={locale} />
    </div>
  );
}

// ---------- language ----------

function LanguageCard({ locale }: { locale: Locale }) {
  const { setLocale } = useStore();
  const options: Locale[] = ['en', 'vi'];
  return (
    <Card title={t(locale, 'language')}>
      <div className="seg" role="group" aria-label={t(locale, 'language')}>
        {options.map((l) => (
          <button
            key={l}
            type="button"
            className={cls(locale === l && 'is-active')}
            aria-pressed={locale === l}
            data-testid={`lang-${l}`}
            onClick={() => setLocale(l)}
          >
            {l === 'en' ? t(locale, 'langEn') : t(locale, 'langVi')}
          </button>
        ))}
      </div>
    </Card>
  );
}

// ---------- notifications ----------

function NotificationsCard({ locale }: { locale: Locale }) {
  const toast = useToast();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(() => {
    getPushStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'));
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const enable = async () => {
    setBusy(true);
    const ok = await enablePush().catch(() => false);
    setBusy(false);
    refreshStatus();
    if (!ok) toast({ message: t(locale, 'notificationsDenied') });
  };

  const disable = async () => {
    setBusy(true);
    await disablePush().catch(() => undefined);
    setBusy(false);
    refreshStatus();
  };

  const test = async () => {
    setBusy(true);
    try {
      await sendTestPush();
      toast({ message: t(locale, 'testSent') });
    } catch {
      toast({ message: t(locale, 'testFailed') });
    } finally {
      setBusy(false);
    }
  };

  const text = (() => {
    switch (status) {
      case 'subscribed':
        return t(locale, 'notificationsOn');
      case 'denied':
        return t(locale, 'notificationsDenied');
      case 'needs-install':
        return t(locale, 'notificationsIosHint');
      case 'unsupported':
        return t(locale, 'notifStatusUnsupported');
      case 'unsubscribed':
        return t(locale, 'notifStatusOff');
      default:
        return t(locale, 'loading');
    }
  })();

  return (
    <Card title={t(locale, 'notifSection')} testId="notifications-card">
      <p className="muted small" data-testid="push-status">
        {text}
      </p>
      <div className="btn-row">
        {status === 'unsubscribed' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={enable} disabled={busy} data-testid="push-enable">
            {t(locale, 'enableNotifications')}
          </button>
        )}
        {status === 'subscribed' && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={test} disabled={busy} data-testid="push-test">
              {t(locale, 'sendTest')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={disable} disabled={busy} data-testid="push-disable">
              {t(locale, 'notifDisable')}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- reminders ----------

function RemindersCard({ locale, settings }: { locale: Locale; settings: Settings }) {
  const { mutate } = useStore();
  const toast = useToast();

  const change = async (key: keyof Settings['reminders'], patch: { enabled?: boolean; hour?: number }) => {
    const body = { reminders: { [key]: patch } };
    try {
      await mutate('PUT', '/api/settings', body, (s) => ({
        ...s,
        settings: {
          ...s.settings,
          reminders: { ...s.settings.reminders, [key]: { ...s.settings.reminders[key], ...patch } },
        },
      }));
    } catch {
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  return (
    <Card title={t(locale, 'reminders')} testId="reminders-card">
      <ul className="list">
        {REMINDERS.map(({ key, label }) => {
          const rule = settings.reminders[key];
          const name = t(locale, label);
          return (
            <li className="setting-row" key={key}>
              <span className="row-main">
                <span className="row-title">{name}</span>
              </span>
              <select
                className="select"
                aria-label={`${name} · ${t(locale, 'hour')}`}
                value={rule.hour}
                data-testid={`reminder-${key}-hour`}
                onChange={(e) => void change(key, { hour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={name}
                className={cls('switch', rule.enabled && 'is-on')}
                data-testid={`reminder-${key}-switch`}
                onClick={() => void change(key, { enabled: !rule.enabled })}
              >
                <span className="switch-knob" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------- categories ----------

function CategoriesCard({ locale, categories }: { locale: Locale; categories: Category[] }) {
  const { mutate } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const sorted = [...categories].sort((a, b) => a.sort - b.sort || a.id - b.id);

  const add = async (v: CategoryValues) => {
    if (!v.name_en.trim() || !v.name_vi.trim()) {
      toast({ message: t(locale, 'categoryNeedsName') });
      return;
    }
    try {
      await mutate('POST', '/api/categories', {
        key: makeKey(v.name_en, categories),
        name_en: v.name_en.trim(),
        name_vi: v.name_vi.trim(),
        icon: v.icon.trim() || '✨',
        color: v.color,
        sort: categories.length,
      });
      toast({ message: t(locale, 'categoryAdded') });
    } catch {
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  const update = async (c: Category, v: CategoryValues) => {
    try {
      await mutate('PUT', `/api/categories/${c.id}`, {
        name_en: v.name_en.trim(),
        name_vi: v.name_vi.trim(),
        icon: v.icon.trim() || c.icon,
        color: v.color,
      });
      setEditing(null);
    } catch {
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  const toggleArchive = async (c: Category) => {
    try {
      await mutate('PUT', `/api/categories/${c.id}`, { archived: c.archived !== 1 });
    } catch {
      toast({ message: t(locale, 'errorGeneric') });
    }
  };

  return (
    <Card title={t(locale, 'categories')} testId="categories-card">
      <ul className="list">
        {sorted.map((c) => (
          <li key={c.id} className={cls('cat-setting', c.archived === 1 && 'is-archived')} data-testid={`cat-${c.key}`}>
            {editing === c.id ? (
              <CategoryForm
                locale={locale}
                initial={c}
                submitLabel={t(locale, 'save')}
                testPrefix={`cat-edit-${c.id}`}
                onSubmit={(v) => update(c, v)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="row cat-line">
                <span className="tx-icon" style={{ background: c.color }} aria-hidden="true">
                  {c.icon}
                </span>
                <span className="row-main">
                  <span className="row-title">{locale === 'vi' ? c.name_vi : c.name_en}</span>
                  {c.archived === 1 && <span className="muted small">{t(locale, 'categoryArchived')}</span>}
                </span>
                <span className="cat-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(c.id)}>
                    {t(locale, 'edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleArchive(c)}>
                    {c.archived === 1 ? t(locale, 'restore') : t(locale, 'archive')}
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="add-cat">
        <h3 className="card-subtitle">{t(locale, 'addCategory')}</h3>
        <CategoryForm locale={locale} submitLabel={t(locale, 'add')} testPrefix="cat" onSubmit={add} resetOnSubmit />
      </div>
    </Card>
  );
}

interface CategoryValues {
  icon: string;
  name_en: string;
  name_vi: string;
  color: string;
}

function CategoryForm({
  locale,
  initial,
  submitLabel,
  testPrefix,
  onSubmit,
  onCancel,
  resetOnSubmit,
}: {
  locale: Locale;
  initial?: Category;
  submitLabel: string;
  testPrefix: string;
  onSubmit: (v: CategoryValues) => void | Promise<void>;
  onCancel?: () => void;
  resetOnSubmit?: boolean;
}) {
  const [icon, setIcon] = useState(initial?.icon ?? '');
  const [nameEn, setNameEn] = useState(initial?.name_en ?? '');
  const [nameVi, setNameVi] = useState(initial?.name_vi ?? '');
  const [color, setColor] = useState(initial?.color ?? PALETTE[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await onSubmit({ icon, name_en: nameEn, name_vi: nameVi, color });
    setBusy(false);
    if (resetOnSubmit) {
      setIcon('');
      setNameEn('');
      setNameVi('');
    }
  };

  return (
    <div className="cat-form">
      <div className="cat-form-row">
        <input
          className="input cat-icon-input"
          value={icon}
          maxLength={8}
          placeholder="☕"
          aria-label={t(locale, 'categoryIcon')}
          data-testid={`${testPrefix}-icon`}
          onChange={(e) => setIcon(e.target.value)}
        />
        <input
          className="input"
          value={nameEn}
          placeholder={t(locale, 'categoryNameEn')}
          aria-label={t(locale, 'categoryNameEn')}
          maxLength={60}
          data-testid={`${testPrefix}-name-en`}
          onChange={(e) => setNameEn(e.target.value)}
        />
        <input
          className="input"
          value={nameVi}
          placeholder={t(locale, 'categoryNameVi')}
          aria-label={t(locale, 'categoryNameVi')}
          maxLength={60}
          data-testid={`${testPrefix}-name-vi`}
          onChange={(e) => setNameVi(e.target.value)}
        />
      </div>
      <div className="swatches" role="group" aria-label={t(locale, 'color')}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={cls('swatch', color === c && 'is-active')}
            style={{ background: c }}
            aria-label={c}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="btn-row">
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {t(locale, 'cancel')}
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submit()} data-testid={`${testPrefix}-submit`}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/** Stable, unique key for a new category, e.g. "coffee-k3f9". */
function makeKey(name: string, existing: Category[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'cat';
  let key = '';
  do {
    key = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  } while (existing.some((c) => c.key === key));
  return key;
}

// ---------- data ----------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function DataCard({ locale }: { locale: Locale }) {
  const { refresh } = useStore();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const day = todayISO(new Date(), 'Asia/Ho_Chi_Minh');

  const exportCsv = async () => {
    setBusy(true);
    try {
      const data = await api<{
        transactions: { date: string; kind: string; category_id: number | null; amount: number; note: string }[];
        categories: { id: number; name_en: string; name_vi: string }[];
      }>('GET', '/api/export');
      const names = new Map(data.categories.map((c) => [c.id, locale === 'vi' ? c.name_vi : c.name_en]));
      const rows = [['date', 'kind', 'category', 'amount', 'note'].join(',')];
      for (const tx of [...data.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
        rows.push(
          [tx.date, tx.kind, tx.category_id === null ? '' : (names.get(tx.category_id) ?? ''), tx.amount, tx.note]
            .map(csvCell)
            .join(','),
        );
      }
      downloadBlob(new Blob(['﻿' + rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }), `my-finance-transactions-${day}.csv`);
    } catch {
      toast({ message: t(locale, 'exportFailed') });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let data: { transactions?: unknown; assets?: unknown };
    try {
      data = JSON.parse(await file.text()) as typeof data;
    } catch {
      toast({ message: t(locale, 'invalidFile') });
      return;
    }
    if (!Array.isArray(data.transactions) || !Array.isArray(data.assets)) {
      toast({ message: t(locale, 'invalidFile') });
      return;
    }
    if (!window.confirm(t(locale, 'importConfirm'))) return;
    setBusy(true);
    try {
      await api('POST', '/api/import', data);
      await refresh();
      toast({ message: t(locale, 'importDone') });
    } catch (err) {
      toast({ message: t(locale, 'importFailed', { error: err instanceof Error ? err.message : '' }) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card title={t(locale, 'dataSection')} testId="data-card">
      <div className="btn-row">
        <a className="btn btn-ghost btn-sm" href="/api/export" download data-testid="export-json">
          <Icon name="receipt" size={16} />
          {t(locale, 'exportJson')}
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportCsv()} disabled={busy} data-testid="export-csv">
          {t(locale, 'exportCsv')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="import-json">
          {t(locale, 'importJson')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="import-file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
    </Card>
  );
}

// ---------- account ----------

function AccountCard({ locale }: { locale: Locale }) {
  const { logout } = useStore();
  return (
    <Card title={t(locale, 'appName')}>
      <p className="muted small" data-testid="app-version">
        {t(locale, 'appVersion', { version: APP_VERSION })}
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()} data-testid="logout">
          {t(locale, 'logout')}
        </button>
      </div>
    </Card>
  );
}

