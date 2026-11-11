import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComparePanel } from '../components/ComparePanel';
import { CompareResult, Timetable } from '../lib/api';

const timetable = { id: 'new-id', name: 'S1 v2', previousTimetableId: 'old-id' } as Timetable;
const versions = [
  timetable,
  { id: 'old-id', name: 'S1 v1', generatedAt: 'FET 1' } as Timetable,
  { id: 'other-id', name: 'S2', generatedAt: 'FET 2' } as Timetable,
];

const snap = (dayName: string, timeRange: string, room: string) => ({
  day: 0, dayName, firstSlot: 0, lastSlot: 0, timeRange, room, roomKey: room.toLowerCase(),
  activity: { teachers: 'Prof A', groups: 'Grp-1', subjectCode: 'T1', subject: 'Maths', frequency: '' },
});

const result: CompareResult = {
  base: { id: 'old-id', name: 'S1 v1', institution: '', comment: '', generatedAt: '', createdAt: '', files: [] },
  target: { id: 'new-id', name: 'S1 v2', institution: '', comment: '', generatedAt: '', createdAt: '', files: [] },
  source: 'teachers',
  summary: {
    total: 3, byType: { added: 1, removed: 1, moved: 1, room_changed: 0, group_changed: 0, teachers_changed: 0 },
    teachers: 2, rooms: 2, similarity: 0.8, warning: null, baseBlocks: 10, targetBlocks: 10, unchanged: 8, changed: 3,
  },
  changes: [
    { type: 'moved', activity: { teachers: 'Prof A', groups: 'Grp-1', subjectCode: 'T1', subject: 'Maths', frequency: '' }, before: snap('Lundi', '8:00-9:30', 'A 0-1'), after: snap('Mardi', '8:00-9:30', 'A 0-1'), days: ['Lundi', 'Mardi'] },
    { type: 'added', activity: { teachers: 'Prof B', groups: 'Grp-2', subjectCode: 'T2', subject: 'Physique', frequency: '' }, before: null, after: snap('Samedi', '10:00-11:30', 'B 0-1'), days: ['Samedi'] },
    { type: 'removed', activity: { teachers: 'Prof C', groups: 'Grp-3', subjectCode: 'T3', subject: 'Chimie', frequency: '' }, before: snap('Jeudi', '14:00-15:30', 'A 0-2'), after: null, days: ['Jeudi'] },
  ],
  days: [{ day: 0, dayName: 'Lundi', cells: [{ room: 'A 0-1', slotHeader: '8:00-9:30', before: 'Prof A', after: '' }] }],
};

const response = (body: unknown, ok = true) => ({ ok, statusText: 'Bad Request', json: async () => body });

describe('ComparePanel', () => {
  it('loads the comparison, shows summary, filters changes and exports links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal('fetch', fetchMock);
    const onHighlight = vi.fn();
    render(<ComparePanel timetable={timetable} versions={versions} onHighlight={onHighlight} />);

    // Default base = previousTimetableId suggestion.
    await waitFor(() => expect(screen.getByText('Ajoutée : 1')).not.toBeNull());
    expect(screen.getByText('Déplacée : 1')).not.toBeNull();
    expect(screen.getByText('Supprimée : 1')).not.toBeNull();
    expect(screen.getByText('Jours à rééditer')).not.toBeNull();
    expect(screen.getByText('Lundi (1)')).not.toBeNull();
    expect(screen.getByText(/similarité 80 %/)).not.toBeNull();

    // Export links point at the compare endpoints.
    const docx = screen.getByText('Exporter la fiche (.docx)') as HTMLAnchorElement;
    expect(docx.getAttribute('href')).toContain('/api/timetables/old-id/compare/new-id/export.docx');
    const csv = screen.getByText('Exporter (.csv)') as HTMLAnchorElement;
    expect(csv.getAttribute('href')).toContain('/export.csv');

    // Highlight callback received the changed cells.
    await waitFor(() => expect(onHighlight).toHaveBeenCalled());
    const cells = onHighlight.mock.calls.at(-1)?.[0] as Set<string>;
    expect(cells.has('A 0-1|8:00-9:30')).toBe(true);

    // Type filter narrows the list.
    const selects = screen.getAllByRole('combobox');
    const typeSelect = selects[2]; // Comparer avec, Vue, type, jour
    fireEvent.change(typeSelect, { target: { value: 'added' } });
    expect(screen.getByText('Prof B — Grp-2 — T2 Physique')).not.toBeNull();
    expect(screen.queryByText('Prof A — Grp-1 — T1 Maths')).toBeNull();

    // Teacher filter.
    fireEvent.change(typeSelect, { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('Enseignant'), { target: { value: 'Prof C' } });
    expect(screen.getByText('Prof C — Grp-3 — T3 Chimie')).not.toBeNull();
    expect(screen.queryByText('Prof A — Grp-1 — T1 Maths')).toBeNull();
  });

  it('shows the empty state when there is no change', async () => {
    const empty: CompareResult = { ...result, summary: { ...result.summary, total: 0, byType: { added: 0, removed: 0, moved: 0, room_changed: 0, group_changed: 0, teachers_changed: 0 } }, changes: [], days: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(empty)));
    render(<ComparePanel timetable={timetable} versions={versions} />);
    await waitFor(() => expect(screen.getByText('Aucun changement entre ces deux versions.')).not.toBeNull());
  });

  it('shows an error message when the comparison fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ message: 'Comparaison impossible' }, false)));
    render(<ComparePanel timetable={timetable} versions={versions} />);
    await waitFor(() => expect(screen.getByText('Comparaison impossible')).not.toBeNull());
  });

  it('prompts to import two versions when only one exists', () => {
    render(<ComparePanel timetable={timetable} versions={[timetable]} />);
    expect(screen.getByText(/Importez au moins deux versions/)).not.toBeNull();
  });
});
