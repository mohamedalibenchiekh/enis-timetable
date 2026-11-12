import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DayPreview } from '../components/DayPreview';
import { ImportPanel } from '../components/ImportPanel';
import { OptionsPanel } from '../components/OptionsPanel';
import { DayGrid, ExportOptions, ExportProfilesState, Timetable } from '../lib/api';

const grid: DayGrid = {
  day: 0, dayName: 'Lundi', headers: [['08:00-09:30']], sessionCount: 1,
  blocs: [{ title: 'BLOC « A »', rows: [{ room: 'A01', label: 'A 0-1', cells: ['Prof Dupont'] }] }],
};
const options: ExportOptions = {
  optionsVersion: 2,
  blocs: [{ id: 'bloc-a', page: 1, title: 'BLOC « A »', patterns: ['^A\\d\\d'] }],
  abbreviateBen: true, showFrequency: true, pauseLabel: 'Pause', includeEmptyRooms: true,
  cellTemplate: '{teacher}', subjectMode: 'full', subjectMaxLength: 0, groupSeparator: ', ',
  cellFontSize: 10, detailItalic: false, detailSmaller: false,
  orientation: 'portrait', repeatDayHeader: true, showPageTitle: false,
};
const profiles: ExportProfilesState = { optionsVersion: 2, defaultId: 'default', profiles: [{ id: 'default', name: 'Standard', options }] };
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

  it('enables the import button in add/replace mode without loading versions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ message: 'Import impossible' }, false)));
    render(<ImportPanel timetable={timetable} onDone={vi.fn()} />);
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['<html/>'], 'test_rooms.html', { type: 'text/html' })] } });
    const button = screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement;
    // versions stays null in this mode; the button must not wait for it.
    await waitFor(() => expect(button.disabled).toBe(false));
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
  const renderPanel = (onSaved = vi.fn(), onProfilesChange = vi.fn()) => {
    render(
      <OptionsPanel
        profiles={profiles}
        activeProfileId="default"
        onProfilesChange={onProfilesChange}
        onActiveProfileChange={vi.fn()}
        onSaved={onSaved}
      />,
    );
    return { onSaved, onProfilesChange };
  };

  it('toggles options, edits the bloc table, and saves via the profile endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return response({ ...profiles, profiles: [{ id: 'default', name: 'Standard', options: body.options ?? options }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved, onProfilesChange } = renderPanel();

    const frequency = await screen.findByLabelText(/Afficher « 1\/15 »/);
    fireEvent.click(frequency);
    // Add a bloc via the table's add button.
    fireEvent.click(screen.getByRole('button', { name: '+ ajouter un bloc' }));
    expect(screen.getAllByDisplayValue(/BLOC/)).toHaveLength(2);
    // Remove the second bloc.
    const removeButtons = screen.getAllByText('supprimer');
    fireEvent.click(removeButtons[removeButtons.length - 1]);

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.getByText('Options enregistrées')).not.toBeNull());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onProfilesChange).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/export-profiles/default');
    const body = JSON.parse(String(init.body));
    expect(body.options.showFrequency).toBe(false);
    expect(body.options.blocs).toHaveLength(1);
  });

  it('switches the cell template preset', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderPanel();
    const preset = await screen.findByRole('button', { name: 'Enseignant + groupe' });
    fireEvent.click(preset);
    const textarea = screen.getByLabelText(/Modèle de cellule/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('{teacher}\n{group}');
  });
});
