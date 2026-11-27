import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseChangelog, type ChangelogEntry } from './parse.js';

@Injectable()
export class ChangelogService {
  private readonly logger = new Logger(ChangelogService.name);
  private cached: ChangelogEntry[] | null = null;

  getChangelog(): ChangelogEntry[] {
    if (this.cached) return this.cached;

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const resourcesPath = (process as unknown as Record<string, string | undefined>)['resourcesPath'];
    const candidates: string[] = [];
    if (resourcesPath) {
      candidates.push(path.join(resourcesPath, 'CHANGELOG.md'));
    }
    // Development: 4 levels up from apps/api/{src,dist}/changelog to repo root.
    candidates.push(path.resolve(currentDir, '..', '..', '..', '..', 'CHANGELOG.md'));

    for (const candidate of candidates) {
      try {
        const text = fs.readFileSync(candidate, 'utf8');
        const entries = parseChangelog(text);
        this.cached = entries;
        return entries;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code !== 'ENOENT') {
          this.logger.warn(
            `Impossible de lire ${candidate} : ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    this.logger.warn('CHANGELOG.md introuvable dans les chemins candidats.');
    return [];
  }
}
