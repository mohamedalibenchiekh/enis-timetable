'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ChangeType, CompareResult, Timetable } from '@/lib/api';

const TYPE_LABEL: Record<ChangeType, string> = {
  added: 'Ajoutée',
  removed: 'Supprimée',
  moved: 'Déplacée',
  room_changed: 'Salle changée',
  group_changed: 'Groupe changé',
  teachers_changed: 'Enseignant changé',
};
const TYPE_ORDER: ChangeType[] = ['added', 'removed', 'moved', 'room_changed', 'group_changed', 'teachers_changed'];
const PAGE_SIZE = 50;

function location(s: { dayName: string; timeRange: string; room: string } | null): string {
  if (!s) return '—';
  return `${s.dayName} · ${s.timeRange} · ${s.room}`;
}

function activityLabel(c: CompareResult['changes'][number]): string {
  const a = c.activity;
  const subject = [a.subjectCode, a.subject].filter(Boolean).join(' ');
  return [a.teachers, a.groups, subject, a.frequency].filter(Boolean).join(' — ');
}

export function ComparePanel({ timetable, versions, onHighlight }: {
  timetable: Timetable;
  versions: Timetable[];
  onHighlight?: (cells: Set<string> | null) => void;
}) {
  const others = useMemo(() => versions.filter((v) => v.id !== timetable.id), [versions, timetable.id]);
  const suggested = timetable.previousTimetableId && others.some((v) => v.id === timetable.previousTimetableId)
    ? timetable.previousTimetableId
    : others[0]?.id ?? '';
  const [baseId, setBaseId] = useState(suggested);
  const [source, setSource] = useState('auto');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ChangeType | ''>('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    setBaseId(suggested);
  }, [suggested]);

  useEffect(() => {
    if (!baseId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.compare(baseId, timetable.id, source)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) { setResult(null); setError((e as Error).message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [baseId, timetable.id, source]);

  const filtered = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.changes.filter((c) => {
      if (typeFilter && c.type !== typeFilter) return false;
      if (teacherFilter && !c.activity.teachers.toLowerCase().includes(teacherFilter.toLowerCase())) return false;
      if (roomFilter) {
        const rooms = [c.before?.room, c.after?.room].filter(Boolean).join(' ');
        if (!rooms.toLowerCase().includes(roomFilter.toLowerCase())) return false;
      }
      if (dayFilter && !c.days.includes(dayFilter)) return false;
      if (q && !activityLabel(c).toLowerCase().includes(q) && !location(c.before).toLowerCase().includes(q) && !location(c.after).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [result, typeFilter, teacherFilter, roomFilter, dayFilter, query]);

  // Group filtered changes by day for display.
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const c of filtered.slice(0, visible)) {
      const key = c.days.join(' / ') || '—';
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered, visible]);

  // Highlight cells for the day preview: room|slotHeader pairs that changed.
  useEffect(() => {
    if (!onHighlight) return;
    if (!result || result.summary.total === 0) {
      onHighlight(null);
      return;
    }
    const cells = new Set<string>();
    for (const d of result.days) {
      for (const c of d.cells) cells.add(`${c.room}|${c.slotHeader}`);
    }
    onHighlight(cells);
    return () => onHighlight(null);
  }, [result, onHighlight]);

  if (!others.length) {
    return <div className="card"><h2>Changements</h2><p className="muted">Importez au moins deux versions d’un même emploi du temps pour comparer les changements.</p></div>;
  }

  const s = result?.summary;
  return (
    <div className="card compare">
      <h2>Changements</h2>
      <div className="compare-controls">
        <label className="field">
          <span>Comparer avec</span>
          <select className="text" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            {others.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.generatedAt ? ` (${v.generatedAt})` : ''}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Vue</span>
          <select className="text" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="auto">Automatique</option>
            <option value="teachers">Enseignants</option>
            <option value="rooms">Salles</option>
            <option value="groups">Groupes</option>
          </select>
        </label>
        <div className="compare-exports">
          {result && result.summary.total > 0 && (
            <>
              <a className="btn" href={api.compareDocxUrl(baseId, timetable.id, source)} download>Exporter la fiche (.docx)</a>
              <a className="btn" href={api.compareCsvUrl(baseId, timetable.id, source)} download>Exporter (.csv)</a>
            </>
          )}
        </div>
      </div>

      {loading && <p className="muted">Comparaison en cours…</p>}
      {error && <p className="error">{error}</p>}

      {result && !loading && (
        <>
          {s!.warning && <p className="compare-warning">⚠ {s!.warning}</p>}
          {s!.total === 0 ? (
            <p className="compare-empty">Aucun changement entre ces deux versions.</p>
          ) : (
            <>
              <div className="compare-summary">
                {TYPE_ORDER.filter((t) => s!.byType[t] > 0).map((t) => (
                  <span key={t} className={`badge badge-${t}`}>{TYPE_LABEL[t]} : {s!.byType[t]}</span>
                ))}
                <span className="muted">{s!.unchanged} inchangée(s) · {s!.teachers} enseignant(s) · {s!.rooms} salle(s) · similarité {Math.round(s!.similarity * 100)} %</span>
              </div>

              <div className="compare-days">
                <span className="muted">Jours à rééditer</span>
                {result.days.map((d) => <span key={d.day} className="chip">{d.dayName} ({d.cells.length})</span>)}
              </div>

              <div className="compare-filters">
                <select className="text" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as ChangeType | ''); setVisible(PAGE_SIZE); }}>
                  <option value="">Tous les types</option>
                  {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
                <input className="text" placeholder="Enseignant" value={teacherFilter} onChange={(e) => { setTeacherFilter(e.target.value); setVisible(PAGE_SIZE); }} />
                <input className="text" placeholder="Salle" value={roomFilter} onChange={(e) => { setRoomFilter(e.target.value); setVisible(PAGE_SIZE); }} />
                <select className="text" value={dayFilter} onChange={(e) => { setDayFilter(e.target.value); setVisible(PAGE_SIZE); }}>
                  <option value="">Tous les jours</option>
                  {[...new Set(result.changes.flatMap((c) => c.days))].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input className="text" placeholder="Rechercher…" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE); }} />
              </div>

              {filtered.length === 0 && <p className="muted">Aucun changement ne correspond aux filtres.</p>}
              {groups.map(([day, changes]) => (
                <div key={day} className="compare-day-group">
                  <h3>{day}</h3>
                  <ul className="compare-list">
                    {changes.map((c, i) => (
                      <li key={i} className={`change change-${c.type}`}>
                        <span className={`badge badge-${c.type}`}>{TYPE_LABEL[c.type]}</span>
                        <div className="change-body">
                          <div className="change-activity">{activityLabel(c)}</div>
                          <div className="change-loc">
                            <span className="before">{location(c.before)}</span>
                            <span className="arrow">→</span>
                            <span className="after">{location(c.after)}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {filtered.length > visible && (
                <button className="btn" onClick={() => setVisible((v) => v + PAGE_SIZE)}>Afficher plus <span className="muted">({filtered.length - visible} restantes)</span></button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
