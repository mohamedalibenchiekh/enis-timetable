/**
 * changelog.controller.ts
 *
 * Serves the parsed CHANGELOG.md entries as JSON so the web UI can render
 * the history list without any Node.js access in the renderer.
 *
 * GET /api/changelog → ChangelogEntry[]
 */

import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import { ChangelogService } from './changelog.service.js';
import type { ChangelogEntry } from './parse.js';

@Controller('changelog')
export class ChangelogController {
  private readonly logger = new Logger(ChangelogController.name);

  constructor(private readonly changelogService: ChangelogService) {}

  @Get()
  getChangelog(): ChangelogEntry[] {
    try {
      return this.changelogService.getChangelog();
    } catch (err) {
      this.logger.error('Erreur lors du chargement du journal des modifications', err);
      throw new InternalServerErrorException('Journal des modifications indisponible');
    }
  }
}
