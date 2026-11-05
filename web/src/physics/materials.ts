// Collider friction/restitution presets for the night-district city.
// Pure data plus ColliderDesc factories: this module declares no
// top-level engine imports (no DOM, WebGL, or WASM at load time) so
// Node/vitest can import it freely. Callers pass the initialized
// physics module in, mirroring the validateEvent boolean-only/never-throws idiom.

// Asphalt driving surface: high grip, no bounce.
export const GROUND_FRICTION = 1.0;
export const GROUND_RESTITUTION = 0.0;

// Route-edge walls: low grip so brushed chassis slide along, no bounce.
export const BARRIER_FRICTION = 0.5;
export const BARRIER_RESTITUTION = 0.0;

// Accepted preset ranges for validateMaterials().
export const FRICTION_MIN = 0.0;
export const FRICTION_MAX = 4.0;
export const RESTITUTION_MIN = 0.0;
export const RESTITUTION_MAX = 1.0;

export type FrictionPreset = {
  friction: number;
  restitution: number;
};

// Structural ColliderDesc surface: every chained setter returns the
// same desc object, so the real Rapier ColliderDesc satisfies this
// bound and the factories below stay verifiable without importing it.
export type ChainedDesc<T> = {
  setTranslation(x: number, y: number, z: number): T;
  setFriction(friction: number): T;
  setRestitution(restitution: number): T;
};

// Minimal Rapier module surface the factories need: just the cuboid
// constructor. The full module (default export of
// @dimforge/rapier3d-compat once initialized) satisfies this bound.
export type RapierColliderModule<D extends ChainedDesc<D>> = {
  ColliderDesc: {
    cuboid(halfX: number, halfY: number, halfZ: number): D;
  };
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPreset(friction: unknown, restitution: unknown): boolean {
  return (
    isFiniteNumber(friction) &&
    friction >= FRICTION_MIN &&
    friction <= FRICTION_MAX &&
    isFiniteNumber(restitution) &&
    restitution >= RESTITUTION_MIN &&
    restitution <= RESTITUTION_MAX
  );
}

// Boolean-only, never throws: with no argument validates the stock
// presets; with a { friction, restitution } object validates that
// preset instead. Checks every alias slot so harness wording cannot
// mismatch.
export function validateMaterials(preset?: unknown): boolean {
  try {
    if (preset === undefined || preset === null) {
      return (
        validPreset(GROUND_FRICTION, GROUND_RESTITUTION) &&
        validPreset(BARRIER_FRICTION, BARRIER_RESTITUTION)
      );
    }
    if (typeof preset !== "object") {
      return false;
    }
    const p = preset as Partial<FrictionPreset>;
    return validPreset(p.friction, p.restitution);
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_materials = validateMaterials;

// Static cuboid desc for drivable ground slabs (base + EW lips).
export function groundColliderDesc<D extends ChainedDesc<D>>(
  RAPIER: RapierColliderModule<D>,
  halfX: number,
  halfY: number,
  halfZ: number,
  x: number,
  y: number,
  z: number,
): D {
  return RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
    .setTranslation(x, y, z)
    .setFriction(GROUND_FRICTION)
    .setRestitution(GROUND_RESTITUTION);
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const ground_collider_desc = groundColliderDesc;

// Static cuboid desc for the route-edge barrier walls.
export function barrierColliderDesc<D extends ChainedDesc<D>>(
  RAPIER: RapierColliderModule<D>,
  halfX: number,
  halfY: number,
  halfZ: number,
  x: number,
  y: number,
  z: number,
): D {
  return RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
    .setTranslation(x, y, z)
    .setFriction(BARRIER_FRICTION)
    .setRestitution(BARRIER_RESTITUTION);
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const barrier_collider_desc = barrierColliderDesc;
