import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '@/lib/api';

/**
 * Minimal client-side Markdown renderer for update release notes.
 *
 * Renders headings (##, ###), bold (**), bullet lists, and https:// links
 * into plain HTML. Strips all other Markdown and rejects javascript: links.
 * All content is escaped before rendering — no raw HTML passthrough.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(escaped: string): string {
  // Bold: **text** (applied to already-escaped text)
  let out = escaped.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => `<strong>${inner}</strong>`);
  // Links [label](https://…) — only https URLs; label and URL are separately escaped before substitution
  out = out.replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, (_, label: string, url: string) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  return out;
}

function safeRenderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) {
      if (inList) { html.push('</ul>'); inList = false; }
      continue;
    }
    // Heading ## or ###
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      if (inList) { html.push('</ul>'); inList = false; }
      const level = h[1].length === 3 ? 3 : 2;
      html.push(`<h${level}>${escapeHtml(h[2])}</h${level}>`);
      continue;
    }
    // List item
    const li = /^-\s+(.+)$/.exec(line);
    if (li) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${renderInline(escapeHtml(li[1]))}</li>`);
      continue;
    }
    // Plain paragraph
    if (inList) { html.push('</ul>'); inList = false; }
    html.push(`<p>${renderInline(escapeHtml(line))}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

export function UpdateBanner({ status, onInstall }: { status: UpdateStatus | null; onInstall: () => void }) {
  const [visibleStatus, setVisibleStatus] = useState(status);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleStatus((current) =>
      current?.status === 'downloaded' && status?.status !== 'downloaded' ? current : status,
    );
    setNotesOpen(false);
  }, [status]);

  if (!visibleStatus || (visibleStatus.status !== 'available' && visibleStatus.status !== 'progress'
    && visibleStatus.status !== 'downloaded')) return null;

  const releaseNotes =
    (visibleStatus.status === 'available' || visibleStatus.status === 'downloaded')
      ? (visibleStatus.releaseNotes ?? null)
      : null;

  // safeRenderMarkdown escapes all content and emits only a safe allow-listed
  // element set, so dangerouslySetInnerHTML is intentional and safe here.
  const notesHtml = releaseNotes ? safeRenderMarkdown(releaseNotes) : null;

  if (visibleStatus.status === 'downloaded') {
    return (
      <div className="update-banner" role="status">
        <span>
          Version {visibleStatus.version} prête —{' '}
          <button className="link" onClick={onInstall}>Redémarrer pour installer</button>
        </span>
        {notesHtml && (
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
        )}
      </div>
    );
  }

  const progress = visibleStatus.status === 'progress'
    ? `téléchargement ${visibleStatus.percent} %…`
    : 'téléchargement en cours…';

  return (
    <div className="update-banner" role="status">
      <span>Nouvelle version {visibleStatus.version} disponible — {progress}</span>
      {notesHtml && (
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
      )}
    </div>
  );
}
