'use client';
/**
 * ChangelogDialog – "Nouveautés de la version X"
 *
 * Shown once after an update (show-once logic is in the Electron main process).
 * Also used for the permanent history list (C) when `onDismiss` is not provided.
 *
 * Props
 *  entries  – ordered list of ChangelogEntry, newest first
 *  onDismiss – when present, renders the "Compris" button (and Esc closes)
 *  currentVersion – used in the title when a single new version is shown
 */

import { useCallback, useEffect, useRef } from 'react';

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

const SECTION_ICONS: Record<string, string> = {
  'ajouté': '✦',
  'added': '✦',
  'modifié': '✎',
  'changed': '✎',
  'corrigé': '✔',
  'fixed': '✔',
  'sécurité': '🔒',
  'security': '🔒',
  'supprimé': '✖',
  'removed': '✖',
};

function sectionIcon(title: string): string {
  return SECTION_ICONS[title.toLowerCase()] ?? '•';
}

interface EntryBlockProps {
  entry: ChangelogEntry;
  defaultOpen: boolean;
  id: string;
}

function EntryBlock({ entry, defaultOpen, id }: EntryBlockProps) {
  const summaryRef = useRef<HTMLButtonElement>(null);

  return (
    <details open={defaultOpen} className="cl-entry">
      <summary className="cl-entry-summary">
        <span className="cl-entry-version" aria-label={`Version ${entry.version}`}>
          <strong>Version {entry.version}</strong>
        </span>
        <span className="cl-entry-date" aria-label={`publiée le ${entry.date}`}>{entry.date}</span>
      </summary>
      <div className="cl-entry-body" id={id}>
        {entry.sections.length === 0 && (
          <p className="cl-empty">Aucun détail disponible.</p>
        )}
        {entry.sections.map((section) => (
          <section key={section.title} className="cl-section" aria-label={section.title}>
            <h3 className="cl-section-title">
              <span className="cl-section-icon" aria-hidden="true">{sectionIcon(section.title)}</span>
              {' '}{section.title}
            </h3>
            <ul className="cl-items">
              {section.items.map((item, i) => (
                <li key={i} className="cl-item">
                  <span dangerouslySetInnerHTML={{ __html: renderItemHtml(item) }} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/** Render a plain-text changelog item with minimal inline markdown (bold only). */
function renderItemHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export interface ChangelogDialogProps {
  entries: ChangelogEntry[];
  currentVersion?: string;
  onDismiss?: () => void;
}

export function ChangelogDialog({ entries, currentVersion, onDismiss }: ChangelogDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  // Focus trap
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), summary'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onDismiss) {
        onDismiss();
        return;
      }
      if (e.key === 'Tab') {
        if (!focusable.length) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const title = entries.length === 1 && currentVersion
    ? `Nouveautés de la version ${currentVersion}`
    : entries.length === 1
      ? `Nouveautés de la version ${entries[0].version}`
      : 'Journal des modifications';

  return (
    <>
      {/* Backdrop */}
      {onDismiss && (
        <div
          className="cl-backdrop"
          aria-hidden="true"
          onClick={onDismiss}
        />
      )}
      <div
        ref={dialogRef}
        className="cl-dialog"
        role="dialog"
        aria-modal={onDismiss ? 'true' : 'false'}
        aria-labelledby="cl-title"
      >
        <div className="cl-header">
          <h2 id="cl-title" className="cl-title">{title}</h2>
          {onDismiss && (
            <button
              className="cl-close-btn"
              onClick={onDismiss}
              aria-label="Fermer"
              title="Fermer"
            >
              ×
            </button>
          )}
        </div>

        <div className="cl-scroll" role="region" aria-label="Contenu du journal">
          {entries.length === 0 && (
            <p className="cl-empty">Aucune note de version disponible.</p>
          )}
          {entries.map((entry, i) => (
            <EntryBlock
              key={entry.version}
              entry={entry}
              defaultOpen={i === 0}
              id={`cl-entry-${entry.version}`}
            />
          ))}
        </div>

        {onDismiss && (
          <div className="cl-footer">
            <button
              ref={dismissRef}
              className="cl-dismiss-btn"
              onClick={onDismiss}
              autoFocus
            >
              Compris
            </button>
          </div>
        )}
      </div>

      <style>{DIALOG_CSS}</style>
    </>
  );
}

const DIALOG_CSS = `
.cl-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 999;
}
.cl-dialog {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1000;
  width: min(680px, 95vw);
  max-height: 80vh;
  display: flex; flex-direction: column;
  background: var(--panel, #fff);
  color: var(--ink, #1d2733);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.28);
  outline: none;
}
.cl-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--line, #d9dee5);
  flex-shrink: 0;
}
.cl-title {
  margin: 0; font-size: 17px; font-weight: 700;
  color: var(--ink, #1d2733);
}
.cl-close-btn {
  background: none; border: none; cursor: pointer;
  font-size: 22px; line-height: 1; padding: 2px 6px;
  color: var(--muted, #6a7686);
  border-radius: 4px;
}
.cl-close-btn:hover { background: var(--accent-soft, #e8f0fe); }
.cl-scroll {
  overflow-y: auto; flex: 1;
  padding: 12px 20px;
}
.cl-entry {
  margin-bottom: 12px;
  border: 1px solid var(--line, #d9dee5);
  border-radius: 6px;
  overflow: hidden;
}
.cl-entry-summary {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; cursor: pointer;
  background: var(--accent-soft, #e8f0fe);
  user-select: none; list-style: none;
  font-size: 14px;
}
.cl-entry-summary::-webkit-details-marker { display: none; }
.cl-entry-version strong { font-size: 15px; }
.cl-entry-date { color: var(--muted, #6a7686); font-size: 13px; margin-left: auto; }
.cl-entry-body { padding: 12px 16px; }
.cl-section { margin-bottom: 12px; }
.cl-section-title {
  font-size: 13px; font-weight: 600; margin: 0 0 6px;
  color: var(--accent, #2b6cb0);
  display: flex; align-items: center; gap: 5px;
}
.cl-section-icon { font-size: 14px; }
.cl-items { margin: 0; padding-left: 18px; }
.cl-item { margin-bottom: 4px; font-size: 13px; line-height: 1.5; }
.cl-empty { color: var(--muted, #6a7686); font-style: italic; font-size: 13px; }
.cl-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--line, #d9dee5);
  display: flex; justify-content: flex-end;
  flex-shrink: 0;
}
.cl-dismiss-btn {
  background: var(--accent, #2b6cb0);
  color: var(--accent-ink, #fff);
  border: none; border-radius: 6px;
  padding: 8px 24px; font-size: 14px; font-weight: 600;
  cursor: pointer;
}
.cl-dismiss-btn:hover { opacity: .88; }
.cl-dismiss-btn:focus-visible { outline: 2px solid var(--accent, #2b6cb0); outline-offset: 2px; }

@media (prefers-color-scheme: dark) {
  .cl-backdrop { background: rgba(0,0,0,.6); }
  .cl-entry-summary { background: var(--accent-soft, #1d3350); }
}
`;
