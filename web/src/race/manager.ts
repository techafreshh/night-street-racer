// Race flow ported from scripts/race/event_manager.gd (countdown + clock)
// and scripts/race/race.gd (_standings_entries + _on_finished results).
// Pure state machine over plain {x, y?, z} points: no rendering engine, no physics,
// no DOM, so vitest and the running-service probe drive the same code.
// Only data/events, race/order, race/positions and race/route are imported.

import { getEvent } from "../data/events";
import {
  isMovingWrongWay,
  nextIndex,
  type GatePoint,
} from "./order";
import {
  computePositions,
  fractionToNext,
  progress,
  RaceResults,
  standingsFor,
  type FinishRow,
  type StandingEntry,
} from "./positions";
import {
  gateRadiusOf,
  isInsideGate,
  RaceRoute,
  type CarPoint,
} from "./route";

// Countdown length in seconds (event_manager.gd COUNTDOWN_DURATION); 3.5 s
// unpaused therefore reads racing.
export const COUNTDOWN_DURATION = 3.0;

export type RaceState = "idle" | "countdown" | "racing" | "finished";

// Field override for startEvent: headcount (player + ai_1..), explicit id
// list, or an options bag with count/ids/racers spellings.
export type StartField =
  | number
  | string[]
  | { count?: unknown; ids?: unknown; racers?: unknown };

// Chassis samples per step: omitted (clock-only), one point (racer 0), an
// index-aligned array, or an id-keyed map. Velocities mirror the shape and
// feed only the moving-wrong-way flag.
export type ChassisInput =
  | CarPoint
  | CarPoint[]
  | Record<string, CarPoint>
  | null
  | undefined;

export type VelocityInput = ChassisInput;

// Results payload: positions and places are the same array reference,
// every row stamped with the shared finish clock so tie order equals the
// live standings (race.gd _on_finished idiom).
export type ManagerResults = {
  positions: FinishRow[];
  places: FinishRow[];
  raceTime: number;
  race_time: number;
  eventId: string;
  event_id: string;
  laps: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function makeIds(count: number): string[] {
  const ids = ["player"];
  for (let i = 1; i < count; i++) {
    ids.push(`ai_${i}`);
  }
  return ids;
}

function headcountOf(event: unknown): number {
  if (event !== null && typeof event === "object") {
    const record = event as Record<string, unknown>;
    const slot = record.opponents ?? record.rivals;
    if (finiteNumber(slot)) {
      return Math.max(0, Math.trunc(slot));
    }
  }
  return 0;
}

function lapsOf(event: unknown): number {
  if (event !== null && typeof event === "object") {
    const laps = (event as Record<string, unknown>).laps;
    if (finiteNumber(laps)) {
      return Math.max(1, Math.trunc(laps));
    }
  }
  return 1;
}

function eventIdOf(event: unknown): string {
  if (event !== null && typeof event === "object") {
    const record = event as Record<string, unknown>;
    const id = record.route_id ?? record.id;
    if (typeof id === "string") {
      return id;
    }
  }
  return "";
}

function asPoint(value: unknown): CarPoint | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!finiteNumber(record.x) || !finiteNumber(record.z)) {
    return undefined;
  }
  const point: CarPoint = { x: record.x, z: record.z };
  if (finiteNumber(record.y)) {
    point.y = record.y;
  }
  return point;
}

// Normalize any chassis spelling to an index-aligned sparse list; invalid
// entries stay undefined so the racer keeps its last known sample.
function normalizeInput(input: ChassisInput, count: number): (CarPoint | undefined)[] {
  const out: (CarPoint | undefined)[] = new Array(count).fill(undefined);
  if (input === null || input === undefined) {
    return out;
  }
  if (Array.isArray(input)) {
    for (let i = 0; i < count && i < input.length; i++) {
      const point = asPoint(input[i]);
      if (point !== undefined) {
        out[i] = point;
      }
    }
    return out;
  }
  const single = asPoint(input);
  if (single !== undefined) {
    if (count > 0) {
      out[0] = single;
    }
    return out;
  }
  return out;
}

