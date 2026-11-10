import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@/lib/api';

export function UpdateBanner({ status, onInstall }: { status: UpdateStatus | null; onInstall: () => void }) {
  const [visibleStatus, setVisibleStatus] = useState(status);
  useEffect(() => {
    setVisibleStatus((current) =>
      current?.status === 'downloaded' && status?.status !== 'downloaded' ? current : status,
    );
  }, [status]);

  if (!visibleStatus || (visibleStatus.status !== 'available' && visibleStatus.status !== 'progress'
    && visibleStatus.status !== 'downloaded')) return null;

  if (visibleStatus.status === 'downloaded') {
    return (
      <div className="update-banner" role="status">
        Version {visibleStatus.version} prête —{' '}
        <button className="link" onClick={onInstall}>Redémarrer pour installer</button>
      </div>
    );
  }

  const progress = visibleStatus.status === 'progress'
    ? `téléchargement ${visibleStatus.percent} %…`
    : 'téléchargement en cours…';
  return <div className="update-banner" role="status">Nouvelle version {visibleStatus.version} disponible — {progress}</div>;
}
