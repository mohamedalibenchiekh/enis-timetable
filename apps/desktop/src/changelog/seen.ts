/**
 * "Show once" logic for the post-update changelog window.
 *
 * All state is stored in <userData>/state.json under the key
 * "lastSeenChangelogVersion". This file is managed by backup.ts for the
 * version key; we piggyback on the same file.
 *
 * Rules (all are pure and covered by unit tests):
 *  - FIRST INSTALL (no stored value or corrupt value): do NOT show the window;
 *    just record the current version.
 *  - Same version: show nothing.
 *  - Upgrade (current > lastSeen, semver compare, pre-release stripped):
 *    show the window with entries for every version between lastSeen
 *    (exclusive) and current (inclusive), newest-first.
 *  - Downgrade: show nothing.
 *  - Setting disabled: show nothing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { compareVersions } from './parse';

export interface SeenState {
  /** The version the user last acknowledged. null = never seen (first install). */
  lastSeenChangelogVersion: string | null;
}

/**
 * Determine what should happen on this launch given the stored version and
 * the running version. Pure function, no side-effects.
 *
 * @returns
 *  - 'first-install'  → record current, do NOT show window
 *  - 'show'           → show the window for versions (lastSeen, current]
 *  - 'nothing'        → same version, downgrade, or setting disabled
 */
export type ShowDecision = 'first-install' | 'show' | 'nothing';

export function decideShowChangelog(opts: {
  currentVersion: string;
  lastSeen: string | null | undefined;
  settingEnabled: boolean;
}): ShowDecision {
  const { currentVersion, lastSeen, settingEnabled } = opts;

  // Corrupt / missing stored value → first-install path
  if (lastSeen === null || lastSeen === undefined || typeof lastSeen !== 'string' || !lastSeen.trim()) {
    return 'first-install';
  }

  // Setting disabled → nothing
  if (!settingEnabled) return 'nothing';

  const cmp = compareVersions(currentVersion, lastSeen);
  if (cmp === null) return 'nothing';   // unparseable versions
  if (cmp <= 0) return 'nothing';       // same or downgrade

  return 'show';
}

// ── Persistence ──────────────────────────────────────────────────────────────

function statePath(userDataPath: string): string {
  return path.join(userDataPath, 'state.json');
}

/** Read lastSeenChangelogVersion from state.json. Returns null on any error. */
export function readLastSeenVersion(userDataPath: string): string | null {
  try {
    const raw = fs.readFileSync(statePath(userDataPath), 'utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const v = obj['lastSeenChangelogVersion'];
    return typeof v === 'string' && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist lastSeenChangelogVersion into state.json atomically.
 * Merges with the existing file contents (preserving the `version` key used
 * by backup.ts).
 */
export function writeLastSeenVersion(userDataPath: string, version: string, log: (msg: string) => void): void {
  const p = statePath(userDataPath);
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
      // Fresh file; start empty
    }
    const updated = { ...existing, lastSeenChangelogVersion: version };
    const tmp = `${p}.tmp`;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
    fs.renameSync(tmp, p);
  } catch (err) {
    log(`Impossible d'enregistrer la version du journal des modifications : ${String(err)}`);
  }
}
