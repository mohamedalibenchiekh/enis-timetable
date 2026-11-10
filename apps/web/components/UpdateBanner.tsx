import type { UpdateStatus } from '@/lib/api';

export function UpdateBanner({ status, onInstall }: { status: UpdateStatus | null; onInstall: () => void }) {
  if (!status || (status.status !== 'available' && status.status !== 'progress' && status.status !== 'downloaded')) return null;

  if (status.status === 'downloaded') {
    return (
      <div className="update-banner" role="status">
        Version {status.version} prête —{' '}
        <button className="link" onClick={onInstall}>Redémarrer pour installer</button>
      </div>
    );
  }

  const progress = status.status === 'progress'
    ? `téléchargement ${status.percent} %…`
    : 'téléchargement en cours…';
  return <div className="update-banner" role="status">Nouvelle version {status.version} disponible — {progress}</div>;
}
