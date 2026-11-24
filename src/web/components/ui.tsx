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

export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

const ToastContext = createContext<(opts: ToastOptions) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<(ToastOptions & { id: number })[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const show = useCallback(
    (opts: ToastOptions) => {
      const id = ++nextId.current;
      setItems((list) => [...list.slice(-2), { ...opts, id }]);
      window.setTimeout(() => dismiss(id), opts.duration ?? 2600);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((i) => (
          <div className="toast" key={i.id} data-testid="toast">
            <span className="toast-msg">{i.message}</span>
            {i.actionLabel && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  i.onAction?.();
                  dismiss(i.id);
                }}
              >
                {i.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (opts: ToastOptions) => void {
  return useContext(ToastContext);
}
