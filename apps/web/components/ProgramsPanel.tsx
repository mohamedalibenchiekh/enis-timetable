'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ProgramAnalysis, ProgramSession, SavedProgram, Timetable } from '@/lib/api';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const CONFLICTS_STALE_WARNING = 'Les conflits doivent être vérifiés à nouveau après modification des enseignants ou salles.';
const listDraftKey = (program: number, session: number, field: 'teachers' | 'tags') => `${program}:${session}:${field}`;
const parseList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
function invalidateConflicts(program: ProgramAnalysis): ProgramAnalysis {
  if (!Object.hasOwn(program.rawSnapshot, 'conflicts')) return program;
  const rawSnapshot = { ...program.rawSnapshot };
  delete rawSnapshot.conflicts;
  return {
    ...program,
    warnings: [...new Set([...program.warnings.filter((warning) => !/^Conflit de (?:salle|enseignant) :/u.test(warning)), CONFLICTS_STALE_WARNING])],
    rawSnapshot,
  };
}
function updateSession(program: ProgramAnalysis, index: number, patch: Partial<ProgramSession>): ProgramAnalysis {
  const updated = { ...program, sessions: program.sessions.map((session, current) => current === index ? { ...session, ...patch } : session) };
  if (!('room' in patch || 'roomUnassigned' in patch || 'teachers' in patch || 'teacherKeys' in patch) || !Object.hasOwn(program.rawSnapshot, 'conflicts')) return updated;
  return invalidateConflicts(updated);
}

