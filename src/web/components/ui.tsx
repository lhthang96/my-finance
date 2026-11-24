// Shared UI primitives: page header, card, skeleton, chip, bottom sheet, toast.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { t } from '../../shared/i18n';
import { Icon } from './icons';

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function PageHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}) {
  const { locale } = useStore();
  return (
    <header className="page-head">
      <div className="page-head-main">
        {back && (
          <a className="icon-btn" href="#/" aria-label={t(locale, 'back')}>
            <Icon name="chevronLeft" />
          </a>
        )}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="page-head-right">{right}</div>}
    </header>
  );
}

export function Card({
  children,
  className,
  title,
  action,
  testId,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <section className={cls('card', className)} data-testid={testId}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cls('skeleton', className)} style={style} aria-hidden="true" />;
}

export function Chip({
  children,
  active,
  onClick,
  color,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  color?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cls('chip', active && 'is-active', className)}
      onClick={onClick}
      style={color ? ({ '--c': color } as React.CSSProperties) : undefined}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="empty muted">{text}</p>;
}

// ---------- bottom sheet ----------

/** Slide-up sheet with a blurred backdrop. Children mount fresh each time the sheet opens. */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const id = window.setTimeout(() => setMounted(false), 260);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!mounted) return null;
  return (
    <div className={cls('sheet-root', shown && 'is-open')}>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} data-testid="sheet">
        <div className="sheet-grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

// ---------- toast ----------

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds. Default: error 6000, toast with an action (undo) 5000, info/success 3500. */
  duration?: number;
}

/** Auto-dismiss time for a toast. Explicit `duration` wins. */
export function toastDuration(opts: ToastOptions): number {
  if (opts.duration !== undefined) return opts.duration;
  if (opts.actionLabel) return 5000;
  return opts.tone === 'error' ? 6000 : 3500;
}

const ToastContext = createContext<(opts: ToastOptions) => void>(() => undefined);

/** One toast at a time: a new one replaces the current one. Taps dismiss it, and so does navigating to another page. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const nextId = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setCurrent(null);
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    const id = ++nextId.current;
    window.clearTimeout(timer.current);
    setCurrent({ ...opts, id });
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setCurrent((c) => (c?.id === id ? null : c));
    }, toastDuration(opts));
  }, []);

  useEffect(() => {
    window.addEventListener('hashchange', dismiss);
    return () => {
      window.removeEventListener('hashchange', dismiss);
      window.clearTimeout(timer.current);
    };
  }, [dismiss]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {current && (
          <div
            className={cls('toast', `is-${current.tone ?? 'info'}`)}
            key={current.id}
            data-testid="toast"
            onClick={dismiss}
            title={current.actionLabel ? undefined : 'Dismiss'}
          >
            <span className="toast-msg">{current.message}</span>
            {current.actionLabel && (
              <button
                type="button"
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation();
                  current.onAction?.();
                  dismiss();
                }}
              >
                {current.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (opts: ToastOptions) => void {
  return useContext(ToastContext);
}
