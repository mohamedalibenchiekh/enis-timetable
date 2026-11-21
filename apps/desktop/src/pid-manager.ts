import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ProcessInspector {
  isPidAlive(pid: number): boolean;
  isPostgresPid(pid: number, expectedDataDir?: string): boolean;
  killPid(pid: number, force?: boolean): boolean;
  stopPostgres?(pid: number, dataDir: string): boolean;
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

    let cmdLine = '';
    if (process.platform === 'win32') {
      try {
        const res = spawnSync(
          'powershell',
          ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`],
          { encoding: 'utf8', windowsHide: true, timeout: 5000 },
        );
        cmdLine = (res.stdout || '').trim();
      } catch {
        // Fallback to tasklist if PowerShell fails
        try {
          const res = spawnSync('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 3000,
          });
          cmdLine = (res.stdout || '').toLowerCase();
        } catch {
          return false;
        }
      }
    } else {
      // Unix / macOS: check /proc/<pid>/cmdline or ps
      try {
        if (fs.existsSync(`/proc/${pid}/cmdline`)) {
          cmdLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        } else {
          const res = spawnSync('ps', ['-p', String(pid), '-o', 'args='], {
            encoding: 'utf8',
            timeout: 3000,
          });
          cmdLine = (res.stdout || '').trim();
        }
      } catch {
        return false;
      }
    }

    const lowerCmd = cmdLine.toLowerCase();
    if (!lowerCmd.includes('postgres')) {
      return false;
    }

    // If expectedDataDir is specified, verify that this postgres process actually belongs to our data directory
    if (expectedDataDir) {
      const normalizedDir = path.normalize(expectedDataDir).toLowerCase();
      // On Windows paths might have forward or backslashes
      const forwardSlashDir = normalizedDir.replace(/\\/g, '/');
      const backSlashDir = normalizedDir.replace(/\//g, '\\');
      if (!lowerCmd.includes(normalizedDir) && !lowerCmd.includes(forwardSlashDir) && !lowerCmd.includes(backSlashDir)) {
        return false;
      }
    }

    return true;
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

  stopPostgres(pid: number, dataDir: string): boolean {
    if (!this.isPidAlive(pid)) return true;

    // 1. Try clean fast shutdown first
    if (process.platform === 'win32') {
      try {
        const pgCtl = path.join(
          path.dirname(require.resolve('@embedded-postgres/windows-x64/package.json')),
          'native', 'bin', 'pg_ctl.exe'
        );
        if (fs.existsSync(pgCtl)) {
          spawnSync(pgCtl, ['stop', '-m', 'fast', '-D', dataDir], {
            windowsHide: true,
            timeout: 5000,
          });
        }
      } catch {
        // pg_ctl failed, try gentle taskkill
        this.killPid(pid, false);
      }
    } else {
      // Unix: SIGINT performs fast shutdown on PostgreSQL postmaster
      try {
        process.kill(pid, 'SIGINT');
      } catch {
        // ignore
      }
    }

    // Wait up to 3.5s for process to exit cleanly
    const startTime = Date.now();
    while (this.isPidAlive(pid) && Date.now() - startTime < 3500) {
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 200);
    }

    if (!this.isPidAlive(pid)) {
      return true;
    }

    // 2. Fallback to forced kill if clean stop did not complete in time
    return this.killPid(pid, true);
  }
}

export interface PostmasterPidInspectionResult {
  cleaned: boolean;
  foreignProcessPid?: number;
  error?: string;
}

export function inspectAndCleanPostmasterPid(
  dataDir: string,
  inspector: ProcessInspector = new SystemProcessInspector(),
  log: (msg: string) => void = () => {},
): PostmasterPidInspectionResult {
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
    // Unparseable or corrupt pid file: fail closed to prevent launching a second server on active data
    log(`Fichier postmaster.pid illisible ou corrompu (PID invalide). Verrou conservé pour éviter toute corruption.`);
    return { cleaned: false, error: 'postmaster.pid illisible ou corrompu' };
  }

  const alive = inspector.isPidAlive(pid);
  if (!alive) {
    log(`Processus PID ${pid} issu de postmaster.pid introuvable. Suppression du verrou obsolète.`);
    try {
      fs.unlinkSync(pidFile);
      return { cleaned: true };
    } catch (e) {
      log(`Échec de suppression de postmaster.pid: ${String(e)}`);
      return { cleaned: false, error: String(e) };
    }
  }

  // PID is alive! Check if it's our postgres or a foreign process
  const isPg = inspector.isPostgresPid(pid, dataDir);
  if (!isPg) {
    log(`PID ${pid} actif dans postmaster.pid mais n'appartient pas à PostgreSQL pour ${dataDir} (processus étranger). Fichier préservé.`);
    return { cleaned: false, foreignProcessPid: pid };
  }

  // It's a running postgres process belonging to our directory!
  log(`Processus PostgreSQL orphelin détecté (PID ${pid}). Tentative d'arrêt propre...`);
  if (typeof inspector.stopPostgres === 'function') {
    inspector.stopPostgres(pid, dataDir);
  } else {
    inspector.killPid(pid, false);
    const start = Date.now();
    while (inspector.isPidAlive(pid) && Date.now() - start < 3000) {
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 200);
    }
    if (inspector.isPidAlive(pid)) {
      inspector.killPid(pid, true);
    }
  }

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
  return { cleaned: false, error: `Impossible d'arrêter le processus PostgreSQL (PID ${pid})` };
}
