import * as fs from 'fs';
import * as path from 'path';

export interface StartupLogEntry {
  step: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: string;
}

export function maskUsername(str: string): string {
  if (!str) return str;
  const username = process.env.USERNAME || process.env.USER;
  if (!username) return str;
  // Replace username in paths case-insensitively
  const regex = new RegExp(`([\\\\/](?:Users|home)[\\\\/])${username}([\\\\/]|$)`, 'gi');
  return str.replace(regex, '$1***$2');
}

export function rotateLogs(logDir: string, maxFiles = 5): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const logFiles = fs.readdirSync(logDir)
      .filter((file) => /^startup(-\d+)?\.log$/i.test(file))
      .map((file) => {
        const fullPath = path.join(logDir, file);
        return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // Keep only maxFiles - 1 so we can write a new one
    for (const oldFile of logFiles.slice(maxFiles - 1)) {
      try {
        fs.unlinkSync(oldFile.fullPath);
      } catch {
        // ignore deletion error
      }
    }
  } catch {
    // ignore rotation errors
  }
}

export class StartupLogger {
  private logPath: string;
  private buffer: string[] = [];
  private currentLog: string = '';

  constructor(private logDir: string) {
    rotateLogs(logDir, 5);
    const dateStr = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
    this.logPath = path.join(logDir, `startup-${dateStr}.log`);
    this.log('INIT', 'Démarrage du journaliseur de démarrage');
  }

  log(step: string, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ' ' + JSON.stringify(this.sanitizeMeta(meta)) : '';
    const line = `[${timestamp}] [${step}] ${message}${metaStr}`;
    this.buffer.push(line);
    this.currentLog = (this.currentLog + line + '\n').slice(-6000);
    try {
      fs.appendFileSync(this.logPath, line + '\n', 'utf8');
    } catch {
      // fallback
    }
  }

  getTail(): string {
    return this.currentLog;
  }

  getLogPath(): string {
    return this.logPath;
  }

  private sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta)) {
      if (/password|secret|token|cred/i.test(key)) {
        clean[key] = '***';
      } else if (typeof value === 'string') {
        clean[key] = maskUsername(value.replace(/postgres:\/\/[^:]+:[^@]+@/g, 'postgres://enis:***@'));
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }
}
