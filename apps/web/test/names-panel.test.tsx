import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NamesPanel } from '../components/NamesPanel';
import { NameEntry, NameList } from '../lib/api';

const teacherRows: NameEntry[] = [
  { key: 'prof benali', sourceName: 'Prof Benali', autoName: 'Prof Benali', displayName: 'B. Benali', sessions: 2 },
  { key: 'prof dupont', sourceName: 'Prof Dupont', autoName: 'Prof Dupont', displayName: null, sessions: 3 },
];
const roomRows: NameEntry[] = [
  { key: 'a01', sourceName: 'A01', autoName: 'A 0-1', displayName: null, sessions: 4, bloc: 'BLOC A' },
];
const list = (items: NameEntry[]): NameList => ({ items, unused: [] });

function installNamesApi() {
  const state = { teachers: list(teacherRows), rooms: list(roomRows) };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/names/teachers?')) return response(state.teachers);
    if (method === 'GET' && url.includes('/names/rooms?')) return response(state.rooms);
    if (method === 'PUT') {
      const kind = url.endsWith('/teachers') ? 'teachers' : 'rooms';
      const body = JSON.parse(String(init?.body)) as { items: { sourceName: string; displayName: string }[] };
      state[kind] = list(state[kind].items.map((entry) => {
        const change = body.items.find((item) => item.sourceName === entry.sourceName);
        return change ? { ...entry, displayName: change.displayName || null } : entry;
      }));
      return response({ ok: true, saved: body.items.length });
    }
    if (method === 'POST' && url.includes('/names/import')) return response({ added: 1, updated: 2, ignored: 0 });
    if (method === 'GET' && url.endsWith('/names/export')) return response({ version: 1, teachers: [], rooms: [] });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}

const response = (body: unknown) => ({
  ok: true,
  statusText: 'OK',
  json: async () => body,
});

describe('NamesPanel', () => {
  beforeEach(() => installNamesApi());

  it('edits a name, shows the dirty bar, supports Escape and cancel', async () => {
    render(<NamesPanel id="fixture-id" onSaved={vi.fn()} />);
    const input = await screen.findByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' });
    fireEvent.change(input, { target: { value: 'Dupont Jean' } });
    expect(screen.getByText('1 modification')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { value: 'Dupont Jean' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('1 modification')).toBeNull();
  });

  it('warns about duplicate teacher display names', async () => {
    render(<NamesPanel id="fixture-id" onSaved={vi.fn()} />);
    const input = await screen.findByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' });
    fireEvent.change(input, { target: { value: 'B. Benali' } });
    expect(screen.getByText(/deux enseignants auront le même nom affiché/)).not.toBeNull();
  });

  it('searches names and moves focus to the next visible row with Enter', async () => {
    render(<NamesPanel id="fixture-id" onSaved={vi.fn()} />);
    const first = await screen.findByRole('textbox', { name: 'Affiché dans Word pour Prof Benali' });
    const next = screen.getByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(document.activeElement).toBe(next);
    fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: 'Dupont' } });
    expect(screen.queryByRole('textbox', { name: 'Affiché dans Word pour Prof Benali' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' })).not.toBeNull();
  });

  it('resets an override, saves changes, and filters to modified names', async () => {
    const { fetchMock } = installNamesApi();
    render(<NamesPanel id="fixture-id" onSaved={vi.fn()} />);
    await screen.findByRole('textbox', { name: 'Affiché dans Word pour Prof Benali' });
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Modifiés seulement' })[0]);
    expect(screen.queryByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser Prof Benali' }));
    expect(screen.getByText('1 modification')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.getByText('Noms enregistrés')).not.toBeNull());
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Modifiés seulement' })[0]);
    const updated = screen.getByRole('textbox', { name: 'Affiché dans Word pour Prof Benali' });
    expect((updated as HTMLInputElement).value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith('/api/names/teachers', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ items: [{ sourceName: 'Prof Benali', displayName: '' }] }),
    }));
  });

  it('shows the import result summary', async () => {
    render(<NamesPanel id="fixture-id" onSaved={vi.fn()} />);
    await screen.findByRole('button', { name: 'Importer des noms…' });
    const file = new File(['{"version":1,"teachers":[],"rooms":[]}'], 'noms.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Choisir un fichier de noms'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('Import terminé : 1 ajout, 2 actualisations, 0 ignorés')).not.toBeNull());
  });

  it('filters by pending display names and preserves drafts when rows are hidden', async () => {
    render(<NamesPanel id="fixture-id" onSaved={vi.fn()} />);
    const input = await screen.findByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' });
    fireEvent.change(input, { target: { value: 'Dupont corrigé' } });
    fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: 'corrigé' } });
    const filtered = screen.getByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' });
    expect((filtered as HTMLInputElement).value).toBe('Dupont corrigé');
    fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: 'aucun résultat' } });
    expect(screen.queryByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' })).toBeNull();
    fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: '' } });
    const restored = screen.getByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' });
    expect((restored as HTMLInputElement).value).toBe('Dupont corrigé');
  });
});
