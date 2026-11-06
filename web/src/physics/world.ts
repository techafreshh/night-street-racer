// Rapier world wrapper: owns the dynamics world, the flat test slab,
// chassis spawning, suspension raycasts, reset clearance probes, and
// teleport-after-step recovery. Minimal Vec3 math lives here so
// vehicle.ts and world.ts never import three.js (headless vitest
// must load these modules with no DOM/WebGL).
import RAPIER from "@dimforge/rapier3d-compat";

let rapierInit: Promise<void> | null = null;

// Compat build embeds WASM as base64: one awaited init, no fetch. The
// shared promise keeps concurrent boot callers (drive plus city) from
// starting two in-flight inits, which corrupts WASM memory. A rejected
// init resets the handle before rethrowing so the next call retries
// instead of poisoning the session on the cached rejection. Both the
// leader and the followers reset only their own failed attempt, so a
// stale waiter never clears a fresh retry.
export async function ensureRapierReady(): Promise<void> {
  if (rapierInit === null) {
    const pending = RAPIER.init();
    rapierInit = pending;
    try {
      await pending;
    } catch (error) {
      if (rapierInit === pending) {
        rapierInit = null;
      }
      throw error;
    }
    return;
  }
  const current = rapierInit;
  try {
    await current;
  } catch (error) {
    if (rapierInit === current) {
      rapierInit = null;
    }
    throw error;
  }
}

// Fixed 60 Hz accumulator tick: single-sourced from core/loop (the STEP_DT
// pinned by web/tests/suites/config.test.ts). Re-exported here so the
// physics suites keep their `from "../physics/world"` imports with no churn.
import { STEP_DT, STEP_HZ } from "../core/loop";

export { STEP_DT, STEP_HZ };

// Engine-free pure math lives in ./vec (chunk-budget split): imported
// here for the wrapper below and re-exported for backward compatibility
// so the physics/vehicle/traffic suites need no churn.
import {
  IDENTITY_QUAT,
  RESET_CLEAR_EXTENTS,
  RESET_LIFT_MAX,
  RESET_PROBE_OFFSET,
  add,
  resetCandidates,
  yawToQuat,
  type Quat,
  type Vec3,
} from "./vec";

export {
  IDENTITY_QUAT,
  RESET_CLEAR_EXTENTS,
  RESET_LATERAL_RADII,
  RESET_LIFT_MAX,
  RESET_PROBE_OFFSET,
  add,
  cross,
  dot,
  length,
  resetCandidates,
  reset_candidates,
  rotateVecByQuat,
  scale,
  sub,
  vec3,
  yawToQuat,
} from "./vec";
export type { Quat, Vec3 } from "./vec";

export type ChassisSpawn = {
  position?: Vec3;
  yaw?: number;
};

