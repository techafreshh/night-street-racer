// Starting-grid player placement (race.gd _spawn_rivals idiom).
// Pure module: only data-free math (physics/vec) and the shared grid
// instance are imported — no rendering engine, no physics engine, no DOM
// access, so vitest and the entry chunk load this module with zero vendor
// weight (grid.ts hygiene rule). One teleport per race arm, called right
// after every armGridForEvent site (main startRace, garage Start, results
// Retry); the countdown never re-pins the body.

import { yawToQuat, type Quat, type Vec3 } from "../physics/vec";
import { grid, type GridPose } from "./grid";

// Structural teleport target: Vehicle satisfies this shape (placeAt), and
// the probe namespace resolves through it without importing the engine
// vehicle module. Never construct a body here.
export type Placeable = {
  placeAt: (position: Vec3, quat?: Quat) => void;
};

function finitePose(pose: unknown): pose is GridPose {
  try {
    if (pose === null || pose === undefined) {
      return false;
    }
    const position = (pose as GridPose).position;
    const yaw = (pose as GridPose).yaw;
    if (position === null || typeof position !== "object") {
      return false;
    }
    return (
      typeof position.x === "number" &&
      Number.isFinite(position.x) &&
      typeof position.y === "number" &&
      Number.isFinite(position.y) &&
      typeof position.z === "number" &&
      Number.isFinite(position.z) &&
      typeof yaw === "number" &&
      Number.isFinite(yaw)
    );
  } catch {
    return false;
  }
}

// Live vehicle behind the probe table when the caller passes no handle
// (main.ts windowNSRVehicle idiom): globalThis first so garage/results
// arm paths need no vehicle handle. Never throws.
function probeVehicle(): Placeable | null {
  try {
    const probe = (
      globalThis as unknown as { __nsr?: { vehicle?: { instance?: unknown } } }
    ).__nsr;
    const instance = probe?.vehicle?.instance;
    if (
      instance !== null &&
      typeof instance === "object" &&
      typeof (instance as Placeable).placeAt === "function"
    ) {
      return instance as Placeable;
    }
  } catch {
    // Unavailable: the caller gets a guarded false.
  }
  return null;
}

// Teleport the player body onto the shared grid slot (defaults to the
// live vehicle and grid.playerStart), copying the position so the body
// never aliases the grid object. Returns true on placement, false when
// the car or pose is missing/invalid. Never throws.
export function placePlayerOnGrid(
  car?: Placeable | null,
  pose?: GridPose | null,
): boolean {
  try {
    const target = car ?? probeVehicle();
    if (
      target === null ||
      target === undefined ||
      typeof (target as Placeable).placeAt !== "function"
    ) {
      return false;
    }
    let slot: GridPose | null = null;
    try {
      // An explicit null pose is invalid (guarded false); only an
      // omitted pose falls back to the shared grid slot.
      slot = pose === undefined ? grid.playerStart : pose;
    } catch {
      slot = null;
    }
    if (!finitePose(slot)) {
      return false;
    }
    const position: Vec3 = {
      x: slot.position.x,
      y: slot.position.y ?? 1,
      z: slot.position.z,
    };
    target.placeAt(position, yawToQuat(slot.yaw));
    return true;
  } catch {
    return false;
  }
}

// v1 snake_case alias (same reference).
export const place_player_on_grid = placePlayerOnGrid;
