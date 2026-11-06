// Ambient lane-following traffic: pure port of scripts/traffic/traffic_car.gd
// (wanted_speed, closest_progress, ACCEL_RATE, BRAKE_RATE, SAMPLE_COUNT)
// and scripts/traffic/traffic_manager.gd (TRAFFIC_COUNT, RECYCLE_DISTANCE,
// RESPAWN_AHEAD, fleet spawn, recycle) onto the ported LANE_LOOPS corner
// polylines. The pure core (lane math, TrafficCar, Traffic) integrates with
// no engine at all; the kinematic shell (attachKinematics/syncKinematics)
// places kinematicPositionBased bodies with the traffic_car.tscn 1.8/1.0/4.2
// cuboid into the shared drive world so one world.step() moves player and
// traffic together. Kinematic bodies never apply damage forces, so the
// damage-free guarantee is structural. No three.js here (Node-safe: type-only
// Rapier imports, the concrete module arrives as a parameter).
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  LANE_LOOPS,
  TRAFFIC_TUNING,
  type LaneLoop,
  type Vec3,
} from "../data/lanePaths";
import { STEP_DT } from "../core/loop";
import { yawToQuat } from "../physics/vec";

// Full Rapier module surface (the default export of
// @dimforge/rapier3d-compat once initialized via RAPIER.init()).
export type RapierModule = typeof import("@dimforge/rapier3d-compat").default;

// --- Fleet tuning (traffic_manager.gd via TRAFFIC_TUNING) ---

export const TRAFFIC_COUNT = TRAFFIC_TUNING.count;
export const TRAFFIC_CRUISE = TRAFFIC_TUNING.cruise;
export const ACCEL_RATE = TRAFFIC_TUNING.accel;
export const BRAKE_RATE = TRAFFIC_TUNING.brake;
export const RECYCLE_DISTANCE = TRAFFIC_TUNING.recycleDistance;
export const RESPAWN_AHEAD = TRAFFIC_TUNING.respawnAhead;

// --- Yield ray (YieldRay in traffic_car.tscn: local (0, 0.8, -2.0), 10 m) ---

export const YIELD_RAY_LENGTH = 10.0;
export const YIELD_RAY_HEIGHT = 0.8;
export const YIELD_NOSE_OFFSET = 2.0;

// --- Lane sampling (traffic_car.gd SAMPLE_COUNT) ---

export const SAMPLE_COUNT = 64;

// --- Kinematic shell (traffic_car.tscn BoxShape3D 1.8/1.0/4.2 at y + 0.5) ---

export const TRAFFIC_COLLIDER_HALF: Vec3 = { x: 0.9, y: 0.5, z: 2.1 };
export const TRAFFIC_COLLIDER_OFFSET_Y = 0.5;
export const TRAFFIC_FRICTION = 1.0;

// Player anchor fallback when the vehicle is not yet booted.
export const PLAYER_ANCHOR_DEFAULT: Vec3 = { x: 0, y: 0, z: 0 };

function moveToward(from: number, to: number, delta: number): number {
  if (Math.abs(to - from) <= delta) {
    return to;
  }
  return from + Math.sign(to - from) * delta;
}

