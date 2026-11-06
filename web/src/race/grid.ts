// Starting-grid composition ported from scripts/race/race.gd (_spawn_rivals).
// Pure module: only data/events, data/tunes, race/order and the pure AI
// math (racing line bake, pursuit input, rubber band) are imported — no
// rendering engine, no physics engine, no DOM access, so vitest and the fixed step
// drive the same code. The grid bakes the event line once, advances a
// lightweight kinematic fleet of same-car rivals each fixed tick, and feeds
// the full chassis array into the authoritative RaceManager; the manager
// stays the sole owner of positions, standings, and finish records.

import { getEvent } from "../data/events";
import { getTune, type CarTune } from "../data/tunes";
import { isCircuit, OPPONENTS_MAX, OPPONENTS_MIN } from "./order";
import { aiInput, type AiDrive } from "../ai/ai_input";
import {
  arcOf,
  bakeSpeeds,
  pointAtArc,
  speedAtArc,
  trackLength,
} from "../ai/racing_line";
import { computeAid, wrapGap } from "../ai/rubber_band";

// Grid stagger behind the start gate (race.gd rival slots): each rival
// sits one slot further back, alternating sides of the racing line.
export const GRID_BACK_SPACING = 7.0;
export const GRID_LATERAL = 2.5;

// Kinematic ease rates mirroring TRAFFIC_TUNING (accel 6.0, brake 12.0)
// so rivals speed up and slow down like the traffic fleet.
export const GRID_ACCEL = 6.0;
export const GRID_BRAKE = 12.0;

export type GridPoint = {
  x: number;
  y?: number;
  z: number;
};

export type GridPose = {
  position: GridPoint;
  yaw: number;
};

// One kinematic rival: the player's selected car id plus the shared tune
// snapshot (same vehicle/tune), an arc position along the baked line, and
// the live pursuit state refreshed by advance().
export type RivalState = {
  id: string;
  tuneId: string;
  tune_id: string;
  tune: CarTune;
  arc: number;
  speedMs: number;
  speed_ms: number;
  position: GridPoint;
  yaw: number;
  targetSpeed: number;
  target_speed: number;
  aid: number;
  inputs: AiDrive;
};

// Build options: the player's selected car plus the solo time-trial flag.
// Dual casings (car_id/tune_id/time_trial) read the same slot so harness
// wording cannot mismatch.
export type GridBuildOpts = {
  carId?: unknown;
  car_id?: unknown;
  tuneId?: unknown;
  tune_id?: unknown;
  solo?: unknown;
  timeTrial?: unknown;
  time_trial?: unknown;
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function fposmod(value: number, mod: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mod) || mod <= 0) {
    return 0;
  }
  return ((value % mod) + mod) % mod;
}

function moveToward(from: number, to: number, delta: number): number {
  if (Math.abs(to - from) <= delta) {
    return to;
  }
  return from + Math.sign(to - from) * delta;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampHeadcount(value: unknown): number {
  if (!finiteNumber(value)) {
    return 0;
  }
  return clamp(Math.trunc(value), OPPONENTS_MIN, OPPONENTS_MAX);
}

function asGridPoint(value: unknown): GridPoint | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = record.x;
  const z = record.z;
  if (!finiteNumber(x) || !finiteNumber(z)) {
    return null;
  }
  const y = record.y;
  return { x, y: finiteNumber(y) ? y : 1, z };
}

function eventHeadcount(event: unknown): number {
  if (event !== null && typeof event === "object") {
    const record = event as Record<string, unknown>;
    return clampHeadcount(record.opponents ?? record.rivals);
  }
  return 0;
}

function eventIdOf(event: unknown, fallback: string): string {
  if (event !== null && typeof event === "object") {
    const record = event as Record<string, unknown>;
    const id = record.route_id ?? record.id;
    if (typeof id === "string" && id !== "") {
      return id;
    }
  }
  return fallback;
}

function eventModeOf(event: unknown): string {
  if (event !== null && typeof event === "object") {
    const mode = (event as Record<string, unknown>).mode;
    if (typeof mode === "string") {
      return mode;
    }
  }
  return "";
}

