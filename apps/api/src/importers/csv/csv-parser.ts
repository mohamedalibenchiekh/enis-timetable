export interface CsvParseOptions {
  maxSizeBytes?: number;
  maxRows?: number;
}

const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_ROWS = 50_000;

export function sniffDelimiter(sample: string): string {
  // Sniff delimiter outside quotes from the first line
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;

  for (let i = 0; i < sample.length; i++) {
    const char = sample[i];
    if (char === '"') {
      if (inQuotes && sample[i + 1] === '"') {
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (char === '\n' || char === '\r') {
        break; // evaluate first line
      } else if (char === ',') commas++;
      else if (char === ';') semicolons++;
      else if (char === '\t') tabs++;
    }
  }

  if (semicolons > commas && semicolons > tabs) return ';';
  if (tabs > commas && tabs > semicolons) return '\t';
  return ',';
}

/**
 * Robust RFC 4180 compliant CSV parser.
 * Handles BOM, CRLF/LF, delimiters, quotes, doubled quotes, and newlines inside quoted fields.
 */
export function parseCsv(input: string | Buffer, options: CsvParseOptions = {}): string[][] {
  const maxBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const rawBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (rawBuffer.length > maxBytes) {
    throw new Error(
      `Le fichier CSV dépasse la taille maximale autorisée de ${(maxBytes / (1024 * 1024)).toFixed(0)} Mo.`,
    );
  }

  let text = rawBuffer.toString('utf8');
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  if (!text.trim()) {
    return [];
  }

  const delimiter = sniffDelimiter(text);

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let fieldQuoted = false;
  let closedQuote = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          // Escaped quote: ""
          currentField += '"';
          i += 2;
        } else {
          // Closing quote
          inQuotes = false;
          closedQuote = true;
          i++;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (closedQuote) {
        if (char === delimiter) {
          currentRow.push(currentField);
          currentField = '';
          fieldQuoted = false;
          closedQuote = false;
          i++;
        } else if (char === '\r') {
          if (i + 1 < len && text[i + 1] === '\n') {
            i += 2;
          } else {
            i++;
          }
          currentRow.push(currentField);
          currentField = '';
          fieldQuoted = false;
          closedQuote = false;
          rows.push(currentRow);
          currentRow = [];
          if (rows.length > maxRows) {
            throw new Error(`Le fichier CSV dépasse le nombre maximal de ${maxRows} lignes.`);
          }
        } else if (char === '\n') {
          currentRow.push(currentField);
          currentField = '';
          fieldQuoted = false;
          closedQuote = false;
          rows.push(currentRow);
          currentRow = [];
          i++;
          if (rows.length > maxRows) {
            throw new Error(`Le fichier CSV dépasse le nombre maximal de ${maxRows} lignes.`);
          }
        } else {
          throw new Error('Caractère inattendu après la fermeture des guillemets (format RFC 4180 invalide).');
        }
      } else if (char === '"') {
        if (currentField.length === 0) {
          fieldQuoted = true;
          inQuotes = true;
          i++;
        } else {
          throw new Error('Guillemet non valide dans un champ non entre guillemets (format RFC 4180 invalide).');
        }
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        fieldQuoted = false;
        closedQuote = false;
        i++;
      } else if (char === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        fieldQuoted = false;
        closedQuote = false;
        rows.push(currentRow);
        currentRow = [];
        if (rows.length > maxRows) {
          throw new Error(`Le fichier CSV dépasse le nombre maximal de ${maxRows} lignes.`);
        }
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        fieldQuoted = false;
        closedQuote = false;
        rows.push(currentRow);
        currentRow = [];
        i++;
        if (rows.length > maxRows) {
          throw new Error(`Le fichier CSV dépasse le nombre maximal de ${maxRows} lignes.`);
        }
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Push final field and row if any content remains
  if (inQuotes) {
    throw new Error('Guillemet non fermé à la fin du fichier CSV (format RFC 4180 invalide).');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
    if (rows.length > maxRows) {
      throw new Error(`Le fichier CSV dépasse le nombre maximal de ${maxRows} lignes.`);
    }
  }

  // Trim trailing empty rows
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) {
    rows.pop();
  }

  return rows;
}
