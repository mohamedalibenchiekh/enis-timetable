import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import JSZip from 'jszip';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  BackupData,
  BackupTableName,
  upgradeBackupData,
  validateRow,
} from './backup-schema.js';
import { BackupManifest, InspectResult, TimetableSummary } from './backup-types.js';

export const MAX_ARCHIVE_SIZE = 200 * 1024 * 1024; // 200 MB
export const MAX_UNCOMPRESSED_SIZE = 250 * 1024 * 1024; // 250 MB
export const MAX_ZIP_RATIO = 100;
export const MAX_ENTRIES_COUNT = 15;

export interface InspectedBackup {
  manifest: BackupManifest;
  data: BackupData;
  inspectResult: InspectResult;
}

export class BackupInspector {
  /**
   * Inspects and hardens an archive buffer against hostile inputs.
   * Throws BadRequestException on any invalidity, corruption, path traversal, or schema violation.
   */
  static async inspectArchive(buffer: Buffer): Promise<InspectedBackup> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Fichier de sauvegarde vide ou manquant.');
    }

    if (buffer.length > MAX_ARCHIVE_SIZE) {
      throw new BadRequestException('L’archive de sauvegarde dépasse la taille maximale autorisée (200 Mo).');
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new BadRequestException('Le fichier sélectionné n’est pas une archive ZIP valide.');
    }

    const fileNames = Object.keys(zip.files);
    if (fileNames.length === 0) {
      throw new BadRequestException('L’archive de sauvegarde est vide.');
    }
    if (fileNames.length > MAX_ENTRIES_COUNT) {
      throw new BadRequestException('L’archive contient un nombre d’entrées anormal.');
    }

    let totalUncompressed = 0;

    // 1. Path-traversal and file naming check
    for (const [key, fileObj] of Object.entries(zip.files)) {
      const originalName = (fileObj as any).unsafeOriginalName || fileObj.name || key;
      if (
        originalName.includes('..') ||
        originalName.startsWith('/') ||
        originalName.startsWith('\\') ||
        originalName.includes(':') ||
        path.isAbsolute(originalName) ||
        originalName.split(/[/\\]/).includes('..')
      ) {
        throw new BadRequestException('L’archive contient des chemins de fichiers interdits (tentative d’évasion).');
      }
      if (originalName.endsWith('/')) {
        // Directory entry
        if (originalName !== 'data/') {
          throw new BadRequestException(`Dossier inattendu dans l’archive : « ${originalName} ».`);
        }
        continue;
      }
      if (originalName === 'manifest.json') continue;

      const match = /^data\/([a-z_]+)\.ndjson$/.exec(originalName);
      if (!match || !BACKUP_TABLES.includes(match[1] as BackupTableName)) {
        throw new BadRequestException(`L’archive contient un fichier inattendu ou non reconnu : « ${originalName} ».`);
      }
    }

    // 2. Manifest check
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new BadRequestException('L’archive ne contient pas de fichier manifest.json.');
    }

    let manifest: BackupManifest;
    try {
      const manifestBuffer = await manifestFile.async('nodebuffer');
      if (manifestBuffer.length > 2 * 1024 * 1024) {
        throw new BadRequestException('Le fichier manifest.json dépasse la taille maximale autorisée.');
      }
      totalUncompressed += manifestBuffer.length;
      manifest = JSON.parse(manifestBuffer.toString('utf8')) as BackupManifest;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Le fichier manifest.json est corrompu ou n’est pas un JSON valide.');
    }

    if (
      !manifest ||
      typeof manifest !== 'object' ||
      typeof manifest.formatVersion !== 'number' ||
      typeof manifest.schemaVersion !== 'number' ||
      !Number.isInteger(manifest.schemaVersion) ||
      manifest.schemaVersion < 1 ||
      typeof manifest.appVersion !== 'string' ||
      !manifest.appVersion.trim() ||
      typeof manifest.createdAt !== 'string' ||
      isNaN(Date.parse(manifest.createdAt)) ||
      !manifest.counts ||
      typeof manifest.counts !== 'object' ||
      !manifest.sha256 ||
      typeof manifest.sha256 !== 'object'
    ) {
      throw new BadRequestException('Le fichier manifest.json est incomplet ou malformé.');
    }

    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BadRequestException(`Format d’archive non pris en charge (format v${manifest.formatVersion}).`);
    }

    if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
      throw new BadRequestException(
        `Cette sauvegarde a été créée avec une version plus récente de l’application (schéma v${manifest.schemaVersion}). Mettez à jour l’application pour pouvoir la restaurer.`,
      );
    }

    for (const table of BACKUP_TABLES) {
      const count = manifest.counts[table];
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new BadRequestException(`Compte invalide dans le manifeste pour la table « ${table} ».`);
      }
    }

    // 3. Decompress, check uncompressed size, verify sha256 and parse rows
    const parsedData: BackupData = {
      timetables: [],
      sessions: [],
      settings: [],
      teacher_names: [],
      room_labels: [],
    };

    for (const table of BACKUP_TABLES) {
      const filePath = `data/${table}.ndjson`;
      const zipEntry = zip.file(filePath);

      if (!zipEntry) {
        throw new BadRequestException(`Fichier de données obligatoire manquant dans l’archive : ${filePath}.`);
      }

      const contentBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytesRead = 0;
        const stream = zipEntry.nodeStream();

        stream.on('data', (chunk: Buffer) => {
          bytesRead += chunk.length;
          totalUncompressed += chunk.length;

          if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
            (stream as any).destroy?.();
            reject(new BadRequestException('Le volume décompressé de l’archive dépasse la limite autorisée.'));
            return;
          }
          if (bytesRead > 10 * 1024 * 1024 && totalUncompressed / buffer.length > MAX_ZIP_RATIO) {
            (stream as any).destroy?.();
            reject(new BadRequestException('Ratio de compression anormal détecté (protection anti zip-bomb).'));
            return;
          }
          chunks.push(chunk);
        });

        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(new BadRequestException(`Erreur lors de la lecture de l’archive : ${err.message}`)));
      });

      // SHA-256 check
      const expectedHash = manifest.sha256?.[filePath];
      if (!expectedHash) {
        throw new BadRequestException(`Somme de contrôle manquante dans le manifeste pour ${filePath}.`);
      }
      const actualHash = createHash('sha256').update(contentBuffer).digest('hex');
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new BadRequestException(
          `Somme de contrôle (SHA-256) invalide pour le fichier ${filePath}. L’archive est corrompue ou a été modifiée.`,
        );
      }

      // Parse NDJSON lines
      const text = contentBuffer.toString('utf8');
      const rawLines = text.split('\n').filter((line) => line.trim().length > 0);

      const expectedCount = manifest.counts?.[table] ?? 0;
      if (rawLines.length !== expectedCount) {
        throw new BadRequestException(
          `Nombre de lignes incohérent pour la table « ${table} » (détecté : ${rawLines.length}, manifest : ${expectedCount}).`,
        );
      }

      for (let i = 0; i < rawLines.length; i++) {
        let parsedLine: unknown;
        try {
          parsedLine = JSON.parse(rawLines[i]);
        } catch {
          throw new BadRequestException(`Ligne ${i + 1} invalide dans ${filePath} : JSON malformé.`);
        }
        try {
          const validated = validateRow(table, parsedLine, i);
          parsedData[table].push(validated);
        } catch (err) {
          throw new BadRequestException((err as Error).message);
        }
      }
    }

    // 4. Upgrade older schema versions if needed
    const data = manifest.schemaVersion < BACKUP_SCHEMA_VERSION
      ? upgradeBackupData(parsedData, manifest.schemaVersion, BACKUP_SCHEMA_VERSION)
      : parsedData;

    // Check for orphan sessions (P1)
    const timetableIds = new Set(data.timetables.map((t: any) => t.id));
    for (let i = 0; i < data.sessions.length; i++) {
      const session = data.sessions[i];
      if (!timetableIds.has(session.timetableId)) {
        throw new BadRequestException(
          `L’archive contient une séance orpheline (ligne ${i + 1}) faisant référence à un emploi du temps inexistant (« ${session.timetableId} »).`,
        );
      }
    }

    // 5. Build summary
    const timetableSummaries: TimetableSummary[] = data.timetables.map((t: any) => ({
      id: t.id,
      name: t.name,
      sessionCount: data.sessions.filter((s: any) => s.timetableId === t.id).length,
      days: t.days || [],
    }));

    const inspectResult: InspectResult = {
      manifest,
      compatibility: {
        compatible: true,
        upgradeRequired: manifest.schemaVersion < BACKUP_SCHEMA_VERSION,
        message:
          manifest.schemaVersion < BACKUP_SCHEMA_VERSION
            ? 'Sauvegarde issue d’une version antérieure (mise à niveau automatique).'
            : 'Sauvegarde compatible avec cette version.',
      },
      summary: {
        timetables: timetableSummaries,
        teacherOverridesCount: data.teacher_names.length,
        roomOverridesCount: data.room_labels.length,
        hasSettings: data.settings.length > 0,
      },
    };

    return { manifest, data, inspectResult };
  }
}