export type SuspensionHit = {
  point: Vec3;
  toi: number;
};

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private groundCreated = false;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP_DT;
  }

  // Flat fixed cuboid slab (1000 x 1 x 1000) with its top at y = 0,
  // mirroring `_make_ground` in tests/support/test_context.gd.
  makeGround(): void {
    if (this.groundCreated) {
      return;
    }
    const desc = RAPIER.ColliderDesc.cuboid(500, 0.5, 500)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0);
    this.world.createCollider(desc, undefined);
    this.groundCreated = true;
  }

  // Single drive-ground mount (issue #240): the city statics carry the
  // y = 0 plane when they land, so the flat fallback slab mounts only
  // when the city step throws — never a coplanar double slab at y = 0.
  mountDriveGround(tryCityStatics: () => void): boolean {
    try {
      tryCityStatics();
      return true;
    } catch {
      this.makeGround();
      return false;
    }
  }

  // Dynamic chassis rigid body with a cuboid collider in exact
  // vehicle_base.tscn geometry (~half-extents 0.9/0.25/2.1, shape
  // offset +0.25 y) and a 1200 kg mass. The center of mass is
  // overridden to (0, -0.35, 0) in the body frame, mirroring the
  // scene's `center_of_mass_mode = 1` / `center_of_mass` arcade
  // stability hack: Rapier would otherwise balance the mass at the
  // cuboid center, 0.6 higher, and the car would loop under throttle.
  // Inertia is the solid-box tensor parallel-axised to that COM
  // (I = Ic + m*d^2, d = 0.6): (2221, 2088, 781).
  // Auto-sleep is disabled so a parked car still ticks.
  spawnChassis(spawn: ChassisSpawn = {}): RAPIER.RigidBody {
    const p = spawn.position ?? { x: 0, y: 0.9, z: 0 };
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation(spawn.yaw !== undefined ? yawToQuat(spawn.yaw) : IDENTITY_QUAT)
      .setLinearDamping(0.0)
      .setAngularDamping(0.3)
      .setCanSleep(false);
    const body = this.world.createRigidBody(desc);
    const collider = RAPIER.ColliderDesc.cuboid(0.9, 0.25, 2.1).setTranslation(
      0,
      0.25,
      0,
    );
    // Collider-local COM: body-frame (0, -0.35, 0) minus the shape
    // offset (0, 0.25, 0).
    collider.setMassProperties(
      1200,
      { x: 0, y: -0.6, z: 0 },
      { x: 2221, y: 2088, z: 781 },
      IDENTITY_QUAT,
    );
    collider.setFriction(1.0);
    this.world.createCollider(collider, body);
    // Warm the query pipeline: castRay/shape probes read null until
    // the first world.step() populates them.
    this.world.step();
    return body;
  }

  // Suspension ray straight down (-up), chassis excluded. A miss means
  // airborne (no force, slip readout 0). Falls back to the analytic
  // flat-slab answer when the query API is unavailable.
  castSuspensionRay(
    origin: Vec3,
    dir: Vec3,
    maxToi: number,
    excludeBody?: RAPIER.RigidBody,
  ): SuspensionHit | null {
    const probe = this.world as unknown as {
      castRay?: (...args: never[]) => unknown;
    };
    if (typeof probe.castRay !== "function") {
      if (dir.y < -1e-6 && origin.y >= 0 && origin.y <= maxToi) {
        return { point: { x: origin.x, y: 0, z: origin.z }, toi: origin.y };
      }
      return null;
    }
    const ray = new RAPIER.Ray({ ...origin }, { ...dir });
    const hit = this.world.castRay(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      excludeBody,
    ) as { timeOfImpact?: number } | null;
    if (hit === null || typeof hit.timeOfImpact !== "number") {
      return null;
    }
    const toi = hit.timeOfImpact;
    return {
      point: {
        x: origin.x + dir.x * toi,
        y: origin.y + dir.y * toi,
        z: origin.z + dir.z * toi,
      },
      toi,
    };
  }

  // True when the parked-car probe at `candidate` touches nothing but
  // the excluded chassis. Unavailable query API reads as clear so the
  // caller falls back to the pure spiral.
  isPoseClear(candidate: Vec3, excludeBody?: RAPIER.RigidBody): boolean {
    const probe = this.world as unknown as {
      intersectionsWithShape?: (...args: never[]) => unknown;
    };
    if (typeof probe.intersectionsWithShape !== "function") {
      return true;
    }
    const center = add(candidate, RESET_PROBE_OFFSET);
    const shape = new RAPIER.Cuboid(
      RESET_CLEAR_EXTENTS.x / 2,
      RESET_CLEAR_EXTENTS.y / 2,
      RESET_CLEAR_EXTENTS.z / 2,
    );
    let blocked = false;
    this.world.intersectionsWithShape(
      center,
      IDENTITY_QUAT,
      shape,
      () => {
        blocked = true;
        return false;
      },
      undefined,
      undefined,
      undefined,
      excludeBody,
    );
    return !blocked;
  }

  // First clearance-free reset destination at or near `desired`: the
  // lateral spiral at parked height, then straight lift to
  // RESET_LIFT_MAX; when fully blocked, the highest probe.
  findClearResetPosition(
    desired: Vec3,
    excludeBody?: RAPIER.RigidBody,
  ): Vec3 {
    for (const candidate of resetCandidates(desired)) {
      if (this.isPoseClear(candidate, excludeBody)) {
        return candidate;
      }
    }
    let height = 1.0;
    while (height <= RESET_LIFT_MAX + 1e-6) {
      const up = { x: desired.x, y: desired.y + height, z: desired.z };
      if (this.isPoseClear(up, excludeBody)) {
        return up;
      }
      height += 1.0;
    }
    return { x: desired.x, y: desired.y + RESET_LIFT_MAX, z: desired.z };
  }

  // Immediate teleport: setTranslation/setRotation/setLinvel/
  // setAngvel. The vehicle calls it after world.step() (the
  // _integrate_forces port: recovery must land post-step, never
  // mid-tick).
  teleportBody(body: RAPIER.RigidBody, pos: Vec3, quat: Quat): void {
    body.setTranslation({ ...pos }, true);
    body.setRotation({ ...quat }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // Fixed 60 Hz step.
  stepWorld(): void {
    this.world.step();
  }
}
