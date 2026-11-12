'use client';
import { useEffect, useState } from 'react';
import { api, CellSession, DayGrid, ExportOptions, normalizeName, SourceKind } from '@/lib/api';

export function DayPreview({ id, day, refreshKey, highlightCells, showHighlight, source, profile, options }: {
  id: string; day: number; refreshKey: number;
  highlightCells?: Set<string> | null;
  showHighlight?: boolean;
  source?: SourceKind | null;
  profile?: string | null;
  options?: ExportOptions | null;
}) {
  const [grid, setGrid] = useState<DayGrid | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setGrid(null);
    setError('');
    api.preview(id, day, source ?? undefined, profile ?? undefined).then((g) => alive && setGrid(g)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [id, day, refreshKey, source, profile]);

  if (error) return <p className="error">{error}</p>;
  if (!grid) return <p className="muted">Chargement…</p>;
  const span = grid.headers.length + 1;
  const hl = showHighlight && highlightCells && highlightCells.size > 0 ? highlightCells : undefined;

  // Group blocs into pages for visual separators (matches the DOCX page groups).
  const pageGroups: { page: number; blocs: typeof grid.blocs }[] = grid.pages && grid.pages.length > 1
    ? grid.pages.map((pg) => ({ page: pg.page, blocs: pg.blocs.map((i) => grid.blocs[i]).filter(Boolean) }))
    : [{ page: 1, blocs: grid.blocs }];
  // Prefer the profile options passed by the parent; fall back to the options
  // the server resolved for this grid so the preview always matches the export.
  const opts = options ?? grid.options ?? null;
  // Mirror the DOCX layout options: header only on the first page group unless
  // repeatDayHeader is set, and an optional bold page title per group.
  const showHeader = (pgIndex: number) => pgIndex === 0 || opts?.repeatDayHeader !== false;
  const showTitle = opts?.showPageTitle === true;

  return (
    <div className="gridwrap">
      {pageGroups.map((pg, pgIndex) => (
        <div key={pg.page}>
          {pgIndex > 0 && <div className="pagebreak" aria-hidden="true"><span>— saut de page —</span></div>}
          {showTitle && pg.blocs.length > 0 && <div className="page-title">{pg.blocs.map((b) => b.title).join(' · ')}</div>}
          <table className="grid">
            {showHeader(pgIndex) && (
              <thead>
                <tr>
                  <th className="dayhead">{grid.dayName}</th>
                  {grid.headers.map((h, i) => (
                    <th key={i} className="slothead">{h.map((l, j) => <div key={j}>{l}</div>)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {pg.blocs.map((b) => (
                <FragmentRows key={b.title} title={b.title} span={span} rows={b.rows} headers={grid.headers} day={day} highlightCells={hl} options={opts} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="muted small">{grid.sessionCount} séances ce jour-là.</p>
    </div>
  );
}

function FragmentRows({ title, span, rows, headers, day, highlightCells, options }: {
  title: string; span: number;
  rows: DayGrid['blocs'][number]['rows'];
  headers: string[][];
  day: number;
  highlightCells?: Set<string>;
  options?: ExportOptions | null;
}) {
  // Session cells use the profile's font size (points), like the DOCX export.
  const cellFontSize = options?.cellFontSize;
  const cellStyle = cellFontSize ? { fontSize: `${cellFontSize}pt` } : undefined;
  return (
    <>
      <tr><td className="bloc" colSpan={span}>{title}</td></tr>
      {rows.map((r) => (
        <tr key={r.room}>
          <th className="roomcell" title={r.room}>{r.label}</th>
          {r.cells.map((c, i) => {
            const slotHeader = headers[i]?.join(' ') ?? '';
            const isHl = !!highlightCells?.has(`${day}|${normalizeName(r.room)}|${slotHeader}`);
            const details = r.details?.[i];
            return (
              <td key={i} className={isHl ? 'hl' : undefined} style={cellStyle}>
                {details ? <RichCell entries={details} options={options} /> : c}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RichCell({ entries, options }: { entries: CellSession[]; options?: ExportOptions | null }) {
  const detailClass = [
    'cell-detail',
    options?.detailItalic ? 'di' : '',
    options?.detailSmaller ? 'ds' : '',
  ].filter(Boolean).join(' ');
  return (
    <>
      {entries.map((entry, ei) => (
        <div key={ei} className={ei > 0 ? 'cell-session' : undefined}>
          {entry.lines.map((line, li) => (
            <div key={li} className={li > 0 ? detailClass : undefined}>{line}</div>
          ))}
        </div>
      ))}
    </>
  );
}
