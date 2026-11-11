import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { renderGuide } from '../../../scripts/guide-build.mjs';
import { publishScreenshots } from '../../../scripts/guide-screenshot-assets.mjs';
import Guide from '../app/aide/guide';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const root = path.resolve(__dirname, '../../..');
const temporary: string[] = [];
const sourceFiles = [
  'apps/web/app/page.tsx', 'apps/web/components/ImportPanel.tsx', 'apps/web/components/OptionsPanel.tsx',
  'apps/web/components/NamesPanel.tsx', 'apps/web/components/UpdateBanner.tsx', 'apps/web/lib/api.ts', 'apps/desktop/src/main.ts', 'apps/desktop/src/menu.ts',
  'apps/desktop/src/updater.ts',
];

function fixtureRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-guide-'));
  temporary.push(directory);
  fs.mkdirSync(path.join(directory, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'apps/web/public/guide'), { recursive: true });
  return directory;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('guide build', () => {
  it('renders headings as stable anchors and rewrites a local image path', () => {
    const directory = fixtureRoot();
    fs.writeFileSync(path.join(directory, 'apps/web/public/guide/example.png'), 'fake image');
    const html = renderGuide('# Guide\n\n## Chapitre\n\n[Aller](#chapitre)\n\n![Exemple](../apps/web/public/guide/example.png)', directory);
    expect(html).toContain('id="chapitre"');
    expect(html).toContain('href="#chapitre"');
    expect(html).toContain('src="/guide/example.png"');
    expect(html).toContain('alt="Exemple"');
  });

  it('decodes a percent-encoded image filename before checking it exists', () => {
    const directory = fixtureRoot();
    fs.writeFileSync(path.join(directory, 'apps/web/public/guide/été.png'), 'fake image');
    const html = renderGuide('# Guide\n\n![Été](../apps/web/public/guide/%C3%A9t%C3%A9.png)', directory);
    expect(html).toContain('src="/guide/%C3%A9t%C3%A9.png"');
    expect(html).toContain('alt="Été"');
  });

  it('rejects a broken internal anchor', () => {
    expect(() => renderGuide('# Guide\n\n[Aller](#absent)')).toThrow('Ancre interne introuvable');
  });

  it('rejects a missing image', () => {
    expect(() => renderGuide('# Guide\n\n![Exemple](../apps/web/public/guide/absent.png)')).toThrow('Image manquante');
  });

  it('rejects missing image alternative text', () => {
    expect(() => renderGuide('# Guide\n\n![](../apps/web/public/guide/example.png)')).toThrow('Image sans texte alternatif');
  });

  it('rejects anything other than one H1', () => {
    expect(() => renderGuide('## Sans H1')).toThrow('exactement un titre H1');
    expect(() => renderGuide('# Un\n\n# Deux')).toThrow('exactement un titre H1');
  });
});

describe('guide screenshot publishing', () => {
  it('removes obsolete PNGs only after publishing the complete staged set', () => {
    const directory = fixtureRoot();
    const staged = path.join(directory, 'staged');
    const published = path.join(directory, 'apps/web/public/guide');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'current.png'), 'new capture');
    fs.writeFileSync(path.join(staged, 'added.png'), 'new image');
    fs.writeFileSync(path.join(published, 'current.png'), 'old capture');
    fs.writeFileSync(path.join(published, 'removed.png'), 'obsolete capture');
    fs.writeFileSync(path.join(published, 'keep.txt'), 'unrelated file');

    publishScreenshots(staged, published);

    expect(fs.readFileSync(path.join(published, 'current.png'), 'utf8')).toBe('new capture');
    expect(fs.readFileSync(path.join(published, 'added.png'), 'utf8')).toBe('new image');
    expect(fs.existsSync(path.join(published, 'removed.png'))).toBe(false);
    expect(fs.existsSync(path.join(published, 'keep.txt'))).toBe(true);
  });
});

