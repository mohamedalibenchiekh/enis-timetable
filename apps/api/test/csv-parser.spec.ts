import { describe, expect, it } from 'vitest';
import { parseCsv, sniffDelimiter } from '../src/importers/csv/csv-parser.js';

describe('RFC 4180 CSV parser suite', () => {
  it('parses basic comma-separated rows', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles CRLF line endings', () => {
    const csv = 'col1,col2\r\nval1,val2\r\nval3,val4';
    expect(parseCsv(csv)).toEqual([
      ['col1', 'col2'],
      ['val1', 'val2'],
      ['val3', 'val4'],
    ]);
  });

  it('strips UTF-8 BOM', () => {
    const csv = '\uFEFF"Activity Id","Day","Hour"\n"1","Lundi","08:30"';
    expect(parseCsv(csv)).toEqual([
      ['Activity Id', 'Day', 'Hour'],
      ['1', 'Lundi', '08:30'],
    ]);
  });

  it('handles quotes with commas and newlines inside', () => {
    const csv = '"field 1","field with, comma","field with\nnewline"\n"val1","val2","val3"';
    expect(parseCsv(csv)).toEqual([
      ['field 1', 'field with, comma', 'field with\nnewline'],
      ['val1', 'val2', 'val3'],
    ]);
  });

  it('handles escaped quotes (doubled quotes "")', () => {
    const csv = '"hello ""world""","test"';
    expect(parseCsv(csv)).toEqual([['hello "world"', 'test']]);
  });

  it('sniffs semicolon and tab delimiters', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('"a";"b";"c"\n"1";"2";"3"')).toBe(';');

    const semiCsv = 'id;nom;salle\n10;Maths;A01';
    expect(parseCsv(semiCsv)).toEqual([
      ['id', 'nom', 'salle'],
      ['10', 'Maths', 'A01'],
    ]);
  });

  it('throws on unclosed quotes', () => {
    expect(() => parseCsv('"unclosed quote,val2\n1,2')).toThrow(/Guillemet non fermé/);
  });

  it('rejects oversized inputs', () => {
    const big = Buffer.alloc(2000, 'x');
    expect(() => parseCsv(big, { maxSizeBytes: 1000 })).toThrow(/dépasse la taille maximale/);
  });

  it('rejects row count exceeding limit', () => {
    const manyRows = 'a\n'.repeat(50);
    expect(() => parseCsv(manyRows, { maxRows: 20 })).toThrow(/dépasse le nombre maximal/);
  });

  it('rejects row count exceeding limit when final row has no newline', () => {
    const rowsNoTrailingNewline = 'a\n'.repeat(19) + 'a';
    expect(() => parseCsv(rowsNoTrailingNewline, { maxRows: 19 })).toThrow(/dépasse le nombre maximal/);
  });

  it('rejects character after closing quote', () => {
    expect(() => parseCsv('"a"x,b')).toThrow(/Caractère inattendu après la fermeture des guillemets/);
  });

  it('rejects quote inside unquoted field', () => {
    expect(() => parseCsv('a"b,c')).toThrow(/Guillemet non valide dans un champ non entre guillemets/);
  });
});
