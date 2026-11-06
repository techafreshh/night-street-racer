// Physics reset band: an inverted car restores upright on demand and
// the 25-candidate spiral never steps closer (vehicle.test.ts idiom).
import { beforeAll, describe, expect, it } from "vitest";
import { TUNES } from "../../src/data/tunes";
import { STEP_DT, ensureRapierReady, PhysicsWorld } from "../../src/physics/world";
import {
  resetCandidates,
  tuneFromCarTune,
  Vehicle,
} from "../../src/vehicles/vehicle";

function freshCar(position = { x: 0, y: 0.9, z: 0 }): {
  physics: PhysicsWorld;
  car: Vehicle;
} {
  const physics = new PhysicsWorld();
  physics.makeGround();
  const car = new Vehicle(physics, {
    tune: tuneFromCarTune(TUNES.sedan),
    position,
  });
  return { physics, car };
}

beforeAll(async () => {
  await ensureRapierReady();
});

describe("physics reset band", () => {
  it("restores upright on demand after a flip", () => {
    const { car } = freshCar();
    car.placeAt({ x: 0, y: 0.7, z: 0 }, { x: 1, y: 0, z: 0, w: 0 });
    for (let i = 0; i < 20; i += 1) {
      car.step(STEP_DT);
    }
    expect(car.upVector().y).toBeLessThan(0.3);
    car.inputs.reset = true;
    car.step(STEP_DT);
    car.inputs.reset = false;
    for (let i = 0; i < 90; i += 1) {
      car.step(STEP_DT);
    }
    expect(car.upVector().y).toBeGreaterThan(0.85);
    const lin = car.body.linvel() as { x: number; y: number; z: number };
    expect(Math.hypot(lin.x, lin.y, lin.z)).toBeLessThan(1.15);
  });

  it("emits a 25-candidate non-decreasing spiral", () => {
    const base = { x: 1.0, y: 1.7, z: -2.0 };
    const cands = resetCandidates(base);
    expect(cands).toHaveLength(25);
    expect(cands[0]).toEqual(base);
    let prev = -1;
    for (const c of cands) {
      expect(c.y).toBe(base.y);
      const r = Math.hypot(c.x - base.x, c.z - base.z);
      expect(r).toBeGreaterThanOrEqual(prev - 0.001);
      prev = r;
    }
  });
});
