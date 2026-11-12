import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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

    // 1. Path-traversal and file naming check
    for (const name of fileNames) {
      if (name.includes('..') || name.startsWith('/') || name.startsWith('\\') || name.includes(':')) {
        throw new BadRequestException('L’archive contient des chemins de fichiers interdits (tentative d’évasion).');
      }
      if (name.endsWith('/')) {
        // Directory entry
        if (name !== 'data/') {
          throw new BadRequestException(`Dossier inattendu dans l’archive : « ${name} ».`);
        }
        continue;
      }
      if (name === 'manifest.json') continue;

      const match = /^data\/([a-z_]+)\.ndjson$/.exec(name);
      if (!match || !BACKUP_TABLES.includes(match[1] as BackupTableName)) {
        throw new BadRequestException(`L’archive contient un fichier inattendu ou non reconnu : « ${name} ».`);
      }
    }

    // 2. Manifest check
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new BadRequestException('L’archive ne contient pas de fichier manifest.json.');
    }

    let manifest: BackupManifest;
    try {
      const manifestText = await manifestFile.async('text');
      manifest = JSON.parse(manifestText) as BackupManifest;
    } catch {
      throw new BadRequestException('Le fichier manifest.json est corrompu ou n’est pas un JSON valide.');
    }

    if (typeof manifest.formatVersion !== 'number' || typeof manifest.schemaVersion !== 'number' || !manifest.createdAt) {
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

    // 3. Decompress, check uncompressed size, verify sha256 and parse rows
    let totalUncompressed = 0;
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
        if (manifest.counts && manifest.counts[table] > 0) {
          throw new BadRequestException(`Fichier de données manquant dans l’archive : ${filePath}.`);
        }
        continue;
      }

      const contentBuffer = await zipEntry.async('nodebuffer');
      totalUncompressed += contentBuffer.length;

      if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
        throw new BadRequestException('Le volume décompressé de l’archive dépasse la limite autorisée.');
      }
      if (contentBuffer.length > 10 * 1024 * 1024 && totalUncompressed / buffer.length > MAX_ZIP_RATIO) {
        throw new BadRequestException('Ratio de compression anormal détecté (protection anti zip-bomb).');
      }

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