// Id-keyed chassis map ({ player: {...}, ai_1: {...} }): resolved against
// the field ids after the point/array spellings miss.
function normalizeMapped(
  input: ChassisInput,
  ids: string[],
  sparse: (CarPoint | undefined)[],
): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return;
  }
  if (asPoint(input) !== undefined) {
    return;
  }
  const record = input as Record<string, unknown>;
  for (let i = 0; i < ids.length; i++) {
    const point = asPoint(record[ids[i]]);
    if (point !== undefined) {
      sparse[i] = point;
    }
  }
}

// Nearest gate containing the point (XZ, event radius), or -1 when the car
// is inside none. Nearest wins when radii overlap.
function containingGate(
  pos: CarPoint,
  gates: GatePoint[],
  radius: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (!isInsideGate(pos, gate, radius)) {
      continue;
    }
    const dist = Math.hypot(pos.x - gate.x, pos.z - gate.z);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

export class RaceManager {
  state: RaceState = "idle";
  countdownLeft = COUNTDOWN_DURATION;
  raceTime = 0;
  totalLaps = 1;
  // Racer-0 (player) mirrors: directed order, lap, flag.
  gateIndex = -1;
  currentLap = 0;
  wrongWay = false;
  // Live field order: racer indices sorted by descending progress.
  positions: number[] = [];
  leader = -1;
  progresses: number[] = [];
  standings: StandingEntry[] = [];
  results: ManagerResults | null = null;
  event: unknown = null;
  eventId = "";
  racers: string[] = [];
  // HUD-readable run holders (race.gd _cached_best idiom): plain data,
  // never persisted here. best caches the personal best the HUD diffs the
  // live clock against (null clears the delta); driftTotal accrues the
  // judged score while racing. Preserved across step; cleared here and
  // re-seeded by the caller (game/records reads) after startEvent or
  // resetRace.
  best: number | null = null;
  driftTotal = 0;
  routes: RaceRoute[] = [];
  samples: CarPoint[] = [];
  radius = gateRadiusOf(null);
  paused = false;
  onStateChanged: ((state: RaceState) => void) | null = null;
  onCheckpoint: ((index: number, racer: string) => void) | null = null;

  getState(): RaceState {
    return this.state;
  }

  get_state(): RaceState {
    return this.getState();
  }

  get gate_index(): number {
    return this.gateIndex;
  }

  get current_lap(): number {
    return this.currentLap;
  }

  get wrong_way(): boolean {
    return this.wrongWay;
  }

  get race_time(): number {
    return this.raceTime;
  }

  get countdown_left(): number {
    return this.countdownLeft;
  }

  get total_laps(): number {
    return this.totalLaps;
  }

  get event_id(): string {
    return this.eventId;
  }

  get gates(): GatePoint[] {
    const first = this.routes[0];
    return first === undefined ? [] : first.gates;
  }

  // Resolve the event (string id via data/events, object used directly),
  // size the field to opponents + 1 by default, build one RaceRoute per
  // racer seeded at gate 0, and arm the countdown. Unknown string ids
  // throw `Unknown event: <id>` (Router show throw idiom).
  startEvent(routeId: string | object, field?: StartField): void {
    let event: unknown;
    if (typeof routeId === "string") {
      const found = getEvent(routeId);
      if (found === undefined || found === null) {
        throw new Error(`Unknown event: ${routeId}`);
      }
      event = found;
    } else if (routeId !== null && typeof routeId === "object") {
      event = routeId;
    } else {
      throw new Error(`Unknown event: ${String(routeId)}`);
    }
    const ids = resolveIds(event, field);
    this.event = event;
    this.eventId = eventIdOf(event);
    this.totalLaps = lapsOf(event);
    this.radius = gateRadiusOf(event);
    this.racers = ids;
    this.routes = ids.map(() => new RaceRoute(event));
    const first = this.routes[0];
    const seed: CarPoint =
      first !== undefined && first.gates.length > 0
        ? { ...first.gates[0] }
        : { x: 0, y: 1, z: 0 };
    this.samples = ids.map(() => ({ ...seed }));
    this.raceTime = 0;
    this.countdownLeft = COUNTDOWN_DURATION;
    this.results = null;
    this.best = null;
    this.driftTotal = 0;
    this.gateIndex = -1;
    this.currentLap = 0;
    this.wrongWay = false;
    this.positions = ids.map((_, i) => i);
    this.leader = ids.length > 0 ? 0 : -1;
    this.progresses = ids.map(() => progress(0, -1, 0, this.gateTotal()));
    this.standings = ids.map((id, i) => ({ id, progress: this.progresses[i] }));
    this.emitState("countdown");
  }

  start_event(routeId: string | object, field?: StartField): void {
    this.startEvent(routeId, field);
  }

  // Sole advancer: clock-authoritative, pause-gated. Countdown decrements
  // to racing at <= 0; racing advances race_time, runs per-racer gate
  // checks (containing gate -> registerHit, non-expected containment sets
  // the per-racer wrong-way flag, supplied velocities add the
  // moving-wrong-way flag), refreshes live positions, and finishes the
  // whole field when the first racer completes the final lap. No-ops
  // while paused/idle/finished or on non-positive/non-finite dt.
  step(dt: number, chassis?: ChassisInput, velocities?: VelocityInput): void {
    if (this.paused) {
      return;
    }
    if (this.state === "idle" || this.state === "finished") {
      return;
    }
    if (!finiteNumber(dt) || dt <= 0) {
      return;
    }
    if (this.state === "countdown") {
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 0) {
        this.countdownLeft = 0;
        this.emitState("racing");
      }
      return;
    }
    this.raceTime += dt;
    const points = normalizeInput(chassis, this.routes.length);
    normalizeMapped(chassis, this.racers, points);
    const vels = normalizeInput(velocities, this.routes.length);
    normalizeMapped(velocities, this.racers, vels);
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];
      const incoming = points[i];
      if (incoming !== undefined) {
        this.samples[i] = { ...incoming };
      }
      const pos = this.samples[i];
      if (pos === undefined) {
        continue;
      }
      const hit = containingGate(pos, route.gates, route.radius);
      if (hit >= 0) {
        if (route.registerHit(hit)) {
          this.emitCheckpoint(route.currentIndex, this.racers[i] ?? `ai_${i}`);
        }
      }
      const vel = vels[i];
      if (vel !== undefined) {
        const next = nextIndex(route.currentIndex, this.event);
        if (next >= 0) {
          const gate = route.gateAt(next);
          if (gate !== null && isMovingWrongWay(vel, pos, gate)) {
            route.wrongWay = true;
          }
        }
      }
    }
    this.refreshTrackers();
    for (const route of this.routes) {
      if (route.finished || route.currentLap >= this.totalLaps) {
        this.finishRace();
        break;
      }
    }
  }

  setPaused(value: boolean): void {
    this.paused = value === true;
  }

  set_paused(value: boolean): void {
    this.setPaused(value);
  }

  pause(value: boolean): void {
    this.setPaused(value);
  }

  isPaused(): boolean {
    return this.paused;
  }

  is_paused(): boolean {
    return this.isPaused();
  }

  // Godot can_drive idiom: the manager is armed and the phase is racing.
  canDrive(): boolean {
    return this.state === "racing";
  }

  can_drive(): boolean {
    return this.canDrive();
  }

  // Re-arm the countdown without dropping the event or the field
  // (race.gd restart_race idiom): routes reset, samples re-seeded at gate
  // 0, clock cleared, results dropped. Stays idle when no event is loaded.
  resetRace(): void {
    if (this.routes.length === 0) {
      return;
    }
    for (const route of this.routes) {
      route.reset();
    }
    const first = this.routes[0];
    const seed: CarPoint =
      first !== undefined && first.gates.length > 0
        ? { ...first.gates[0] }
        : { x: 0, y: 1, z: 0 };
    this.samples = this.racers.map(() => ({ ...seed }));
    this.raceTime = 0;
    this.countdownLeft = COUNTDOWN_DURATION;
    this.results = null;
    this.best = null;
    this.driftTotal = 0;
    this.gateIndex = -1;
    this.currentLap = 0;
    this.wrongWay = false;
    this.positions = this.racers.map((_, i) => i);
    this.leader = this.racers.length > 0 ? 0 : -1;
    this.progresses = this.racers.map(() =>
      progress(0, -1, 0, this.gateTotal()),
    );
    this.standings = this.racers.map((id, i) => ({
      id,
      progress: this.progresses[i],
    }));
    this.emitState("countdown");
  }

  reset(): void {
    this.resetRace();
  }

  reset_race(): void {
    this.resetRace();
  }

  private gateTotal(): number {
    const first = this.routes[0];
    const count = first === undefined ? 0 : first.gateCount();
    return count > 0 ? count : 1;
  }

  private refreshTrackers(): void {
    const total = this.gateTotal();
    const scores = this.routes.map((route, i) => {
      const pos = this.samples[i] ?? { x: 0, z: 0 };
      const next = nextIndex(route.currentIndex, this.event);
      let frac = 0;
      if (next >= 0) {
        const nextGate = route.gateAt(next);
        const here = route.currentIndex >= 0 ? route.gateAt(route.currentIndex) : nextGate;
        if (nextGate !== null && here !== null) {
          frac = fractionToNext(pos, here, nextGate);
        }
      }
      return progress(route.currentLap, route.currentIndex, frac, total);
    });
    this.progresses = scores;
    this.standings = standingsFor(
      this.racers.map((id, i) => ({ id, progress: scores[i] })),
    );
    const ranked = computePositions(scores);
    this.leader = ranked.leader;
    this.positions = ranked.order;
    const player = this.routes[0];
    if (player !== undefined) {
      this.gateIndex = player.currentIndex;
      this.currentLap = player.currentLap;
      this.wrongWay = player.wrongWay;
    }
  }

  private finishRace(): void {
    // Stamp the full field first so state listeners (the main.ts
    // results handoff) observe the populated table, then emit.
    const table = new RaceResults();
    for (const entry of this.standings) {
      table.recordFinish(String(entry.id), this.raceTime);
    }
    const rows = table.orderedResults();
    this.results = {
      positions: rows,
      places: rows,
      raceTime: this.raceTime,
      race_time: this.raceTime,
      eventId: this.eventId,
      event_id: this.eventId,
      laps: this.totalLaps,
    };
    this.emitState("finished");
  }

  private emitState(state: RaceState): void {
    this.state = state;
    try {
      this.onStateChanged?.(state);
    } catch {
      // Listener faults must never break the fixed step.
    }
  }

  private emitCheckpoint(index: number, racer: string): void {
    try {
      this.onCheckpoint?.(index, racer);
    } catch {
      // Listener faults must never break the fixed step.
    }
  }
}

