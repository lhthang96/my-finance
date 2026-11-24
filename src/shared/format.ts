import type { Locale } from './types';

export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

const intlLocale = (locale: Locale): string => (locale === 'vi' ? 'vi-VN' : 'en-US');

/** Full VND amount with no decimals: vi `1.234.567 ₫`, en `1,234,567 ₫`. */
export function formatVND(n: number, locale: Locale): string {
  const digits = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 });
  return `${digits.format(Math.round(n))} ₫`;
}

const COMPACT_UNITS: Record<Locale, [number, string, number][]> = {
  // [divisor, suffix, max fraction digits]
  en: [
    [1e9, 'B', 2],
    [1e6, 'M', 1],
    [1e3, 'K', 0],
  ],
  vi: [
    [1e9, ' tỷ', 2],
    [1e6, ' tr', 1],
    [1e3, ' N', 0],
  ],
};

/** Compact amount: vi `9,06 tỷ`, `378,7 tr`, `500 N`; en `9.06B`, `378.7M`, `500K`. */
export function formatCompact(n: number, locale: Locale): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  for (const [div, suffix, digits] of COMPACT_UNITS[locale]) {
    if (a >= div) {
      const nf = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: digits });
      return sign + nf.format(a / div) + suffix;
    }
  }
  return sign + new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(Math.round(a));
}

const UNIT_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  tr: 1e6,
  triệu: 1e6,
  trieu: 1e6,
  b: 1e9,
  tỷ: 1e9,
  ty: 1e9,
};

/**
 * Parses a typed amount into integer VND, or null when invalid.
 * Examples: 150k -> 150000, 1.5tr -> 1500000, 1,5m -> 1500000, 2tỷ -> 2000000000,
 * 25.000 -> 25000, 25000 -> 25000, 500 -> 500.
 * With a unit, `.` or `,` is a decimal separator; without a unit they are thousands separators.
 */
export function parseAmount(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s*(đ|₫|vnd)$/, '');
  if (!s) return null;
  const m = /^(\d[\d.,\s]*?)\s*(k|m|tr|triệu|trieu|b|tỷ|ty)?$/.exec(s);
  if (!m) return null;
  const [, numPart, unit] = m;

  if (!unit) {
    const digits = numPart.replace(/[.,\s]/g, '');
    return /^\d+$/.test(digits) ? Number(digits) : null;
  }

  let num = numPart.replace(/\s/g, '');
  const lastSep = Math.max(num.lastIndexOf('.'), num.lastIndexOf(','));
  if (lastSep >= 0) {
    const intPart = num.slice(0, lastSep).replace(/[.,]/g, '');
    const frac = num.slice(lastSep + 1);
    num = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  }
  const value = Number(num);
  if (!Number.isFinite(value) || num === '') return null;
  return Math.round(value * UNIT_MULTIPLIERS[unit]);
}

/** Percentage from a ratio, e.g. 0.0418 -> "4.2%" (en) / "4,2%" (vi). */
export function formatPercent(ratio: number, locale: Locale, digits = 1): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

function ymdParts(now: Date, tz: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Local calendar date in the timezone as YYYY-MM-DD. */
export function todayISO(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const { y, m, d } = ymdParts(now, tz);
  return `${y}-${m}-${d}`;
}

/** Local calendar month in the timezone as YYYY-MM. */
export function currentMonth(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const { y, m } = ymdParts(now, tz);
  return `${y}-${m}`;
}
