import { detectKind, parseHtml } from '../../parser/html-parser.js';
import { DetectionResult, FileReport, Importer, ImporterResult, UploadedInputFile } from '../types.js';

export class HtmlImporter implements Importer {
  readonly id = 'html' as const;

  detect(file: UploadedInputFile): DetectionResult | null {
    const textPrefix = file.buffer.slice(0, 4096).toString('utf8');
    const isHtmlContent =
      /<!DOCTYPE html/i.test(textPrefix) ||
      /<html/i.test(textPrefix) ||
      /<table[^>]*id=["']table_[a-z0-9_]+["']/i.test(textPrefix) ||
      /Table des mati/i.test(textPrefix);

    const hasHtmlExt = /\.(html?)$/i.test(file.originalname);

    if (!isHtmlContent && !hasHtmlExt) {
      return null;
    }

    const fullText = isHtmlContent ? file.buffer.toString('utf8') : undefined;
    const kind = detectKind(file.originalname, fullText);

    return {
      origin: 'html',
      kind: kind ?? undefined,
      confidence: isHtmlContent ? (kind ? 1.0 : 0.8) : 0.5,
      reason: isHtmlContent
        ? `Contenu HTML détecté (vue : ${kind ?? 'inconnue'})`
        : `Extension HTML avec structure de nom : ${kind ?? 'inconnue'}`,
    };
  }

  async parse(file: UploadedInputFile): Promise<ImporterResult> {
    const html = file.buffer.toString('utf8');
    const kind = detectKind(file.originalname, html);

    if (!kind) {
      throw new Error(
        `Type de fichier HTML inconnu : « ${file.originalname} » (attendu : teachers, rooms ou groups dans le nom ou la table des matières)`,
      );
    }

    const parsed = parseHtml(html, kind);
    if (!parsed.owners.length || !parsed.days.length || !parsed.slots.length) {
      throw new Error(`« ${file.originalname} » ne contient aucun tableau d'emploi du temps valide.`);
    }

    const report: FileReport = {
      fileName: file.originalname,
      origin: 'html',
      kind,
      ownersCount: parsed.owners.length,
      sessionsCount: parsed.sessions.length,
      warnings: [],
      errors: [],
      issues: [],
      stats: {
        totalRows: parsed.sessions.length,
      },
    };

    return {
      parsed: [parsed],
      report,
    };
  }
}