function eventPointsOf(event: unknown): GridPoint[] {
  if (event === null || typeof event !== "object") {
    return [];
  }
  const record = event as Record<string, unknown>;
  const raw = record.checkpoints ?? record.gates;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: GridPoint[] = [];
  for (const entry of raw) {
    const point = asGridPoint(entry);
    if (point !== null) {
      out.push(point);
    }
  }
  return out;
}

function resolveCarId(opts: GridBuildOpts | undefined): string {
  const slot =
    opts?.carId ?? opts?.car_id ?? opts?.tuneId ?? opts?.tune_id ?? "sedan";
  if (typeof slot === "string" && slot !== "" && getTune(slot) !== undefined) {
    return slot;
  }
  return "sedan";
}

function resolveSolo(
  opts: GridBuildOpts | undefined,
  event: unknown,
): boolean {
  const slot = opts?.solo ?? opts?.timeTrial ?? opts?.time_trial ?? false;
  if (slot === true) {
    return true;
  }
  return eventModeOf(event) === "time_trial";
}

// Staggered grid slots (race.gd _spawn_rivals idiom): index 0 is the
// player on gate 0 facing gate 1; rival i sits (i+1)*7.0 m behind the
// start along the gate 0->1 direction, alternating +/-2.5 m lateral. Yaw
// everywhere faces gate 1. At least the player slot is always returned.
export function gridStartPoses(
  points: unknown,
  headcount?: unknown,
): GridPose[] {
  const list = Array.isArray(points)
    ? points
        .map((entry) => asGridPoint(entry))
        .filter((entry): entry is GridPoint => entry !== null)
    : [];
  const count = clampHeadcount(headcount);
  const first = list[0] ?? { x: 0, y: 1, z: 0 };
  const second = list[1] ?? null;
  let dirX = 0;
  let dirZ = -1;
  if (second !== null) {
    const dx = second.x - first.x;
    const dz = second.z - first.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      dirX = dx / len;
      dirZ = dz / len;
    }
  }
  const yaw = Math.atan2(-dirX, -dirZ);
  const perpX = -dirZ;
  const perpZ = dirX;
  const baseY = finiteNumber(first.y) ? (first.y as number) : 1;
  const poses: GridPose[] = [
    { position: { x: first.x, y: baseY, z: first.z }, yaw },
  ];
  for (let i = 0; i < count; i += 1) {
    const back = (i + 1) * GRID_BACK_SPACING;
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = side * GRID_LATERAL;
    poses.push({
      position: {
        x: first.x - dirX * back + perpX * lateral,
        y: baseY,
        z: first.z - dirZ * back + perpZ * lateral,
      },
      yaw,
    });
  }
  return poses;
}

// v1 snake_case alias (same reference).
export const grid_start_poses = gridStartPoses;

export class RaceGrid {
  event: unknown = null;
  eventId = "";
  racers: string[] = [];
  rivals: RivalState[] = [];
  points: GridPoint[] = [];
  speeds: number[] = [];
  loop = true;
  total = 0;
  tuneId = "sedan";
  tune: CarTune = (getTune("sedan") ?? {}) as CarTune;
  playerStart: GridPose = { position: { x: 0, y: 1, z: 0 }, yaw: 0 };
  private lastPlayer: GridPoint | null = null;

  get event_id(): string {
    return this.eventId;
  }

  get tune_id(): string {
    return this.tuneId;
  }

  get headcount(): number {
    return this.rivals.length;
  }

