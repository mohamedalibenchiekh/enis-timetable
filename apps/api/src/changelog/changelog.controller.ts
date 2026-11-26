/**
 * changelog.controller.ts
 *
 * Serves the parsed CHANGELOG.md entries as JSON so the web UI can render
 * the history list without any Node.js access in the renderer.
 *
 * GET /api/changelog → ChangelogEntry[]
 */

import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { parseChangelog, type ChangelogEntry } from './parse.js';

@Controller('changelog')
export class ChangelogController {
  private readonly logger = new Logger(ChangelogController.name);
  private cached: ChangelogEntry[] | null = null;

  private load(): ChangelogEntry[] {
    if (this.cached) return this.cached;

    // The CHANGELOG.md is bundled as an extraResource next to the app.
    // In development the repo root is two levels above the api directory.
    const candidates = [
      // packaged: resources/CHANGELOG.md (process.resourcesPath is injected by Electron at runtime)
      path.join(((process as unknown as Record<string, string>)['resourcesPath']) ?? '', 'CHANGELOG.md'),
      // development: repo root
      path.join(__dirname, '..', '..', '..', '..', '..', 'CHANGELOG.md'),
      path.join(__dirname, '..', '..', '..', 'CHANGELOG.md'),
    ];

    for (const candidate of candidates) {
      try {
        const text = fs.readFileSync(candidate, 'utf8');
        const entries = parseChangelog(text);
        this.cached = entries;
        return entries;
      } catch {
        // try next candidate
      }
    }

    this.logger.warn('CHANGELOG.md introuvable dans les chemins candidats.');
    return [];
  }

  @Get()
  getChangelog(): ChangelogEntry[] {
    try {
      return this.load();
    } catch (err) {
      this.logger.error('Erreur lors du chargement du journal des modifications', err);
      throw new InternalServerErrorException('Journal des modifications indisponible');
    }
  }
}
