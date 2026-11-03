'use client';
import { useEffect, useState } from 'react';
import { api, DayGrid } from '@/lib/api';

export function DayPreview({ id, day, refreshKey }: { id: string; day: number; refreshKey: number }) {
  const [grid, setGrid] = useState<DayGrid | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setGrid(null);
    setError('');
    api.preview(id, day).then((g) => alive && setGrid(g)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [id, day, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (!grid) return <p className="muted">Chargement…</p>;
  const span = grid.headers.length + 1;
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
            <FragmentRows key={b.title} title={b.title} span={span} rows={b.rows} />
          ))}
        </tbody>
      </table>
      <p className="muted small">{grid.sessionCount} séances ce jour-là.</p>
    </div>
  );
}

function FragmentRows({ title, span, rows }: { title: string; span: number; rows: DayGrid['blocs'][number]['rows'] }) {
  return (
    <>
      <tr><td className="bloc" colSpan={span}>{title}</td></tr>
      {rows.map((r) => (
        <tr key={r.room}>
          <th className="roomcell" title={r.room}>{r.label}</th>
          {r.cells.map((c, i) => <td key={i}>{c}</td>)}
        </tr>
      ))}
    </>
  );
}
