import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '@/lib/api';
import { renderMarkdown } from '../../desktop/src/changelog/render-markdown';

export function UpdateBanner({ status, onInstall }: { status: UpdateStatus | null; onInstall: () => void }) {
  const [visibleStatus, setVisibleStatus] = useState(status);
  const [notesOpen, setNotesOpen] = useState(false);
  const [lastNotes, setLastNotes] = useState<{ version: string; notes: string } | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const visibleStatusRef = useRef<UpdateStatus | null>(status);
  const lastVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const current = visibleStatusRef.current;
    const next = current?.status === 'downloaded' && status?.status !== 'downloaded' ? current : status;
    visibleStatusRef.current = next;
    setVisibleStatus(next);

    const nextVersion =
      next && (next.status === 'available' || next.status === 'progress' || next.status === 'downloaded')
        ? next.version
        : null;

    if (nextVersion !== lastVersionRef.current) {
      lastVersionRef.current = nextVersion;
      setNotesOpen(false);
    }

    if (next && (next.status === 'available' || next.status === 'downloaded')) {
      if (next.releaseNotes) {
        setLastNotes({ version: next.version, notes: next.releaseNotes });
      } else if (next.status === 'available') {
        setLastNotes((prev) => (prev?.version === next.version ? prev : null));
      }
    } else if (!next || next.status === 'none' || next.status === 'checking') {
      setLastNotes(null);
    }
  }, [status]);

  if (!visibleStatus || (visibleStatus.status !== 'available' && visibleStatus.status !== 'progress'
    && visibleStatus.status !== 'downloaded')) return null;

  const directNotes =
    visibleStatus.status === 'available' || visibleStatus.status === 'downloaded'
      ? (visibleStatus.releaseNotes ?? null)
      : null;
  const cachedNotes = lastNotes?.version === visibleStatus.version ? lastNotes.notes : null;
  const releaseNotes = directNotes ?? cachedNotes;

  // renderMarkdown escapes/strips unsafe HTML and emits only an allow-listed element set.
  const notesHtml = releaseNotes ? renderMarkdown(releaseNotes) : null;

  const notesToggle = notesHtml ? (
    <>
      {' '}
      <button
        className="link"
        aria-expanded={notesOpen}
        aria-controls="update-notes-panel"
        onClick={() => setNotesOpen((v) => !v)}
      >
        {notesOpen ? '▾ Masquer les notes' : '▸ Notes de version'}
      </button>
      {notesOpen && (
        // eslint-disable-next-line react/no-danger
        <div id="update-notes-panel" ref={notesRef} className="update-release-notes" dangerouslySetInnerHTML={{ __html: notesHtml }} />
      )}
    </>
  ) : null;

  if (visibleStatus.status === 'downloaded') {
    return (
      <div className="update-banner" role="status">
        <span>
          Version {visibleStatus.version} prête —{' '}
          <button className="link" onClick={onInstall}>Redémarrer pour installer</button>
        </span>
        {notesToggle}
      </div>
    );
  }

  const progress = visibleStatus.status === 'progress'
    ? `téléchargement ${visibleStatus.percent} %…`
    : 'téléchargement en cours…';

  return (
    <div className="update-banner" role="status">
      <span>Nouvelle version {visibleStatus.version} disponible — {progress}</span>
      {notesToggle}
    </div>
  );
}
