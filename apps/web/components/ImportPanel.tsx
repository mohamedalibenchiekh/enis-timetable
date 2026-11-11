'use client';
import { useRef, useState } from 'react';
import { api, guessKind, KIND_LABEL, Timetable } from '@/lib/api';

export function ImportPanel({ timetable, onDone }: { timetable?: Timetable; onDone: (t: Timetable) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[]) => {
    const html = Array.from(list).filter((f) => /\.html?$/i.test(f.name));
    setFiles((prev) => [...prev.filter((p) => !html.some((h) => h.name === p.name)), ...html]);
    setError('');
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await api.upload(files, { name: name || undefined, timetableId: timetable?.id });
      setFiles([]);
      setName('');
      onDone(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {!timetable && <><h2>Bienvenue — 3 étapes pour commencer</h2><p><a href="/aide/">Ouvrir le guide d’utilisation</a></p></>}
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
        <input className="text" placeholder="Nom (facultatif) — ex. S1 2026-2027" value={name} onChange={(e) => setName(e.target.value)} />
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={!files.length || busy} onClick={submit}>
        {busy ? 'Import en cours…' : 'Importer'}
      </button>
    </div>
  );
}
