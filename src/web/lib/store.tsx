// App store: loads /api/state once, exposes mutations (optimistic, then reconciled by refresh) and the offline outbox.
//
// Usage in a page:  const { state, locale, mutate } = useStore();
//   await mutate('PUT', '/api/settings', { salary: 60e6 }, (s) => ({ ...s, settings: { ...s.settings, salary: 60e6 } }));
// `optimistic` receives the last server state and returns the patched state; the summary is recomputed
// client-side afterwards. On failure the previous state is restored. On success the state is refreshed.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeSummary } from '../../shared/calc';
import { currentMonth } from '../../shared/format';
import type { AppState, Locale, Transaction } from '../../shared/types';
import { ApiError, api, setUnauthorizedHandler } from './api';
import {
  cacheLocale,
  loadOutbox,
  loadPendingLocale,
  newLocalId,
  readCachedLocale,
  savePendingLocale,
  saveOutbox,
  rejectionReason,
  type OutboxItem,
  type TxBody,
} from './outbox';
import { useToast } from '../components/ui';
import { t } from '../../shared/i18n';

export type AuthStatus = 'loading' | 'login' | 'ready' | 'error';
export type LocalTransaction = Transaction & { localId?: string };
export type LoginResult = { ok: true } | { ok: false; reason: 'wrong' | 'limited' | 'network' };
export type Method = 'POST' | 'PUT' | 'DELETE';

export interface StoreValue {
  status: AuthStatus;
  /** Server state with queued (unsynced) transactions merged into monthTransactions. Null until loaded. */
  state: AppState | null;
  locale: Locale;
  /** Number of transactions waiting in the outbox. */
  pending: number;
  online: boolean;
  refresh: () => Promise<void>;
  /** Re-runs the boot sequence (auth check, then load). Used by the error screen. */
  reload: () => Promise<void>;
  login: (passcode: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  setLocale: (locale: Locale) => void;
  mutate: <T = unknown>(
    method: Method,
    path: string,
    body?: unknown,
    optimistic?: (s: AppState) => AppState,
  ) => Promise<T>;
  /** Queues a transaction (offline-safe), returns its local id. Undo with undoTransaction. */
  enqueueTransaction: (body: TxBody) => string;
  undoTransaction: (localId: string) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Adds the client-side summary so optimistic edits show their effect immediately. */
export function withSummary(s: AppState): AppState {
  return { ...s, summary: computeSummary(s.settings, s.spendingItems, s.assets, new Date()) };
}

/** Merges queued transactions of the current month into monthTransactions (ids are negative, localId set). */
function withPending(base: AppState, items: OutboxItem[], cancelled: Set<string>): AppState {
  const month = currentMonth(new Date(), base.settings.timezone);
  const extra: LocalTransaction[] = items
    .filter((i) => !cancelled.has(i.localId) && i.body.date.startsWith(month))
    .map((i, idx) => ({
      id: -(idx + 1),
      date: i.body.date,
      amount: i.body.amount,
      kind: i.body.kind,
      category_id: i.body.category_id,
      note: i.body.note,
      created_at: i.createdAt,
      localId: i.localId,
    }));
  if (extra.length === 0) return base;
  return { ...base, monthTransactions: [...extra, ...base.monthTransactions] };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<AppState | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [cachedLocale, setCachedLocale] = useState<Locale>(readCachedLocale);
  const [outbox, setOutbox] = useState<OutboxItem[]>(loadOutbox);
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const toast = useToast();

  const baseRef = useRef<AppState | null>(null);
  const sentIds = useRef(new Map<string, number>());
  const cancelled = useRef(new Set<string>());
  const flushing = useRef(false);

  const commit = useCallback((next: AppState | null) => {
    baseRef.current = next;
    setBase(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      let data = await api<AppState>('GET', '/api/state');
      const pendingLocale = loadPendingLocale();
      if (pendingLocale) {
        savePendingLocale(null);
        if (pendingLocale !== data.settings.locale) {
          await api('PUT', '/api/settings', { locale: pendingLocale });
          data = { ...data, settings: { ...data.settings, locale: pendingLocale } };
        }
      }
      cacheLocale(data.settings.locale);
      setCachedLocale(data.settings.locale);
      commit(data);
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        commit(null);
        setStatus('login');
        return;
      }
      if (!baseRef.current) setStatus('error');
    }
  }, [commit]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    let synced = false;
    try {
      for (;;) {
        const item = loadOutbox()[0];
        if (!item) break;
        try {
          const tx = await api<Transaction>('POST', '/api/transactions', item.body);
          sentIds.current.set(item.localId, tx.id);
          saveOutbox(loadOutbox().filter((i) => i.localId !== item.localId));
          synced = true;
          if (cancelled.current.delete(item.localId)) {
            await api('DELETE', `/api/transactions/${tx.id}`);
            sentIds.current.delete(item.localId);
          }
        } catch (err) {
          // Network errors, 401 and 5xx keep the entry queued for the next attempt.
          if (!(err instanceof ApiError) || err.status === 401 || err.status >= 500) break;
          // A 4xx means the server refuses this entry for good: drop it so the queue cannot block, and say so.
          saveOutbox(loadOutbox().filter((i) => i.localId !== item.localId));
          setOutbox(loadOutbox());
          const locale = baseRef.current?.settings.locale ?? readCachedLocale();
          toast({ message: t(locale, 'syncRejected', { reason: t(locale, rejectionReason(err.message)) }), tone: 'error' });
        }
      }
    } finally {
      flushing.current = false;
      setOutbox(loadOutbox());
    }
    if (synced) await refresh();
  }, [refresh, toast]);

