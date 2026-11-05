// Cross-cutting game state (GameState.gd port).
// Tracks the selected event/car/color plus the unlocked-events/cars caches
// and persists the selection across restarts through a coalesced
// load-modify-save: writers mark the store dirty and persist once per frame
// (plus flush() on demand and on unload) instead of writing per assignment.
// The run-mode selector and the last-result handoff stay memory-only and
// are never written to the save.

import {
  getDefaultStorage,
  loadSave,
  saveNow,
  type StorageAdapter,
} from "./save";
import { applyResult as applyProgressionResult } from "./progression";
import type { ApplyResult } from "./progression";

export const DEFAULT_CAR = "sedan";

export const MODE_RACE = "race";
export const MODE_TIME_TRIAL = "time_trial";

export type RunMode = typeof MODE_RACE | typeof MODE_TIME_TRIAL;

// Allow-list guard for the run-mode selector (same allow-list as
// RaceEvent.validate()): true only for "race" and "time_trial".
export function isValidMode(mode: unknown): mode is RunMode {
  return mode === MODE_RACE || mode === MODE_TIME_TRIAL;
}

function toSelection(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toColorIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

export class GameState {
  private readonly storage: StorageAdapter;
  private loading = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unloadHandler: (() => void) | null = null;

  private car = "";
  private color = 0;
  private event = "";
  private unlockedEventCache: string[] = [];
  private unlockedCarCache: string[] = [];

  // Runtime-only run-mode selector: never persisted, so _persist and
  // reload leave it untouched. Only the two canonical handles stick.
  private mode: RunMode = MODE_RACE;

  // In-memory post-race handoff for the results screen: never written to
  // the save, so the schema is untouched.
  private result: Record<string, unknown> = {};

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

  get selectedCar(): string {
    return this.car;
  }

  set selectedCar(value: string) {
    const next = toSelection(value);
    if (this.loading) {
      this.car = next;
      return;
    }
    if (this.car === next) {
      return;
    }
    this.car = next;
    this.requestPersist();
  }

  get selectedColor(): number {
    return this.color;
  }

  set selectedColor(value: number) {
    const next = toColorIndex(value);
    if (this.loading) {
      this.color = next;
      return;
    }
    if (this.color === next) {
      return;
    }
    this.color = next;
    this.requestPersist();
  }

  get currentEvent(): string {
    return this.event;
  }

  set currentEvent(value: string) {
    const next = toSelection(value);
    if (this.loading) {
      this.event = next;
      return;
    }
    if (this.event === next) {
      return;
    }
    this.event = next;
    this.requestPersist();
  }

  // Read-only unlock caches, refreshed by reloadFromDisk; never written
  // by _persist (only progression.applyResult writes the unlock lists).
  get unlockedEvents(): string[] {
    return [...this.unlockedEventCache];
  }

  get unlockedCars(): string[] {
    return [...this.unlockedCarCache];
  }

  get currentMode(): RunMode {
    return this.mode;
  }

  set currentMode(value: RunMode) {
    if (!isValidMode(value)) {
      return;
    }
    this.mode = value;
  }

  // True when the in-memory run mode names the solo time-trial mode.
  isTimeTrialMode(): boolean {
    return this.mode === MODE_TIME_TRIAL;
  }

  // Typed writer: record the chosen event and persist it.
  selectEvent(routeId: string): void {
    this.currentEvent = routeId;
  }

  // Typed reader: return the chosen event handle (empty when none).
  getCurrentEvent(): string {
    return this.event;
  }

  // Typed reader: return the chosen car handle (empty when none).
  getSelectedCar(): string {
    return this.car;
  }

  // Typed reader: return the canonical default car handle.
  getDefaultCar(): string {
    return DEFAULT_CAR;
  }

  // Typed writer: record the run mode in memory only. Unknown values are
  // ignored with no persist side effect.
  selectMode(mode: string): void {
    if (!isValidMode(mode)) {
      return;
    }
    this.mode = mode;
  }

  // Typed writer: record the chosen car and persist it.
  selectCar(carId: string): void {
    this.selectedCar = carId;
  }

  // Typed writer: record the chosen paint index and persist it.
  selectColor(colorIdx: number): void {
    this.selectedColor = colorIdx;
  }

  // Typed reader: return the chosen paint index.
  getSelectedColor(): number {
    return this.color;
  }

  // Typed writer: store a duplicate of the result dict for the results
  // screen (memory only).
  setLastResult(result: Record<string, unknown>): void {
    this.result = { ...result };
  }

  // Typed writer: drop the handoff so the next boot falls back to the mock.
  clearLastResult(): void {
    this.result = {};
  }

  // Typed reader: return a duplicate of the result dict.
  getLastResult(): Record<string, unknown> {
    return { ...this.result };
  }

  // Thin wrapper: record a result through the ladder, then refresh the
  // caches (mirrors GameState.apply_result).
  applyResult(eventId: string, place: number): ApplyResult {
    const result = applyProgressionResult(eventId, place, this.storage);
    this.reloadFromDisk();
    return result;
  }

  // Re-read the save into the selection and the unlock caches. Missing or
  // corrupt files fall back to defaults without erroring, non-numeric
  // selected_color falls back to 0, non-string selections fall back to "",
  // and write-back stays suppressed. The in-memory mode and result are
  // preserved across reloads.
  reloadFromDisk(): void {
    this.pending = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.loading = true;
    const data = loadSave(this.storage);
    const raw = data.progress as unknown as Record<string, unknown>;
    this.car = toSelection(raw.selected_car);
    this.color = toColorIndex(raw.selected_color);
    this.event = toSelection(raw.current_event);
    this.unlockedEventCache = sanitizeList(raw.unlocked_events);
    this.unlockedCarCache = sanitizeList(raw.unlocked_cars);
    this.loading = false;
  }

  // Merge the live selection into the saved document, keeping settings,
  // unlocked lists, and records opaque for other owners.
  private persist(): void {
    if (this.loading) {
      return;
    }
    const data = loadSave(this.storage);
    data.progress.selected_car = this.car;
    data.progress.selected_color = this.color;
    data.progress.current_event = this.event;
    saveNow(data, this.storage);
  }

  // Mark the selection dirty and schedule exactly one deferred write-back,
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

  // Synchronous read-your-writes: durably store the pending selection now.
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

// Snapshot sanitizer for the unlock caches: non-Arrays yield empty,
// otherwise keep non-empty strings in order.
function sanitizeList(value: unknown): string[] {
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

// Shared autoload-equivalent handle (GameState.gd singleton idiom).
export const gameState = new GameState();