export function ProgramsPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [analyses, setAnalyses] = useState<ProgramAnalysis[]>([]);
  const [selected, setSelected] = useState(0);
  const [programs, setPrograms] = useState<SavedProgram[] | null>(null);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [referenceId, setReferenceId] = useState('');
  const [mode, setMode] = useState<'replace' | 'new-version'>('new-version');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'analyse' | 'review' | 'saved'>('analyse');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [listDrafts, setListDrafts] = useState<Record<string, string>>({});
  const current = analyses[selected];
  const existing = useMemo(() => programs?.some((item) => item.code === current?.code && item.isCurrent) ?? false, [programs, current]);
  const teacherNames = useMemo(() => [...new Set(current?.sessions.flatMap((session) => session.teachers) ?? [])], [current]);
  const roomNames = useMemo(() => [...new Set(current?.sessions.map((session) => session.room).filter((room): room is string => Boolean(room)) ?? [])], [current]);

  useEffect(() => {
    api.list().then(setTimetables).catch((e: unknown) => { setTimetables([]); setError((e as Error).message); });
    api.listPrograms().then(setPrograms).catch((e: unknown) => setError((e as Error).message));
  }, []);

  const analyze = async () => {
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const selectedReference = timetables.find((item) => item.id === referenceId);
      const reference = selectedReference?.slots.length === 6 ? selectedReference.slots.map((slot) => slot.base) : undefined;
      const referenceOverrides = selectedReference?.slots.length === 6 ? Object.fromEntries(selectedReference.slots.map((slot, index) => [index, slot.overrides])) : undefined;
      const [result, saved] = await Promise.all([api.analyzePrograms(files, reference, referenceId || undefined, referenceOverrides), api.listPrograms()]);
      setAnalyses(result); setListDrafts({}); setPrograms(saved); setSelected(0); setMode('new-version'); setStep('review');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!current) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const programToSave: ProgramAnalysis = {
        ...current,
        sessions: current.sessions.map((session, index) => {
          const teachers = listDrafts[listDraftKey(selected, index, 'teachers')];
          const tags = listDrafts[listDraftKey(selected, index, 'tags')];
          return {
            ...session,
            ...(teachers === undefined ? {} : { teachers: parseList(teachers), teacherKeys: parseList(teachers).map((name) => name.toLocaleLowerCase('fr')) }),
            ...(tags === undefined ? {} : { tags: parseList(tags) }),
          };
        }),
      };
      const hasTeacherDraft = current.sessions.some((_, index) => listDrafts[listDraftKey(selected, index, 'teachers')] !== undefined);
      const saved = await api.saveProgram(hasTeacherDraft ? invalidateConflicts(programToSave) : programToSave, mode);
      setPrograms((old) => [...(old ?? []).filter((item) => item.code !== saved.code), saved]);
      setMessage(`Programme ${saved.code} enregistré (révision ${saved.revision}).`); setStep('saved');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const confirmAlias = async (kind: 'teacher' | 'room', aliasName: string, canonicalName: string) => {
    try { await api.saveProgramAlias({ kind, aliasName, canonicalName }); setMessage('Alias enregistré pour les prochains imports.'); }
    catch (e) { setError((e as Error).message); }
  };

  const commitListDraft = (field: 'teachers' | 'tags', sessionIndex: number) => {
    const key = listDraftKey(selected, sessionIndex, field);
    const draft = listDrafts[key];
    if (draft === undefined) return;
    const values = parseList(draft);
    setAnalyses((old) => old.map((item, index) => {
      if (index !== selected) return item;
      return updateSession(item, sessionIndex, field === 'teachers'
        ? { teachers: values, teacherKeys: values.map((name) => name.toLocaleLowerCase('fr')) }
        : { tags: values });
    }));
    setListDrafts((old) => { const next = { ...old }; delete next[key]; return next; });
  };

  const editSaved = async (id: string) => {
    try {
      const program = await api.getProgram(id);
      setAnalyses([{ ...program, warnings: program.warnings ?? [], confidence: program.confidence ?? 1, rawSnapshot: program.rawSnapshot ?? {} }]);
      setListDrafts({});
      setSelected(0); setMode('new-version'); setMessage(''); setError(''); setStep('review');
    } catch (e) { setError((e as Error).message); }
  };

  const deleteSaved = async (program: SavedProgram) => {
    if (!window.confirm(`Supprimer la révision ${program.revision} du programme ${program.code} ?`)) return;
    try { await api.deleteProgram(program.id); setPrograms(await api.listPrograms()); }
    catch (e) { setError((e as Error).message); }
  };

  return <section className="card" aria-labelledby="masters-title">
    <h2 id="masters-title">Importer un emploi du temps de mastère</h2>
    {programs && programs.length > 0 && <section className="names-section" aria-label="Programmes enregistrés"><h3>Programmes enregistrés</h3><ul className="files">{programs.map((program) => <li key={program.id}><span><strong>{program.code}</strong> · {program.title} · révision {program.revision}</span><button className="link" onClick={() => void editSaved(program.id)}>Corriger</button><button className="link danger" onClick={() => void deleteSaved(program)}>Supprimer</button></li>)}</ul></section>}
    <div className="tabs" role="group" aria-label="Étapes d’importation">
      <button className={step === 'analyse' ? 'on' : ''} onClick={() => setStep('analyse')}>1. Analyse</button>
      <button className={step === 'review' ? 'on' : ''} disabled={!analyses.length} onClick={() => setStep('review')}>2. Vérification</button>
      <button className={step === 'saved' ? 'on' : ''} disabled={step !== 'saved'}>3. Enregistrer</button>
    </div>
    {step === 'analyse' && <>
      <p className="muted">Sélectionnez des fichiers DOCX ou PDF. Les PDF numérisés et les fichiers de plus de 20 Mo sont refusés.</p>
      <div className="drop" role="button" tabIndex={0} onClick={(event) => { if (event.target === event.currentTarget) input.current?.click(); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = Array.from(event.dataTransfer.files).filter((file) => /\.(?:docx|pdf)$/iu.test(file.name)); if (dropped.length) setFiles((old) => [...old, ...dropped.filter((file) => !old.some((item) => item.name === file.name && item.size === file.size))]); }}>
        Glissez les emplois du temps ici ou cliquez pour les choisir
        <input ref={input} type="file" accept=".docx,.pdf" multiple hidden onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      </div>
      <label className="field"><span>Référence des créneaux</span><select className="text" value={referenceId} onChange={(event) => setReferenceId(event.target.value)}><option value="">Valeurs intégrées (Vendredi 14:00-15:30)</option>{timetables.filter((item) => item.slots.length === 6).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {files.length > 0 && <ul className="files">{files.map((file) => <li key={file.name}><span>{file.name}</span><button className="link" onClick={() => setFiles((old) => old.filter((item) => item !== file))}>retirer</button></li>)}</ul>}
      <button className="primary" disabled={!files.length || busy} onClick={analyze}>{busy ? 'Analyse en cours…' : 'Analyser les fichiers'}</button>
    </>}
    {step === 'review' && current && <>
      {analyses.length > 1 && <label className="field"><span>Programme analysé</span><select className="text" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{analyses.map((item, index) => <option key={`${item.code}-${index}`} value={index}>{item.code} — {item.title}</option>)}</select></label>}
      <div className="info-box"><strong>Confiance moyenne : {Math.round(current.confidence * 100)}%</strong> · {current.sessions.length} séances · {current.source.toUpperCase()}<br />Année retenue : 2026-2027</div>
      {current.warnings.length > 0 && <ul className="text-amber-700">{current.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <div className="grid2">
        {([['code', 'Code'], ['title', 'Intitulé'], ['kind', 'Type'], ['semester', 'Semestre'], ['coordinator', 'Coordinateur du mastère'], ['formRef', 'Référence du formulaire'], ['effectiveFrom', 'À partir de'], ['footerText', 'Pied de page']] as const).map(([key, label]) => <label key={key}>{label}<input className="text" value={current[key]} onChange={(event) => setAnalyses((old) => old.map((item, index) => index === selected ? { ...item, [key]: event.target.value } : item))} /></label>)}
      </div>
      <datalist id={`teachers-${selected}`}>{teacherNames.map((name) => <option key={name} value={name} />)}</datalist>
      <datalist id={`rooms-${selected}`}>{roomNames.map((name) => <option key={name} value={name} />)}</datalist>
      <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
        <table className="grid"><thead><tr><th>Créneau</th>{DAYS.map((day) => <th key={day} className="dayhead">{day}</th>)}</tr></thead><tbody>
          {current.slots.map((slot) => <tr key={slot.index}><th className="slothead">{slot.label}</th>{DAYS.map((day, dayIndex) => {
            const indexed = current.sessions.map((session, index) => ({ session, index })).filter(({ session }) => session.day === dayIndex && session.slot === slot.index);
            return <td key={day} className={indexed.some(({ session }) => session.confidence < 0.75) ? 'hl' : ''}>{indexed.map(({ session, index }) => <div key={index} style={{ padding: '0.35rem', background: session.color ? `#${session.color.replace(/^#/u, '')}` : undefined, borderBottom: '1px solid #ddd' }}>
              <div className="small muted">Texte source · {session.slotSpan} créneau(x) · {session.daySpan} jour(s)</div><div style={{ whiteSpace: 'pre-wrap' }}>{session.rawText}</div>
              <label className="field">Matière<input className="text" value={session.title} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { title: event.target.value }) : item))} /></label>
              <label className="field">Code<input className="text" value={session.code} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { code: event.target.value }) : item))} /></label>
              <label className="field">Enseignants<input className="text" list={`teachers-${selected}`} value={listDrafts[listDraftKey(selected, index, 'teachers')] ?? session.teachers.join(', ')} onChange={(event) => setListDrafts((old) => ({ ...old, [listDraftKey(selected, index, 'teachers')]: event.target.value }))} onBlur={() => commitListDraft('teachers', index)} /></label>
              <label className="field">Salle<input className="text" list={`rooms-${selected}`} value={session.room ?? ''} disabled={session.roomUnassigned} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { room: event.target.value || null, roomUnassigned: false }) : item))} /></label>
              <button className="link" onClick={() => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { room: null, roomUnassigned: true, locationNote: 'salle à rechercher' }) : item))}>Marquer salle à rechercher</button>
              {session.roomUnassigned && <><span className="tag">Salle à rechercher</span><button className="link" onClick={() => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { roomUnassigned: false, locationNote: '' }) : item))}>Réaffecter une salle</button></>}
              <label className="field">Fréquence<input className="text" value={session.frequency} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { frequency: event.target.value }) : item))} /></label>
              <label className="field">Étiquettes<input className="text" value={listDrafts[listDraftKey(selected, index, 'tags')] ?? session.tags.join(', ')} onChange={(event) => setListDrafts((old) => ({ ...old, [listDraftKey(selected, index, 'tags')]: event.target.value }))} onBlur={() => commitListDraft('tags', index)} /></label>
              <label className="field">Horaire personnalisé<input className="text" value={session.customTime ?? ''} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { customTime: event.target.value || null }) : item))} /></label>
              <label className="field">Note de lieu<input className="text" value={session.locationNote} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { locationNote: event.target.value }) : item))} /></label>
              <label className="field">Note<textarea className="text" value={session.note} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { note: event.target.value }) : item))} /></label>
              <label className="field">Couleur de cellule<input className="text" placeholder="RVB hexadécimal" value={session.color ?? ''} onChange={(event) => setAnalyses((old) => old.map((item, currentIndex) => currentIndex === selected ? updateSession(item, index, { color: event.target.value || null }) : item))} /></label>
              {session.teachers.map((name) => <button key={name} className="link" onClick={() => { const canonical = prompt('Nom canonique de l’enseignant :', name); if (canonical) void confirmAlias('teacher', name, canonical); }}>Confirmer ce nom</button>)}
              {session.room && <button className="link" onClick={() => { const canonical = prompt('Nom canonique de la salle :', session.room ?? ''); if (canonical) void confirmAlias('room', session.room ?? '', canonical); }}>Confirmer cette salle</button>}
              {session.reasons.length > 0 && <strong className="error">À vérifier : {session.reasons.join(', ')}</strong>}
            </div>)}</td>;
          })}</tr>)}
        </tbody></table>
      </div>
      {existing && <label className="field"><span>Ce code de programme existe déjà</span><select className="text" value={mode} onChange={(event) => setMode(event.target.value as 'replace' | 'new-version')}><option value="replace">Remplacer (l’ancienne version est conservée dans l’historique)</option><option value="new-version">Enregistrer comme nouvelle version</option></select></label>}
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="ok">{message}</p>}
      <div style={{ display: 'flex', gap: '.75rem', marginTop: '1rem' }}><button className="secondary" onClick={() => setStep('analyse')}>Modifier les fichiers</button><button className="primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer le programme'}</button></div>
    </>}
    {step === 'saved' && <><p className="ok">{message}</p><button className="secondary" onClick={() => { setFiles([]); setAnalyses([]); setStep('analyse'); }}>Importer d’autres programmes</button></>}
    {error && step !== 'review' && <p className="error" role="alert">{error}</p>}
  </section>;
}
