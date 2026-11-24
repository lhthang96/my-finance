// Placeholder for screens that are not built yet.
import { useStore } from '../lib/store';
import { t, type TKey } from '../../shared/i18n';
import { EmptyState, PageHeader } from '../components/ui';

export function ComingSoon({ titleKey, back }: { titleKey: TKey; back?: boolean }) {
  const { locale } = useStore();
  return (
    <div className="page-stack">
      <PageHeader title={t(locale, titleKey)} back={back} />
      <div className="card coming-soon">
        <EmptyState text={t(locale, 'comingSoonBody')} />
      </div>
    </div>
  );
}
