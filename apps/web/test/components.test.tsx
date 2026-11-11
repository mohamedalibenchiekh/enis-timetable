import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DayPreview } from '../components/DayPreview';
import { ImportPanel } from '../components/ImportPanel';
import { OptionsPanel } from '../components/OptionsPanel';
import { DayGrid, ExportOptions, Timetable } from '../lib/api';

const grid: DayGrid = {
  day: 0, dayName: 'Lundi', headers: [['08:00-09:30']], sessionCount: 1,
  blocs: [{ title: 'BLOC « A »', rows: [{ room: 'A01', label: 'A 0-1', cells: ['Prof Dupont'] }] }],
};
const options: ExportOptions = {
  blocs: [{ title: 'BLOC « A »', patterns: ['^A\\d\\d'] }],
  abbreviateBen: true, showFrequency: true, pauseLabel: 'Pause', includeEmptyRooms: true,
};
const timetable = { id: 'fixture-id', name: 'S1 test' } as Timetable;
const response = (body: unknown, ok = true) => ({ ok, statusText: 'Bad Request', json: async () => body });

describe('ImportPanel', () => {
  it('shows detected kinds, removes a file, and displays an upload error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ message: 'Import impossible' }, false));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    render(<ImportPanel onDone={onDone} />);
    const input = document.querySelector('input[type="file"]')!;
    const rooms = new File(['<html/>'], 'test_rooms.html', { type: 'text/html' });
    const groups = new File(['<html/>'], 'test_groups.html', { type: 'text/html' });
    fireEvent.change(input, { target: { files: [rooms, groups] } });
    expect(screen.getByText('Salles')).not.toBeNull();
    expect(screen.getByText('Groupes')).not.toBeNull();
    fireEvent.click(screen.getAllByText('retirer')[0]);
    expect(screen.queryByText('test_rooms.html')).toBeNull();
    // The version list lookup must settle before the import button is enabled.
    await waitFor(() => expect(screen.getByText(/Impossible de charger les versions/)).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(screen.getByText('Import impossible')).not.toBeNull());
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('DayPreview', () => {
  it('shows loading, error, and the returned preview table', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<DayPreview id="fixture-id" day={0} refreshKey={0} />);
    expect(screen.getByText('Chargement…')).not.toBeNull();
    resolveFetch(response(grid) as Response);
    await waitFor(() => expect(screen.getByText('Prof Dupont')).not.toBeNull());
    expect(screen.getByText('Lundi')).not.toBeNull();
    view.unmount();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ message: 'Aperçu indisponible' }, false)));
    render(<DayPreview id="fixture-id" day={0} refreshKey={1} />);
    await waitFor(() => expect(screen.getByText('Aperçu indisponible')).not.toBeNull());
  });
});

describe('OptionsPanel', () => {
  it('toggles options, adds/removes a bloc, and saves the edited options', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(options))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => response(JSON.parse(String(init.body))));
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    render(<OptionsPanel onSaved={onSaved} />);
    const frequency = await screen.findByLabelText(/Afficher « 1\/15 »/);
    fireEvent.click(frequency);
    fireEvent.click(screen.getByRole('button', { name: '+ ajouter un bloc' }));
    expect(screen.getAllByDisplayValue(/BLOC/)).toHaveLength(2);
    fireEvent.click(screen.getAllByText('supprimer')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.getByText('Options enregistrées')).not.toBeNull());
    expect(onSaved).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(body.showFrequency).toBe(false);
    expect(body.blocs).toHaveLength(1);
  });
});
