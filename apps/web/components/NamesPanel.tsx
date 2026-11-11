'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, NameCategory, NameEntry, NameList, NamesImportSummary } from '@/lib/api';

type Drafts = Record<string, string>;

const draftKey = (kind: NameCategory, key: string) => `${kind}:${key}`;
const normalizeForCompare = (value: string) =>
  value.trim().replace(/\s+/gu, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function readFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lecture du fichier impossible'));
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.readAsText(file);
  });
}

export function NamesPanel({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [teachers, setTeachers] = useState<NameList | null>(null);
  const [rooms, setRooms] = useState<NameList | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [teacherNames, roomNames] = await Promise.all([
      api.getNames('teachers', id),
      api.getNames('rooms', id),
    ]);
    setTeachers(teacherNames);
    setRooms(roomNames);
  }, [id]);

  useEffect(() => {
    let active = true;
    Promise.all([api.getNames('teachers', id), api.getNames('rooms', id)])
      .then(([teacherNames, roomNames]) => {
        if (active) {
          setTeachers(teacherNames);
          setRooms(roomNames);
        }
      })
      .catch((e: unknown) => active && setError((e as Error).message));
    return () => { active = false; };
  }, [id]);

  const onDraft = useCallback((kind: NameCategory, entry: NameEntry, value: string) => {
    const key = draftKey(kind, entry.key);
    const savedValue = entry.displayName ?? '';
    setDrafts((current) => {
      if (value === savedValue && !(key in current)) return current;
      const next = { ...current };
      if (value === savedValue) delete next[key];
      else next[key] = value;
      return next;
    });
    setStatus('');
  }, []);

  const draftKeys = Object.keys(drafts).sort().join('\u0000');
  const modifiedKeys = useMemo(
    () => new Set(draftKeys ? draftKeys.split('\u0000') : []),
    [draftKeys],
  );
  const duplicateTeacherName = useMemo(() => {
    if (!teachers) return false;
    const seen = new Set<string>();
    for (const entry of teachers.items) {
      const key = draftKey('teachers', entry.key);
      const effective = key in drafts
        ? (drafts[key].trim() || entry.autoName)
        : (entry.displayName ?? entry.autoName);
      const normalized = normalizeForCompare(effective);
      if (normalized && seen.has(normalized)) return true;
      if (normalized) seen.add(normalized);
    }
    return false;
  }, [drafts, teachers]);

  const save = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const teacherItems = teachers?.items
        .filter((entry) => draftKey('teachers', entry.key) in drafts)
        .map((entry) => ({ sourceName: entry.sourceName, displayName: drafts[draftKey('teachers', entry.key)] })) ?? [];
      const roomItems = rooms?.items
        .filter((entry) => draftKey('rooms', entry.key) in drafts)
        .map((entry) => ({ sourceName: entry.sourceName, displayName: drafts[draftKey('rooms', entry.key)] })) ?? [];
      if (teacherItems.length) await api.saveNames('teachers', teacherItems);
      if (roomItems.length) await api.saveNames('rooms', roomItems);
      await reload();
      setDrafts({});
      setStatus('Noms enregistrés');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDrafts({});
    setStatus('');
    setError('');
  };

  const deleteUnused = useCallback(async (kind: NameCategory, entry: NameEntry) => {
    setError('');
    try {
      await api.deleteName(kind, entry.key);
      await reload();
      setStatus('Nom inutilisé supprimé');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [reload]);

  const exportNames = async () => {
    setError('');
    try {
      const data = await api.exportNames();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'noms-enis.json';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Fichier de noms exporté');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importNames = async (file?: File) => {
    if (!file) return;
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const summary: NamesImportSummary = await api.importNames(JSON.parse(await readFile(file)) as unknown);
      await reload();
      setDrafts({});
      setStatus(
        `Import terminé : ${summary.added} ${summary.added === 1 ? 'ajout' : 'ajouts'}, ` +
        `${summary.updated} ${summary.updated === 1 ? 'actualisation' : 'actualisations'}, ` +
        `${summary.ignored} ${summary.ignored === 1 ? 'ignoré' : 'ignorés'}`,
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const dirtyCount = Object.keys(drafts).length;
  if (!teachers || !rooms) {
    return error ? <p className="error">{error}</p> : <p className="muted">Chargement des noms…</p>;
  }

  return (
    <section className="names-panel" aria-label="Gestion des noms">
      <div className="names-toolbar">
        <p className="muted">Les corrections s’appliquent à tous les emplois du temps de cette base.</p>
        <div className="actions">
          <a className="btn" href="/aide/#noms-et-libelles" aria-label="Aide sur les noms">? Aide sur les noms</a>
          <button onClick={() => void exportNames()}>Exporter les noms (.json)</button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Enregistrez ou annulez les modifications avant d’importer' : undefined}
          >Importer des noms…</button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-label="Choisir un fichier de noms"
            onChange={(event) => void importNames(event.target.files?.[0])}
          />
        </div>
      </div>

      {duplicateTeacherName && <p className="warning" role="status">Attention : deux enseignants auront le même nom affiché dans Word.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="ok" role="status">{status}</p>}

      <NamesSection
        kind="teachers"
        title="Enseignants"
        list={teachers}
        drafts={drafts}
        modifiedKeys={modifiedKeys}
        onDraft={onDraft}
        onDeleteUnused={deleteUnused}
      />
      <NamesSection
        kind="rooms"
        title="Salles"
        list={rooms}
        drafts={drafts}
        modifiedKeys={modifiedKeys}
        onDraft={onDraft}
        onDeleteUnused={deleteUnused}
      />

      {dirtyCount > 0 && (
        <div className="names-savebar" role="region" aria-label="Modifications non enregistrées">
          <span>{dirtyCount} {dirtyCount === 1 ? 'modification' : 'modifications'}</span>
          <button className="primary" onClick={() => void save()} disabled={busy}>Enregistrer</button>
          <button onClick={cancel} disabled={busy}>Annuler</button>
        </div>
      )}
    </section>
  );
}

const NamesSection = memo(function NamesSection({
  kind, title, list, drafts, modifiedKeys, onDraft, onDeleteUnused,
}: {
  kind: NameCategory;
  title: string;
  list: NameList;
  drafts: Drafts;
  modifiedKeys: Set<string>;
  onDraft: (kind: NameCategory, entry: NameEntry, value: string) => void;
  onDeleteUnused: (kind: NameCategory, entry: NameEntry) => void;
}) {
  const [search, setSearch] = useState('');
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  const visible = list.items.filter((entry) => {
    const draftValue = drafts[draftKey(kind, entry.key)];
    const matchesSearch = `${entry.sourceName} ${entry.autoName} ${draftValue ?? entry.displayName ?? ''}`
      .toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'));
    return matchesSearch && (!modifiedOnly || entry.displayName !== null || modifiedKeys.has(draftKey(kind, entry.key)));
  });
  const focusNext = useCallback((index: number) => {
    rowsRef.current?.querySelector<HTMLInputElement>(`[data-name-row="${index + 1}"]`)?.focus();
  }, []);

  return (
    <section className="names-section" aria-labelledby={`${kind}-heading`}>
      <h3 id={`${kind}-heading`}>{title}</h3>
      <div className="names-filters">
        <label className="names-search">
          Rechercher
          <input
            className="text"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Rechercher ${title.toLocaleLowerCase('fr')}…`}
          />
        </label>
        <label className="names-modified">
          <input type="checkbox" checked={modifiedOnly} onChange={(event) => setModifiedOnly(event.target.checked)} />
          Modifiés seulement
        </label>
      </div>
      <div className="names-table-wrap" ref={rowsRef}>
        <table className="names-table">
          <thead>
            <tr>
              <th scope="col">Nom dans le fichier</th>
              <th scope="col">Affiché dans Word</th>
              <th scope="col">Séances</th>
              {kind === 'rooms' && <th scope="col">Bloc</th>}
              <th scope="col"><span className="visually-hidden">Réinitialiser</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry, index) => (
              <NameEntryRow
                key={entry.key}
                kind={kind}
                entry={entry}
                rowIndex={index}
                value={drafts[draftKey(kind, entry.key)] ?? entry.displayName ?? ''}
                onDraft={onDraft}
                onEnter={focusNext}
              />
            ))}
            {!visible.length && <tr><td colSpan={kind === 'rooms' ? 5 : 4} className="muted">Aucun nom correspondant.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.unused.length > 0 && (
        <details className="unused-names">
          <summary>Non utilisés ({list.unused.length})</summary>
          <ul>
            {list.unused.map((entry) => (
              <li key={entry.key}>
                <span>{entry.sourceName} <span className="muted">→ {entry.displayName}</span></span>
                <button className="link danger" onClick={() => onDeleteUnused(kind, entry)}>Supprimer</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
});

const NameEntryRow = memo(function NameEntryRow({
  kind, entry, rowIndex, value, onDraft, onEnter,
}: {
  kind: NameCategory;
  entry: NameEntry;
  rowIndex: number;
  value: string;
  onDraft: (kind: NameCategory, entry: NameEntry, value: string) => void;
  onEnter: (index: number) => void;
}) {
  const savedValue = entry.displayName ?? '';
  const change = (next: string) => {
    onDraft(kind, entry, next);
  };

  return (
    <tr>
      <th scope="row" title={entry.sourceName}><span className="source-name">{entry.sourceName}</span></th>
      <td>
        <input
          className="text names-input"
          value={value}
          placeholder={entry.autoName}
          aria-label={`Affiché dans Word pour ${entry.sourceName}`}
          data-name-row={rowIndex}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onEnter(rowIndex);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onDraft(kind, entry, savedValue);
            }
          }}
        />
      </td>
      <td className="number-cell">{entry.sessions}</td>
      {kind === 'rooms' && <td>{entry.bloc ?? '—'}</td>}
      <td>
        <button
          className="reset-name"
          aria-label={`Réinitialiser ${entry.sourceName}`}
          title="Effacer la correction"
          onClick={() => change('')}
        >↺</button>
      </td>
    </tr>
  );
});
