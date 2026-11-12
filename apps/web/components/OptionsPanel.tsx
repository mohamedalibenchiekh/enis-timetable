'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ExportOptions, ExportProfilesState } from '@/lib/api';

const PRESETS: { id: string; label: string; template: string }[] = [
  { id: 'teacher', label: 'Enseignant seulement', template: '{teacher}' },
  { id: 'teacherGroup', label: 'Enseignant + groupe', template: '{teacher}\n{group}' },
  { id: 'teacherGroupSubject', label: 'Enseignant + groupe + matière', template: '{teacher}\n{group} — {subjectCode} {subject}' },
  { id: 'groupSubject', label: 'Groupe + matière', template: '{group} — {subjectCode} {subject}' },
];
const TOKENS = ['{teacher}', '{group}', '{subjectCode}', '{subject}', '{frequency}'];

export function OptionsPanel({ profiles, activeProfileId, onProfilesChange, onActiveProfileChange, onSaved }: {
  profiles: ExportProfilesState | null;
  activeProfileId: string | null;
  onProfilesChange: (state: ExportProfilesState) => void;
  onActiveProfileChange: (id: string) => void;
  onSaved: () => void;
}) {
  const [o, setO] = useState<ExportOptions | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const profile = useMemo(() => profiles?.profiles.find((p) => p.id === activeProfileId) ?? null, [profiles, activeProfileId]);

  // Sync the editable copy whenever the active profile changes.
  useEffect(() => {
    setO(profile ? structuredClone(profile.options) : null);
    setMsg(''); setError('');
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profiles || !profile || !o) return error ? <p className="error">{error}</p> : null;

  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => { setO({ ...o, [k]: v }); setMsg(''); };
  const setBloc = (i: number, patch: Partial<ExportOptions['blocs'][number]>) =>
    set('blocs', o.blocs.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const activePreset = PRESETS.find((p) => p.template === o.cellTemplate)?.id ?? 'custom';

  const run = async (fn: () => Promise<ExportProfilesState>, done?: string) => {
    setError('');
    try {
      const state = await fn();
      onProfilesChange(state);
      if (done) setMsg(done);
      return state;
    } catch (e) { setError((e as Error).message); return null; }
  };

  const save = async () => {
    const state = await run(() => api.updateProfile(profile.id, { options: o }), 'Options enregistrées');
    if (state) {
      // Resync the editor with the normalized options returned by the server.
      const updated = state.profiles.find((p) => p.id === profile.id);
      if (updated) setO(structuredClone(updated.options));
      onSaved();
    }
  };
  const createProfile = async () => {
    const name = newName.trim();
    if (!name) return;
    const state = await run(() => api.createProfile(name, o), 'Profil créé');
    if (state) {
      const created = state.profiles[state.profiles.length - 1];
      if (created) onActiveProfileChange(created.id);
      setNewName('');
    }
  };
  const renameProfile = () => {
    const name = prompt('Nom du profil', profile.name);
    if (name && name.trim() && name.trim() !== profile.name) void run(() => api.updateProfile(profile.id, { name: name.trim() }));
  };
  const setDefault = () => void run(() => api.updateProfile(profile.id, { isDefault: true }), 'Profil par défaut mis à jour');
  const removeProfile = () => {
    if (profiles.profiles.length <= 1) { setError('Impossible de supprimer le dernier profil'); return; }
    if (!confirm(`Supprimer le profil « ${profile.name} » ?`)) return;
    void run(() => api.deleteProfile(profile.id)).then((state) => {
      if (state && !state.profiles.some((p) => p.id === activeProfileId)) onActiveProfileChange(state.defaultId);
    });
  };

  const maxPage = Math.max(1, ...o.blocs.map((b) => b.page ?? 1));
  // Always offer one page beyond the current maximum (capped at 50) so a bloc
  // can be moved onto a new page.
  const pageLimit = Math.min(50, maxPage + 1);

  return (
    <div className="options">
      <p><a href="/aide/#options-du-document-word" aria-label="Aide sur les options">? Aide sur les options</a></p>

      {/* ----- Profiles ----- */}
      <h3>Profils d’export</h3>
      <div className="profilebar">
        <select value={profile.id} onChange={(e) => onActiveProfileChange(e.target.value)} aria-label="Profil actif">
          {profiles.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === profiles.defaultId ? ' (défaut)' : ''}</option>)}
        </select>
        <button className="link" onClick={renameProfile}>renommer</button>
        {profile.id !== profiles.defaultId && <button className="link" onClick={setDefault}>définir par défaut</button>}
        <button className="link danger" onClick={removeProfile}>supprimer</button>
      </div>
      <div className="profilebar">
        <input className="text" placeholder="Nom du nouveau profil" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="link" onClick={createProfile}>+ nouveau profil</button>
      </div>

      {/* ----- Cell content ----- */}
      <h3>Contenu des cellules</h3>
      <div className="presets" role="group" aria-label="Préréglages de contenu">
        {PRESETS.map((p) => (
          <button key={p.id} className={activePreset === p.id ? 'chip on' : 'chip'} onClick={() => set('cellTemplate', p.template)}>{p.label}</button>
        ))}
        <button className={activePreset === 'custom' ? 'chip on' : 'chip'} onClick={() => { /* keep current template */ }}>Personnalisé</button>
      </div>
      <label>Modèle de cellule
        <textarea className="text template" rows={3} value={o.cellTemplate} onChange={(e) => set('cellTemplate', e.target.value)} spellCheck={false} />
      </label>
      <p className="muted small">Jetons disponibles : {TOKENS.join(' ')}. Un saut de ligne dans le modèle crée une ligne dans la cellule.</p>
      <div className="grid2">
        <label>Affichage de la matière
          <select value={o.subjectMode} onChange={(e) => set('subjectMode', e.target.value as ExportOptions['subjectMode'])}>
            <option value="full">Nom complet</option>
            <option value="code">Code seulement</option>
            <option value="both">Code + nom</option>
          </select>
        </label>
        <label>Longueur max du nom (0 = illimité)
          <input className="text" type="number" min={0} max={200} value={o.subjectMaxLength} onChange={(e) => set('subjectMaxLength', Number(e.target.value))} />
        </label>
        <label>Séparateur de groupes
          <input className="text" value={o.groupSeparator} onChange={(e) => set('groupSeparator', e.target.value)} />
        </label>
        <label>Taille de police des cellules (pt)
          <input className="text" type="number" min={7} max={12} value={o.cellFontSize} onChange={(e) => set('cellFontSize', Number(e.target.value))} />
        </label>
      </div>
      <label><input type="checkbox" checked={o.detailItalic} onChange={(e) => set('detailItalic', e.target.checked)} /> Italique pour les lignes secondaires (groupe + matière)</label>
      <label><input type="checkbox" checked={o.detailSmaller} onChange={(e) => set('detailSmaller', e.target.checked)} /> Taille réduite pour les lignes secondaires</label>

      {/* ----- Page layout ----- */}
      <h3>Mise en page</h3>
      <div className="grid2">
        <label>Orientation
          <select value={o.orientation} onChange={(e) => set('orientation', e.target.value as ExportOptions['orientation'])}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Paysage</option>
          </select>
        </label>
      </div>
      <label><input type="checkbox" checked={o.repeatDayHeader} onChange={(e) => set('repeatDayHeader', e.target.checked)} /> Répéter l’en-tête du jour sur chaque page</label>
      <label><input type="checkbox" checked={o.showPageTitle} onChange={(e) => set('showPageTitle', e.target.checked)} /> Afficher un titre de page (noms des blocs)</label>

      <h4>Blocs et pages</h4>
      <p className="muted small">Assignez chaque bloc à une page pour répartir le document sur plusieurs pages.</p>
      <table className="bloctable">
        <thead><tr><th>Bloc</th><th>Motifs (regex)</th><th>Page</th><th /></tr></thead>
        <tbody>
          {o.blocs.map((b, i) => (
            <tr key={b.id ?? i}>
              <td><input className="text" value={b.title} onChange={(e) => setBloc(i, { title: e.target.value })} /></td>
              <td><input className="text" value={b.patterns.join(', ')} onChange={(e) => setBloc(i, { patterns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></td>
              <td>
                <select value={b.page ?? 1} onChange={(e) => setBloc(i, { page: Number(e.target.value) })}>
                  {Array.from({ length: pageLimit }, (_, n) => n + 1).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
              <td><button className="link danger" onClick={() => set('blocs', o.blocs.filter((_, j) => j !== i))}>supprimer</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="link" onClick={() => set('blocs', [...o.blocs, { title: `BLOC « ${String.fromCharCode(65 + o.blocs.length)} »`, patterns: [`^${String.fromCharCode(65 + o.blocs.length)}\\d\\d`], page: 1 }])}>+ ajouter un bloc</button>

      {/* ----- General ----- */}
      <h3>Général</h3>
      <label><input type="checkbox" checked={o.abbreviateBen} onChange={(e) => set('abbreviateBen', e.target.checked)} /> Abréger « BEN » en « B » (ex. B Rhouma Asma)</label>
      <label><input type="checkbox" checked={o.showFrequency} onChange={(e) => set('showFrequency', e.target.checked)} /> Afficher « 1/15 » pour les séances une semaine sur deux</label>
      <label><input type="checkbox" checked={o.includeEmptyRooms} onChange={(e) => set('includeEmptyRooms', e.target.checked)} /> Lister aussi les salles libres</label>
      <label>Libellé de la pause <input className="text inline" value={o.pauseLabel} onChange={(e) => set('pauseLabel', e.target.value)} /></label>

      {error && <p className="error">{error}</p>}
      <div><button className="primary" onClick={save}>Enregistrer</button> {msg && <span className="ok">{msg}</span>}</div>
    </div>
  );
}
