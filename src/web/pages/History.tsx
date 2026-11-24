// History: monthly snapshots as a line chart (net worth and FI assets) and a list of months. Reached from Home.
import { useState } from 'react';
import { formatVND } from '../../shared/format';
import { t } from '../../shared/i18n';
import type { AppState, Locale } from '../../shared/types';
import { api } from '../lib/api';
import { formatMonthYear } from '../lib/dates';
import { useStore } from '../lib/store';
import { SnapshotLines } from '../components/charts';
import { Card, PageHeader, Skeleton, useToast } from '../components/ui';

export function HistoryPage() {
  const { state, locale } = useStore();
  if (!state) {
    return (
      <div className="page-stack" aria-busy="true">
        <Skeleton className="sk-title" />
        <Skeleton className="sk-card" />
      </div>
    );
  }
  return <HistoryContent state={state} locale={locale} />;
}

function HistoryContent({ state, locale }: { state: AppState; locale: Locale }) {
  const { refresh } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ascending = [...state.snapshots].sort((a, b) => a.month.localeCompare(b.month));
  const descending = [...ascending].reverse();

  const saveNow = async () => {
    setBusy(true);
    try {
      await api('POST', '/api/snapshots');
      await refresh();
      toast({ message: t(locale, 'snapshotDone') });
    } catch {
      toast({ message: t(locale, 'errorGeneric') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack history">
      <PageHeader
        title={t(locale, 'viewHistory')}
        back
        right={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveNow()} disabled={busy} data-testid="snapshot-save">
            {t(locale, 'snapshotNow')}
          </button>
        }
      />

      <Card title={t(locale, 'historyChart')}>
        {ascending.length === 0 ? (
          <p className="muted small">{t(locale, 'emptyState')}</p>
        ) : (
          <>
            <SnapshotLines
              rows={ascending}
              locale={locale}
              netWorthLabel={t(locale, 'kpiNetWorth')}
              fiAssetsLabel={t(locale, 'kpiFiAssets')}
            />
            <div className="chart-legend">
              <span>
                <span className="dot legend-nw" /> {t(locale, 'kpiNetWorth')}
              </span>
              <span>
                <span className="dot legend-fi" /> {t(locale, 'kpiFiAssets')}
              </span>
            </div>
          </>
        )}
      </Card>

      <Card title={t(locale, 'historyList')}>
        <table className="snap-table" data-testid="snapshot-table">
          <thead>
            <tr>
              <th scope="col">{t(locale, 'monthLabel')}</th>
              <th scope="col">{t(locale, 'kpiNetWorth')}</th>
              <th scope="col">{t(locale, 'kpiFiAssets')}</th>
            </tr>
          </thead>
          <tbody>
            {descending.map((s) => (
              <tr key={s.month} data-testid={`snap-row-${s.month}`}>
                <td>{formatMonthYear(`${s.month}-01`, locale)}</td>
                <td className="num">{formatVND(s.net_worth, locale)}</td>
                <td className="num">{formatVND(s.fi_assets, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
