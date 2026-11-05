// Ported event data: all 6 v1 race events as pure data (Appendix A).
// Values transcribed verbatim from assets/events/*.tres (y = 1,
// checkpoint_radius = 10.0 on every event); order follows
// MenuUI.EVENT_PATHS. No imports so a single file loads under Node/vitest.

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type EventType = "sprint" | "circuit" | "drift";

export type EventMode = "race" | "time_trial";

// Canonical v1 keys (route_id, event_type, opponents, unlock_req,
// checkpoints, checkpoint_radius) plus same-reference aliases for the
// issue's mixed vocabulary (id, type, rivals, gates, radius) so harness
// wording cannot mismatch. Plain mutable objects, never frozen, so probes
// can spread-and-mutate variants.
export type GameEvent = {
  route_id: string;
  id: string;
  event_type: EventType;
  type: EventType;
  laps: number;
  opponents: number;
  rivals: number;
  unlock_req: string;
  reward: number;
  mode: EventMode;
  checkpoints: Vec3[];
  gates: Vec3[];
  checkpoint_radius: number;
  radius: number;
};

// Bounds mirrored from scripts/race/race_event.gd.
export const CHECKPOINT_COUNT_MIN = 4;
export const CHECKPOINT_RADIUS_MIN = 6.0;
export const CHECKPOINT_RADIUS_MAX = 14.0;
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

function gate(x: number, z: number): Vec3 {
  return { x, y: 1, z };
}

function makeEvent(
  routeId: string,
  eventType: EventType,
  laps: number,
  opponents: number,
  unlockReq: string,
  reward: number,
  points: Vec3[],
): GameEvent {
  const event: GameEvent = {
    route_id: routeId,
    id: routeId,
    event_type: eventType,
    type: eventType,
    laps,
    opponents,
    rivals: opponents,
    unlock_req: unlockReq,
    reward,
    mode: "race",
    checkpoints: points,
    gates: points,
    checkpoint_radius: 10.0,
    radius: 10.0,
  };
  return event;
}

const HARBOR_POINTS: Vec3[] = [
  gate(-102, 136),
  gate(-51, 136),
  gate(0, 136),
  gate(51, 136),
  gate(102, 136),
];

const DOWNTOWN_POINTS: Vec3[] = [
  gate(-68, -68),
  gate(0, -68),
  gate(68, -68),
  gate(68, 0),
  gate(68, 68),
  gate(0, 68),
  gate(-68, 68),
  gate(-68, 0),
];

const NEON_POINTS: Vec3[] = [
  gate(-136, -136),
  gate(0, -136),
  gate(136, -136),
  gate(136, 0),
  gate(136, 136),
  gate(0, 136),
  gate(-136, 136),
  gate(-136, 0),
];

const BAYLINE_POINTS: Vec3[] = [
  gate(-136, -68),
  gate(-68, -68),
  gate(-68, 0),
  gate(-68, 68),
  gate(-136, 68),
  gate(-136, 0),
];

const ALLEY_POINTS: Vec3[] = [
  gate(68, -102),
  gate(68, -51),
  gate(68, 0),
  gate(68, 51),
  gate(68, 102),
];

const DRIFT_POINTS: Vec3[] = [
  gate(-102, -102),
  gate(-51, -51),
  gate(0, 0),
  gate(51, 51),
  gate(102, 102),
];

export const EVENTS: GameEvent[] = [
  makeEvent("harbor_sprint", "sprint", 1, 3, "", 500, HARBOR_POINTS),
  makeEvent("downtown_gp", "circuit", 3, 5, "harbor_sprint", 1500, DOWNTOWN_POINTS),
  makeEvent("neon_loop", "circuit", 2, 4, "downtown_gp", 1200, NEON_POINTS),
  makeEvent("bayline_circuit", "circuit", 2, 4, "neon_loop", 1000, BAYLINE_POINTS),
  makeEvent("alley_sprint", "sprint", 1, 3, "bayline_circuit", 750, ALLEY_POINTS),
  makeEvent("drift_park", "drift", 1, 3, "alley_sprint", 1000, DRIFT_POINTS),
];

// Alias so both EVENTS and events read the same roster.
export const events: GameEvent[] = EVENTS;

export function getEvent(routeId: string): GameEvent | undefined {
  for (const event of EVENTS) {
    if (event.route_id === routeId || event.id === routeId) {
      return event;
    }
  }
  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validGateList(gates: unknown): boolean {
  if (!Array.isArray(gates) || gates.length < CHECKPOINT_COUNT_MIN) {
    return false;
  }
  for (const p of gates) {
    if (p === null || typeof p !== "object") {
      return false;
    }
    const point = p as { x?: unknown; y?: unknown; z?: unknown };
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y) || !isFiniteNumber(point.z)) {
      return false;
    }
    if (point.y < GATE_Y_MIN || point.y > GATE_Y_MAX) {
      return false;
    }
    if (Math.abs(point.x) > COORD_LIMIT || Math.abs(point.z) > COORD_LIMIT) {
      return false;
    }
  }
  return true;
}

// Pure port of RaceEvent.validate(): bound-for-bound, boolean only, never
// throws. Checks every alias slot so spread-and-mutate probes that edit
// either vocabulary still fail.
export function validateEvent(event: unknown): boolean {
  try {
    if (event === null || typeof event !== "object") {
      return false;
    }
    const e = event as Partial<GameEvent>;
    const routeId = e.route_id ?? e.id;
    if (typeof routeId !== "string" || routeId === "") {
      return false;
    }
    const eventType = e.event_type ?? e.type;
    if (eventType !== "sprint" && eventType !== "circuit" && eventType !== "drift") {
      return false;
    }
    if (!isFiniteNumber(e.laps)) {
      return false;
    }
    if (eventType === "sprint" || eventType === "drift") {
      if (e.laps !== SPRINT_LAPS) {
        return false;
      }
    } else if (e.laps < CIRCUIT_LAPS_MIN || e.laps > CIRCUIT_LAPS_MAX) {
      return false;
    }
    for (const headcount of [e.opponents, e.rivals]) {
      if (headcount !== undefined) {
        if (!isFiniteNumber(headcount) || headcount < OPPONENTS_MIN || headcount > OPPONENTS_MAX) {
          return false;
        }
      }
    }
    if (e.opponents === undefined && e.rivals === undefined) {
      return false;
    }
    if (!isFiniteNumber(e.reward) || e.reward < REWARD_MIN || e.reward > REWARD_MAX) {
      return false;
    }
    if (e.mode !== "race" && e.mode !== "time_trial") {
      return false;
    }
    const gates = e.checkpoints ?? e.gates;
    const aliasGates = e.gates ?? e.checkpoints;
    if (!validGateList(gates) || !validGateList(aliasGates)) {
      return false;
    }
    for (const radius of [e.checkpoint_radius, e.radius]) {
      if (radius !== undefined) {
        if (
          !isFiniteNumber(radius) ||
          radius < CHECKPOINT_RADIUS_MIN ||
          radius > CHECKPOINT_RADIUS_MAX
        ) {
          return false;
        }
      }
    }
    if (e.checkpoint_radius === undefined && e.radius === undefined) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