function resolveIds(event: unknown, field: StartField | undefined): string[] {
  if (typeof field === "number") {
    if (finiteNumber(field)) {
      return makeIds(Math.max(1, Math.trunc(field)));
    }
  } else if (Array.isArray(field)) {
    const ids = field.filter(
      (id): id is string => typeof id === "string" && id !== "",
    );
    if (ids.length > 0) {
      return [...ids];
    }
  } else if (field !== null && typeof field === "object") {
    const opts = field as { count?: unknown; ids?: unknown; racers?: unknown };
    const list = opts.ids ?? opts.racers;
    if (Array.isArray(list)) {
      const ids = list.filter(
        (id): id is string => typeof id === "string" && id !== "",
      );
      if (ids.length > 0) {
        return [...ids];
      }
    }
    if (finiteNumber(opts.count)) {
      return makeIds(Math.max(1, Math.trunc(opts.count as number)));
    }
  }
  return makeIds(1 + headcountOf(event));
}

// Module singleton so both `import { manager }` and the delegated
// `import { startEvent, step }` spellings drive the same race.
export const manager = new RaceManager();

export function startEvent(routeId: string | object, field?: StartField): void {
  manager.startEvent(routeId, field);
}

export const start_event = startEvent;

export function step(
  dt: number,
  chassis?: ChassisInput,
  velocities?: VelocityInput,
): void {
  manager.step(dt, chassis, velocities);
}

export function getState(): RaceState {
  return manager.getState();
}

export const get_state = getState;

export function setPaused(value: boolean): void {
  manager.setPaused(value);
}

export const set_paused = setPaused;

export function resetRace(): void {
  manager.resetRace();
}

export const reset_race = resetRace;
