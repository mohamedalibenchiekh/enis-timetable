'use client';
/**
 * ChangelogPanel – permanent "Nouveautés" history list (feature C).
 *
 * Renders all versions from the bundled CHANGELOG, newest first.
 * Data is fetched from /api/changelog which is served by the NestJS API.
 */

import { useEffect, useState } from 'react';
import { ChangelogDialog, type ChangelogEntry } from './ChangelogDialog';

export function ChangelogPanel() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return <ChangelogDialog entries={entries} />;
}
