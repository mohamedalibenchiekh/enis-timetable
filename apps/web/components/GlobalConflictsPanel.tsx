'use client';
import { useMemo, useState } from 'react';
import { Conflict, ConflictSeverity, ProgramSlot, SavedProgram, SlotLabel } from '@/lib/api';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const STANDARD_SLOTS = ['08:30 - 10:00', '10:15 - 11:45', 'Pause (12:00 - 13:00)', '13:00 - 14:30', '14:45 - 16:15', '16:30 - 18:00'];
const FRIDAY_SLOTS = ['08:30 - 10:00', '10:15 - 11:45', 'Pause (12:00 - 14:00)', '14:00 - 15:30', '15:45 - 17:15', '17:30 - 19:00'];

function getSlotLabel(
  day: number,
  slot: number,
  referenceSlots?: Array<{ base?: string; raw?: string; label?: string; rawLabel?: string; overrides?: Record<number, string>; dayOverrides?: Record<number, string> }>,
): string {
  if (referenceSlots && referenceSlots[slot]) {
    const s = referenceSlots[slot];
    const dayOverride = s.overrides?.[day] ?? s.dayOverrides?.[day];
    if (dayOverride) return dayOverride;
    const base = s.base || s.label || s.raw || s.rawLabel;
    if (base) return base;
  }
  const slots = day === 4 ? FRIDAY_SLOTS : STANDARD_SLOTS;
  return slots[slot] ?? `Créneau ${slot + 1}`;
}

