'use client';
/**
 * ChangelogPanel – "Nouveautés" history list and post-update modal.
 *
 * Renders all versions from the bundled CHANGELOG, newest first.
 * When `?since=<v1>&upTo=<v2>` query parameters are present (post-update launch),
 * filters entries to `(since, upTo]` and renders ChangelogDialog as a dismissible
 * modal ("Compris" / Escape) that returns to the main screen.
 */

import { useEffect, useState } from 'react';
import { entriesBetween } from '../../desktop/src/changelog/parse';
import { ChangelogDialog, type ChangelogEntry } from './ChangelogDialog';

export function ChangelogPanel() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterRange, setFilterRange] = useState<{ since: string; upTo: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const since = params.get('since');
    const upTo = params.get('upTo');
    if (since && upTo) {
      setFilterRange({ since, upTo });
    }

    fetch('/api/changelog')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ChangelogEntry[]>;
      })
      .then(setEntries)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="changelog-panel-error" role="alert">
        Impossible de charger le journal des modifications : {error}
      </div>
    );
  }

  if (!entries) {
    return <div className="changelog-panel-loading">Chargement…</div>;
  }

  if (filterRange) {
    const filtered = entriesBetween(entries, filterRange.since, filterRange.upTo);
    return (
      <ChangelogDialog
        entries={filtered}
        currentVersion={filterRange.upTo}
        onDismiss={() => {
          window.location.href = '/';
        }}
      />
    );
  }

  return <ChangelogDialog entries={entries} />;
}
