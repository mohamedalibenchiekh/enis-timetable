'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  Conflict,
  ProgramRevisionInfo,
  ProgramSession,
  SavedProgram,
  SessionSuggestions,
  Timetable,
} from '@/lib/api';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const SLOTS = [
  { index: 0, label: '08:30 - 10:00' },
  { index: 1, label: '10:15 - 11:45' },
  { index: 2, label: 'Pause (12:00 - 13:00)' },
  { index: 3, label: '13:00 - 14:30 (V: 14:00 - 15:30)' },
  { index: 4, label: '14:45 - 16:15' },
  { index: 5, label: '16:30 - 18:00' },
];

export function ProgramEditorGrid({
  program,
  conflicts,
  timetables,
  referenceId,
  onProgramUpdated,
  onOpenSessionId,
}: {
  program: SavedProgram;
  conflicts: Conflict[];
  timetables: Timetable[];
  referenceId?: string;
  onProgramUpdated: (updated: SavedProgram) => void;
  onOpenSessionId?: string | null;
}) {
  const [selectedSession, setSelectedSession] = useState<ProgramSession | null>(null);
  const [sessionDraft, setSessionDraft] = useState<Partial<ProgramSession> | null>(null);
  const [suggestions, setSuggestions] = useState<SessionSuggestions | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [revisions, setRevisions] = useState<ProgramRevisionInfo[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const lastOpenedSessionIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<number>(0);
  const modalRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation focus
  const [focusedCell, setFocusedCell] = useState<{ day: number; slot: number }>({ day: 0, slot: 0 });
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  // Focus effect for keyboard navigation
  useEffect(() => {
    const key = `${focusedCell.day}:${focusedCell.slot}`;
    const el = cellRefs.current.get(key);
    if (el && document.activeElement && cellRefs.current.get(`${focusedCell.day}:${focusedCell.slot}`) !== document.activeElement) {
      // Avoid stealing focus unless explicitly moved
    }
  }, [focusedCell]);

  // Handle external session selection (e.g. from conflict list)
  useEffect(() => {
    if (onOpenSessionId && onOpenSessionId !== lastOpenedSessionIdRef.current) {
      lastOpenedSessionIdRef.current = onOpenSessionId;
      const found = program.sessions.find((s) => s.id === onOpenSessionId);
      if (found) {
        openSessionModal(found);
      }
    } else if (!onOpenSessionId) {
      lastOpenedSessionIdRef.current = null;
    }
  }, [onOpenSessionId, program.sessions]);

  // Load revisions
  const loadRevisions = useCallback(async () => {
    try {
      const list = await api.listProgramRevisions(program.id);
      setRevisions(list);
    } catch {
      // Revisions unavailable
    }
  }, [program.id]);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions, program.revision]);

  // Open session modal
  const openSessionModal = async (session: ProgramSession) => {
    setSelectedSession(session);
    setSessionDraft({ ...session });
    setError('');
    setSuccess('');
    setSuggestions(null);

    if (session.id) {
      setLoadingSuggestions(true);
      const reqId = ++activeRequestIdRef.current;
      try {
        const res = await api.getSessionSuggestions(program.id, session.id, referenceId);
        if (reqId === activeRequestIdRef.current) {
          setSuggestions(res);
        }
      } catch {
        // Suggestions unavailable
      } finally {
        if (reqId === activeRequestIdRef.current) {
          setLoadingSuggestions(false);
        }
      }
    }
  };

  // Close session modal
  const closeModal = () => {
    setSelectedSession(null);
    setSessionDraft(null);
    setSuggestions(null);
  };

  useEffect(() => {
    if (selectedSession && modalRef.current) {
      modalRef.current.focus();
    }
  }, [selectedSession]);
  const activeSessionConflicts = useMemo(() => {
    if (!selectedSession?.id) return [];
    return conflicts.filter((c) => c.sessions?.some((s) => s.id === selectedSession.id));
  }, [selectedSession, conflicts]);

  // Quick room assignment
  const assignRoom = (room: string) => {
    if (!sessionDraft) return;
    setSessionDraft({
      ...sessionDraft,
      room,
      roomUnassigned: false,
    });
  };

  // Quick move to slot
  const moveToSlot = (targetDay: number, targetSlot: number) => {
    if (!sessionDraft) return;
    setSessionDraft({
      ...sessionDraft,
      day: targetDay,
      slot: targetSlot,
    });
  };

  // Save session edits
  const saveSessionEdits = async () => {
    if (!selectedSession?.id || !sessionDraft) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.updateProgramSession(program.id, selectedSession.id, sessionDraft);
      const updatedSessions = program.sessions.map((s) => (s.id === selectedSession.id ? res.session : s));
      const updatedProg: SavedProgram = {
        ...program,
        revision: res.revision,
        sessions: updatedSessions,
      };
      onProgramUpdated(updatedProg);
      setSuccess('Séance mise à jour.');
      setSelectedSession(res.session);
      setSessionDraft({ ...res.session });
      // Refresh suggestions
      if (res.session.id) {
        api.getSessionSuggestions(program.id, res.session.id, referenceId).then(setSuggestions).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Delete session
  const deleteSession = async () => {
    if (!selectedSession?.id) return;
    if (!confirm(`Supprimer la séance « ${selectedSession.title} » ?`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.deleteProgramSession(program.id, selectedSession.id);
      const updatedSessions = program.sessions.filter((s) => s.id !== selectedSession.id);
      const updatedProg: SavedProgram = {
        ...program,
        revision: res.revision,
        sessions: updatedSessions,
      };
      onProgramUpdated(updatedProg);
      closeModal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Add new session
  const addNewSession = async (day: number, slot: number) => {
    setBusy(true);
    setError('');
    try {
      const newSessionPayload: Partial<ProgramSession> = {
        day,
        slot,
        slotSpan: 1,
        daySpan: 1,
        title: 'Nouvelle séance',
        code: '',
        teachers: [],
        room: null,
        roomUnassigned: true,
        source: 'manual',
      };
      const res = await api.createProgramSession(program.id, newSessionPayload);
      const updatedProg: SavedProgram = {
        ...program,
        revision: res.revision,
        sessions: [...program.sessions, res.session],
      };
      onProgramUpdated(updatedProg);
      openSessionModal(res.session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Move session via drag-and-drop or batch
  const handleDropSession = async (targetDay: number, targetSlot: number) => {
    if (!draggedSessionId) return;
    const session = program.sessions.find((s) => s.id === draggedSessionId);
    if (!session || (session.day === targetDay && session.slot === targetSlot)) {
      setDraggedSessionId(null);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await api.batchProgramSessions(
        program.id,
        program.revision,
        [
          {
            type: 'move',
            id: draggedSessionId,
            day: targetDay,
            slot: targetSlot,
          },
        ],
        `Déplacement de « ${session.title} » vers ${DAYS[targetDay]} créneau ${targetSlot + 1}`,
      );
      const updatedProg: SavedProgram = {
        ...program,
        revision: res.revision,
        sessions: res.sessions,
      };
      onProgramUpdated(updatedProg);
      setSuccess(`Séance déplacée vers ${DAYS[targetDay]}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDraggedSessionId(null);
    }
  };

  // Revert program to original import snapshot
  const revertToImport = async () => {
    if (!confirm('Rétablir l’emploi du temps tel qu’il était lors de l’importation originale ? Toutes les modifications manuelles seront archivées dans une nouvelle révision.')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.revertProgram(program.id);
      const updatedProg: SavedProgram = {
        ...program,
        revision: res.revision,
        sessions: res.sessions,
      };
      onProgramUpdated(updatedProg);
      setSuccess('Programme rétabli à son état d’importation.');
      closeModal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Restore revision
  const restoreRevision = async (revNum: number) => {
    if (!confirm(`Restaurer la révision ${revNum} ?`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.restoreProgramRevision(program.id, revNum);
      const updatedProg: SavedProgram = {
        ...program,
        revision: res.revision,
        sessions: res.sessions,
      };
      onProgramUpdated(updatedProg);
      setSuccess(`Révision ${revNum} restaurée.`);
      setShowRevisions(false);
      closeModal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Keyboard navigation handler for the grid
  const handleKeyDown = (e: React.KeyboardEvent, day: number, slot: number) => {
    let nextDay = day;
    let nextSlot = slot;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        nextSlot = Math.max(0, slot - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        nextSlot = Math.min(5, slot + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        nextDay = Math.max(0, day - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextDay = Math.min(5, day + 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const inCell = program.sessions.filter((s) => s.day === day && s.slot === slot);
        if (inCell.length > 0) {
          openSessionModal(inCell[0]);
        } else {
          void addNewSession(day, slot);
        }
        return;
      }
      default:
        return;
    }

    setFocusedCell({ day: nextDay, slot: nextSlot });
    const targetEl = cellRefs.current.get(`${nextDay}:${nextSlot}`);
    targetEl?.focus();
  };

  // Check conflicts for a session
  const getSessionConflictBadge = (session: ProgramSession) => {
    if (!session.id) return null;
    const sessionConflicts = conflicts.filter((c) => c.sessions?.some((s) => s.id === session.id));
    if (!sessionConflicts.length) return null;

    const hasError = sessionConflicts.some((c) => c.severity === 'error');
    const hasWarn = sessionConflicts.some((c) => c.severity === 'warning');

    const badgeColor = hasError ? '#b42318' : hasWarn ? '#856404' : '#2b6cb0';
    const bgColor = hasError ? '#ffebee' : hasWarn ? '#fff9db' : '#e8f0fe';

    return (
      <span
        title={sessionConflicts.map((c) => c.message).join('\n')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          padding: '1px 6px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 700,
          color: badgeColor,
          background: bgColor,
          border: `1px solid ${badgeColor}`,
        }}
      >
        ⚠ {sessionConflicts.length}
      </span>
    );
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '0.75rem 1rem',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: '8px',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
            {program.code} — {program.title}
          </h3>
          <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
            Année 2026-2027 · {program.semester} · {program.coordinator || 'Coordinateur non précisé'} ·{' '}
            <strong>Révision {program.revision}</strong> · {program.sessions.length} séances
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="secondary" onClick={() => setShowRevisions(!showRevisions)}>
            Historique ({revisions.length} révisions)
          </button>
          <button className="secondary" onClick={revertToImport} title="Revenir à l’état brut de l’importation">
            Rétablir l’import
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {error && <p className="error" role="alert" style={{ marginBottom: '1rem' }}>{error}</p>}
      {success && <p className="ok" style={{ marginBottom: '1rem' }}>{success}</p>}

      {/* Revision History Dropdown */}
      {showRevisions && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '8px',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>Historique des modifications</h4>
            <button className="link" onClick={() => setShowRevisions(false)}>Fermer</button>
          </div>
          {revisions.length === 0 ? (
            <p className="muted small">Aucune révision enregistrée pour le moment.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {revisions.map((rev) => (
                <li
                  key={rev.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '4px',
                    background: rev.revision === program.revision ? '#f0fdf4' : '#f8f9fa',
                    border: `1px solid ${rev.revision === program.revision ? '#c3e6cb' : '#dee2e6'}`,
                  }}
                >
                  <div>
                    <strong>Révision {rev.revision}</strong>
                    {rev.revision === program.revision && <span className="tag" style={{ marginLeft: '0.5rem', background: '#c3e6cb' }}>Actuelle</span>}
                    <div className="small muted">
                      {rev.description || 'Modification de l’emploi du temps'} · {new Date(rev.createdAt).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  {rev.revision !== program.revision && (
                    <button className="link" onClick={() => restoreRevision(rev.revision)}>
                      Restaurer cette révision
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Interactive Grid */}
      <div style={{ overflowX: 'auto', background: 'var(--panel)', borderRadius: '8px', border: '1px solid var(--line)' }}>
        <table className="grid" style={{ minWidth: '850px' }}>
          <thead>
            <tr>
              <th style={{ width: '130px' }}>Créneau</th>
              {DAYS.map((d) => (
                <th key={d} className="dayhead" style={{ fontSize: '15px' }}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot.index}>
                <th className="slothead" style={{ fontSize: '12px', padding: '6px' }}>
                  {slot.label}
                </th>
                {DAYS.map((day, dayIndex) => {
                  const inSlot = program.sessions.filter((s) => s.day === dayIndex && s.slot === slot.index);
                  const isFocused = focusedCell.day === dayIndex && focusedCell.slot === slot.index;
                  const isDropTarget = draggedSessionId !== null;

                  return (
                    <td
                      key={day}
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${dayIndex}:${slot.index}`, el);
                        else cellRefs.current.delete(`${dayIndex}:${slot.index}`);
                      }}
                      tabIndex={0}
                      aria-label={`${DAYS[dayIndex]}, ${slot.label}`}
                      onKeyDown={(e) => handleKeyDown(e, dayIndex, slot.index)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleDropSession(dayIndex, slot.index);
                      }}
                      style={{
                        verticalAlign: 'top',
                        padding: '4px',
                        outline: isFocused ? '2px solid var(--accent)' : undefined,
                        background: isDropTarget ? '#f8fafc' : undefined,
                        minHeight: '80px',
                        height: '100%',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '60px' }}>
                        {inSlot.map((session) => {
                          const conflictBadge = getSessionConflictBadge(session);
                          const isUnassigned = session.roomUnassigned || !session.room;
                          const roomLabel = session.roomUnassigned
                            ? 'Salle à rechercher'
                            : session.room
                              ? session.room
                              : 'Sans salle';

                          return (
                            <button
                              type="button"
                              key={session.id}
                              draggable
                              tabIndex={0}
                              onDragStart={(e) => {
                                setDraggedSessionId(session.id ?? null);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openSessionModal(session);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openSessionModal(session);
                                }
                              }}
                              style={{
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: session.color ? `#${session.color.replace(/^#/u, '')}` : '#f0f4f8',
                                border: `1px solid ${conflictBadge ? '#e53e3e' : '#cbd5e1'}`,
                                cursor: 'grab',
                                textAlign: 'left',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                width: '100%',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                                <strong style={{ fontSize: '12px', lineHeight: 1.2 }}>
                                  {session.code ? `${session.code} : ` : ''}
                                  {session.title}
                                </strong>
                                {conflictBadge}
                              </div>

                              {session.teachers.length > 0 && (
                                <div className="small muted" style={{ fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {session.teachers.join(', ')}
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginTop: '2px' }}>
                                <span
                                  className="tag"
                                  style={{
                                    fontSize: '11px',
                                    padding: '1px 5px',
                                    margin: 0,
                                    background: isUnassigned ? '#fff3cd' : '#e2e8f0',
                                    color: isUnassigned ? '#856404' : '#1e293b',
                                    border: isUnassigned ? '1px dashed #856404' : undefined,
                                    fontWeight: 600,
                                  }}
                                >
                                  {roomLabel}
                                </span>
                                {session.customTime && (
                                  <span className="small muted" style={{ fontSize: '10px' }}>
                                    ⏱ {session.customTime}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}

                        {/* Add button on empty / hover */}
                        <button
                          className="link small"
                          style={{
                            marginTop: 'auto',
                            opacity: inSlot.length === 0 ? 0.6 : 0.2,
                            alignSelf: 'center',
                            fontSize: '11px',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = inSlot.length === 0 ? '0.6' : '0.2')}
                          onClick={() => addNewSession(dayIndex, slot.index)}
                        >
                          + Ajouter
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Session Edit & Suggestions Modal / Drawer */}
      {selectedSession && sessionDraft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-modal-title"
          tabIndex={-1}
          ref={modalRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeModal();
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.5rem',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 id="session-modal-title" style={{ margin: 0 }}>Modifier la séance</h3>
                <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
                  {DAYS[sessionDraft.day ?? 0]} · Créneau {(sessionDraft.slot ?? 0) + 1} ({SLOTS[sessionDraft.slot ?? 0]?.label})
                </p>
              </div>
              <button className="link" onClick={closeModal} style={{ fontSize: '18px', fontWeight: 'bold' }}>
                ✕
              </button>
            </div>

            {/* Diagnostics & Conflicts Box */}
            {activeSessionConflicts.length > 0 && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: '#ffebee',
                  border: '1px solid #f5c6cb',
                  marginBottom: '1rem',
                }}
              >
                <strong style={{ color: '#b42318', fontSize: '13px' }}>
                  ⚠ {activeSessionConflicts.length} conflit(s) détecté(s) pour cette séance :
                </strong>
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '12px', color: '#b42318' }}>
                  {activeSessionConflicts.map((c) => (
                    <li key={c.id}>{c.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Room Suggestions Box */}
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '13px' }}>Salles libres recommandées pour ce créneau</strong>
                {loadingSuggestions && <span className="muted small">Recherche…</span>}
              </div>

              {suggestions?.bestRoom && (
                <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="small">Recommandation prioritaire :</span>
                  <button
                    className="primary"
                    style={{ padding: '2px 8px', fontSize: '12px' }}
                    onClick={() => assignRoom(suggestions.bestRoom!)}
                  >
                    Attribuer {suggestions.bestRoom}
                  </button>
                </div>
              )}

              {suggestions?.freeRooms && suggestions.freeRooms.length > 0 ? (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', maxHeight: '100px', overflowY: 'auto' }}>
                  {suggestions.freeRooms.slice(0, 20).map((r) => (
                    <button
                      key={r.room}
                      className="link"
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: r.isSameBloc ? '#e2e8f0' : '#f1f5f9',
                        fontWeight: r.isSameBloc ? 700 : 400,
                        fontSize: '11px',
                        border: '1px solid #cbd5e1',
                      }}
                      onClick={() => assignRoom(r.room)}
                    >
                      {r.room}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  {loadingSuggestions ? 'Chargement des salles libres…' : 'Aucune salle libre trouvée.'}
                </p>
              )}
            </div>

            {/* Free Slots Suggestions */}
            {suggestions?.freeSlots && suggestions.freeSlots.length > 0 && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  marginBottom: '1rem',
                }}
              >
                <strong style={{ fontSize: '13px', color: '#166534' }}>
                  Créneaux alternatifs libres (sans conflit de salle ni d’enseignant)
                </strong>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {suggestions.freeSlots.slice(0, 10).map((fs) => (
                    <button
                      key={`${fs.day}:${fs.slot}`}
                      className="link"
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: '#dcfce7',
                        fontSize: '11px',
                        border: '1px solid #86efac',
                        color: '#166534',
                      }}
                      onClick={() => moveToSlot(fs.day, fs.slot)}
                    >
                      {fs.dayName} créneau {fs.slot + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Form Fields */}
            <div className="grid2">
              <label>
                Matière
                <input
                  className="text"
                  value={sessionDraft.title ?? ''}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, title: e.target.value })}
                />
              </label>
              <label>
                Code matière
                <input
                  className="text"
                  value={sessionDraft.code ?? ''}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, code: e.target.value })}
                />
              </label>
            </div>

            <div className="grid2">
              <label>
                Enseignants (séparés par des virgules)
                <input
                  className="text"
                  value={(sessionDraft.teachers ?? []).join(', ')}
                  onChange={(e) =>
                    setSessionDraft({
                      ...sessionDraft,
                      teachers: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                Salle
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    className="text"
                    value={sessionDraft.room ?? ''}
                    disabled={sessionDraft.roomUnassigned}
                    placeholder={sessionDraft.roomUnassigned ? 'Salle à rechercher' : 'Ex. A 0-1'}
                    onChange={(e) => setSessionDraft({ ...sessionDraft, room: e.target.value || null })}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={sessionDraft.roomUnassigned ?? false}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const currentLoc = sessionDraft.locationNote ?? '';
                        const nextLoc = checked
                          ? (!currentLoc || currentLoc.toLowerCase().includes('rechercher') ? 'salle à rechercher' : currentLoc)
                          : (currentLoc.toLowerCase().includes('rechercher') ? '' : currentLoc);

                        setSessionDraft({
                          ...sessionDraft,
                          roomUnassigned: checked,
                          room: checked ? null : sessionDraft.room,
                          locationNote: nextLoc,
                        });
                      }}
                    />
                    Salle à rechercher (XX)
                  </label>
                </div>
              </label>
            </div>

            <div className="grid2">
              <label>
                Jour
                <select
                  className="text"
                  value={sessionDraft.day ?? 0}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, day: Number(e.target.value) })}
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                Créneau horaire
                <select
                  className="text"
                  value={sessionDraft.slot ?? 0}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, slot: Number(e.target.value) })}
                >
                  {SLOTS.map((s) => (
                    <option key={s.index} value={s.index}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid2">
              <label>
                Horaire personnalisé (ex. 10H30 - 12H30)
                <input
                  className="text"
                  value={sessionDraft.customTime ?? ''}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, customTime: e.target.value || null })}
                />
              </label>
              <label>
                Fréquence (ex. 1/15)
                <input
                  className="text"
                  value={sessionDraft.frequency ?? ''}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, frequency: e.target.value })}
                />
              </label>
            </div>

            <div className="grid2">
              <label>
                Couleur de cellule (RVB hex)
                <input
                  className="text"
                  placeholder="Ex. B4C6E7"
                  value={sessionDraft.color ?? ''}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, color: e.target.value || null })}
                />
              </label>
              <label>
                Note de lieu
                <input
                  className="text"
                  value={sessionDraft.locationNote ?? ''}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, locationNote: e.target.value })}
                />
              </label>
            </div>

            <label>
              Remarque / Note
              <textarea
                className="text"
                rows={2}
                value={sessionDraft.note ?? ''}
                onChange={(e) => setSessionDraft({ ...sessionDraft, note: e.target.value })}
              />
            </label>

            {/* Actions Bar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '1.25rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--line)',
              }}
            >
              <button className="link danger" disabled={busy} onClick={deleteSession}>
                Supprimer cette séance
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="secondary" onClick={closeModal}>
                  Annuler
                </button>
                <button className="primary" disabled={busy} onClick={saveSessionEdits}>
                  {busy ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
