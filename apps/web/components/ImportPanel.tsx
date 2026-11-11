'use client';
import { useEffect, useRef, useState } from 'react';
import { api, guessKind, KIND_LABEL, Timetable, UploadResult } from '@/lib/api';

export function ImportPanel({ timetable, onDone }: { timetable?: Timetable; onDone: (t: UploadResult) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [versions, setVersions] = useState<Timetable[] | null>(null);
  const [versionsError, setVersionsError] = useState('');
  const [previousId, setPreviousId] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const loadVersions = () => {
    setVersions(null);
    setVersionsError('');
    api.list().then(setVersions).catch((e) => {
      setVersions([]);
      setVersionsError((e as Error).message);
    });
  };

  useEffect(() => {
    if (!timetable) loadVersions();
  }, [timetable]);

  const add = (list: FileList | File[]) => {
    const html = Array.from(list).filter((f) => /\.html?$/i.test(f.name));
    setFiles((prev) => [...prev.filter((p) => !html.some((h) => h.name === p.name)), ...html]);
    setError('');
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await api.upload(files, {
        name: name || undefined,
        timetableId: timetable?.id,
        previousTimetableId: !timetable && previousId ? previousId : undefined,
      });
      setFiles([]);
      setName('');
      setPreviousId('');
      onDone(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {!timetable && <>
        <h2>Bienvenue — 3 étapes pour commencer</h2>
        <ol>
          <li>Importez les fichiers HTML exportés depuis FET.</li>
          <li>Vérifiez l’aperçu de l’emploi du temps.</li>
          <li>Téléchargez les documents Word.</li>
        </ol>
        <p><a href="/aide/">Ouvrir le guide d’utilisation</a></p>
      </>}
      <h2>{timetable ? 'Ajouter ou remplacer des fichiers' : 'Importer un emploi du temps'}</h2>
      <p className="muted">
        Fichiers HTML exportés par FET (<code>…_rooms_days_horizontal.html</code>, <code>…_teachers_…</code>, <code>…_groups_…</code>).
        Le fichier « salles » suffit pour produire les documents Word ; les deux autres servent de complément.
      </p>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        Glissez les fichiers HTML ici ou cliquez pour les choisir
        <input ref={input} type="file" accept=".html,.htm" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
      </div>
      {files.length > 0 && (
        <ul className="files">
          {files.map((f) => {
            const k = guessKind(f.name);
            return (
              <li key={f.name}>
                <span className={`tag ${k ?? 'unknown'}`}>{k ? KIND_LABEL[k] : 'Type ?'}</span>
                <span className="fname">{f.name}</span>
                <button className="link" onClick={() => setFiles(files.filter((x) => x !== f))}>retirer</button>
              </li>
            );
          })}
        </ul>
      )}
      {!timetable && (
        <>
          <input className="text" placeholder="Nom (facultatif) — ex. S1 2026-2027" value={name} onChange={(e) => setName(e.target.value)} />
          {versions === null && <p className="muted small">Chargement des versions…</p>}
          {versionsError && (
            <p className="error small">
              Impossible de charger les versions : {versionsError}{' '}
              <button className="link" onClick={loadVersions}>Réessayer</button>
            </p>
          )}
          {versions !== null && versions.length > 0 && (
            <label className="field">
              <span>Nouvelle version de…</span>
              <select className="text" value={previousId} onChange={(e) => setPreviousId(e.target.value)}>
                <option value="">— Aucun (première version) —</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.generatedAt ? ` (${v.generatedAt})` : ''}
                  </option>
                ))}
              </select>
              <small className="muted">Si cet import remplace une version existante, choisissez-la ici : l’onglet « Changements » comparera les deux versions.</small>
            </label>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={!files.length || busy || (!timetable && versions === null)} onClick={submit}>
        {busy ? 'Import en cours…' : 'Importer'}
      </button>
    </div>
  );
}
