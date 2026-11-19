import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramsPanel } from '../components/ProgramsPanel';
import { ProgramAnalysis, Timetable } from '../lib/api';

const slots = Array.from({ length: 6 }, (_, index) => ({ raw: `Slot ${index}`, base: `${8 + index}:00-${9 + index}:00`, overrides: {}, note: '' }));
const timetable = (id: string, name: string, count: number): Timetable => ({
  id, name, institution: 'ENISo', comment: '', generatedAt: '', days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  slots: slots.slice(0, count), rooms: [], files: [], createdAt: '2026-01-01',
});
const session = (id: string, slot: number) => ({
  id, day: 0, slot, slotSpan: 1, daySpan: 1, title: `Matière ${slot}`, code: 'MAT', teachers: ['Prof Benali'], teacherKeys: ['prof benali'],
  room: 'A01', roomUnassigned: false, locationNote: '', frequency: '', tags: ['TD'], customTime: null, color: null,
  note: '', rawText: 'Texte source', confidence: 1, reasons: [], source: 'docx' as const,
});
const analysis: ProgramAnalysis = {
  code: 'M1-IA', title: 'Intelligence artificielle', kind: 'Master', academicYear: '2026-2027', semester: 'S1',
  coordinator: '', formRef: '', effectiveFrom: '', footerText: '', version: 'v1.2',
  slots: slots.map((slot, index) => ({ index, label: slot.base, rawLabel: slot.raw, base: slot.base, dayOverrides: {}, note: '' })),
  sessions: [session('one', 0), session('two', 1)], warnings: ['Conflit de salle : A01 · Matière 0 · 1/1'], confidence: 1,
  rawSnapshot: { conflicts: [{ day: 0, slot: 0, type: 'room', resource: 'A01', title: 'Matière 0' }] }, source: 'docx',
};
const response = (body: unknown, status = 200) => ({ ok: status < 400, statusText: status === 200 ? 'OK' : 'Internal Server Error', json: async () => body });

function installApi() {
  let savedPayload: { program: ProgramAnalysis; mode: string } | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/timetables') return response([timetable('five', 'Emploi cinq créneaux', 5), timetable('six', 'Emploi six créneaux', 6)]);
    if (url === '/api/programs' && init?.method === 'POST') {
      savedPayload = JSON.parse(String(init.body)) as { program: ProgramAnalysis; mode: string };
      return response({ ...savedPayload.program, id: 'saved-id', revision: 1, isCurrent: true, createdAt: '', updatedAt: '' });
    }
    if (url === '/api/programs/analyze') return response([analysis]);
    if (url === '/api/programs') return response([]);
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, getSavedPayload: () => savedPayload };
}

describe('ProgramsPanel', () => {
  beforeEach(() => installApi());

  it('limits reference timetables to six slots and accepts file drops and Space activation', async () => {
    const { container } = render(<ProgramsPanel />);
    const select = await screen.findByLabelText('Référence des créneaux');
    expect(screen.queryByRole('option', { name: 'Emploi cinq créneaux' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Emploi six créneaux' })).not.toBeNull();

    const zone = screen.getByRole('button', { name: /Glissez les emplois du temps ici/ });
    const file = new File(['docx'], 'master.docx');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(await screen.findByText('master.docx')).not.toBeNull();

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const click = vi.spyOn(fileInput!, 'click');
    fireEvent.keyDown(zone, { key: ' ' });
    expect(click).toHaveBeenCalledOnce();
    expect(select).not.toBeNull();
  });

  it('keeps comma input editable, renders shared datalists once, and invalidates conflicts after room edits', async () => {
    const { getSavedPayload } = installApi();
    render(<ProgramsPanel />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['docx'], 'master.docx')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyser les fichiers' }));
    const teachers = await screen.findAllByLabelText('Enseignants');
    expect(document.querySelectorAll('datalist#teachers-0')).toHaveLength(1);
    expect(document.querySelectorAll('datalist#rooms-0')).toHaveLength(1);

    fireEvent.change(teachers[0], { target: { value: 'Prof Benali, ' } });
    expect((teachers[0] as HTMLInputElement).value).toBe('Prof Benali, ');
    fireEvent.change(screen.getAllByLabelText('Salle')[0], { target: { value: 'A02' } });
    expect(screen.getByText('Les conflits doivent être vérifiés à nouveau après modification des enseignants ou salles.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le programme' }));

    await waitFor(() => expect(getSavedPayload()).toBeDefined());
    const payload = getSavedPayload()!;
    expect(payload.program.sessions[0].teachers).toEqual(['Prof Benali']);
    expect(payload.program.sessions[0].room).toBe('A02');
    expect(payload.program.warnings).toContain('Les conflits doivent être vérifiés à nouveau après modification des enseignants ou salles.');
    expect(payload.program.warnings).not.toContain('Conflit de salle : A01 · Matière 0 · 1/1');
    expect(payload.program.rawSnapshot).not.toHaveProperty('conflicts');
  });

  it('shows saved-program loading failures instead of treating them as an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/programs'
      ? response({ message: 'Programmes temporarily unavailable' }, 500)
      : response([])));
    render(<ProgramsPanel />);
    expect((await screen.findByRole('alert')).textContent).toContain('Programmes temporarily unavailable');
  });
});
