/**
 * Minimal safe Markdown renderer for release notes.
 *
 * Renders only: headings (##/###), bold (**text**), unordered lists (- item),
 * and inline links ([text](url)).  Images, raw HTML, scripts, and non-https
 * links are stripped or neutralised. Output is a plain HTML string suitable
 * for injection into an Electron BrowserWindow that has nodeIntegration:false
 * and sandbox:true.
 *
 * Line-length is capped at 2 000 characters per line; the total input is
 * capped at 500 KB before processing.
 */

const MAX_INPUT_BYTES = 500 * 1024;
const MAX_LINE_LENGTH = 2_000;

/** Escape HTML special chars in a plain-text string. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Allowed URL schemes for links. */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https:\/\//i.test(trimmed);
}

/**
 * Render inline markdown within a single line of text:
 *  - **bold** → <strong>
 *  - [text](url) → <a href="url"> (https only; others become plain text)
 *  - everything else is HTML-escaped
 *
 * Images (![...](url)) are stripped entirely.
 */
function renderInline(text: string): string {
  // Work on segments to avoid nested regex confusion
  let result = '';
  let remaining = text;

  while (remaining.length > 0) {
    // Image: strip entirely  ![alt](url)
    const imgMatch = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(remaining);
    if (imgMatch) {
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(remaining);
    if (linkMatch) {
      const linkText = esc(linkMatch[1]);
      const url = linkMatch[2].trim();
      if (isSafeUrl(url)) {
        result += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
      } else {
        // Non-https link: render as plain text (no href)
        result += linkText;
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = /^\*\*([^*]+)\*\*/.exec(remaining);
    if (boldMatch) {
      result += `<strong>${esc(boldMatch[1])}</strong>`;
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* or _text_ — render as <em>
    const emMatch = /^(\*|_)([^*_]+)\1/.exec(remaining);
    if (emMatch) {
      result += `<em>${esc(emMatch[2])}</em>`;
      remaining = remaining.slice(emMatch[0].length);
      continue;
    }

    // Inline code: `text`
    const codeMatch = /^`([^`]+)`/.exec(remaining);
    if (codeMatch) {
      result += `<code>${esc(codeMatch[1])}</code>`;
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Advance one character (escaped)
    result += esc(remaining[0]);
    remaining = remaining.slice(1);
  }

  return result;
}

/**
 * Render a Markdown string to a safe HTML fragment.
 * Only structural elements recognised: headings ##/###, lists (- item),
 * blank lines (paragraph break). Everything else is treated as text.
 */
export function renderMarkdown(markdown: string): string {
  if (markdown.length > MAX_INPUT_BYTES) {
    markdown = markdown.slice(0, MAX_INPUT_BYTES);
  }

  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let inList = false;

  for (let rawLine of lines) {
    // Cap line length
    if (rawLine.length > MAX_LINE_LENGTH) rawLine = rawLine.slice(0, MAX_LINE_LENGTH);

    // Strip only well-formed HTML tags (opening or closing, with tag name starting with a letter)
    // to avoid eating plain-text uses of < and >.
    const stripped = rawLine.replace(/<\/?[a-zA-Z][^>]*>/g, '');

    const trimmed = stripped.trim();

    // Blank line
    if (!trimmed) {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      continue;
    }

    // ## Heading (level 2)
    const h2 = /^##\s+(.+)$/.exec(trimmed);
    if (h2) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<h2>${renderInline(h2[1])}</h2>`);
      continue;
    }

    // ### Heading (level 3)
    const h3 = /^###\s+(.+)$/.exec(trimmed);
    if (h3) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<h3>${renderInline(h3[1])}</h3>`);
      continue;
    }

    // #### Heading (level 4) — treat as strong paragraph
    const h4 = /^####\s+(.+)$/.exec(trimmed);
    if (h4) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<p><strong>${renderInline(h4[1])}</strong></p>`);
      continue;
    }

    // List item
    const li = /^[-*]\s+(.+)$/.exec(trimmed);
    if (li) {
      if (!inList) { output.push('<ul>'); inList = true; }
      output.push(`<li>${renderInline(li[1])}</li>`);
      continue;
    }

    // Paragraph text
    if (inList) { output.push('</ul>'); inList = false; }
    output.push(`<p>${renderInline(trimmed)}</p>`);
  }

  if (inList) output.push('</ul>');

  return output.join('\n');
}
