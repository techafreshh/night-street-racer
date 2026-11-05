// User-facing audio/accessibility preferences (settings.gd port).
// Owns the five PRD section 10 settings keys (master/music/sfx volumes,
// assists, camera shake) and persists them across restarts through a
// coalesced load-modify-save: setters mark the store dirty and schedule
// exactly one deferred write-back (plus flush() on demand and on unload),
// while reload_from_disk() allow-lists only the five known keys and
// suppresses write-back. No audio graph here: levels are data only.

import {
  getDefaultStorage,
  loadSave,
  saveNow,
  type StorageAdapter,
} from "./save";

export const MASTER_VOLUME_DEFAULT = 0.8;
export const MUSIC_VOLUME_DEFAULT = 0.7;
export const SFX_VOLUME_DEFAULT = 0.9;
export const ASSISTS_DEFAULT = true;
export const CAMERA_SHAKE_DEFAULT = true;

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;

export type SettingsSnapshot = {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  assists: boolean;
  cameraShake: boolean;
};

// Numeric volumes clamp into [VOLUME_MIN, VOLUME_MAX]; anything else
// (String, bool, null, NaN) falls back to the per-key default.
function toVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < VOLUME_MIN) {
    return VOLUME_MIN;
  }
  if (value > VOLUME_MAX) {
    return VOLUME_MAX;
  }
  return value;
}

// Disk flags apply only when strictly bool; anything else falls back.
function toFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export class SettingsStore {
  private readonly storage: StorageAdapter;
  private loading = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unloadHandler: (() => void) | null = null;

  private master = MASTER_VOLUME_DEFAULT;
  private music = MUSIC_VOLUME_DEFAULT;
  private sfx = SFX_VOLUME_DEFAULT;
  private assist = ASSISTS_DEFAULT;
  private shake = CAMERA_SHAKE_DEFAULT;

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? getDefaultStorage();
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      const handler = (): void => {
        this.flush();
      };
      this.unloadHandler = handler;
      window.addEventListener("beforeunload", handler);
      window.addEventListener("pagehide", handler);
    }
    this.reloadFromDisk();
  }

  get masterVolume(): number {
    return this.master;
  }

  set masterVolume(value: number) {
    const level = toVolume(value, MASTER_VOLUME_DEFAULT);
    if (this.loading) {
      this.master = level;
      return;
    }
    if (this.master === level) {
      return;
    }
    this.master = level;
    this.requestPersist();
  }

  get musicVolume(): number {
    return this.music;
  }

  set musicVolume(value: number) {
    const level = toVolume(value, MUSIC_VOLUME_DEFAULT);
    if (this.loading) {
      this.music = level;
      return;
    }
    if (this.music === level) {
      return;
    }
    this.music = level;
    this.requestPersist();
  }

  get sfxVolume(): number {
    return this.sfx;
  }

  set sfxVolume(value: number) {
    const level = toVolume(value, SFX_VOLUME_DEFAULT);
    if (this.loading) {
      this.sfx = level;
      return;
    }
    if (this.sfx === level) {
      return;
    }
    this.sfx = level;
    this.requestPersist();
  }

  get assists(): boolean {
    return this.assist;
  }

  set assists(value: boolean) {
    const flag = toFlag(value, ASSISTS_DEFAULT);
    if (this.loading) {
      this.assist = flag;
      return;
    }
    if (this.assist === flag) {
      return;
    }
    this.assist = flag;
    this.requestPersist();
  }

  get cameraShake(): boolean {
    return this.shake;
  }

  set cameraShake(value: boolean) {
    const flag = toFlag(value, CAMERA_SHAKE_DEFAULT);
    if (this.loading) {
      this.shake = flag;
      return;
    }
    if (this.shake === flag) {
      return;
    }
    this.shake = flag;
    this.requestPersist();
  }

  // Read the live settings without write-back (settings.gd poll idiom).
  snapshot(): SettingsSnapshot {
    return {
      masterVolume: this.master,
      musicVolume: this.music,
      sfxVolume: this.sfx,
      assists: this.assist,
      cameraShake: this.shake,
    };
  }

  // Re-read the save into the five settings. Missing or corrupt entries
  // fall back to defaults, numeric out-of-range volumes clamp to [0, 1],
  // unknown keys are dropped, and write-back stays suppressed.
  reloadFromDisk(): void {
    this.pending = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.loading = true;
    const data = loadSave(this.storage);
    const raw = data.settings as unknown as Record<string, unknown>;
    this.master = toVolume(raw.master_volume, MASTER_VOLUME_DEFAULT);
    this.music = toVolume(raw.music_volume, MUSIC_VOLUME_DEFAULT);
    this.sfx = toVolume(raw.sfx_volume, SFX_VOLUME_DEFAULT);
    this.assist = toFlag(raw.assists, ASSISTS_DEFAULT);
    this.shake = toFlag(raw.camera_shake, CAMERA_SHAKE_DEFAULT);
    this.loading = false;
  }

  // Merge the live settings into the saved document, keeping progress and
  // records opaque for other owners. Silent no-op while bulk-loading.
  private persist(): void {
    if (this.loading) {
      return;
    }
    const data = loadSave(this.storage);
    data.settings.master_volume = this.master;
    data.settings.music_volume = this.music;
    data.settings.sfx_volume = this.sfx;
    data.settings.assists = this.assist;
    data.settings.camera_shake = this.shake;
    saveNow(data, this.storage);
  }

  // Mark the settings dirty and schedule exactly one deferred write-back,
  // no matter how many setters fire in the same frame. No-op while
  // bulk-loading and when a write is already scheduled.
  private requestPersist(): void {
    if (this.loading || this.pending) {
      return;
    }
    this.pending = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pending) {
        return;
      }
      this.pending = false;
      this.persist();
    }, 0);
  }

  // Synchronous read-your-writes: durably store the pending settings now.
  // Clears the pending flag first so a stranded deferred call afterwards
  // is a no-op; a second flush without new writes writes nothing.
  flush(): void {
    if (!this.pending) {
      return;
    }
    this.pending = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.persist();
  }

  // Detach the unload hook and drop any scheduled write without flushing.
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = false;
    if (
      this.unloadHandler !== null &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("beforeunload", this.unloadHandler);
      window.removeEventListener("pagehide", this.unloadHandler);
    }
  }
}

// Shared autoload-equivalent handle (settings.gd singleton idiom).
export const settings = new SettingsStore();
