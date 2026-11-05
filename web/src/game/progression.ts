// Unlock ladder for events and cars (issue #21 port).
// Pure functions over SaveSystem load-modify-save round-trips (like
// Progression/apply_result) so unlocks survive restarts; settings and
// records pass through untouched.

import {
  getDefaultStorage,
  loadSave,
  saveNow,
  type StorageAdapter,
} from "./save";

// Ladder order mirrors MenuUI.EVENT_PATHS (and the unlock_req chain).
export const LADDER: string[] = [
  "harbor_sprint",
  "downtown_gp",
  "neon_loop",
  "bayline_circuit",
  "alley_sprint",
  "drift_park",
];

// Win reward per ladder rung (clamped index): harbor grants coupe,
// downtown grants hatch, neon onward grants awd.
export const REWARD_CARS: string[] = ["coupe", "hatch", "awd"];

export type ApplyResult = {
  unlockedEvents: string[];
  unlockedCars: string[];
  eventUnlocked: string;
  carUnlocked: string;
};

// Coerce any saved value to a clean string list mirroring
// Progression._string_list (kept local to avoid the cross-class
// dependency, as in Godot): non-Array yields empty, non-strings and
// empty strings are dropped in order without deduping.
function stringList(value: unknown): string[] {
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

// Next rung after eventId, or "" when unknown or already last.
export function nextEventAfter(eventId: string): string {
  const idx = LADDER.indexOf(eventId);
  if (idx < 0 || idx + 1 >= LADDER.length) {
    return "";
  }
  return LADDER[idx + 1];
}

// Win reward for eventId (clamped ladder index), or "" when unknown.
export function mappedCar(eventId: string): string {
  const idx = LADDER.indexOf(eventId);
  if (idx < 0) {
    return "";
  }
  return REWARD_CARS[Math.min(idx, REWARD_CARS.length - 1)];
}

function isIntegerPlace(place: unknown): place is number {
  return typeof place === "number" && Number.isInteger(place);
}

// Top-3-opens-next predicate: true only for a known non-final ladder event
// with an integer place of 1-3.
export function canUnlockNext(eventId: unknown, place: unknown): boolean {
  if (typeof eventId !== "string") {
    return false;
  }
  const idx = LADDER.indexOf(eventId);
  if (idx < 0 || idx + 1 >= LADDER.length) {
    return false;
  }
  return (
    isIntegerPlace(place) && (place as number) >= 1 && (place as number) <= 3
  );
}

// Win-unlocks-car predicate: true only for a known ladder event with an
// integer place of exactly 1.
export function carReward(eventId: unknown, place: unknown): boolean {
  if (typeof eventId !== "string" || LADDER.indexOf(eventId) < 0) {
    return false;
  }
  return isIntegerPlace(place) && (place as number) === 1;
}

// Record a result through load-modify-save mirroring
// Progression.apply_result(): place 1-3 records the completed event (which
// opens the next rung) and place 1 additionally grants the mapped car;
// place >= 4, non-integer places, or unknown events are no-ops returning
// the unchanged snapshot. Neither list ever gains a duplicate.
export function applyResult(
  eventId: string,
  place: number,
  storage: StorageAdapter = getDefaultStorage(),
): ApplyResult {
  const data = loadSave(storage);
  const events = stringList(data.progress.unlocked_events);
  const cars = stringList(data.progress.unlocked_cars);
  if (
    typeof eventId !== "string" ||
    LADDER.indexOf(eventId) < 0 ||
    !isIntegerPlace(place) ||
    place < 1 ||
    place > 3
  ) {
    return {
      unlockedEvents: events,
      unlockedCars: cars,
      eventUnlocked: "",
      carUnlocked: "",
    };
  }
  let eventUnlocked = "";
  let carUnlocked = "";
  if (!events.includes(eventId)) {
    events.push(eventId);
    eventUnlocked = nextEventAfter(eventId);
  }
  if (place === 1) {
    const car = mappedCar(eventId);
    if (car !== "" && !cars.includes(car)) {
      cars.push(car);
      carUnlocked = car;
    }
  }
  data.progress.unlocked_events = events;
  data.progress.unlocked_cars = cars;
  saveNow(data, storage);
  return {
    unlockedEvents: events,
    unlockedCars: cars,
    eventUnlocked,
    carUnlocked,
  };
}
