'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, KIND_LABEL, SourceKind, Timetable } from '@/lib/api';
import { ImportPanel } from '@/components/ImportPanel';
import { DayPreview } from '@/components/DayPreview';
import { OptionsPanel } from '@/components/OptionsPanel';
import { UpdateBanner } from '@/components/UpdateBanner';
import type { UpdateStatus } from '@/lib/api';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function Home() {
  const [items, setItems] = useState<Timetable[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [importMode, setImportMode] = useState<null | 'new' | 'add'>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);
  const [desktopVersionError, setDesktopVersionError] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  const reload = useCallback(async (select?: string) => {
    try {
      const list = await api.list();
      setItems(list);
      setSelId((cur) => select ?? (cur && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      setError(`Impossible de joindre le serveur : ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const bridge = window.enis;
    if (!bridge) return;
    setIsDesktop(true);
    void bridge.getVersion()
      .then(setDesktopVersion)
      .catch(() => setDesktopVersionError(true));
    let receivedUpdateEvent = false;
    const unsubscribe = bridge.onUpdateStatus((next) => {
      receivedUpdateEvent = true;
      setUpdateStatus(next);
    });
    void bridge.getUpdateStatus()
      .then((current) => {
        if (!receivedUpdateEvent) setUpdateStatus(current);
      })
      .catch((e: unknown) => console.warn(`État des mises à jour indisponible : ${errorMessage(e)}`));
    return unsubscribe;
  }, []);

  const sel = items?.find((t) => t.id === selId) ?? null;
  useEffect(() => { if (sel && day >= sel.days.length) setDay(0); }, [sel, day]);

  const exportToFolder = async () => {
    if (!sel || !window.enis) return;
    setStatus(''); setError('');
    const dir = await window.enis.chooseFolder();
    if (!dir) return;
    try {
      const r = await api.exportToFolder(sel.id, dir);
      setStatus(`${r.files.length} fichiers Word enregistrés dans ${r.dir}`);
      window.enis.showInFolder(r.files[0]);
    } catch (e) { setError((e as Error).message); }
  };

  const remove = async () => {
    if (!sel || !confirm(`Supprimer « ${sel.name} » ?`)) return;
    await api.remove(sel.id);
    setSelId(null);
    reload();
  };

  const checkForUpdates = () => {
    if (window.enis) void window.enis.checkForUpdates().catch((e: unknown) => setError(errorMessage(e)));
  };
  const installUpdate = () => {
    if (window.enis) void window.enis.installUpdate().catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <div className="app">
      <aside className="side">
        <h1>Emplois du temps</h1>
        <button className="primary wide" onClick={() => setImportMode('new')}>+ Importer</button>
        <ul className="tlist">
          {items?.map((t) => (
            <li key={t.id} className={t.id === selId ? 'active' : ''} onClick={() => { setSelId(t.id); setImportMode(null); setStatus(''); }}>
              <strong>{t.name}</strong>
              <span className="muted small">{new Date(t.createdAt).toLocaleDateString('fr-FR')}</span>
            </li>
          ))}
        </ul>
        {isDesktop && (
          <div className="sidebar-footer">
            {desktopVersion && <span className="muted small">v{desktopVersion}</span>}
            {desktopVersionError && <span className="muted small">Version indisponible</span>}
            <button className="link" onClick={checkForUpdates}>Rechercher les mises à jour</button>
          </div>
        )}
      </aside>

      <main className="main">
        {isDesktop && <UpdateBanner status={updateStatus} onInstall={installUpdate} />}
        {error && <p className="error">{error}</p>}
        {items && (importMode || !sel) && (
          <ImportPanel
            timetable={importMode === 'add' ? sel ?? undefined : undefined}
            onDone={(t) => { setImportMode(null); setRefreshKey((k) => k + 1); reload(t.id); }}
          />
        )}

        {sel && !importMode && (
          <>
            <div className="titlebar">
              <div>
                <h2>{sel.name}</h2>
                <p className="muted small">{sel.institution} · généré avec {sel.generatedAt}</p>
                <p>
                  {(['rooms', 'teachers', 'groups'] as SourceKind[]).map((k) => {
                    const f = sel.files.find((x) => x.kind === k);
                    return <span key={k} className={`tag ${f ? k : 'off'}`} title={f?.fileName}>{KIND_LABEL[k]}{f ? ` · ${f.sessions} séances` : ' · manquant'}</span>;
                  })}
                </p>
              </div>
              <div className="actions">
                <a className="primary btn" href={api.docxUrl(sel.id, day)}>Télécharger {sel.days[day]}.docx</a>
                <a className="btn" href={api.zipUrl(sel.id)}>Tous les jours (.zip)</a>
                {typeof window !== 'undefined' && window.enis && <button onClick={exportToFolder}>Enregistrer dans un dossier…</button>}
              </div>
            </div>
            {status && <p className="ok">{status}</p>}

            <div className="tabs">
              {sel.days.map((d, i) => <button key={d} className={i === day ? 'on' : ''} onClick={() => setDay(i)}>{d}</button>)}
            </div>
            <DayPreview id={sel.id} day={day} refreshKey={refreshKey} />

            <div className="foot">
              <button className="link" onClick={() => setShowOptions(!showOptions)}>{showOptions ? '▾' : '▸'} Options du document Word</button>
              <button className="link" onClick={() => setImportMode('add')}>Ajouter / remplacer des fichiers</button>
              <button className="link danger" onClick={remove}>Supprimer cet emploi du temps</button>
            </div>
            {showOptions && <OptionsPanel onSaved={() => setRefreshKey((k) => k + 1)} />}
          </>
        )}
      </main>
    </div>
  );
}
