import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class MaintenanceService {
  private inMaintenance = false;
  private currentOperation: string | null = null;
  private mutexLocked = false;
  private activeMutations = 0;
  private mutationDrainedResolvers: Array<() => void> = [];

  isMaintenance(): boolean {
    return this.inMaintenance;
  }

  setMaintenance(active: boolean, operation?: string): void {
    this.inMaintenance = active;
    this.currentOperation = active ? operation || 'maintenance' : null;
  }

  getCurrentOperation(): string | null {
    return this.currentOperation;
  }

  enterMutation(): void {
    this.activeMutations++;
  }

  exitMutation(): void {
    this.activeMutations = Math.max(0, this.activeMutations - 1);
    if (this.activeMutations === 0 && this.mutationDrainedResolvers.length > 0) {
      const resolvers = [...this.mutationDrainedResolvers];
      this.mutationDrainedResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }

  async drainActiveMutations(timeoutMs = 10000): Promise<void> {
    if (this.activeMutations === 0) return;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.mutationDrainedResolvers = this.mutationDrainedResolvers.filter((r) => r !== onDrained);
        resolve();
      }, timeoutMs);

      const onDrained = () => {
        clearTimeout(timer);
        resolve();
      };

      this.mutationDrainedResolvers.push(onDrained);
    });
  }

  async runExclusive<T>(
    operation: string,
    fn: () => Promise<T>,
    drainMutations = false,
  ): Promise<T> {
    if (this.mutexLocked) {
      throw new ServiceUnavailableException('Une opération de sauvegarde ou de restauration est déjà en cours.');
    }
    this.mutexLocked = true;
    this.currentOperation = operation;
    try {
      if (drainMutations) {
        this.inMaintenance = true;
        await this.drainActiveMutations();
      }
      return await fn();
    } finally {
      this.mutexLocked = false;
      this.currentOperation = null;
    }
  }
}

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    const isMutating = mutatingMethods.includes(req.method.toUpperCase());
    const path = req.baseUrl ? `${req.baseUrl}${req.path}` : (req.originalUrl || req.url || '');
    const isRestoreRequest = /\/backups\/restore(?:\/|$|\?)/.test(path);

    if (this.maintenanceService.isMaintenance()) {
      if (isMutating) {
        throw new ServiceUnavailableException(
          'Restauration en cours. L’application est temporairement en maintenance. Veuillez patienter.',
        );
      }
      return true;
    }

    if (isMutating && !isRestoreRequest) {
      this.maintenanceService.enterMutation();
      let exited = false;
      const onDone = () => {
        if (!exited) {
          exited = true;
          this.maintenanceService.exitMutation();
        }
      };
      res.once('finish', onDone);
      res.once('close', onDone);
    }

    return true;
  }
}


