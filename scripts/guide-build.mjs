import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'docs/guide-utilisateur.fr.md');
const outputPath = path.join(root, 'apps/web/generated/guide.json');

function slug(text) {
  return text.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

export function renderGuide(markdown, projectRoot = root) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const tokens = md.parse(markdown, {});
  const headings = tokens.filter((token) => token.type === 'heading_open');
  if (headings.filter((token) => token.tag === 'h1').length !== 1) throw new Error('Le guide doit contenir exactement un titre H1.');
  const headingIds = new Set();
  const headingByToken = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'inline' && i > 0 && tokens[i - 1].type === 'heading_open') {
      const text = tokens[i].content;
      const base = slug(text) || 'section';
      let id = base;
      let suffix = 2;
      while (headingIds.has(id)) id = `${base}-${suffix++}`;
      headingIds.add(id);
      headingByToken.set(tokens[i - 1], id);
    }
  }
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const id = headingByToken.get(token);
    if (id) token.attrSet('id', id);
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const alt = token.content.trim();
    if (!alt) throw new Error(`Image sans texte alternatif : ${src}`);
    if (!src || /^(?:https?:)?\/\//i.test(src)) throw new Error(`L’image doit être locale : ${src}`);
    const imagePath = path.resolve(path.dirname(path.join(projectRoot, 'docs/guide-utilisateur.fr.md')), src);
    const publicRoot = path.join(projectRoot, 'apps/web/public');
    const relativePublicPath = path.relative(publicRoot, imagePath);
    if (relativePublicPath.startsWith('..') || path.isAbsolute(relativePublicPath)) throw new Error(`Image hors du dossier public : ${src}`);
    if (!fs.existsSync(imagePath)) throw new Error(`Image manquante : ${src}`);
    token.attrSet('src', `/${relativePublicPath.split(path.sep).join('/')}`);
    return self.renderToken(tokens, idx, options);
  };
  const html = md.renderer.render(tokens, md.options, {});
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const [, anchor] of html.matchAll(/\shref="#([^"]+)"/g)) {
    if (!ids.has(anchor)) throw new Error(`Ancre interne introuvable : #${anchor}`);
  }
  return html;
}

export function buildGuide(projectRoot = root) {
  const markdown = fs.readFileSync(path.join(projectRoot, 'docs/guide-utilisateur.fr.md'), 'utf8');
  const html = renderGuide(markdown, projectRoot);
  const output = path.join(projectRoot, 'apps/web/generated/guide.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const desktop = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps/desktop/package.json'), 'utf8'));
  fs.writeFileSync(output, JSON.stringify({ html, version: desktop.version }));
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Guide généré : ${path.relative(root, buildGuide())}`);
}
