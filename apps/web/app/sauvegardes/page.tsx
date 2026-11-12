'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  AutoBackupItem,
  BackupsSummary,
  InspectResult,
  PreUpdateBackupItem,
} from '@/lib/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
}

function timeAgo(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 30) return `il y a ${diffDays} jours`;
    if (diffDays >= 1) return `il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`;
    if (diffHours >= 1) return `il y a ${diffHours} heure${diffHours > 1 ? 's' : ''}`;
    if (diffMin >= 1) return `il y a ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
    return 'à l’instant';
  } catch {
    return 'date inconnue';
  }
}

export default function SauvegardesPage() {
  const [data, setData] = useState<BackupsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Settings form state
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [retention, setRetention] = useState(10);
  const [savingSettings, setSavingSettings] = useState(false);

  // Restore flow state
  const [inspecting, setInspecting] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<InspectResult | null>(null);
  const [inspectSourceId, setInspectSourceId] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.backups.list();
      setData(res);
      setAutoEnabled(res.settings.enabled);
      setRetention(res.settings.retention);
      setError(null);
    } catch (err) {
      setError(`Impossible de charger les sauvegardes : ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingSettings(true);
      setStatus(null);
      setError(null);
      const updated = await api.backups.saveSettings({
        enabled: autoEnabled,
        retention: Number(retention),
      });
      setAutoEnabled(updated.enabled);
      setRetention(updated.retention);
      setStatus('Paramètres de sauvegarde enregistrés.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleInspectFile = async (file: File) => {
    try {
      setInspecting(true);
      setError(null);
      setStatus(null);
      setRestoreSuccess(null);
      setInspectSourceId(null);
      const res = await api.backups.inspect({ file });
      setInspectTarget(res);
      setConfirmChecked(false);
    } catch (err) {
      setError((err as Error).message);
      setInspectTarget(null);
    } finally {
      setInspecting(false);
    }
  };

  const handleInspectAuto = async (backup: AutoBackupItem) => {
    try {
      setInspecting(true);
      setError(null);
      setStatus(null);
      setRestoreSuccess(null);
      setInspectSourceId(backup.id);
      const res = await api.backups.inspect({ id: backup.id });
      setInspectTarget(res);
      setConfirmChecked(false);
    } catch (err) {
      setError((err as Error).message);
      setInspectTarget(null);
    } finally {
      setInspecting(false);
    }
  };

  const handleDeleteAuto = async (backup: AutoBackupItem) => {
    if (!confirm(`Supprimer la sauvegarde automatique « ${backup.fileName} » ?`)) return;
    try {
      setError(null);
      setStatus(null);
      await api.backups.delete(backup.id);
      if (inspectSourceId === backup.id) {
        setInspectTarget(null);
        setInspectSourceId(null);
      }
      setStatus(`Sauvegarde « ${backup.fileName} » supprimée.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleExecuteRestore = async () => {
    if (!inspectTarget) return;
    if (restoreMode === 'replace' && !confirmChecked) return;

    try {
      setRestoring(true);
      setError(null);
      setStatus(null);
      const res = await api.backups.restore({
        id: inspectTarget.id,
        uploadToken: inspectTarget.uploadToken,
        mode: restoreMode,
      });

      setRestoreSuccess(
        `Restauration terminée (${res.mode === 'replace' ? 'Remplacement complet' : 'Fusion'}). ` +
        `Emplois du temps : ${res.restoredCounts.timetables}, Séances : ${res.restoredCounts.sessions}. ` +
        `Une sauvegarde de sécurité a été créée : ${res.safetyBackupPath}.`,
      );
      setInspectTarget(null);
      setInspectSourceId(null);
      await loadData();
    } catch (err) {
      setError(`Échec de la restauration : ${(err as Error).message}. Aucune donnée n’a été modifiée.`);
    } finally {
      setRestoring(false);
    }
  };

  const handleOpenFolder = (dirPath: string) => {
    if (window.enis?.showInFolder) {
      window.enis.showInFolder(dirPath);
    } else {
      alert(`Chemin du dossier : ${dirPath}`);
    }
  };

  const newestAuto = data?.autoBackups[0];
  const isStale = !newestAuto || (Date.now() - new Date(newestAuto.createdAt).getTime() > 30 * 24 * 3600 * 1000);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px 80px' }}>
      <div style={{ marginBottom: 20 }}>
        <a href="/" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          ← Retour aux emplois du temps
        </a>
      </div>

      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>Sauvegardes et restauration</h1>

      {/* Global Status Banner */}
      {data && (
        <div style={{ marginBottom: 24 }}>
          {newestAuto ? (
            <div className={isStale ? 'warning' : 'card'} style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <strong>Dernière sauvegarde automatique :</strong> {formatDate(newestAuto.createdAt)} ({timeAgo(newestAuto.createdAt)})
                {isStale && <div className="small" style={{ marginTop: 4 }}>Attention : votre dernière sauvegarde date de plus de 30 jours.</div>}
              </div>
              <span className="small muted">{formatBytes(newestAuto.sizeBytes)}</span>
            </div>
          ) : (
            <div className="warning">
              <strong>Aucune sauvegarde automatique récente trouvée.</strong> Créez une sauvegarde manuelle ou activez les sauvegardes automatiques.
            </div>
          )}

          {data.lastAutoBackup.error && (
            <div className="warning" style={{ marginTop: 10 }}>
              <strong>Avertissement :</strong> La dernière tentative de sauvegarde automatique a échoué ({data.lastAutoBackup.error}).
            </div>
          )}
        </div>
      )}

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}
      {status && <p className="ok" style={{ marginBottom: 16 }}>{status}</p>}
      {restoreSuccess && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 8%, var(--panel))' }}>
          <h3 style={{ margin: '0 0 8px', color: 'var(--ok)' }}>Restauration réussie</h3>
          <p style={{ margin: '0 0 12px' }}>{restoreSuccess}</p>
          <a href="/" className="btn primary">Retourner aux emplois du temps</a>
        </div>
      )}

      {/* Section 1 : Créer une sauvegarde manuelle */}
      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>Créer une sauvegarde</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>
          Télécharge une archive complète <code>.enisbackup</code> contenant tous les emplois du temps, les séances,
          les corrections de noms et les paramètres. Conservez ce fichier sur une clé USB ou un dossier cloud sécurisé.
        </p>
        <a href={api.backups.createUrl()} className="btn primary" download>
          Créer une sauvegarde maintenant
        </a>
      </section>

      {/* Section 2 : Sauvegardes automatiques */}
      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 14px' }}>Sauvegardes automatiques</h2>
        <form onSubmit={handleSaveSettings} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
            />
            <span>Activer les sauvegardes automatiques</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Rétention (3 à 50) :</span>
            <input
              type="number"
              min={3}
              max={50}
              className="text inline"
              style={{ width: 70 }}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
          </label>

          <button type="submit" disabled={savingSettings}>
            {savingSettings ? 'Enregistrement…' : 'Enregistrer les paramètres'}
          </button>
        </form>

        <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Historique des sauvegardes automatiques</h3>
        {loading && <p className="muted">Chargement de l’historique…</p>}
        {!loading && data && data.autoBackups.length === 0 && (
          <p className="muted">Aucune sauvegarde automatique enregistrée.</p>
        )}
        {!loading && data && data.autoBackups.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '8px 10px' }}>Date</th>
                  <th style={{ padding: '8px 10px' }}>Taille</th>
                  <th style={{ padding: '8px 10px' }}>Emplois du temps</th>
                  <th style={{ padding: '8px 10px' }}>Séances</th>
                  <th style={{ padding: '8px 10px' }}>Version</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.autoBackups.map((b) => (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <strong>{formatDate(b.createdAt)}</strong>
                      {b.isPreRestore && <span className="tag" style={{ marginLeft: 6 }}>Sécurité</span>}
                      <div className="small muted" style={{ fontFamily: 'monospace' }}>{b.fileName}</div>
                    </td>
                    <td style={{ padding: '8px 10px' }} className="muted">{formatBytes(b.sizeBytes)}</td>
                    <td style={{ padding: '8px 10px' }}>{b.counts.timetables}</td>
                    <td style={{ padding: '8px 10px' }}>{b.counts.sessions}</td>
                    <td style={{ padding: '8px 10px' }} className="muted">{b.appVersion}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a href={api.backups.downloadUrl(b.id)} className="link" download={b.fileName}>
                        Télécharger
                      </a>
                      <button
                        className="link"
                        onClick={() => handleInspectAuto(b)}
                        style={{ marginLeft: 8 }}
                      >
                        Restaurer
                      </button>
                      <button
                        className="link danger"
                        onClick={() => handleDeleteAuto(b)}
                        style={{ marginLeft: 8 }}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 3 : Restaurer depuis un fichier ou une sauvegarde inspectée */}
      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>Restaurer des données</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Sélectionnez ou déposez une archive <code>.enisbackup</code> pour inspecter son contenu avant toute modification.
        </p>

        {/* Dropzone */}
        <label
          className="drop"
          style={{ display: 'block', marginBottom: 16 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleInspectFile(f);
          }}
        >
          <input
            type="file"
            accept=".enisbackup,.zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleInspectFile(f);
            }}
          />
          {inspecting ? 'Analyse de l’archive en cours…' : 'Glissez-déposez un fichier .enisbackup ou cliquez pour choisir'}
        </label>

        {/* Inspection Result Card */}
        {inspectTarget && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 18, background: 'var(--bg)', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Détails de l’archive analysée</h3>
                <p className="small muted" style={{ margin: '0 0 10px' }}>
                  Créée le {formatDate(inspectTarget.manifest.createdAt)} · Application v{inspectTarget.manifest.appVersion} (schéma v{inspectTarget.manifest.schemaVersion})
                </p>
              </div>
              <span className="tag" style={{ background: 'color-mix(in srgb, var(--ok) 20%, transparent)', color: 'var(--ok)' }}>
                {inspectTarget.compatibility.message}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '12px 0 16px' }}>
              <div className="card" style={{ padding: 12 }}>
                <span className="small muted">Emplois du temps</span>
                <div style={{ fontSize: 18, fontWeight: 'bold' }}>{inspectTarget.summary.timetables.length}</div>
                <div className="small muted">{inspectTarget.summary.timetables.map((t) => t.name).join(', ') || 'Aucun'}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <span className="small muted">Séances</span>
                <div style={{ fontSize: 18, fontWeight: 'bold' }}>{inspectTarget.manifest.counts.sessions}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <span className="small muted">Corrections enseignants</span>
                <div style={{ fontSize: 18, fontWeight: 'bold' }}>{inspectTarget.summary.teacherOverridesCount}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <span className="small muted">Libellés de salles</span>
                <div style={{ fontSize: 18, fontWeight: 'bold' }}>{inspectTarget.summary.roomOverridesCount}</div>
              </div>
            </div>

            {/* Mode selection */}
            <h4 style={{ fontSize: 14, margin: '14px 0 8px' }}>Mode de restauration</h4>
            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="restoreMode"
                  value="replace"
                  checked={restoreMode === 'replace'}
                  onChange={() => setRestoreMode('replace')}
                />
                <div>
                  <strong>Remplacer toutes les données</strong> (recommandé lors d’un changement de poste)
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    Efface les données actuelles et les remplace intégralement par celles de la sauvegarde.
                  </p>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="restoreMode"
                  value="merge"
                  checked={restoreMode === 'merge'}
                  onChange={() => setRestoreMode('merge')}
                />
                <div>
                  <strong>Ajouter les emplois du temps de la sauvegarde</strong> (fusion)
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    Conserve les données actuelles et ajoute les emplois du temps sous de nouveaux identifiants.
                    Les corrections de noms manquantes sont ajoutées sans écraser les vôtres.
                  </p>
                </div>
              </label>
            </div>

            {/* Confirmation & Action */}
            <div style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }}>
              <p className="small muted" style={{ margin: '0 0 10px' }}>
                Une sauvegarde de sécurité (<code>auto/pre-restore-...</code>) sera automatiquement créée avant toute modification.
              </p>

              {restoreMode === 'replace' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                  />
                  <strong style={{ color: 'var(--danger)' }}>
                    Je confirme vouloir remplacer toutes les données actuelles
                  </strong>
                </label>
              )}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  className="btn"
                  style={{
                    background: 'var(--danger)',
                    color: '#fff',
                    borderColor: 'var(--danger)',
                    fontWeight: 600,
                  }}
                  disabled={restoring || (restoreMode === 'replace' && !confirmChecked)}
                  onClick={handleExecuteRestore}
                >
                  {restoring ? 'Restauration en cours…' : 'Restaurer les données'}
                </button>
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => setInspectTarget(null)}
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section 4 : Sauvegardes de mise à jour (avancé) */}
      <section className="card">
        <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>Sauvegardes de mise à jour (avancé)</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Ces sauvegardes sont des copies intégrales de la base de données réalisées automatiquement avant l’installation d’une
          nouvelle version de l’application. Elles sont conservées sous forme de dossiers bruts. Pour les restaurer,
          consultez la procédure manuelle documentée dans le guide d’utilisation.
        </p>

        {loading && <p className="muted">Chargement…</p>}
        {!loading && data && data.preUpdateBackups.length === 0 && (
          <p className="muted">Aucune sauvegarde de mise à jour trouvée.</p>
        )}
        {!loading && data && data.preUpdateBackups.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '8px 10px' }}>Dossier</th>
                  <th style={{ padding: '8px 10px' }}>Version</th>
                  <th style={{ padding: '8px 10px' }}>Date</th>
                  <th style={{ padding: '8px 10px' }}>Taille</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.preUpdateBackups.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{p.name}</td>
                    <td style={{ padding: '8px 10px' }}>{p.version}</td>
                    <td style={{ padding: '8px 10px' }} className="muted">{formatDate(p.createdAt)}</td>
                    <td style={{ padding: '8px 10px' }} className="muted">{formatBytes(p.sizeBytes)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <button className="link" onClick={() => handleOpenFolder(p.path)}>
                        Ouvrir le dossier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
