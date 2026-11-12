import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class MaintenanceService {
  private inMaintenance = false;
  private currentOperation: string | null = null;
  private mutexLocked = false;

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

  async runExclusive<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (this.mutexLocked) {
      throw new ServiceUnavailableException('Une opération de sauvegarde ou de restauration est déjà en cours.');
    }
    this.mutexLocked = true;
    try {
      return await fn();
    } finally {
      this.mutexLocked = false;
    }
  }
}

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.maintenanceService.isMaintenance()) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

    // If mutating request arrives while in maintenance mode (except restore itself which controls it), return 503
    if (mutatingMethods.includes(req.method.toUpperCase())) {
      throw new ServiceUnavailableException(
        'Restauration en cours. L’application est temporairement en maintenance. Veuillez patienter.',
      );
    }

    return true;
  }
}