  const boot = useCallback(async () => {
    setStatus('loading');
    try {
      const me = await api<{ authenticated: boolean }>('GET', '/api/auth/me');
      if (me.authenticated) await refresh();
      else setStatus('login');
    } catch {
      setStatus('error');
    }
  }, [refresh]);

  // Boot once; treat any 401 as "show login".
  useEffect(() => {
    setUnauthorizedHandler(() => {
      commit(null);
      setStatus('login');
    });
    void boot();
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      setUnauthorizedHandler(null);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [boot, commit]);

  // Flush the outbox whenever we are logged in and online (app start, reconnect, after login).
  useEffect(() => {
    if (status !== 'ready' || !online) return;
    void flush();
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [status, online, flush]);

  const login = useCallback(
    async (passcode: string): Promise<LoginResult> => {
      try {
        await api('POST', '/api/auth/login', { passcode });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return { ok: false, reason: 'wrong' };
        if (err instanceof ApiError && err.status === 429) return { ok: false, reason: 'limited' };
        return { ok: false, reason: 'network' };
      }
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api('POST', '/api/auth/logout');
    } finally {
      commit(null);
      setStatus('login');
    }
  }, [commit]);

  const mutate = useCallback(
    async <T,>(method: Method, path: string, body?: unknown, optimistic?: (s: AppState) => AppState): Promise<T> => {
      const prev = baseRef.current;
      if (optimistic && prev) commit(withSummary(optimistic(prev)));
      try {
        const res = await api<T>(method, path, body);
        await refresh();
        return res;
      } catch (err) {
        if (prev) commit(prev);
        throw err;
      }
    },
    [commit, refresh],
  );

  const enqueueTransaction = useCallback(
    (body: TxBody): string => {
      const localId = newLocalId();
      const next = [...loadOutbox(), { localId, body, createdAt: new Date().toISOString() }];
      saveOutbox(next);
      setOutbox(next);
      void flush();
      return localId;
    },
    [flush],
  );

  const undoTransaction = useCallback(
    async (localId: string) => {
      const queued = loadOutbox();
      if (queued.some((i) => i.localId === localId)) {
        const rest = queued.filter((i) => i.localId !== localId);
        saveOutbox(rest);
        setOutbox(rest);
        return;
      }
      const serverId = sentIds.current.get(localId);
      if (serverId !== undefined) {
        sentIds.current.delete(localId);
        await mutate('DELETE', `/api/transactions/${serverId}`, undefined, (s) => ({
          ...s,
          monthTransactions: s.monthTransactions.filter((t) => t.id !== serverId),
        }));
        return;
      }
      // Still being sent: hide it now and delete it on the server as soon as the send completes.
      cancelled.current.add(localId);
      setOutbox(loadOutbox());
    },
    [mutate],
  );

  const setLocale = useCallback(
    (locale: Locale) => {
      cacheLocale(locale);
      setCachedLocale(locale);
      if (!baseRef.current) {
        savePendingLocale(locale);
        return;
      }
      mutate('PUT', '/api/settings', { locale }, (s) => ({ ...s, settings: { ...s.settings, locale } })).catch(
        () => undefined,
      );
    },
    [mutate],
  );

  const state = useMemo(
    () => (base ? withPending(base, outbox, cancelled.current) : null),
    [base, outbox],
  );
  const locale: Locale = base?.settings.locale ?? cachedLocale;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value: StoreValue = {
    status,
    state,
    locale,
    pending: outbox.length,
    online,
    refresh,
    reload: boot,
    login,
    logout,
    setLocale,
    mutate,
    enqueueTransaction,
    undoTransaction,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}

