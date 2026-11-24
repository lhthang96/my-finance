// Number formatting for UI-only text (deltas, years). Money uses formatCompact / formatVND from shared/format.
import type { Locale } from '../../shared/types';

export function formatYears(years: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 }).format(years);
}

/** Signed text with a true minus sign: -1.2 -> "−" + format(1.2), 3 -> "+" + format(3). */
export function formatSigned(n: number, format: (abs: number) => string): string {
  return `${n < 0 ? '−' : '+'}${format(Math.abs(n))}`;
}

/** Rounds a percent value to one decimal place. */
export function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}