  // Resolve the event (string id via data/events, object used directly),
  // size the field to 1+headcount (solo/time-trial forces 1), bake the
  // racing line once, and stagger every rival on the grid. Unknown string
  // ids throw `Unknown event: <id>` (RaceManager.startEvent idiom).
  build(
    eventInput: string | object,
    opts?: GridBuildOpts | string | boolean,
  ): this {
    let event: unknown;
    let hint = "";
    if (typeof eventInput === "string") {
      hint = eventInput;
      const found = getEvent(eventInput);
      if (found === undefined || found === null) {
        throw new Error(`Unknown event: ${eventInput}`);
      }
      event = found;
    } else if (eventInput !== null && typeof eventInput === "object") {
      event = eventInput;
    } else {
      throw new Error(`Unknown event: ${String(eventInput)}`);
    }
    let bag: GridBuildOpts | undefined;
    if (typeof opts === "string") {
      bag = { carId: opts };
    } else if (typeof opts === "boolean") {
      bag = { solo: opts };
    } else {
      bag = opts;
    }
    const solo = resolveSolo(bag, event);
    const headcount = solo ? 0 : eventHeadcount(event);
    const carId = resolveCarId(bag);
    const tune = getTune(carId) ?? getTune("sedan");
    const loop = isCircuit(event);
    const points = eventPointsOf(event);
    const speeds = bakeSpeeds(points, loop);
    let total = 0;
    try {
      total = trackLength(points, loop);
    } catch {
      total = 0;
    }
    if (!finiteNumber(total) || total < 0) {
      total = 0;
    }
    const poses = gridStartPoses(points, headcount);
    const player = poses[0] ?? { position: { x: 0, y: 1, z: 0 }, yaw: 0 };
    this.event = event;
    this.eventId = eventIdOf(event, hint);
    this.loop = loop;
    this.points = points.map((point) => ({ ...point }));
    this.speeds = [...speeds];
    this.total = total;
    this.tuneId = carId;
    if (tune !== undefined) {
      this.tune = tune;
    }
    this.playerStart = {
      position: { ...player.position },
      yaw: player.yaw,
    };
    this.racers = ["player"];
    this.rivals = [];
    for (let i = 0; i < headcount; i += 1) {
      const id = `ai_${i + 1}`;
      this.racers.push(id);
      const pose = poses[i + 1] ?? player;
      const arc =
        loop && total > 1e-9
          ? fposmod(-(i + 1) * GRID_BACK_SPACING, total)
          : -(i + 1) * GRID_BACK_SPACING;
      const target = this.targetFor(arc);
      let drive: AiDrive;
      try {
        drive = aiInput({ speedMs: 0, angle: 0, yawRate: 0, targetSpeed: target });
      } catch {
        drive = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
      }
      this.rivals.push({
        id,
        tuneId: carId,
        tune_id: carId,
        tune: this.tune,
        arc,
        speedMs: 0,
        speed_ms: 0,
        position: { ...pose.position },
        yaw: pose.yaw,
        targetSpeed: target,
        target_speed: target,
        aid: 0,
        inputs: drive,
      });
    }
    this.lastPlayer = { ...this.playerStart.position };
    return this;
  }

  // One kinematic tick: every rival pursues the baked line speed at its
  // arc plus the rubber-band aid toward the leader, easing toward the
  // target with the traffic accel/brake rates, then steps along the line
  // (loops wrap, open lines clamp) with the pose/yaw from pointAtArc.
  advance(dt: number): void {
    if (!finiteNumber(dt) || dt <= 0) {
      return;
    }
    if (this.rivals.length === 0) {
      return;
    }
    if (this.points.length < 2 || this.speeds.length === 0 || !(this.total > 1e-9)) {
      return;
    }
    let leader = -Infinity;
    for (const rival of this.rivals) {
      if (finiteNumber(rival.arc) && rival.arc > leader) {
        leader = rival.arc;
      }
    }
    if (!finiteNumber(leader)) {
      return;
    }
    if (this.lastPlayer !== null) {
      try {
        const playerArc = arcOf(this.points, this.lastPlayer, this.loop);
        if (finiteNumber(playerArc) && playerArc > leader) {
          leader = playerArc;
        }
      } catch {
        // A bad player sample never breaks the fleet tick.
      }
    }
    for (const rival of this.rivals) {
      const gap = this.loop
        ? wrapGap(leader, rival.arc, this.total)
        : leader - rival.arc;
      let aid = 0;
      try {
        aid = computeAid(gap);
      } catch {
        aid = 0;
      }
      const target = this.targetFor(rival.arc) + aid;
      let drive: AiDrive;
      try {
        drive = aiInput({
          speedMs: rival.speedMs,
          angle: 0,
          yawRate: 0,
          targetSpeed: target,
        });
      } catch {
        drive = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
      }
      const rate = target > rival.speedMs ? GRID_ACCEL : GRID_BRAKE;
      const speed = Math.max(0, moveToward(rival.speedMs, target, rate * dt));
      const stepped = rival.arc + speed * dt;
      const arc = this.loop ? fposmod(stepped, this.total) : Math.min(stepped, this.total);
      let pose = { ...rival.position };
      try {
        const at = pointAtArc(
          this.points,
          this.loop ? arc : clamp(arc, 0, this.total),
          this.loop,
        );
        pose = { x: at.x, y: at.y ?? 1, z: at.z };
      } catch {
        // Keep the last pose when the line lookup fails.
      }
      let yaw = rival.yaw;
      try {
        const aheadAt = this.loop ? arc + 2 : Math.min(arc + 2, this.total);
        const ahead = pointAtArc(
          this.points,
          this.loop ? aheadAt : clamp(aheadAt, 0, this.total),
          this.loop,
        );
        const dx = ahead.x - pose.x;
        const dz = ahead.z - pose.z;
        if (Math.hypot(dx, dz) > 1e-6) {
          yaw = Math.atan2(-dx, -dz);
        }
      } catch {
        // Keep the last yaw when the lookahead fails.
      }
      rival.arc = arc;
      rival.speedMs = speed;
      rival.speed_ms = speed;
      rival.position = pose;
      rival.yaw = yaw;
      rival.targetSpeed = target;
      rival.target_speed = target;
      rival.aid = aid;
      rival.inputs = drive;
    }
  }

