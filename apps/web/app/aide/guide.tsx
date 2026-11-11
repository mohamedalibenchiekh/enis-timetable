'use client';

import { useEffect, useMemo, useState } from 'react';

type Heading = { id: string; text: string; level: number; chapter: string; content: string };

export default function Guide({ html, version }: { html: string; version: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.guide-content');
    if (!root) return;
    const chapters = [...root.querySelectorAll<HTMLElement>('h2')];
    const items: Heading[] = [];
    for (const chapter of chapters) {
      const chapterItem: Heading = { id: chapter.id, text: chapter.textContent ?? '', level: 2, chapter: chapter.id, content: '' };
      items.push(chapterItem);
      let next = chapter.nextElementSibling;
      const chapterElements: HTMLElement[] = [];
      while (next && next.tagName !== 'H2') {
        if (next instanceof HTMLElement) {
          chapterElements.push(next);
          if (/^H[3-6]$/.test(next.tagName)) {
            items.push({ id: next.id, text: next.textContent ?? '', level: 3, chapter: chapter.id, content: '' });
          }
        }
        next = next.nextElementSibling;
      }
      chapterItem.content = `${chapter.textContent ?? ''} ${chapterElements.map((element) => element.textContent ?? '').join(' ')}`.toLocaleLowerCase('fr');
    }
    setHeadings(items);
  }, []);

  const visibleChapters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    return new Set(headings.filter((item) => item.level === 2).filter((item) => {
      if (!normalized) return true;
      return item.content.includes(normalized);
    }).map((item) => item.chapter));
  }, [headings, query]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.guide-content');
    if (!root || !headings.length) return;
    for (const heading of root.querySelectorAll<HTMLElement>('h2')) {
      heading.hidden = !visibleChapters.has(heading.id);
      let sibling = heading.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2') {
        if (sibling instanceof HTMLElement) sibling.hidden = heading.hidden;
        sibling = sibling.nextElementSibling;
      }
    }
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedParents = new Set<Node>();
    for (const mark of root.querySelectorAll('mark[data-guide-search]')) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
        normalizedParents.add(parent);
      }
    }
    for (const parent of normalizedParents) parent.normalize();
    if (escaped) {
      const expression = new RegExp(escaped, 'giu');
      const containsExpression = new RegExp(escaped, 'iu');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          return parent && !parent.closest('script, style, mark') && containsExpression.test(node.textContent ?? '')
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      for (const node of textNodes) {
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of node.textContent!.matchAll(expression)) {
          const start = match.index!;
          if (start > cursor) fragment.append(node.textContent!.slice(cursor, start));
          const mark = document.createElement('mark');
          mark.dataset.guideSearch = 'true';
          mark.textContent = match[0];
          fragment.append(mark);
          cursor = start + match[0].length;
        }
        if (cursor < node.textContent!.length) fragment.append(node.textContent!.slice(cursor));
        node.replaceWith(fragment);
      }
    }
  }, [headings, query, visibleChapters]);

  return (
    <div id="top" className="guide-shell">
      <a className="guide-skip" href="#guide-main">Aller au contenu</a>
      <header className="guide-top">
        <a href="/" className="guide-return">← Retour à l’application</a>
        <button className="guide-toc-toggle" type="button" aria-expanded={open} aria-controls="guide-toc" onClick={() => setOpen((value) => !value)}>
          Sommaire
        </button>
      </header>
      <div className="guide-layout">
        <aside id="guide-toc" className={`guide-nav ${open ? 'is-open' : ''}`} aria-label="Sommaire du guide">
          <label className="guide-search-label" htmlFor="guide-search">Rechercher dans le guide</label>
          <input id="guide-search" className="guide-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. télécharger" />
          <nav aria-label="Chapitres">
            <ul>{headings.map((item) => visibleChapters.has(item.chapter) && (
              <li key={item.id} className={item.level === 3 ? 'guide-subitem' : undefined}>
                <a href={`#${item.id}`} onClick={() => setOpen(false)}>{item.text}</a>
              </li>
            ))}</ul>
          </nav>
          <a className="guide-print" href="#" onClick={(event) => { event.preventDefault(); window.print(); }}>Imprimer / enregistrer en PDF</a>
        </aside>
        <main id="guide-main" className="guide-content" tabIndex={-1} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <footer className="guide-footer"><span>Emplois du temps ENISo · version {version}</span><a href="#top">Haut de page</a></footer>
      <a className="guide-back-top" href="#top">Haut de page</a>
    </div>
  );
}
