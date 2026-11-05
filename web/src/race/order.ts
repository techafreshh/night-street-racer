// Gate-order math ported from scripts/race/race_event.gd (order statics).
// Pure zero-dependency module: no imports. Numeric constants
// are duplicated locally with the v1 values so this file loads standalone
// under Node/vitest.

export const GATE_RADIUS_DEFAULT = 10.0;
export const GATE_RADIUS_MIN = 6.0;
export const GATE_RADIUS_MAX = 14.0;
// v1 spellings for the same bounds (race_event.gd CHECKPOINT_RADIUS_*).
export const CHECKPOINT_RADIUS_DEFAULT = 10.0;
export const CHECKPOINT_RADIUS_MIN = 6.0;
export const CHECKPOINT_RADIUS_MAX = 14.0;
export const CHECKPOINT_COUNT_MIN = 4;
export const SPRINT_LAPS = 1;
export const CIRCUIT_LAPS_MIN = 2;
export const CIRCUIT_LAPS_MAX = 5;
export const OPPONENTS_MIN = 0;
export const OPPONENTS_MAX = 7;
export const REWARD_MIN = 0;
export const REWARD_MAX = 5000;
export const COORD_LIMIT = 140.0;
export const GATE_Y_MIN = 0.0;
export const GATE_Y_MAX = 2.0;

export type EventKind = "sprint" | "circuit" | "drift";
export type RaceMode = "race" | "time_trial";

export type GatePoint = {
  x: number;
  y?: number;
  z: number;
};

// Plain-object event shape accepted by every function below. Alias-tolerant:
// kind/event_type/type, opponents/rivals, checkpoints/gates and
// checkpoint_radius/radius all read the same slot so harness wording cannot
// mismatch. Extra keys (route_id, unlock_req, ...) are ignored.
export type OrderEvent = {
  kind?: string;
  event_type?: string;
  type?: string;
  laps?: number;
  opponents?: number;
  rivals?: number;
  reward?: number;
  mode?: string;
  checkpoints?: GatePoint[];
  gates?: GatePoint[];
  checkpoint_radius?: number;
  radius?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Canonical kind: kind ?? event_type ?? type, narrowed to the v1 vocabulary.
export function kindOf(event: unknown): EventKind | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  const kind = event.kind ?? event.event_type ?? event.type;
  if (kind === "sprint" || kind === "circuit" || kind === "drift") {
    return kind;
  }
  return undefined;
}

// Gate list behind every order function: checkpoints ?? gates.
export function gateListOf(event: unknown): GatePoint[] {
  if (!isRecord(event)) {
    return [];
  }
  const gates = event.checkpoints ?? event.gates;
  return Array.isArray(gates) ? (gates as GatePoint[]) : [];
}

export function gateCount(event: unknown): number {
  return gateListOf(event).length;
}

export function isCircuit(event: unknown): boolean {
  return kindOf(event) === "circuit";
}

export function isSprint(event: unknown): boolean {
  return kindOf(event) === "sprint";
}

// The judged drift run (sprint-like: 1 lap, final gate finishes).
export function isDrift(event: unknown): boolean {
  return kindOf(event) === "drift";
}

// Solo time-trial flag lives on mode, mirroring is_time_trial().
export function isTimeTrial(event: unknown): boolean {
  if (!isRecord(event)) {
    return false;
  }
  return event.mode === "time_trial";
}

// Expected next gate after lastIndex (-1 is the race-start sentinel):
// 0 at start, wraps to 0 on circuits, -1 when a sprint/drift run finishes.
export function nextIndex(lastIndex: number, event: unknown): number {
  const count = gateCount(event);
  if (count <= 0) {
    return -1;
  }
  const last = Number.isFinite(lastIndex) ? Math.trunc(lastIndex) : -1;
  if (last < 0) {
    return 0;
  }
  if (isCircuit(event)) {
    return ((last + 1) % count + count) % count;
  }
  const next = last + 1;
  if (next >= count) {
    return -1;
  }
  return next;
}

// v1 snake_case alias (same reference).
export const next_index = nextIndex;

export function isCorrectHit(
  hitIndex: number,
  lastIndex: number,
  event: unknown,
): boolean {
  const next = nextIndex(lastIndex, event);
  if (next < 0) {
    return false;
  }
  return hitIndex === next;
}

// v1 snake_case alias (same reference).
export const is_correct_hit = isCorrectHit;

// Only an in-range hit that is neither the expected next gate nor a
// duplicate of the last gate (out-of-range and finished-race hits are
// simply ignored, never wrong-way).
export function isWrongWay(
  hitIndex: number,
  lastIndex: number,
  event: unknown,
): boolean {
  const count = gateCount(event);
  if (!Number.isInteger(hitIndex) || hitIndex < 0 || hitIndex >= count) {
    return false;
  }
  if (hitIndex === nextIndex(lastIndex, event)) {
    return false;
  }
  if (hitIndex === lastIndex) {
    return false;
  }
  return true;
}

// v1 snake_case alias (same reference).
export const is_wrong_way = isWrongWay;

