// Versioned save document for localStorage["nsr_save"] (PRD section 10).
// Ports scripts/game/save_system.gd: lenient-load/strict-validate with the
// same defaults and merge order. save.ts stays synchronous and write-through
// like SaveGame.save_game/load_game; the debounce lives in settings.ts and
// state.ts exactly as _request_persist lives in the Godot owners.
// One deliberate deviation from Godot: a numeric out-of-range volume loads
// clamped to [0, 1] (2 becomes 1) per this issue's acceptance; Godot's
// _disk_volume resets such values to defaults instead.

export const SAVE_KEY = "nsr_save";
export const SAVE_VERSION = 1;
export const SCHEMA_VERSION = 1;

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;
export const BEST_TIME_MIN = 0;
export const BEST_POSITION_MIN = 1;
export const BEST_DRIFT_SCORE_MIN = 1;

const SETTINGS_KEYS = [
  "master_volume",
  "music_volume",
  "sfx_volume",
  "assists",
  "camera_shake",
] as const;

const PROGRESS_KEYS = [
  "unlocked_events",
  "unlocked_cars",
  "selected_car",
  "selected_color",
  "current_event",
] as const;

const RECORD_KEYS = ["best_time_s", "best_position", "best_drift_score"] as const;

export type SaveSettings = {
  master_volume: number;
  music_volume: number;
  sfx_volume: number;
  assists: boolean;
  camera_shake: boolean;
};

export type SaveProgress = {
  unlocked_events: string[];
  unlocked_cars: string[];
  selected_car: string;
  selected_color: number;
  current_event: string;
};

export type SaveRecordEntry = {
  best_time_s?: number;
  best_position?: number;
  best_drift_score?: number;
};

export type SaveData = {
  version: number;
  settings: SaveSettings;
  progress: SaveProgress;
  records: Record<string, SaveRecordEntry>;
};

// Narrow injectable storage adapter; defaults to localStorage with an
// in-memory fallback when localStorage is unavailable (Node/vitest).
export type StorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

function hasLocalStorage(): boolean {
  try {
    return (
      typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage !== null
    );
  } catch {
    return false;
  }
}

const memoryBacking = new Map<string, string>();

const sharedMemoryStorage: StorageAdapter = {
  getItem: (key: string): string | null =>
    memoryBacking.has(key) ? (memoryBacking.get(key) as string) : null,
  setItem: (key: string, value: string): void => {
    memoryBacking.set(key, String(value));
  },
  removeItem: (key: string): void => {
    memoryBacking.delete(key);
  },
};

// Default adapter: the real localStorage when present, otherwise the shared
// in-memory shim so every store observes the same document under Node.
export function getDefaultStorage(): StorageAdapter {
  if (hasLocalStorage()) {
    try {
      const ls = globalThis.localStorage;
      return {
        getItem: (key: string): string | null => ls.getItem(key),
        setItem: (key: string, value: string): void => {
          ls.setItem(key, value);
        },
        removeItem: (key: string): void => {
          ls.removeItem(key);
        },
      };
    } catch {
      return sharedMemoryStorage;
    }
  }
  return sharedMemoryStorage;
}

// Fresh isolated adapter for tests that must not share the default backing.
export function createMemoryStorage(): StorageAdapter {
  const backing = new Map<string, string>();
  return {
    getItem: (key: string): string | null =>
      backing.has(key) ? (backing.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      backing.set(key, String(value));
    },
    removeItem: (key: string): void => {
      backing.delete(key);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

function clampVolume(level: number): number {
  if (level < VOLUME_MIN) {
    return VOLUME_MIN;
  }
  if (level > VOLUME_MAX) {
    return VOLUME_MAX;
  }
  return level;
}

// PRD section 10-shaped defaults: version + settings + progress + records.
export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: {
      master_volume: 0.8,
      music_volume: 0.7,
      sfx_volume: 0.9,
      assists: true,
      camera_shake: true,
    },
    progress: {
      unlocked_events: [],
      unlocked_cars: [],
      selected_car: "",
      selected_color: 0,
      current_event: "",
    },
    records: {},
  };
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const defaultData = defaultSave;

// Strict shape check mirroring SaveSystem.validate(): int-only version equal
// to 1, exactly the five settings keys with 0-1 numerics and strictly-bool
// flags, string selection, numeric color, array-only non-empty-string unlock
// lists, and per-entry positive best_time_s plus whole best_position >= 1 and
// best_drift_score >= 1 (unknown per-entry keys ignored, as in Godot).
export function validateSave(data: unknown): data is SaveData {
  if (!isRecord(data)) {
    return false;
  }
  if (
    typeof data.version !== "number" ||
    !Number.isInteger(data.version) ||
    data.version !== SAVE_VERSION
  ) {
    return false;
  }
  if (!isRecord(data.settings)) {
    return false;
  }
  const settings = data.settings;
  const settingKeys = Object.keys(settings);
  if (
    settingKeys.length !== SETTINGS_KEYS.length ||
    !SETTINGS_KEYS.every((key) => settingKeys.includes(key))
  ) {
    return false;
  }
  for (const key of ["master_volume", "music_volume", "sfx_volume"] as const) {
    const level: unknown = settings[key];
    if (
      typeof level !== "number" ||
      !Number.isFinite(level) ||
      level < VOLUME_MIN ||
      level > VOLUME_MAX
    ) {
      return false;
    }
  }
  for (const key of ["assists", "camera_shake"] as const) {
    if (typeof settings[key] !== "boolean") {
      return false;
    }
  }
  if (!isRecord(data.progress)) {
    return false;
  }
  const progress = data.progress;
  if (
    typeof progress.selected_car !== "string" ||
    typeof progress.current_event !== "string"
  ) {
    return false;
  }
  if (
    typeof progress.selected_color !== "number" ||
    !Number.isFinite(progress.selected_color)
  ) {
    return false;
  }
  for (const key of ["unlocked_events", "unlocked_cars"] as const) {
    const unlocks: unknown = progress[key];
    if (!Array.isArray(unlocks)) {
      return false;
    }
    for (const entry of unlocks) {
      if (typeof entry !== "string" || entry === "") {
        return false;
      }
    }
  }
  if (!isRecord(data.records)) {
    return false;
  }
  for (const [key, entry] of Object.entries(data.records)) {
    if (key === "" || !isRecord(entry) || Object.keys(entry).length === 0) {
      return false;
    }
    if ("best_time_s" in entry) {
      const best: unknown = entry.best_time_s;
      if (
        typeof best !== "number" ||
        !Number.isFinite(best) ||
        best <= BEST_TIME_MIN
      ) {
        return false;
      }
    }
    if ("best_position" in entry) {
      const place: unknown = entry.best_position;
      if (
        typeof place !== "number" ||
        !Number.isInteger(place) ||
        place < BEST_POSITION_MIN
      ) {
        return false;
      }
    }
    if ("best_drift_score" in entry) {
      const score: unknown = entry.best_drift_score;
      if (
        typeof score !== "number" ||
        !Number.isInteger(score) ||
        score < BEST_DRIFT_SCORE_MIN
      ) {
        return false;
      }
    }
  }
  return true;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate = validateSave;

// Read-boundary unlock-list sanitizer mirroring Progression._string_list:
// non-Array yields empty, otherwise keep non-empty strings in order.
function sanitizedUnlockList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item !== "") {
      out.push(item);
    }
  }
  return out;
}

