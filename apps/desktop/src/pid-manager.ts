import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ProcessInspector {
  isPidAlive(pid: number): boolean;
  isPostgresPid(pid: number, expectedDataDir?: string): boolean;
  killPid(pid: number, force?: boolean): boolean;
}

export class SystemProcessInspector implements ProcessInspector {
  isPidAlive(pid: number): boolean {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err?.code === 'EPERM';
    }
  }

  isPostgresPid(pid: number, expectedDataDir?: string): boolean {
    if (!this.isPidAlive(pid)) return false;

    if (process.platform === 'win32') {
      try {
        const res = spawnSync('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 4000,
        });
        const output = (res.stdout || '').toLowerCase();
        if (output.includes('postgres.exe')) {
          // If expectedDataDir is specified, we can double check with powershell commandline if possible,
          // or trust postgres.exe if verified
          return true;
        }
        return false;
      } catch {
        return false;
      }
    } else {
      // Unix / macOS: check /proc/<pid>/cmdline or ps
      try {
        const res = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], {
          encoding: 'utf8',
          timeout: 4000,
        });
        const comm = (res.stdout || '').trim().toLowerCase();
        return comm.includes('postgres');
      } catch {
        return false;
      }
    }
  }

  killPid(pid: number, force = true): boolean {
    if (!this.isPidAlive(pid)) return true;
    if (process.platform === 'win32') {
      try {
        const args = ['/pid', String(pid)];
        if (force) args.push('/f');
        args.push('/t');
        spawnSync('taskkill', args, { windowsHide: true, timeout: 5000 });
        return !this.isPidAlive(pid);
      } catch {
        return false;
      }
    } else {
      try {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
        return true;
      } catch {
        return false;
      }
    }
  }
}

export function inspectAndCleanPostmasterPid(
  dataDir: string,
  inspector: ProcessInspector = new SystemProcessInspector(),
  log: (msg: string) => void = () => {},
): { cleaned: boolean; foreignProcessPid?: number } {
  const pidFile = path.join(dataDir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) {
    return { cleaned: false };
  }

  let pid = 0;
  try {
    const content = fs.readFileSync(pidFile, 'utf8');
    const firstLine = content.split('\n')[0].trim();
    pid = parseInt(firstLine, 10);
  } catch (err) {
    log(`Impossible de lire postmaster.pid: ${String(err)}`);
  }

  if (!pid || isNaN(pid)) {
    // Corrupt or unparseable pid file without active pid - safely remove
    try {
      fs.unlinkSync(pidFile);
      log(`Fichier postmaster.pid invalide supprimé.`);
      return { cleaned: true };
    } catch {
      return { cleaned: false };
    }
  }

  const alive = inspector.isPidAlive(pid);
  if (!alive) {
    log(`Processus PID ${pid} issu de postmaster.pid introuvable. Suppression du verrou obsolète.`);
    try {
      fs.unlinkSync(pidFile);
      return { cleaned: true };
    } catch (e) {
      log(`Échec de suppression de postmaster.pid: ${String(e)}`);
      return { cleaned: false };
    }
  }

  // PID is alive! Check if it's our postgres or a foreign process
  const isPg = inspector.isPostgresPid(pid, dataDir);
  if (!isPg) {
    log(`PID ${pid} actif dans postmaster.pid mais n'appartient pas à PostgreSQL (processus étranger). Fichier préservé.`);
    return { cleaned: false, foreignProcessPid: pid };
  }

  // It's a running postgres process holding the directory!
  log(`Processus PostgreSQL orphelin détecté (PID ${pid}). Tentative d'arrêt propre...`);
  inspector.killPid(pid, true);
  if (!inspector.isPidAlive(pid)) {
    try {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
      log(`Processus PostgreSQL résiduel arrêté et postmaster.pid nettoyé.`);
      return { cleaned: true };
    } catch {
      return { cleaned: false };
    }
  }

  log(`Impossible d'arrêter le processus PostgreSQL résiduel (PID ${pid}).`);
  return { cleaned: false };
}
