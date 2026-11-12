import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/timetable.entity.js';
import {
  DEFAULT_OPTIONS, ExportOptions, ExportProfile, ExportProfilesState, normalizeOptions, normalizeProfilesState,
} from '../export/options.js';
import { BackupsService } from '../backups/backups.service.js';

const SETTINGS_KEY = 'export';

/** Shallow copy of an object keeping only keys with a defined value. */
function definedEntries<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting) private repo: Repository<Setting>,
    @Optional() private backups?: BackupsService,
  ) {}

  // ----- storage ---------------------------------------------------------------------------

  private async readState(): Promise<ExportProfilesState> {
    const row = await this.repo.findOneBy({ key: SETTINGS_KEY });
    return normalizeProfilesState(row?.value);
  }

  private async writeState(state: ExportProfilesState): Promise<ExportProfilesState> {
    await this.repo.save({ key: SETTINGS_KEY, value: state });
    this.backups?.scheduler?.notifyDataChanged();
    return state;
  }

  // ----- legacy single-options API (default profile) ---------------------------------------

  async getExportOptions(): Promise<ExportOptions> {
    const state = await this.readState();
    return state.profiles.find((p) => p.id === state.defaultId)?.options ?? state.profiles[0].options;
  }

  async setExportOptions(value: Partial<ExportOptions>): Promise<ExportOptions> {
    const state = await this.readState();
    const current = state.profiles.find((p) => p.id === state.defaultId)?.options ?? state.profiles[0].options;
    const merged = { ...current, ...value };
    // Legacy semantics: an empty blocs list resets to the default blocs.
    if (Array.isArray(value.blocs) && value.blocs.length === 0) merged.blocs = DEFAULT_OPTIONS.blocs;
    const options = normalizeOptions(merged, true);
    const idx = state.profiles.findIndex((p) => p.id === state.defaultId);
    state.profiles[idx >= 0 ? idx : 0].options = options;
    await this.writeState(state);
    return options;
  }

  // ----- profiles ---------------------------------------------------------------------------

  async listProfiles(): Promise<ExportProfilesState> {
    return this.readState();
  }

  async getProfileOptions(profileId: string): Promise<{ profile: ExportProfile; isDefault: boolean }> {
    const state = await this.readState();
    const profile = state.profiles.find((p) => p.id === profileId);
    if (!profile) throw new NotFoundException('Profil introuvable');
    return { profile, isDefault: profile.id === state.defaultId };
  }

  /** Resolve a profile by id, or the default profile when no id is given. */
  async resolveProfile(profileId?: string): Promise<{ profile: ExportProfile; isDefault: boolean }> {
    const state = await this.readState();
    if (profileId) {
      const profile = state.profiles.find((p) => p.id === profileId);
      if (!profile) throw new NotFoundException('Profil introuvable');
      return { profile, isDefault: profile.id === state.defaultId };
    }
    const profile = state.profiles.find((p) => p.id === state.defaultId) ?? state.profiles[0];
    return { profile, isDefault: true };
  }

  private assertUniqueName(state: ExportProfilesState, name: string, exceptId?: string) {
    const lower = name.trim().toLowerCase();
    if (state.profiles.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === lower)) {
      throw new BadRequestException('Un profil avec ce nom existe déjà');
    }
  }

  async createProfile(name: string, options?: Partial<ExportOptions>): Promise<ExportProfilesState> {
    const state = await this.readState();
    // Truncate before the uniqueness check so names that collide after
    // truncation are still rejected.
    const cleanName = (name ?? '').trim().slice(0, 60);
    if (!cleanName) throw new BadRequestException('Le nom du profil est obligatoire');
    this.assertUniqueName(state, cleanName);
    const id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const base = state.profiles.find((p) => p.id === state.defaultId)?.options ?? state.profiles[0].options;
    const merged = options ? { ...base, ...definedEntries(options) } : base;
    state.profiles.push({ id, name: cleanName, options: normalizeOptions(merged, true) });
    return this.writeState(state);
  }

  async updateProfile(id: string, patch: { name?: string; options?: Partial<ExportOptions>; isDefault?: boolean }): Promise<ExportProfilesState> {
    const state = await this.readState();
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) throw new NotFoundException('Profil introuvable');
    if (patch.name !== undefined) {
      const cleanName = patch.name.trim().slice(0, 60);
      if (!cleanName) throw new BadRequestException('Le nom du profil est obligatoire');
      this.assertUniqueName(state, cleanName, id);
      profile.name = cleanName;
    }
    if (patch.options !== undefined) {
      // Partial options merge over the profile's current options.
      profile.options = normalizeOptions({ ...profile.options, ...definedEntries(patch.options) }, true);
    }
    if (patch.isDefault !== undefined) {
      if (typeof patch.isDefault !== 'boolean') throw new BadRequestException('« isDefault » doit être un booléen');
      if (patch.isDefault) state.defaultId = id;
    }
    return this.writeState(state);
  }

  async deleteProfile(id: string): Promise<ExportProfilesState> {
    const state = await this.readState();
    const idx = state.profiles.findIndex((p) => p.id === id);
    if (idx < 0) throw new NotFoundException('Profil introuvable');
    if (state.profiles.length <= 1) throw new BadRequestException('Impossible de supprimer le dernier profil');
    state.profiles.splice(idx, 1);
    if (state.defaultId === id) state.defaultId = state.profiles[0].id;
    return this.writeState(state);
  }
}
