// Directed-gate route tracking ported from scripts/race/route.gd.
// Pure math over plain {x, y?, z} points: no rendering engine, no physics,
// so vitest and the running-service probe drive the same code. Gate order
// math delegates to race/order; only order types and statics are imported.

import {
  completesLap,
  isCircuit,
  isCorrectHit,
  isWrongWay,
  type GatePoint,
} from "./order";

// Default gate trigger radius in meters (Checkpoint trigger_radius,
// RaceEvent CHECKPOINT_RADIUS_DEFAULT, data/events checkpoint_radius).
export const GATE_RADIUS_DEFAULT = 10.0;

// Plain car/chassis sample: Y is accepted and ignored (chassis Y bobs with
// suspension while gates are pinned at y = 1, so hits test the XZ plane).
export type CarPoint = {
  x: number;
  y?: number;
  z: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// XZ-plane containment: true when the car is within `radius` meters of the
// gate on the ground plane. Y on either point is ignored. Non-finite
// coordinates or a non-finite/negative radius never contain.
export function isInsideGate(
  carPos: CarPoint,
  gatePos: CarPoint,
  radius: number = GATE_RADIUS_DEFAULT,
): boolean {
  if (carPos === null || typeof carPos !== "object") {
    return false;
  }
  if (gatePos === null || typeof gatePos !== "object") {
    return false;
  }
  if (!finiteNumber(radius) || radius < 0) {
    return false;
  }
  const cx = carPos.x;
  const cz = carPos.z;
  const gx = gatePos.x;
  const gz = gatePos.z;
  if (!finiteNumber(cx) || !finiteNumber(cz)) {
    return false;
  }
  if (!finiteNumber(gx) || !finiteNumber(gz)) {
    return false;
  }
  return Math.hypot(cx - gx, cz - gz) <= radius;
}

// v1 snake_case alias (same reference).
export const is_inside_gate = isInsideGate;

// Per-event gate radius: checkpoint_radius ?? radius ?? 10. Non-finite or
// negative slots fall back to the default so a corrupt event still races.
export function gateRadiusOf(event: unknown): number {
  if (event !== null && typeof event === "object") {
    const record = event as Record<string, unknown>;
    const slot = record.checkpoint_radius ?? record.radius;
    if (finiteNumber(slot) && slot >= 0) {
      return slot;
    }
  }
  return GATE_RADIUS_DEFAULT;
}

// v1 snake_case alias (same reference).
export const gate_radius_of = gateRadiusOf;

// Per-racer directed-route tracker (scripts/race/route.gd RaceRoute port):
// one instance per racer, owned by the race manager, so live positions and
// lap counts stay per-racer instead of one shared counter. lastIndex -1 is
// the race-start sentinel; sprint/drift runs finish on the final gate,
// circuits finish when currentLap reaches the event laps.
export class RaceRoute {
  event: unknown;
  gates: GatePoint[];
  radius: number;
  currentIndex = -1;
  currentLap = 0;
  wrongWay = false;
  finished = false;

  constructor(event: unknown, radius?: number) {
    this.event = event;
    const list = gateList(event);
    this.gates = list.map((gate) => ({ ...gate }));
    this.radius = radius !== undefined ? radius : gateRadiusOf(event);
    if (!finiteNumber(this.radius) || this.radius < 0) {
      this.radius = GATE_RADIUS_DEFAULT;
    }
  }

  get current_index(): number {
    return this.currentIndex;
  }

  get current_lap(): number {
    return this.currentLap;
  }

  get wrong_way(): boolean {
    return this.wrongWay;
  }

  gateCount(): number {
    return this.gates.length;
  }

  gate_count(): number {
    return this.gateCount();
  }

  gateAt(index: number): GatePoint | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.gates.length) {
      return null;
    }
    return this.gates[index];
  }

  gate_at(index: number): GatePoint | null {
    return this.gateAt(index);
  }

  // Feed a gate hit through the order statics; true when the hit was the
  // expected next gate. Mirrors route.gd register_hit: correct hits clear
  // wrong_way and advance (finishing sprints on the final gate and
  // circuits when completes_lap closes the lap); anything else recomputes
  // wrong_way through is_wrong_way (out-of-range hits are ignored, never
  // wrong-way). No-ops once finished.
  registerHit(hitIndex: number): boolean {
    if (this.finished) {
      return false;
    }
    const prev = this.currentIndex;
    if (isCorrectHit(hitIndex, this.currentIndex, this.event)) {
      this.currentIndex = hitIndex;
      this.wrongWay = false;
      if (isCircuit(this.event)) {
        if (completesLap(hitIndex, prev, this.event)) {
          this.currentLap += 1;
          if (this.currentLap >= totalLapsOf(this.event)) {
            this.finished = true;
          }
        }
      } else if (hitIndex === this.gates.length - 1) {
        this.currentLap += 1;
        this.finished = true;
      }
      return true;
    }
    this.wrongWay = isWrongWay(hitIndex, this.currentIndex, this.event);
    return false;
  }

  register_hit(hitIndex: number): boolean {
    return this.registerHit(hitIndex);
  }

  reset(): void {
    this.currentIndex = -1;
    this.currentLap = 0;
    this.wrongWay = false;
    this.finished = false;
  }

  reset_race(): void {
    this.reset();
  }
}

function gateList(event: unknown): GatePoint[] {
  if (event === null || typeof event !== "object") {
    return [];
  }
  const record = event as Record<string, unknown>;
  const gates = record.checkpoints ?? record.gates;
  if (!Array.isArray(gates)) {
    return [];
  }
  return gates.filter(
    (gate): gate is GatePoint =>
      gate !== null &&
      typeof gate === "object" &&
      finiteNumber((gate as GatePoint).x) &&
      finiteNumber((gate as GatePoint).z),
  );
}

function totalLapsOf(event: unknown): number {
  if (event !== null && typeof event === "object") {
    const laps = (event as Record<string, unknown>).laps;
    if (finiteNumber(laps)) {
      return Math.max(1, Math.trunc(laps));
    }
  }
  return 1;
}
