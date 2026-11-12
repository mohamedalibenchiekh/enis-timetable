'use client';
import { useEffect, useState } from 'react';
import { api, DayGrid, normalizeName, SourceKind } from '@/lib/api';

export function DayPreview({ id, day, refreshKey, highlightCells, showHighlight, source }: {
  id: string; day: number; refreshKey: number;
  highlightCells?: Set<string> | null;
  showHighlight?: boolean;
  source?: SourceKind | null;
}) {
  const [grid, setGrid] = useState<DayGrid | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setGrid(null);
    setError('');
    api.preview(id, day, source ?? undefined).then((g) => alive && setGrid(g)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [id, day, refreshKey, source]);

  if (error) return <p className="error">{error}</p>;
  if (!grid) return <p className="muted">Chargement…</p>;
  const span = grid.headers.length + 1;
  const hl = showHighlight && highlightCells && highlightCells.size > 0 ? highlightCells : undefined;
  return (
    <div className="gridwrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="dayhead">{grid.dayName}</th>
            {grid.headers.map((h, i) => (
              <th key={i} className="slothead">{h.map((l, j) => <div key={j}>{l}</div>)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.blocs.map((b) => (
            <FragmentRows key={b.title} title={b.title} span={span} rows={b.rows} headers={grid.headers} day={day} highlightCells={hl} />
          ))}
        </tbody>
      </table>
      <p className="muted small">{grid.sessionCount} séances ce jour-là.</p>
    </div>
  );
}

function FragmentRows({ title, span, rows, headers, day, highlightCells }: {
  title: string; span: number;
  rows: DayGrid['blocs'][number]['rows'];
  headers: string[][];
  day: number;
  highlightCells?: Set<string>;
}) {
  return (
    <>
      <tr><td className="bloc" colSpan={span}>{title}</td></tr>
      {rows.map((r) => (
        <tr key={r.room}>
          <th className="roomcell" title={r.room}>{r.label}</th>
          {r.cells.map((c, i) => {
            const slotHeader = headers[i]?.join(' ') ?? '';
            const isHl = !!highlightCells?.has(`${day}|${normalizeName(r.room)}|${slotHeader}`);
            return <td key={i} className={isHl ? 'hl' : undefined}>{c}</td>;
          })}
        </tr>
      ))}
    </>
  );
}
