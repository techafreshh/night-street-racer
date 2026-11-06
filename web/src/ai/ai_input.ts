// Pure-pursuit AI bridge ported from scripts/ai/ai_input.gd.
// Engine-free module: no DOM, no 3D engine — the fixed step and vitest
// load it directly. Steering pursues a speed-scaled lookahead point;
// throttle/brake track the baked curvature target speed. The output
// matches the VehicleInputs seam (throttle/brake/steer plus the
// handbrake/reset flags Vehicle.step reads), so it assigns directly onto
// Vehicle.inputs. The XZ projection core (arc/point/speed, closest index,
// curvature, throttle cap, top speed) is the canonical racing_line.ts
// implementation — this module only normalizes samples to finite Pt lists
// and delegates, mirroring scripts/ai/ai_input.gd which calls into
// RacingLine instead of re-implementing it.

import {
  MAX_SPEED,
  arcOf,
  closestIndex,
  curvatureOf,
  pointAtArc,
  speedAtArc,
  throttleCap,
} from "./racing_line";

export const LOOKAHEAD_BASE = 4.0;
export const LOOKAHEAD_GAIN = 0.5;
export const LOOKAHEAD_MAX = 16.0;
export const STEER_GAIN = 1.5;
export const ANG_DAMP = 0.3;
export const THROTTLE_GAIN = 0.5;
export const BRAKE_GAIN = 0.4;
export const DEADBAND = 0.5;

export type AiDrive = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  reset: boolean;
};

