import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChangelogDialog } from '../components/ChangelogDialog';
import type { ChangelogEntry } from '../components/ChangelogDialog';

const SAMPLE_ENTRIES: ChangelogEntry[] = [
  {
    version: '1.4.0',
    date: '2026-11-26',
    sections: [
      { title: 'Ajouté', items: ['Nouvelle fonctionnalité **A**'] },
      { title: 'Corrigé', items: ['Correction du bogue B'] },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-01',
    sections: [
      { title: 'Modifié', items: ['Comportement C modifié'] },
    ],
  },
];

describe('ChangelogDialog', () => {
  it('renders the title with the current version', () => {
    render(
      <ChangelogDialog
        entries={[SAMPLE_ENTRIES[0]]}
        currentVersion="1.4.0"
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('Nouveautés de la version 1.4.0')).toBeTruthy();
  });

  it('renders section titles and items', () => {
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} />);
    expect(screen.getByText('Ajouté')).toBeTruthy();
    expect(screen.getByText('Corrigé')).toBeTruthy();
    expect(screen.getByText('Modifié')).toBeTruthy();
  });

  it('renders "Compris" button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: 'Compris' });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not render "Compris" button when onDismiss is absent', () => {
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} />);
    expect(screen.queryByRole('button', { name: 'Compris' })).toBeNull();
  });

  it('calls onDismiss when backdrop is clicked', () => {
    const onDismiss = vi.fn();
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} onDismiss={onDismiss} />);
    const backdrop = document.querySelector('.cl-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when close × button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} onDismiss={onDismiss} />);
    const closeBtn = screen.getByRole('button', { name: 'Fermer' });
    fireEvent.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders "Aucune note de version disponible." for empty entries', () => {
    render(<ChangelogDialog entries={[]} onDismiss={vi.fn()} />);
    expect(screen.getByText('Aucune note de version disponible.')).toBeTruthy();
  });

  it('shows the latest entry open by default (details[open])', () => {
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} />);
    const details = document.querySelectorAll('details');
    // First entry should be open
    expect(details[0].hasAttribute('open')).toBe(true);
    // Second entry should be closed
    expect(details[1].hasAttribute('open')).toBe(false);
  });

  it('renders section icon text labels (not colour-only)', () => {
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} />);
    // Icon spans are aria-hidden; the title text is still visible
    const sections = document.querySelectorAll('.cl-section-title');
    const texts = Array.from(sections).map((el) => el.textContent ?? '');
    expect(texts.some((t) => t.includes('Ajouté'))).toBe(true);
  });

  it('has role=dialog and aria-modal', () => {
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} onDismiss={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('has aria-labelledby pointing to title', () => {
    render(<ChangelogDialog entries={SAMPLE_ENTRIES} onDismiss={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelId!)).toBeTruthy();
  });
});
