'use client';
import { useEffect, useState } from 'react';
import { api, ExportOptions } from '@/lib/api';

export function OptionsPanel({ onSaved }: { onSaved: () => void }) {
  const [o, setO] = useState<ExportOptions | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.getOptions().then(setO).catch((e) => setError((e as Error).message)); }, []);
  if (!o) return error ? <p className="error">{error}</p> : null;

  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => { setO({ ...o, [k]: v }); setMsg(''); };
  const save = async () => {
    setError('');
    try { setO(await api.saveOptions(o)); setMsg('Options enregistrées'); onSaved(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="options">
      <p><a href="/aide/#options-du-document-word" aria-label="Aide sur les options">? Aide sur les options</a></p>
      <label><input type="checkbox" checked={o.abbreviateBen} onChange={(e) => set('abbreviateBen', e.target.checked)} /> Abréger « BEN » en « B » (ex. B Rhouma Asma)</label>
      <label><input type="checkbox" checked={o.showFrequency} onChange={(e) => set('showFrequency', e.target.checked)} /> Afficher « 1/15 » pour les séances une semaine sur deux</label>
      <label><input type="checkbox" checked={o.includeEmptyRooms} onChange={(e) => set('includeEmptyRooms', e.target.checked)} /> Lister aussi les salles libres</label>
      <label>Libellé de la pause <input className="text inline" value={o.pauseLabel} onChange={(e) => set('pauseLabel', e.target.value)} /></label>

      <h3>Blocs (bandes jaunes)</h3>
      <p className="muted small">Chaque bloc regroupe les salles dont le nom correspond à l'une des expressions régulières (séparées par des virgules).</p>
      {o.blocs.map((b, i) => (
        <div className="blocrow" key={i}>
          <input className="text" value={b.title} onChange={(e) => set('blocs', o.blocs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <input className="text" value={b.patterns.join(', ')} onChange={(e) => set('blocs', o.blocs.map((x, j) => (j === i ? { ...x, patterns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)))} />
          <button className="link" onClick={() => set('blocs', o.blocs.filter((_, j) => j !== i))}>supprimer</button>
        </div>
      ))}
      <button className="link" onClick={() => set('blocs', [...o.blocs, { title: 'BLOC « E »', patterns: ['^E\\d\\d'] }])}>+ ajouter un bloc</button>
      {error && <p className="error">{error}</p>}
      <div><button className="primary" onClick={save}>Enregistrer</button> {msg && <span className="ok">{msg}</span>}</div>
    </div>
  );
}