// Lenient load mirroring SaveSystem.load_game(): missing/corrupt input falls
// back to defaults; known keys merge over defaults while unknown top,
// settings, progress, and per-entry keys are dropped; unlock lists sanitize
// to non-empty strings; corrupt records entries are dropped; a numeric
// future version carries through as int. Numeric out-of-range volumes clamp
// to [0, 1] on load (this issue's deviation from Godot's default-reset).
export function loadSave(
  storage: StorageAdapter = getDefaultStorage(),
): SaveData {
  const merged = defaultSave();
  let text: string | null = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return merged;
  }
  if (text === null || text === undefined || text === "") {
    return merged;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return merged;
  }
  if (!isRecord(parsed)) {
    return merged;
  }
  const raw: Record<string, unknown> = parsed;
  if (isRecord(raw.settings)) {
    const saved = raw.settings;
    for (const key of SETTINGS_KEYS) {
      if (!Object.hasOwn(saved, key)) {
        continue;
      }
      let value: unknown = saved[key];
      if (
        (key === "master_volume" ||
          key === "music_volume" ||
          key === "sfx_volume") &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        value = clampVolume(value);
      }
      (merged.settings as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (isRecord(raw.progress)) {
    const saved = raw.progress;
    for (const key of PROGRESS_KEYS) {
      if (!Object.hasOwn(saved, key)) {
        continue;
      }
      if (key === "unlocked_events" || key === "unlocked_cars") {
        merged.progress[key] = sanitizedUnlockList(saved[key]);
      } else {
        (merged.progress as unknown as Record<string, unknown>)[key] =
          saved[key];
      }
    }
  }
  if (isRecord(raw.records)) {
    const saved = raw.records;
    for (const key of Object.keys(saved)) {
      if (key === "") {
        continue;
      }
      const record: unknown = saved[key];
      if (!isRecord(record) || Object.keys(record).length === 0) {
        continue;
      }
      if ("best_time_s" in record) {
        const best: unknown = record.best_time_s;
        if (
          typeof best !== "number" ||
          !Number.isFinite(best) ||
          best <= BEST_TIME_MIN
        ) {
          continue;
        }
      }
      if ("best_position" in record) {
        const place: unknown = record.best_position;
        if (
          typeof place !== "number" ||
          !Number.isInteger(place) ||
          place < BEST_POSITION_MIN
        ) {
          continue;
        }
      }
      if ("best_drift_score" in record) {
        const score: unknown = record.best_drift_score;
        if (
          typeof score !== "number" ||
          !Number.isInteger(score) ||
          score < BEST_DRIFT_SCORE_MIN
        ) {
          continue;
        }
      }
      const sanitized: SaveRecordEntry = {};
      for (const known of RECORD_KEYS) {
        if (Object.hasOwn(record, known)) {
          (sanitized as unknown as Record<string, unknown>)[known] =
            record[known];
        }
      }
      if (Object.keys(sanitized).length === 0) {
        continue;
      }
      merged.records[key] = sanitized;
    }
  }
  const rawVersion: unknown = raw.version;
  if (
    typeof rawVersion === "number" &&
    Number.isFinite(rawVersion) &&
    Math.trunc(rawVersion) > SAVE_VERSION
  ) {
    merged.version = Math.trunc(rawVersion);
  } else {
    merged.version = SAVE_VERSION;
  }
  return merged;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const loadGame = loadSave;

// Write-through save mirroring SaveSystem.save_game(): never raises,
// returns false when the write fails.
export function saveNow(
  data: SaveData,
  storage: StorageAdapter = getDefaultStorage(),
): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const saveGame = saveNow;