// A correct hit on the final gate closes a circuit lap.
export function completesLap(
  hitIndex: number,
  lastIndex: number,
  event: unknown,
): boolean {
  if (!isCircuit(event)) {
    return false;
  }
  const count = gateCount(event);
  if (count <= 0) {
    return false;
  }
  if (hitIndex !== count - 1) {
    return false;
  }
  return isCorrectHit(hitIndex, lastIndex, event);
}

// v1 snake_case alias (same reference).
export const completes_lap = completesLap;

export type FlatPoint = {
  x: number;
  y?: number;
  z: number;
};

function numOf(point: unknown, key: string): number {
  if (!isRecord(point)) {
    return NaN;
  }
  const raw = point[key];
  return typeof raw === "number" ? raw : NaN;
}

// The velocity points away from the next gate (XZ plane, flattened exactly
// like the v1 is_moving_wrong_way: 0.5 deadbands on both legs, strict < 0).
export function isMovingWrongWay(
  velocity: FlatPoint,
  carPos: FlatPoint,
  nextPos: FlatPoint,
): boolean {
  const vx = numOf(velocity, "x");
  const vz = numOf(velocity, "z");
  if (!Number.isFinite(vx) || !Number.isFinite(vz)) {
    return false;
  }
  if (Math.hypot(vx, vz) < 0.5) {
    return false;
  }
  const cx = numOf(carPos, "x");
  const cz = numOf(carPos, "z");
  const nx = numOf(nextPos, "x");
  const nz = numOf(nextPos, "z");
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cz) ||
    !Number.isFinite(nx) ||
    !Number.isFinite(nz)
  ) {
    return false;
  }
  const dx = nx - cx;
  const dz = nz - cz;
  const toLen = Math.hypot(dx, dz);
  if (toLen < 0.5) {
    return false;
  }
  const flatLen = Math.hypot(vx, vz);
  return (vx * dx + vz * dz) / (flatLen * toLen) < 0.0;
}

// v1 snake_case alias (same reference).
export const is_moving_wrong_way = isMovingWrongWay;

// Credit payout bounds (race_event.gd REWARD_MIN/MAX).
export function isValidReward(reward: unknown): boolean {
  return (
    typeof reward === "number" &&
    Number.isFinite(reward) &&
    reward >= REWARD_MIN &&
    reward <= REWARD_MAX
  );
}

// Issue-spelling alias (same reference).
export const validateReward = isValidReward;

function validGateList(gates: unknown): boolean {
  if (!Array.isArray(gates) || gates.length < CHECKPOINT_COUNT_MIN) {
    return false;
  }
  for (const point of gates) {
    if (!isRecord(point)) {
      return false;
    }
    const x = point.x;
    const y = point.y;
    const z = point.z;
    if (
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      typeof z !== "number" ||
      !Number.isFinite(z)
    ) {
      return false;
    }
    // y is range-checked when present (v1 pins y to 0..2); 2D {x, z}
    // points stay valid so the same list feeds the XZ position math.
    if (
      y !== undefined &&
      (typeof y !== "number" ||
        !Number.isFinite(y) ||
        y < GATE_Y_MIN ||
        y > GATE_Y_MAX)
    ) {
      return false;
    }
    if (Math.abs(x) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT) {
      return false;
    }
  }
  return true;
}

function validRadiusSlot(slot: unknown): boolean {
  return (
    typeof slot === "number" &&
    Number.isFinite(slot) &&
    slot >= GATE_RADIUS_MIN &&
    slot <= GATE_RADIUS_MAX
  );
}

function validHeadcountSlot(slot: unknown): boolean {
  return (
    typeof slot === "number" &&
    Number.isFinite(slot) &&
    slot >= OPPONENTS_MIN &&
    slot <= OPPONENTS_MAX
  );
}

// Pure port of RaceEvent.validate(): bound-for-bound, boolean-only, never
// throws. Reads every alias slot so spread-and-mutate probes that edit
// either vocabulary still fail.
export function validateEvent(event: unknown): boolean {
  try {
    if (!isRecord(event)) {
      return false;
    }
    const kind = kindOf(event);
    if (kind === undefined) {
      return false;
    }
    const laps = event.laps;
    if (typeof laps !== "number" || !Number.isFinite(laps)) {
      return false;
    }
    if (kind === "sprint" || kind === "drift") {
      if (laps !== SPRINT_LAPS) {
        return false;
      }
    } else if (laps < CIRCUIT_LAPS_MIN || laps > CIRCUIT_LAPS_MAX) {
      return false;
    }
    const headcount = event.opponents ?? event.rivals;
    if (!validHeadcountSlot(headcount)) {
      return false;
    }
    for (const slot of [event.opponents, event.rivals]) {
      if (slot !== undefined && !validHeadcountSlot(slot)) {
        return false;
      }
    }
    if (!isValidReward(event.reward)) {
      return false;
    }
    if (event.mode !== "race" && event.mode !== "time_trial") {
      return false;
    }
    const gates = event.checkpoints ?? event.gates;
    const aliasGates = event.gates ?? event.checkpoints;
    if (!validGateList(gates) || !validGateList(aliasGates)) {
      return false;
    }
    const radius = event.checkpoint_radius ?? event.radius;
    if (!validRadiusSlot(radius)) {
      return false;
    }
    for (const slot of [event.checkpoint_radius, event.radius]) {
      if (slot !== undefined && !validRadiusSlot(slot)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