type Pt = {
  x: number;
  z: number;
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function wrapPi(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function coordOf(point: unknown, key: string): number {
  if (Array.isArray(point)) {
    if (key === "x") {
      return typeof point[0] === "number" ? point[0] : NaN;
    }
    if (key === "z") {
      return typeof point[point.length >= 3 ? 2 : 1] === "number"
        ? (point[point.length >= 3 ? 2 : 1] as number)
        : NaN;
    }
    return NaN;
  }
  if (point !== null && typeof point === "object") {
    const cand = (point as Record<string, unknown>)[key];
    return typeof cand === "number" ? cand : NaN;
  }
  return NaN;
}

function ptOf(value: unknown): Pt | null {
  const x = coordOf(value, "x");
  const z = coordOf(value, "z");
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  return { x, z };
}

function ptsOf(value: unknown): Pt[] {
  let src = value;
  if (!Array.isArray(src) && src !== null && typeof src === "object") {
    const rec = src as Record<string, unknown>;
    if (Array.isArray(rec.points)) {
      src = rec.points;
    } else if (Array.isArray(rec.waypoints)) {
      src = rec.waypoints;
    } else if (Array.isArray(rec.line)) {
      src = rec.line;
    } else {
      return [];
    }
  }
  if (!Array.isArray(src)) {
    return [];
  }
  const out: Pt[] = [];
  for (const entry of src) {
    const p = ptOf(entry);
    if (p !== null) {
      out.push(p);
    }
  }
  return out;
}

// Speed-scaled lookahead distance, clamped to [base, max].
export function lookaheadFor(speed: unknown): number {
  let v = NaN;
  if (typeof speed === "number") {
    v = speed;
  } else if (speed !== null && typeof speed === "object" && !Array.isArray(speed)) {
    const rec = speed as Record<string, unknown>;
    for (const key of ["speedMs", "speed_ms", "speed", "velocity", "v"]) {
      const cand = rec[key];
      if (typeof cand === "number" && Number.isFinite(cand)) {
        v = cand;
        break;
      }
    }
  }
  if (!Number.isFinite(v)) {
    return LOOKAHEAD_BASE;
  }
  return clamp(LOOKAHEAD_BASE + LOOKAHEAD_GAIN * v, LOOKAHEAD_BASE, LOOKAHEAD_MAX);
}

// v1 snake_case alias (same reference).
export const lookahead_for = lookaheadFor;

function firstFinite(bag: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const cand = bag[key];
    if (typeof cand === "number" && Number.isFinite(cand)) {
      return cand;
    }
  }
  return NaN;
}

function loopOfBag(bag: Record<string, unknown>): boolean {
  for (const key of ["loop", "loop_line", "loopLine", "closed"]) {
    if (typeof bag[key] === "boolean") {
      return bag[key] as boolean;
    }
  }
  return true;
}

// Pursuit core: steer = clamp(-1.5*ang - 0.3*yawRate); err = target -
// speed with a 0.5 m/s deadband (throttle = clamp(err*0.5),
// brake = clamp(-err*0.4), else coast). Samples accept the issue's flat
// {speedMs, yawRate} + angle-to-lookahead triple under several harness
// spellings, positional (speed, angle, target, yawRate) numbers, or
// end-to-end line + car-pose geometry (angle/target derived from the
// lookahead point and the baked speeds when not given outright).
export function aiInput(...args: unknown[]): AiDrive {
  const coast: AiDrive = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
  const bag: Record<string, unknown> = {};
  const numArgs: number[] = [];
  let barePoints: unknown = null;
  let bareSpeeds: unknown = null;
  const bareFlats: unknown[] = [];
  let loopOverride: boolean | null = null;
  for (const arg of args) {
    if (typeof arg === "number" && Number.isFinite(arg)) {
      numArgs.push(arg);
    } else if (typeof arg === "boolean") {
      loopOverride = arg;
    } else if (Array.isArray(arg)) {
      if (arg.length > 0 && (Array.isArray(arg[0]) || (arg[0] !== null && typeof arg[0] === "object"))) {
        if (barePoints === null) {
          barePoints = arg;
        }
      } else if (arg.length > 0 && arg.every((e) => typeof e === "number")) {
        if (arg.length >= 4 && bareSpeeds === null) {
          bareSpeeds = arg;
        } else {
          bareFlats.push(arg);
        }
      }
    } else if (arg !== null && typeof arg === "object") {
      const rec = arg as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        if (!(key in bag)) {
          bag[key] = rec[key];
        }
      }
      if (barePoints === null && (Array.isArray(rec.points) || Array.isArray(rec.waypoints) || Array.isArray(rec.line))) {
        barePoints = rec.points ?? rec.waypoints ?? rec.line;
      }
      if (
        bareSpeeds === null &&
        (Array.isArray(rec.speeds) || Array.isArray(rec.targetSpeeds) || Array.isArray(rec.target_speeds))
      ) {
        bareSpeeds = rec.speeds ?? rec.targetSpeeds ?? rec.target_speeds;
      }
    }
  }
  let speed = firstFinite(bag, ["speedMs", "speed_ms", "speed", "velocity", "v", "forwardSpeed", "forward_speed"]);
  let angle = firstFinite(bag, [
    "angle",
    "ang",
    "headingError",
    "heading_error",
    "headingErr",
    "alpha",
    "bearing",
    "lookAngle",
    "look_angle",
  ]);
  let target = firstFinite(bag, [
    "targetSpeed",
    "target_speed",
    "target",
    "desired",
    "desiredSpeed",
    "desired_speed",
    "lineSpeed",
    "line_speed",
    "reference",
    "ref",
  ]);
  let yawRate = firstFinite(bag, [
    "yawRate",
    "yaw_rate",
    "yawrate",
    "yawVelocity",
    "yaw_velocity",
    "dang",
    "dAng",
    "turnRate",
    "turn_rate",
  ]);
  let slot = 0;
  if (!Number.isFinite(speed) && slot < numArgs.length) {
    speed = numArgs[slot];
    slot += 1;
  }
  if (!Number.isFinite(angle) && slot < numArgs.length) {
    angle = numArgs[slot];
    slot += 1;
  }
  if (!Number.isFinite(target) && slot < numArgs.length) {
    target = numArgs[slot];
    slot += 1;
  }
  if (!Number.isFinite(yawRate) && slot < numArgs.length) {
    yawRate = numArgs[slot];
    slot += 1;
  }
  if (!Number.isFinite(speed)) {
    speed = 0;
  }
  if (!Number.isFinite(yawRate)) {
    yawRate = 0;
  }
  const pts = ptsOf(barePoints ?? bag.points ?? bag.waypoints ?? bag.line ?? []);
  const rawSpeeds = Array.isArray(bareSpeeds)
    ? (bareSpeeds as unknown[])
    : Array.isArray(bag.speeds)
      ? (bag.speeds as unknown[])
      : [];
  const speeds: number[] = rawSpeeds
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN))
    .filter((v) => Number.isFinite(v));
  const closed = loopOverride ?? loopOfBag(bag);
  const carPos =
    ptOf(
      bag.carPos ??
        bag.car_pos ??
        bag.carPosition ??
        bag.car_position ??
        bag.car ??
        bag.position ??
        bag.pos ??
        bag.ownPos ??
        bag.own_pos ??
        bareFlats[0],
    ) ?? (bareFlats.length > 0 ? ptOf(bareFlats[0]) : null);
  const lookExplicit = ptOf(
    bag.lookPoint ??
      bag.look_point ??
      bag.look ??
      bag.lookaheadPoint ??
      bag.lookahead_point ??
      bag.targetPoint ??
      bag.target_point ??
      (bareFlats.length > 1 ? bareFlats[1] : null),
  );
  const carYaw = firstFinite(bag, ["carYaw", "car_yaw", "yaw", "heading", "headingYaw", "heading_yaw"]);
  const fwd = ptOf(bag.fwd ?? bag.forward ?? bag.forwardVec ?? bag.dir ?? bag.direction);
  if (!Number.isFinite(angle)) {
    let look: Pt | null = lookExplicit;
    if (look === null && carPos !== null && pts.length >= 2) {
      const arc = arcOf(pts, carPos, closed);
      look = pointAtArc(pts, arc + lookaheadFor(speed), closed);
    }
    if (look !== null && carPos !== null) {
      const want = Math.atan2(-(look.x - carPos.x), -(look.z - carPos.z));
      if (Number.isFinite(carYaw)) {
        angle = wrapPi(want - carYaw);
      } else if (fwd !== null) {
        angle = wrapPi(want - Math.atan2(-fwd.x, -fwd.z));
      } else {
        angle = 0;
      }
    } else {
      angle = 0;
    }
  }
  if (!Number.isFinite(target)) {
    if (speeds.length > 0 && carPos !== null && pts.length >= 2) {
      target = speedAtArc(pts, speeds, arcOf(pts, carPos, closed), closed);
    } else if (speeds.length > 0) {
      target = Math.max(...speeds);
    } else {
      target = MAX_SPEED;
    }
  }
  // Off-track slowdown (Godot parity): shed target speed when pointing
  // off-track — mirrors scripts/ai/ai_input.gd
  // `target *= clampf(1.2 - absf(ang) * 1.5, 0.35, 1.0)`. At angle 0 the
  // factor is exactly 1.0 so aligned pursuit is unaffected.
  if (Number.isFinite(target) && Number.isFinite(angle)) {
    target = (target as number) * clamp(1.2 - Math.abs(angle as number) * 1.5, 0.35, 1.0);
  }
  const steer = clamp(-STEER_GAIN * (angle as number) - ANG_DAMP * (yawRate as number), -1, 1);
  const err = (target as number) - (speed as number);
  // Cornering-load throttle cap (Godot parity): lat_load = max(|yawRate| *
  // |speed|, speed^2 * kappa) with kappa = max(curv(carIdx), curv(lookIdx)).
  // Explicit bag keys win; geometry kappa applies when line points plus a
  // car pose are present; flat harness calls fall back to the yaw term.
  const latExplicit = firstFinite(bag, ["latLoad", "lat_load", "latAccel", "lat_accel", "lateralLoad", "lateral_load"]);
  const kappaExplicit = firstFinite(bag, ["kappa", "curvature"]);
  const grip = firstFinite(bag, ["gripBudget", "grip_budget", "grip"]);
  const spd = speed as number;
  const yaw = yawRate as number;
  let lat = Math.abs(yaw) * Math.abs(spd);
  if (Number.isFinite(latExplicit)) {
    lat = latExplicit;
  } else {
    let kappa = kappaExplicit;
    if (!Number.isFinite(kappa) && pts.length >= 3 && carPos !== null) {
      const carIdx = closestIndex(pts, carPos);
      let lookPt = lookExplicit;
      if (lookPt === null) {
        lookPt = pointAtArc(pts, arcOf(pts, carPos, closed) + lookaheadFor(spd), closed);
      }
      const lookIdx = closestIndex(pts, lookPt);
      kappa = Math.max(curvatureOf(pts, carIdx, closed), curvatureOf(pts, lookIdx, closed));
    }
    if (Number.isFinite(kappa as number)) {
      lat = Math.max(lat, spd * spd * (kappa as number));
    }
  }
  const thrCap = throttleCap(lat, grip);
  if (!Number.isFinite(err) || !Number.isFinite(steer)) {
    return coast;
  }
  if (err > DEADBAND) {
    return {
      throttle: Math.min(clamp(err * THROTTLE_GAIN, 0, 1), thrCap),
      brake: 0,
      steer,
      handbrake: false,
      reset: false,
    };
  }
  if (err < -DEADBAND) {
    return {
      throttle: 0,
      brake: clamp(-err * BRAKE_GAIN, 0, 1),
      steer,
      handbrake: false,
      reset: false,
    };
  }
  return { throttle: 0, brake: 0, steer, handbrake: false, reset: false };
}

// v1 snake_case alias (same reference).
export const ai_input = aiInput;
