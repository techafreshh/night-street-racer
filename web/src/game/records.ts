// Time-trial and judged-drift personal-best owner (TimeTrial /
// DriftScoring save_best_if_faster idiom port).
// Pure load-modify-save round-trips over game/save (mirrors
// game/progression.ts applyResult): every writer loads, merges sibling
// keys, and saves once. The race/* table modules stay disk-free; only the
// results screen calls the save* writers (single-writer rule). All reads
// delegate to the zero-import race table helpers with the live records
// table injected, so no math is duplicated here.

import {
  getDefaultStorage,
  loadSave,
  saveNow,
  type StorageAdapter,
} from "./save";
import {
  allBestsFromTable,
  bestFromTable as timeTrialBestFromTable,
} from "../race/timetrial";
import { bestFromTable as driftBestFromTable } from "../race/drift";

// Fastest stored lap for eventId, or -1 when empty/unknown (mirrors the
// race/timetrial bestFromTable contract). Never throws.
export function getBest(
  eventId: string,
  storage: StorageAdapter = getDefaultStorage(),
): number {
  try {
    if (typeof eventId !== "string" || eventId === "") {
      return -1;
    }
    return timeTrialBestFromTable(loadSave(storage).records, eventId);
  } catch {
    return -1;
  }
}

// v1 snake_case alias (same reference).
export const get_best = getBest;

// Record a lap through load-modify-save (TimeTrial.save_best_if_faster
// idiom): true + merged write only when eventId is non-empty, timeS is a
// positive finite number, and no stored best_time_s beats it; sibling keys
// (best_drift_score, ...) are preserved. best_position defaults to 1 and
// falls back to 1 (or the stored slot) when the given place is not a
// whole number >= 1, so the saved document always validates. Never throws.
export function saveBestIfFaster(
  eventId: string,
  timeS: number,
  place = 1,
  storage: StorageAdapter = getDefaultStorage(),
): boolean {
  try {
    if (typeof eventId !== "string" || eventId === "") {
      return false;
    }
    if (typeof timeS !== "number" || !Number.isFinite(timeS) || timeS <= 0) {
      return false;
    }
    const data = loadSave(storage);
    const stored = timeTrialBestFromTable(data.records, eventId);
    if (stored > 0 && stored <= timeS) {
      return false;
    }
    const table = data.records as unknown as Record<string, unknown>;
    const raw = table[eventId];
    const merged: Record<string, unknown> =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : {};
    const previous = merged.best_position;
    const slot =
      Number.isInteger(place) && (place as number) >= 1
        ? (place as number)
        : Number.isInteger(previous) && (previous as number) >= 1
          ? (previous as number)
          : 1;
    merged.best_time_s = timeS;
    merged.best_position = slot;
    table[eventId] = merged;
    data.records = table as typeof data.records;
    saveNow(data, storage);
    return true;
  } catch {
    return false;
  }
}

// v1 snake_case alias (same reference).
export const save_best_if_faster = saveBestIfFaster;

// Highest stored judged score for eventId, or 0 when empty/unknown
// (mirrors the race/drift bestFromTable contract). Never throws.
export function getDriftBest(
  eventId: string,
  storage: StorageAdapter = getDefaultStorage(),
): number {
  try {
    if (typeof eventId !== "string" || eventId === "") {
      return 0;
    }
    return driftBestFromTable(loadSave(storage).records, eventId);
  } catch {
    return 0;
  }
}

// v1 snake_case alias (same reference).
export const get_drift_best = getDriftBest;

// Record a judged run through load-modify-save (drift banked-best idiom):
// the score truncates to a whole int first; true + merged write only when
// eventId is non-empty, the truncated score is positive, and no stored
// best_drift_score reaches it; sibling keys (best_time_s, ...) are
// preserved. Never throws.
export function saveBestIfHigher(
  eventId: string,
  score: number,
  storage: StorageAdapter = getDefaultStorage(),
): boolean {
  try {
    if (typeof eventId !== "string" || eventId === "") {
      return false;
    }
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return false;
    }
    const whole = Math.trunc(score);
    if (whole <= 0) {
      return false;
    }
    const data = loadSave(storage);
    const stored = driftBestFromTable(data.records, eventId);
    if (stored >= whole) {
      return false;
    }
    const table = data.records as unknown as Record<string, unknown>;
    const raw = table[eventId];
    const merged: Record<string, unknown> =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : {};
    merged.best_drift_score = whole;
    table[eventId] = merged;
    data.records = table as typeof data.records;
    saveNow(data, storage);
    return true;
  } catch {
    return false;
  }
}

// v1 snake_case alias (same reference).
export const save_best_if_higher = saveBestIfHigher;

// Snapshot of every positive lap best ({eventId: best_time_s}) from one
// loadSave, for the event-select BEST tags. Never throws.
export function allBests(
  storage: StorageAdapter = getDefaultStorage(),
): Record<string, number> {
  try {
    return allBestsFromTable(loadSave(storage).records);
  } catch {
    return {};
  }
}

// v1 snake_case alias (same reference).
export const all_bests = allBests;

// Probe-attach bags for window.__nsr.race: the main module spreads these
// onto the race/timetrial and race/drift namespaces (same references, no
// imports added to the race modules). Kept here so main.ts never spells
// the writer names (single-writer static scan).
export const timetrialApi = {
  getBest,
  get_best,
  allBests,
  all_bests,
  saveBestIfFaster,
  save_best_if_faster,
};

export const driftApi = {
  getDriftBest,
  get_drift_best,
  saveBestIfHigher,
  save_best_if_higher,
};
