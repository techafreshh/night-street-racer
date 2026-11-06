// Drive-ground single-slab regression suite (issue #240): initDrive must
// mount exactly one ground path — the city statics on success, the flat
// fallback slab only on throw — never a coplanar double slab at y = 0.
// Real Rapier in Node, no browser.

import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld, ensureRapierReady } from "../src/physics/world";
import {
  BARRIER_COLLIDER_COUNT,
  GROUND_COLLIDER_COUNT,
  addBarrierColliders,
  addGroundColliders,
  castRayDown,
} from "../src/render/city";

beforeAll(async () => {
  await ensureRapierReady();
});

function mountCity(w: PhysicsWorld): boolean {
  return w.mountDriveGround(() => {
    addGroundColliders(w.world, RAPIER);
    addBarrierColliders(w.world, RAPIER);
  });
}

describe("drive ground single slab", () => {
  it("mounts city statics with no fallback slab", () => {
    const w = new PhysicsWorld();
    expect(mountCity(w)).toBe(true);
    expect(w.world.colliders.len()).toBe(
      GROUND_COLLIDER_COUNT + BARRIER_COLLIDER_COUNT,
    );
    expect(w.world.colliders.len()).toBe(10);
    expect(castRayDown(w.world, RAPIER, 0, 20)).toBeCloseTo(0, 2);
    // Outside the 280 m district but inside the old 1000 m slab: a
    // fallback slab would hit here, so null proves it is absent.
    expect(castRayDown(w.world, RAPIER, 400, 0)).toBeNull();
  });

  it("mounts only the flat slab when city statics throw", () => {
    const w = new PhysicsWorld();
    expect(
      w.mountDriveGround(() => {
        throw new Error("city boom");
      }),
    ).toBe(false);
    expect(w.world.colliders.len()).toBe(1);
    expect(castRayDown(w.world, RAPIER, 400, 0)).toBeCloseTo(0, 5);
  });
});
