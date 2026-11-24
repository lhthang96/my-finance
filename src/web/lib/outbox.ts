// Offline outbox: new transactions are queued in localStorage until the server accepts them.
import type { Locale } from '../../shared/types';

export interface TxBody {
  date: string;
  amount: number;
  kind: 'expense' | 'income';
  category_id: number | null;
  note: string;
}

export interface OutboxItem {
  localId: string;
  body: TxBody;
  createdAt: string;
}

const KEY = 'mf-outbox-v1';
const RECENT_KEY = 'mf-recent-categories';
const LOCALE_KEY = 'mf-locale';
const PENDING_LOCALE_KEY = 'mf-locale-pending';

export function loadOutbox(): OutboxItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

export function saveOutbox(items: OutboxItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or disabled: the item stays in memory for this session only.
  }
}

export function newLocalId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Category ids most recently used in Quick add, newest first. */
export function loadRecentCategories(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

export function rememberCategory(id: number | null): void {
  if (id === null) return;
  const next = [id, ...loadRecentCategories().filter((c) => c !== id)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** Locale picked on the login screen; pushed to the server once the first load succeeds. */
export function loadPendingLocale(): Locale | null {
  try {
    const v = localStorage.getItem(PENDING_LOCALE_KEY);
    return v === 'en' || v === 'vi' ? v : null;
  } catch {
    return null;
  }
}

export function savePendingLocale(locale: Locale | null): void {
  try {
    if (locale === null) localStorage.removeItem(PENDING_LOCALE_KEY);
    else localStorage.setItem(PENDING_LOCALE_KEY, locale);
  } catch {
    // ignore
  }
}

/** Locale cached on this device so the login screen can render in the right language. */
export function readCachedLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_KEY) === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

export function cacheLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // ignore
  }
}

/** Short reason for a server refusal. Server text looks like "amount: Number must be ..." (zod); only the field name is used. */
export function rejectionReason(serverError: string): 'reasonAmount' | 'reasonDate' | 'reasonCategory' | 'reasonOther' {
  const field = serverError.split(':')[0]?.trim().toLowerCase() ?? '';
  if (field === 'amount') return 'reasonAmount';
  if (field === 'date') return 'reasonDate';
  if (field.startsWith('category')) return 'reasonCategory';
  return 'reasonOther';
}
