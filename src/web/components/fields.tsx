// Form fields that keep their own text while typing, so partial input ("1,", "150k") is not rewritten.
import { useEffect, useRef, useState } from 'react';
import { formatInt } from '../lib/dates';
import { parseAmount } from '../../shared/format';
import type { Locale } from '../../shared/types';
import { cls } from './ui';

/** Money input: accepts 150k, 1.5tr, 25.000 and shows the grouped VND amount when not focused. */
export function AmountField({
  value,
  onChange,
  locale,
  label,
  testId,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  locale: Locale;
  label: string;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const shown = (n: number) => (n > 0 ? formatInt(n, locale) : '');
  const [text, setText] = useState(() => shown(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (document.activeElement !== ref.current) setText(shown(value));
    // `shown` depends only on locale, which is also a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locale]);

  return (
    <input
      ref={ref}
      className={cls('input', 'amount-input', invalid && 'is-invalid', className)}
      inputMode="text"
      autoComplete="off"
      value={text}
      placeholder="0"
      aria-label={label}
      data-testid={testId}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = raw.trim() === '' ? 0 : parseAmount(raw);
        if (parsed === null) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onChange(parsed);
      }}
      onBlur={() => {
        setInvalid(false);
        setText(shown(value));
      }}
    />
  );
}

/** Plain number input with clamping on blur. Used for percentages, years and hours. */
export function NumField({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  testId,
  className,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  testId?: string;
  className?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(value));

  useEffect(() => {
    if (document.activeElement !== ref.current) setText(String(value));
  }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <span className={cls('num-field', className)}>
      <input
        ref={ref}
        type="number"
        className="input num-input"
        min={min}
        max={max}
        step={step}
        value={text}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(clamp(n));
        }}
        onBlur={() => setText(String(value))}
      />
      {suffix && <span className="muted small num-suffix">{suffix}</span>}
    </span>
  );
}
