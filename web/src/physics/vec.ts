// Engine-free pure math moved out of world.ts (chunk-budget split).
// No top-level engine imports (no three.js, no Rapier, no DOM/WebGL/WASM
// at load time); callers pass the initialized physics module in, mirroring
// the physics/materials.ts header idiom, so Node/vitest and the entry
// chunk load this module with zero vendor weight.

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// Rotate a vector by a unit quaternion (basis-vector transform for
// wheel mounts and the up/fwd/right frame each tick).
export function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  const uv = cross({ x: q.x, y: q.y, z: q.z }, v);
  const uuv = cross({ x: q.x, y: q.y, z: q.z }, uv);
  return add(add(v, scale(uv, 2 * q.w)), scale(uuv, 2));
}

// Yaw-only orientation quaternion (reset keeps the heading, drops
// roll/pitch). Matches `Basis(Vector3.UP, yaw)` in _integrate_forces.
export function yawToQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

// Reset clearance probe, mirroring vehicle_controller.gd: car
// footprint (1.8 x 4.2) plus margin and headroom, full extents.
export const RESET_CLEAR_EXTENTS: Vec3 = { x: 2.0, y: 2.0, z: 4.4 };
// Lateral search radii for the reset spiral, non-decreasing.
export const RESET_LATERAL_RADII: number[] = [2.0, 4.0, 6.0];
// Maximum vertical lift when laterally blocked.
export const RESET_LIFT_MAX = 8.0;
// Probe center sits one metre above the candidate origin.
export const RESET_PROBE_OFFSET: Vec3 = { x: 0, y: 1.0, z: 0 };

// Deterministic reset candidates: base first, then 8 compass points at
// each lateral radius (25 entries max), all sharing base y. Pure port
// of `reset_candidates` (no scene needed).
export function resetCandidates(base: Vec3): Vec3[] {
  const out: Vec3[] = [{ x: base.x, y: base.y, z: base.z }];
  const dirs: Array<[number, number]> = [
    [0, -1],
    [Math.SQRT1_2, -Math.SQRT1_2],
    [1, 0],
    [Math.SQRT1_2, Math.SQRT1_2],
    [0, 1],
    [-Math.SQRT1_2, Math.SQRT1_2],
    [-1, 0],
    [-Math.SQRT1_2, -Math.SQRT1_2],
  ];
  for (const radius of RESET_LATERAL_RADII) {
    for (const [dx, dz] of dirs) {
      out.push({
        x: base.x + dx * radius,
        y: base.y,
        z: base.z + dz * radius,
      });
    }
  }
  return out;
}

export const reset_candidates = resetCandidates;