export function GlobalConflictsPanel({
  conflicts,
  programs,
  referenceName,
  referenceSlots,
  onSelectProgramSession,
  onRefresh,
}: {
  conflicts: Conflict[];
  programs: SavedProgram[];
  referenceName?: string;
  referenceSlots?: SlotLabel[] | ProgramSlot[];
  onSelectProgramSession?: (programId: string, sessionId: string) => void;
  onRefresh?: () => void;
}) {
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterDay, setFilterDay] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const filtered = useMemo(() => {
    return conflicts.filter((c) => {
      if (filterSeverity !== 'all' && c.severity !== filterSeverity) return false;
      if (filterDay !== 'all' && String(c.day) !== filterDay) return false;
      if (filterType !== 'all' && c.type !== filterType) return false;
      return true;
    });
  }, [conflicts, filterSeverity, filterDay, filterType]);

  const counts = useMemo(() => {
    const err = conflicts.filter((c) => c.severity === 'error').length;
    const warn = conflicts.filter((c) => c.severity === 'warning').length;
    const info = conflicts.filter((c) => c.severity === 'info').length;
    return { err, warn, info, total: conflicts.length };
  }, [conflicts]);

  const severityBadge = (sev: ConflictSeverity) => {
    switch (sev) {
      case 'error':
        return <span className="tag" style={{ background: '#ffdddd', color: '#b42318', fontWeight: 600 }}>Erreur</span>;
      case 'warning':
        return <span className="tag" style={{ background: '#fff3cd', color: '#856404', fontWeight: 600 }}>Attention</span>;
      case 'info':
        return <span className="tag" style={{ background: '#e8f0fe', color: '#2b6cb0', fontWeight: 600 }}>Info</span>;
    }
  };

  const typeLabel = (type: Conflict['type']) => {
    switch (type) {
      case 'room_double_booked':
        return 'Salle occupée simultanément';
      case 'teacher_double_booked':
        return 'Enseignant programmé deux fois';
      case 'room_missing':
        return 'Salle non affectée';
      case 'room_to_find':
        return 'Salle à rechercher (Salle XX)';
      case 'room_unknown':
        return 'Salle hors FET';
      default:
        return type;
    }
  };

  return (
    <div className="names-section" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h3>Vue globale de l’occupation et des conflits</h3>
          <p className="muted small">
            Vérification croisée entre tous les mastères enregistrés
            {referenceName ? ` et l’emploi du temps de référence « ${referenceName} »` : ''}.
          </p>
        </div>
        {onRefresh && (
          <button className="secondary" onClick={onRefresh}>
            Actualiser les conflits
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <div style={{ padding: '0.75rem 1.25rem', borderRadius: '8px', background: counts.err ? '#ffebee' : '#f0fdf4', border: `1px solid ${counts.err ? '#f5c6cb' : '#c3e6cb'}` }}>
          <strong style={{ fontSize: '1.25rem', color: counts.err ? '#b42318' : '#1a7f37' }}>{counts.err}</strong>
          <div className="small muted">Double réservations (salle / enseignant)</div>
        </div>
        <div style={{ padding: '0.75rem 1.25rem', borderRadius: '8px', background: counts.warn ? '#fff9db' : '#f8f9fa', border: `1px solid ${counts.warn ? '#ffe066' : '#dee2e6'}` }}>
          <strong style={{ fontSize: '1.25rem', color: counts.warn ? '#856404' : '#495057' }}>{counts.warn}</strong>
          <div className="small muted">Séances sans salle</div>
        </div>
        <div style={{ padding: '0.75rem 1.25rem', borderRadius: '8px', background: '#f8f9fa', border: '1px solid #dee2e6' }}>
          <strong style={{ fontSize: '1.25rem', color: '#2b6cb0' }}>{counts.info}</strong>
          <div className="small muted">À rechercher / Hors FET</div>
        </div>
      </div>

      {/* Filters */}
      <div className="names-filters">
        <label className="field">
          <span>Gravité</span>
          <select className="text" value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
            <option value="all">Toutes ({conflicts.length})</option>
            <option value="error">Erreurs ({counts.err})</option>
            <option value="warning">Avertissements ({counts.warn})</option>
            <option value="info">Informations ({counts.info})</option>
          </select>
        </label>
        <label className="field">
          <span>Jour</span>
          <select className="text" value={filterDay} onChange={(e) => setFilterDay(e.target.value)}>
            <option value="all">Tous les jours</option>
            {DAYS.map((d, i) => (
              <option key={d} value={String(i)}>{d}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type de conflit</span>
          <select className="text" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">Tous les types</option>
            <option value="room_double_booked">Salles occupées</option>
            <option value="teacher_double_booked">Enseignants en conflit</option>
            <option value="room_missing">Salle non affectée</option>
            <option value="room_to_find">Salle à rechercher (Salle XX)</option>
            <option value="room_unknown">Salle hors FET</option>
          </select>
        </label>
      </div>

      {/* Conflict List */}
      {filtered.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #c3e6cb', margin: '1rem 0' }}>
          <strong style={{ color: '#1a7f37', fontSize: '1.1rem' }}>✓ Aucun conflit correspondant</strong>
          <p className="muted small" style={{ margin: '0.25rem 0 0' }}>
            Tous les créneaux et affectations de salles sont cohérents.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((conflict) => {
            const dayLabel = DAYS[conflict.day] ?? `Jour ${conflict.day + 1}`;
            const slotLabel = getSlotLabel(conflict.day, conflict.slot, referenceSlots);

            return (
              <li
                key={conflict.id}
                style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: 'var(--panel)',
                  border: `1px solid ${conflict.severity === 'error' ? '#f5c6cb' : conflict.severity === 'warning' ? '#ffe066' : 'var(--line)'}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {severityBadge(conflict.severity)}
                    <span className="muted small"><strong>{typeLabel(conflict.type)}</strong></span>
                    <span className="muted small">· {dayLabel} · {slotLabel}</span>
                  </div>
                  {conflict.resource && (
                    <span className="tag" style={{ background: '#f1f3f5', fontWeight: 600 }}>
                      {conflict.resource}
                    </span>
                  )}
                </div>

                <p style={{ margin: '0 0 0.5rem', fontSize: '13px', lineHeight: 1.4 }}>
                  {conflict.message}
                </p>

                {conflict.sessions && conflict.sessions.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                    {conflict.sessions.map((s, idx) => {
                      const isMaster = s.source !== 'fet';
                      const prog = isMaster ? programs.find((p) => p.code === s.source || p.id === s.programId) : null;

                      return (
                        <div
                          key={idx}
                          style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: '4px',
                            background: isMaster ? '#f0f7ff' : '#f8f9fa',
                            border: `1px solid ${isMaster ? '#cce5ff' : '#e9ecef'}`,
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span>
                            <strong>{s.source}</strong> : {s.title}
                            {s.room ? ` (salle : ${s.room})` : ' (pas de salle)'}
                          </span>
                          {isMaster && prog && onSelectProgramSession && s.id && (
                            <button
                              className="link"
                              style={{ padding: '0 4px', fontSize: '11px', textDecoration: 'underline' }}
                              aria-label={`Ouvrir ${prog.code} : ${s.title} dans l’éditeur`}
                              onClick={() => onSelectProgramSession(prog.id, String(s.id))}
                            >
                              Ouvrir dans l’éditeur
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
