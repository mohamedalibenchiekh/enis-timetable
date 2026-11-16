'use client';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  guessKind,
  guessOrigin,
  ImportReport,
  KIND_LABEL,
  ORIGIN_LABEL,
  Timetable,
  UploadResult,
} from '@/lib/api';

export function ImportPanel({
  timetable,
  onDone,
}: {
  timetable?: Timetable;
  onDone: (t: UploadResult) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirmDateMismatch, setConfirmDateMismatch] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [versions, setVersions] = useState<Timetable[] | null>(null);
  const [versionsError, setVersionsError] = useState('');
  const [previousId, setPreviousId] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const loadVersions = () => {
    setVersions(null);
    setVersionsError('');
    api.list()
      .then(setVersions)
      .catch((e) => {
        setVersions([]);
        setVersionsError((e as Error).message);
      });
  };

  useEffect(() => {
    if (!timetable) loadVersions();
  }, [timetable]);

  const add = (list: FileList | File[]) => {
    const valid = Array.from(list).filter((f) => /\.(html?|csv|pdf)$/i.test(f.name));
    setFiles((prev) => [...prev.filter((p) => !valid.some((v) => v.name === p.name)), ...valid]);
    setReport(null);
    setConfirmDateMismatch(false);
    setError('');
  };

  const removeFile = (fileToRemove: File) => {
    setFiles(files.filter((x) => x !== fileToRemove));
    setReport(null);
    setConfirmDateMismatch(false);
  };

  const runAnalysis = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    setError('');
    try {
      const rep = await api.analyze(files, {
        previousTimetableId: !timetable && previousId ? previousId : undefined,
      });
      setReport(rep);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    if (report?.dateMismatch?.isMismatch && !confirmDateMismatch) {
      setError('Veuillez confirmer que les fichiers correspondent à la même version avant d’importer.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const t = await api.upload(files, {
        name: name || undefined,
        timetableId: timetable?.id,
        previousTimetableId: !timetable && previousId ? previousId : undefined,
        confirmDateMismatch,
      });
      setFiles([]);
      setName('');
      setPreviousId('');
      setReport(null);
      setConfirmDateMismatch(false);
      onDone(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    files.length > 0 &&
    !busy &&
    !analyzing &&
    (timetable !== undefined || versions !== null) &&
    (!report || (report.canImport && (!report.dateMismatch?.isMismatch || confirmDateMismatch)));

  return (
    <div className="card">
      {!timetable && (
        <>
          <h2>Bienvenue — 3 étapes pour commencer</h2>
          <ol>
            <li>Importez les fichiers exportés depuis FET (HTML, CSV ou PDF).</li>
            <li>Vérifiez l’aperçu de l’emploi du temps.</li>
            <li>Téléchargez les documents Word.</li>
          </ol>
          <p>
            <a href="/aide/">Ouvrir le guide d’utilisation</a>
          </p>
        </>
      )}
      <h2>{timetable ? 'Ajouter ou remplacer des fichiers' : 'Importer un emploi du temps'}</h2>
      <p className="muted">
        Formats acceptés : export HTML FET (<code>…_rooms_…</code>, <code>…_teachers_…</code>, <code>…_groups_…</code>),
        export CSV FET (<code>timetable.csv</code>), ou export PDF FET (A4 paysage).
      </p>

      {!report && (
        <>
          <div
            className={`drop ${over ? 'over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              add(e.dataTransfer.files);
            }}
          >
            Glissez les fichiers ici (HTML, CSV ou PDF) ou cliquez pour les choisir
            <input
              ref={input}
              type="file"
              accept=".html,.htm,.csv,.pdf"
              multiple
              hidden
              onChange={(e) => e.target.files && add(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <ul className="files">
              {files.map((f) => {
                const kOrig = guessOrigin(f.name);
                const kKind = guessKind(f.name);
                return (
                  <li key={f.name}>
                    <span className="tag origin">{kOrig ? ORIGIN_LABEL[kOrig] : 'Format ?'}</span>
                    <span className={`tag ${kKind ?? (kOrig === 'csv' ? 'all' : 'unknown')}`}>
                      {kOrig === 'csv' ? 'Toutes vues' : kKind ? KIND_LABEL[kKind] : 'Type ?'}
                    </span>
                    <span className="fname">{f.name}</span>
                    <button className="link" onClick={() => removeFile(f)}>
                      retirer
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!timetable && (
            <>
              <input
                className="text"
                placeholder="Nom (facultatif) — ex. S1 2026-2027"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {versions === null && <p className="muted small">Chargement des versions…</p>}
              {versionsError && (
                <p className="error small">
                  Impossible de charger les versions : {versionsError}{' '}
                  <button className="link" onClick={loadVersions}>
                    Réessayer
                  </button>
                </p>
              )}
              {versions !== null && versions.length > 0 && (
                <label className="field">
                  <span>Nouvelle version de…</span>
                  <select
                    className="text"
                    value={previousId}
                    onChange={(e) => setPreviousId(e.target.value)}
                  >
                    <option value="">— Aucun (première version) —</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.generatedAt ? ` (${v.generatedAt})` : ''}
                      </option>
                    ))}
                  </select>
                  <small className="muted">
                    Si cet import remplace une version existante, choisissez-la ici : l’onglet
                    « Changements » comparera les deux versions.
                  </small>
                </label>
              )}
            </>
          )}

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', alignItems: 'center' }}>
            <button
              className="secondary"
              type="button"
              disabled={!files.length || busy || analyzing}
              onClick={runAnalysis}
            >
              {analyzing ? 'Analyse en cours…' : 'Analyser les fichiers'}
            </button>
            <button
              className="primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              {busy ? 'Import en cours…' : 'Importer'}
            </button>
          </div>
        </>
      )}

      {report && (
        <div className="report-panel" style={{ marginTop: '1rem' }}>
          <h3>Rapport d&apos;analyse avant importation</h3>

          {/* Date mismatch alert */}
          {report.dateMismatch.isMismatch && (
            <div
              className="alert-box warning"
              style={{
                border: '1px solid #f59e0b',
                background: '#fffbeb',
                padding: '1rem',
                borderRadius: '6px',
                marginBottom: '1rem',
              }}
            >
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#92400e' }}>
                Dates différentes détectées
              </h4>
              <p style={{ margin: '0 0 0.5rem 0' }}>
                Les fichiers fournis contiennent des dates de génération distinctes :
                <strong> {report.dateMismatch.dates.join(' vs ')}</strong>.
              </p>
              {report.dateMismatch.details.map((d, i) => (
                <p key={i} className="small muted" style={{ margin: '0.25rem 0' }}>
                  {d}
                </p>
              ))}
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={confirmDateMismatch}
                    onChange={(e) => setConfirmDateMismatch(e.target.checked)}
                  />
                  <span>Ils correspondent à la même version (confirmer l’import groupé)</span>
                </label>
              </div>
            </div>
          )}

          {/* Blocking message */}
          {(!report.canImport || report.hasErrors) && (
            <div
              className="alert-box error"
              style={{
                border: '1px solid #ef4444',
                background: '#fef2f2',
                padding: '1rem',
                borderRadius: '6px',
                marginBottom: '1rem',
                color: '#991b1b',
              }}
            >
              <h4 style={{ margin: '0 0 0.5rem 0' }}>Import impossible</h4>
              <p style={{ margin: 0 }}>
                {report.blockingMessage ?? 'Des erreurs bloquantes empêchent l’importation de ces fichiers.'}
              </p>
            </div>
          )}

          {/* Cross check info */}
          {report.crossCheck && (
            <div
              className="info-box"
              style={{
                border: '1px solid #3b82f6',
                background: '#eff6ff',
                padding: '0.75rem',
                borderRadius: '6px',
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              <strong>Vérification croisée :</strong>{' '}
              Séances issues du CSV (source autoritaire) ; catalogues des salles, enseignants et groupes complétés à partir des PDF.
              {report.crossCheck.discrepancies.length > 0 && (
                <ul style={{ margin: '0.5rem 0 0 1.25rem' }}>
                  {report.crossCheck.discrepancies.map((disc, idx) => (
                    <li key={idx} className="small text-amber-700">{disc}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Summary stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px' }}>
              <div className="small muted">Séances</div>
              <strong style={{ fontSize: '1.25rem' }}>{report.summary.totalSessions}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px' }}>
              <div className="small muted">Salles</div>
              <strong style={{ fontSize: '1.25rem' }}>{report.summary.distinctRooms}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px' }}>
              <div className="small muted">Enseignants</div>
              <strong style={{ fontSize: '1.25rem' }}>{report.summary.distinctTeachers}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px' }}>
              <div className="small muted">Groupes</div>
              <strong style={{ fontSize: '1.25rem' }}>{report.summary.distinctGroups}</strong>
            </div>
          </div>

          {/* File details */}
          <ul className="files" style={{ marginBottom: '1rem' }}>
            {report.files.map((f) => (
              <li key={f.fileName} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                  <span className="tag origin">{ORIGIN_LABEL[f.origin]}</span>
                  {f.detectedKind && (
                    <span className={`tag ${f.detectedKind}`}>{KIND_LABEL[f.detectedKind]}</span>
                  )}
                  <span className="fname" style={{ flex: 1 }}>{f.fileName}</span>
                  <span className="small muted">
                    {f.sessionsCount} séances · confiance {Math.round(f.confidence * 100)}%
                  </span>
                </div>
                {f.warnings.length > 0 && (
                  <ul className="small text-amber-700" style={{ margin: '0.25rem 0 0 1.5rem' }}>
                    {f.warnings.map((w, wi) => (
                      <li key={wi}>{w}</li>
                    ))}
                  </ul>
                )}
                {f.errors.length > 0 && (
                  <ul className="small text-red-700" style={{ margin: '0.25rem 0 0 1.5rem' }}>
                    {f.errors.map((e, ei) => (
                      <li key={ei}>{e}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setReport(null)}
            >
              Modifier les fichiers
            </button>
            <button
              className="primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              {busy
                ? 'Import en cours…'
                : report.hasWarnings
                ? 'Importer avec avertissements'
                : 'Importer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