// Float modulo matching Godot fposmod (always non-negative for b > 0).
export function fposmod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function distSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// Closed-polyline length of a lane loop (last point wraps to first).
export function laneLength(lane: LaneLoop): number {
  const pts = lane.points;
  if (pts.length < 2) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const lane_length = laneLength;

// Pose at a baked distance along the loop: segment-walk with fposmod
// wrap, yaw atan2(-dx, -dz) matching traffic_car.gd _lane_basis.
export function sampleLane(
  lane: LaneLoop,
  offset: number,
): { position: Vec3; yaw: number } {
  const pts = lane.points;
  const fallback = pts[0] ?? { x: 0, y: 0.6, z: 0 };
  if (pts.length < 2) {
    return { position: { ...fallback }, yaw: 0 };
  }
  const total = laneLength(lane);
  if (!(total > 1e-9)) {
    return { position: { ...fallback }, yaw: 0 };
  }
  let rest = fposmod(offset, total);
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (seg < 1e-9) {
      continue;
    }
    if (rest <= seg) {
      const t = rest / seg;
      return {
        position: {
          x: a.x + dx * t,
          y: a.y + dy * t,
          z: a.z + dz * t,
        },
        yaw: Math.atan2(-dx, -dz),
      };
    }
    rest -= seg;
  }
  const a = pts[0];
  const b = pts[1 % pts.length];
  return {
    position: { ...a },
    yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
  };
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const sample_lane = sampleLane;

// Nearest baked offset to a target: 64-sample scan matching
// traffic_car.gd closest_progress. Degenerate lanes read 0.0.
export function closestProgress(lane: LaneLoop, target: Vec3): number {
  const total = laneLength(lane);
  if (lane.points.length < 2 || total < 1.0) {
    return 0;
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const off = (total * i) / SAMPLE_COUNT;
    const s = sampleLane(lane, off).position;
    const d = distSquared(s, target);
    if (d < bestD) {
      bestD = d;
      best = off;
    }
  }
  return best;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const closest_progress = closestProgress;

// Blocked yield ray reads 0.0, clear road reads cruise. Port of
// traffic_car.gd wanted_speed.
export function wantedSpeed(blocked: boolean, cruise: number): number {
  return blocked ? 0.0 : cruise;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const wanted_speed = wantedSpeed;

// Probe-facing car snapshot with both casings (mirrors the __nsr idiom).
export type CarState = {
  position: Vec3;
  speedMs: number;
  speed_ms: number;
  progress: number;
  laneIndex: number;
  lane_index: number;
  yaw: number;
  cruise: number;
  blocked: boolean | null;
};

// Kinematic lane follower: eases toward the yield-ray target speed with
// the accel/brake rate-select, then advances along its lane. Mirrors the
// Vehicle fixed-tick idiom (moveToward, STEP_DT default).
export class TrafficCar {
  laneIndex: number;
  lane: LaneLoop;
  progress: number;
  cruise: number;
  speedMs = 0;
  position: Vec3;
  yaw = 0;
  body: RAPIER.RigidBody | null = null;
  blockedOverride: boolean | null = null;

  constructor(
    laneIndex: number,
    lane: LaneLoop,
    progress = 0,
    cruise: number = TRAFFIC_CRUISE,
  ) {
    this.laneIndex = laneIndex;
    this.lane = lane;
    this.progress = progress;
    this.cruise = cruise;
    const pose = sampleLane(lane, progress);
    this.position = pose.position;
    this.yaw = pose.yaw;
  }

  step(dt: number = STEP_DT, blocked = false): void {
    const stepDt = dt > 0 ? dt : STEP_DT;
    const isBlocked = this.blockedOverride ?? blocked;
    const target = wantedSpeed(isBlocked, this.cruise);
    const rate = target > this.speedMs ? ACCEL_RATE : BRAKE_RATE;
    this.speedMs = moveToward(this.speedMs, target, rate * stepDt);
    const length = laneLength(this.lane);
    if (length < 1.0) {
      return;
    }
    this.progress = fposmod(this.progress + this.speedMs * stepDt, length);
    const pose = sampleLane(this.lane, this.progress);
    this.position = pose.position;
    this.yaw = pose.yaw;
  }

  getState(): CarState {
    return {
      position: { ...this.position },
      speedMs: this.speedMs,
      speed_ms: this.speedMs,
      progress: this.progress,
      laneIndex: this.laneIndex,
      lane_index: this.laneIndex,
      yaw: this.yaw,
      cruise: this.cruise,
      blocked: this.blockedOverride,
    };
  }
}

export type NearestLanePoint = {
  laneIndex: number;
  progress: number;
  position: Vec3;
  distance: number;
};

// Fleet manager: 6 kinematic cars over the 3 lane loops. Recycle scans
// every loop for the point nearest the player anchor and respawns 30 m
// past it, so a stray car always lands back near the action.
export class Traffic {
  cars: TrafficCar[] = [];
  playerPos: Vec3 = { ...PLAYER_ANCHOR_DEFAULT };
  // Race-mode flag (grid arming idiom): active fleets cruise and recycle,
  // parked fleets (time-trial) ease every car to a stop in place while
  // keeping all 6 cars so count probes hold in every mode.
  active = true;
  private world: RAPIER.World | null = null;
  private rapier: RapierModule | null = null;

  constructor() {
    this.spawnFleet();
  }

  // True while the fleet cruises (false parks motion for time-trial).
  isActive(): boolean {
    return this.active === true;
  }

  is_active(): boolean {
    return this.isActive();
  }

  // Park (false) or release (true) the fleet. Parked cars ease to 0 via
  // the brake rate but are never destroyed, so cars.length stays 6.
  setActive(value: boolean): void {
    this.active = value === true;
  }

  set_active(value: boolean): void {
    this.setActive(value);
  }

  // Fleet spawn: lane i % 3, staggered slots per lane, uniform 9.0 m/s
  // cruise (traffic_manager.gd _spawn_fleet, variation dropped).
  spawnFleet(): void {
    this.cars = [];
    const laneCount = LANE_LOOPS.length;
    if (laneCount === 0) {
      return;
    }
    const perLane = Math.ceil(TRAFFIC_COUNT / laneCount);
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
      const laneIndex = i % laneCount;
      const lane = LANE_LOOPS[laneIndex];
      const length = laneLength(lane);
      if (length < 1.0) {
        continue;
      }
      const slot = Math.floor(i / laneCount);
      this.cars.push(
        new TrafficCar(
          laneIndex,
          lane,
          (length * slot) / perLane,
          TRAFFIC_CRUISE,
        ),
      );
    }
  }

  // Closest baked point to the anchor across every loop.
  nearestLanePoint(anchor: Vec3): NearestLanePoint {
    const first = LANE_LOOPS[0]?.points[0] ?? { x: 0, y: 0.6, z: 0 };
    let best: NearestLanePoint = {
      laneIndex: 0,
      progress: 0,
      position: { ...first },
      distance: Infinity,
    };
    LANE_LOOPS.forEach((lane, laneIndex) => {
      if (laneLength(lane) < 1.0) {
        return;
      }
      const progress = closestProgress(lane, anchor);
      const position = sampleLane(lane, progress).position;
      const distance = Math.sqrt(distSquared(position, anchor));
      if (distance < best.distance) {
        best = { laneIndex, progress, position, distance };
      }
    });
    return best;
  }

  // Recycle a stray car to 30 m past the anchor-nearest lane point.
  // Speed is kept; only lane/progress/pose reset (manager _recycle).
  recycleCar(car: TrafficCar, anchor: Vec3): void {
    const best = this.nearestLanePoint(anchor);
    const lane = LANE_LOOPS[best.laneIndex] ?? car.lane;
    const length = laneLength(lane);
    if (length < 1.0) {
      return;
    }
    car.laneIndex = best.laneIndex;
    car.lane = lane;
    car.progress = fposmod(best.progress + RESPAWN_AHEAD, length);
    const pose = sampleLane(lane, car.progress);
    car.position = pose.position;
    car.yaw = pose.yaw;
  }

  // One fixed tick: recycle strays beyond 150 m, then ease every car
  // toward its yield target. Never steps the Rapier world (caller owns
  // stepping); without an attached world every ray reads unblocked.
  // Parked fleets (time-trial) skip the recycle churn and ease every car
  // to a stop in place — still wrapping/posing along the lane so the
  // fleet keeps moving coherently while speeds read 0.
  step(dt: number = STEP_DT, playerPos?: Vec3): void {
    const stepDt = dt > 0 ? dt : STEP_DT;
    const anchor = playerPos ?? this.playerPos;
    this.playerPos = { ...anchor };
    if (!this.isActive()) {
      for (const car of this.cars) {
        car.speedMs = moveToward(car.speedMs, 0, BRAKE_RATE * stepDt);
        const length = laneLength(car.lane);
        if (length < 1.0) {
          continue;
        }
        car.progress = fposmod(car.progress + car.speedMs * stepDt, length);
        const pose = sampleLane(car.lane, car.progress);
        car.position = pose.position;
        car.yaw = pose.yaw;
      }
      return;
    }
    for (const car of this.cars) {
      if (Math.sqrt(distSquared(car.position, anchor)) > RECYCLE_DISTANCE) {
        this.recycleCar(car, anchor);
      }
    }
    for (const car of this.cars) {
      const blocked = car.blockedOverride ?? this.checkBlocked(car);
      car.step(stepDt, blocked);
    }
  }

  // Forward yield ray: 10 m from the nose at 0.8 m height. Any hit
  // blocks; a missing query API reads unblocked, never throws.
  checkBlocked(car: TrafficCar): boolean {
    try {
      if (this.world === null || this.rapier === null) {
        return false;
      }
      const fx = -Math.sin(car.yaw);
      const fz = -Math.cos(car.yaw);
      const ray = new this.rapier.Ray(
        {
          x: car.position.x + fx * YIELD_NOSE_OFFSET,
          y: YIELD_RAY_HEIGHT,
          z: car.position.z + fz * YIELD_NOSE_OFFSET,
        },
        { x: fx, y: 0, z: fz },
      );
      const hit = this.world.castRay(
        ray,
        YIELD_RAY_LENGTH,
        true,
        undefined,
        undefined,
        undefined,
        car.body ?? undefined,
      );
      return hit !== null;
    } catch {
      return false;
    }
  }

  // Kinematic shell: one kinematicPositionBased body per car in the
  // shared drive world with the traffic_car.tscn 1.8/1.0/4.2 cuboid.
  // Skips cars that already have bodies; never steps the world.
  attachKinematics(world: RAPIER.World, RAPIER: RapierModule): void {
    this.world = world;
    this.rapier = RAPIER;
    for (const car of this.cars) {
      if (car.body !== null) {
        continue;
      }
      try {
        const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(car.position.x, car.position.y, car.position.z)
          .setRotation(yawToQuat(car.yaw));
        const body = world.createRigidBody(desc);
        const collider = RAPIER.ColliderDesc.cuboid(
          TRAFFIC_COLLIDER_HALF.x,
          TRAFFIC_COLLIDER_HALF.y,
          TRAFFIC_COLLIDER_HALF.z,
        )
          .setTranslation(0, TRAFFIC_COLLIDER_OFFSET_Y, 0)
          .setFriction(TRAFFIC_FRICTION);
        world.createCollider(collider, body);
        car.body = body;
      } catch {
        car.body = null;
      }
    }
  }

  // Drive every kinematic body from its lane pose. Runs before the
  // single world.step() so traffic motion pushes the player chassis.
  syncKinematics(): void {
    for (const car of this.cars) {
      try {
        if (car.body === null) {
          continue;
        }
        const body = car.body as unknown as {
          setNextKinematicTranslation?: (t: Vec3) => void;
          setNextKinematicRotation?: (q: {
            x: number;
            y: number;
            z: number;
            w: number;
          }) => void;
          setTranslation?: (t: Vec3, wake: boolean) => void;
          setRotation?: (
            q: { x: number; y: number; z: number; w: number },
            wake: boolean,
          ) => void;
        };
        const translation = { ...car.position };
        const rotation = yawToQuat(car.yaw);
        if (
          typeof body.setNextKinematicTranslation === "function" &&
          typeof body.setNextKinematicRotation === "function"
        ) {
          body.setNextKinematicTranslation(translation);
          body.setNextKinematicRotation(rotation);
        } else {
          if (typeof body.setTranslation === "function") {
            body.setTranslation(translation, true);
          }
          if (typeof body.setRotation === "function") {
            body.setRotation(rotation, true);
          }
        }
      } catch {
        // A single stuck body must never break the fleet tick.
      }
    }
  }

  // Probe/test helper: force (or release with null) a car's blocked flag.
  setBlockedOverride(index: number, value: boolean | null): void {
    const car = this.cars[index];
    if (car !== undefined) {
      car.blockedOverride = value;
    }
  }

  // Probe/test helper: move a car off-lane (the next step recycles it
  // when it lands beyond the recycle distance).
  teleportCar(index: number, position: Vec3): void {
    const car = this.cars[index];
    if (car === undefined) {
      return;
    }
    car.position = { ...position };
    try {
      car.body?.setTranslation({ ...position }, true);
    } catch {
      // Pure-mode teleport still counts; the body follows next sync.
    }
  }

  // Probe/test helper: override the player anchor used when step()
  // is called without an explicit position.
  setPlayerPos(position: Vec3): void {
    this.playerPos = { ...position };
  }

  carState(index: number): CarState {
    const car = this.cars[index];
    if (car === undefined) {
      return {
        position: { ...PLAYER_ANCHOR_DEFAULT },
        speedMs: 0,
        speed_ms: 0,
        progress: 0,
        laneIndex: -1,
        lane_index: -1,
        yaw: 0,
        cruise: TRAFFIC_CRUISE,
        blocked: null,
      };
    }
    return car.getState();
  }
}

// Shared fleet behind the running service: main.ts ensureTraffic plus the
// garage/results arming paths all drive this one instance, so the parked
// flag and the live poses never diverge between entry points.
let shared: Traffic | null = null;

export function sharedTraffic(): Traffic {
  if (shared === null) {
    shared = new Traffic();
  }
  return shared;
}

// v1 snake_case alias (same reference).
export const shared_traffic = sharedTraffic;