describe('guide drift protection', () => {
  it('keeps every bracketed UI label as an exact static value in the web or desktop source', () => {
    const guide = fs.readFileSync(path.join(root, 'docs/guide-utilisateur.fr.md'), 'utf8');
    const sourceValues = new Set<string>();
    const addValue = (value: string) => {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (normalized) sourceValues.add(normalized);
    };
    for (const file of sourceFiles) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) addValue(node.text);
        if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) addValue(node.text);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    const labels = [...guide.matchAll(/\*\*\[([^\]]+)\]\*\*/g)].map((match) => match[1]);
    expect(labels.length).toBeGreaterThan(20);
    const missing = [...new Set(labels)].filter((label) => !sourceValues.has(label.replace(/\s+/g, ' ').trim()));
    expect(missing, `Labels absents des sources : ${missing.join(', ')}`).toEqual([]);
  });

  it('documents French error messages surfaced by the API and desktop, or records a reason', () => {
    const guide = fs.readFileSync(path.join(root, 'docs/guide-utilisateur.fr.md'), 'utf8');
    const whitelisted: Record<string, string> = {
      'Le rappel de mise à jour doit être une fonction': 'Invalid preload callback; internal IPC programming error, not an end-user message.',
      'Backend introuvable': 'Packaging integrity error that needs support; the missing backend path is technical and cannot be repaired by staff.',
      'Vous avez la dernière version': 'Informational success message, not an error.',
      'Arguments IPC inattendus': 'Internal IPC validation guard; malformed calls can only come from application code, not a user action.',
      'Chemin de fichier invalide': 'Internal IPC validation guard; the file path is supplied by the application after the native save dialog.',
    };
    const sources = ['apps/api/src', 'apps/desktop/src'].flatMap((directory) => {
      const walk = (current: string): string[] => fs.readdirSync(path.join(root, current), { withFileTypes: true })
        .flatMap((entry) => entry.isDirectory() ? walk(path.join(current, entry.name)) : entry.name.endsWith('.ts') ? [path.join(current, entry.name)] : []);
      return walk(directory);
    });
    const messages = new Set<string>();
    const exceptionNames = /^(?:Error|TypeError|BadRequestException|NotFoundException|InternalServerErrorException|DatabaseVersionMismatchError|DatabaseVersionFileCorruptError)$/;
    const staticMessage = (node: ts.Expression): string => {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
      if (ts.isTemplateExpression(node)) return `${node.head.text} … ${node.templateSpans.map((span) => span.literal.text).join(' … ')}`;
      return '';
    };
    for (const file of sources) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && exceptionNames.test(node.expression.text) && node.arguments?.[0]) {
          const message = staticMessage(node.arguments[0]).replace(/[^\p{L}\p{N}’']+$/gu, '').trim();
          if (message) messages.add(message);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword && node.arguments[0]) {
          const message = staticMessage(node.arguments[0]).replace(/[^\p{L}\p{N}’']+$/gu, '').trim();
          if (message) messages.add(message);
        }
        if (ts.isPropertyAssignment(node) && node.name.getText(ast).replaceAll("'", '').replaceAll('"', '') === 'message' && ts.isExpression(node.initializer)) {
          const message = staticMessage(node.initializer).replace(/[^\p{L}\p{N}’']+$/gu, '').trim();
          if (message) messages.add(message);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    const normalize = (text: string) => text.normalize('NFC').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLocaleLowerCase('fr');
    const normalizedGuide = normalize(guide);
    const missing = [...messages].filter((message) => {
      if (Object.keys(whitelisted).some((prefix) => message.startsWith(prefix))) return false;
      const chunks = message.split(/\s+…\s+|[.!?]\s*/u).map(normalize).filter((chunk) => chunk.replace(/[^\p{L}\p{N}]/gu, '').length >= 4);
      return chunks.some((chunk) => !normalizedGuide.includes(chunk));
    });
    expect(missing, `Messages d’erreur non couverts : ${missing.map((message) => `${message} => ${message.split(/\s+…\s+|[.!?]\s*/u).map(normalize).map((chunk) => `${chunk}:${normalizedGuide.includes(chunk)}`).join(' | ')}`).join(', ')}`).toEqual([]);
    expect(messages.size).toBeGreaterThan(20);
    expect(messages).toContain('Jour invalide');
    expect(messages).toContain('Dossier invalide');
    const invalidWhitelist = Object.entries(whitelisted).filter(([message, reason]) => ![...messages].some((entry) => entry.startsWith(message)) || reason.length <= 10);
    expect(invalidWhitelist).toEqual([]);
  });
});

describe('guide search highlighting', () => {
  it('normalizes text after clearing marks so later queries can span old match boundaries', async () => {
    const { container } = render(<Guide html={'<h1 id="guide">Guide</h1><h2 id="chapitre">Chapitre</h2><p>abcdefgh</p>'} version="1.0.0" />);
    const search = screen.getByRole('searchbox', { name: 'Rechercher dans le guide' });
    fireEvent.change(search, { target: { value: 'cde' } });
    await waitFor(() => expect(container.querySelector('.guide-content mark')?.textContent).toBe('cde'));
    fireEvent.change(search, { target: { value: 'efg' } });
    await waitFor(() => expect(container.querySelector('.guide-content mark')?.textContent).toBe('efg'));
  });
});