  // Re-stagger the fleet on the baked line without rebaking: arcs, speeds,
  // and poses return to the grid slots, the player anchor returns to the
  // start, and the tune/line stay put.
  reset(): void {
    if (this.rivals.length === 0) {
      this.lastPlayer = { ...this.playerStart.position };
      return;
    }
    const poses = gridStartPoses(this.points, this.rivals.length);
    const player = poses[0] ?? this.playerStart;
    this.playerStart = { position: { ...player.position }, yaw: player.yaw };
    for (let i = 0; i < this.rivals.length; i += 1) {
      const rival = this.rivals[i];
      const pose = poses[i + 1] ?? player;
      const arc =
        this.loop && this.total > 1e-9
          ? fposmod(-(i + 1) * GRID_BACK_SPACING, this.total)
          : -(i + 1) * GRID_BACK_SPACING;
      const target = this.targetFor(arc);
      let drive: AiDrive;
      try {
        drive = aiInput({ speedMs: 0, angle: 0, yawRate: 0, targetSpeed: target });
      } catch {
        drive = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
      }
      rival.arc = arc;
      rival.speedMs = 0;
      rival.speed_ms = 0;
      rival.position = { ...pose.position };
      rival.yaw = pose.yaw;
      rival.targetSpeed = target;
      rival.target_speed = target;
      rival.aid = 0;
      rival.inputs = drive;
    }
    this.lastPlayer = { ...this.playerStart.position };
  }

  // Index-aligned chassis feed for RaceManager.step: the player sample
  // first, then every rival pose. A missing player sample reuses the last
  // (or start) anchor so the manager keeps its racer-0 track.
  chassisWith(playerPos?: GridPoint | null): GridPoint[] {
    const incoming = asGridPoint(playerPos);
    let player: GridPoint;
    if (incoming !== null) {
      player = incoming;
      this.lastPlayer = { ...incoming };
    } else if (this.lastPlayer !== null) {
      player = { ...this.lastPlayer };
    } else {
      player = { ...this.playerStart.position };
    }
    const out: GridPoint[] = [player];
    for (const rival of this.rivals) {
      out.push({ ...rival.position });
    }
    return out;
  }

  chassis_with(playerPos?: GridPoint | null): GridPoint[] {
    return this.chassisWith(playerPos);
  }

  private targetFor(arc: number): number {
    try {
      const target = speedAtArc(this.points, this.speeds, arc, this.loop);
      return finiteNumber(target) ? target : 0;
    } catch {
      return 0;
    }
  }
}

// Shared grid behind the running service (main.ts plus the garage/results
// arming paths): one build per race arm, advanced by the fixed step.
export const grid = new RaceGrid();

// Single arming helper so startRace, the garage Start button, and the
// results retry cannot diverge: builds the shared grid from the same id.
export function armGridForEvent(
  eventInput: string | object,
  opts?: GridBuildOpts | string | boolean,
): RaceGrid {
  grid.build(eventInput, opts);
  return grid;
}

// v1 snake_case alias (same reference).
export const arm_grid_for_event = armGridForEvent;
