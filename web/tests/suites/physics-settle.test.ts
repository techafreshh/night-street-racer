// Physics settle band: a 1.2 m drop settles inside 0.03 m nominal.
// Suite asserts the last-second range stays under 0.035 m with slack
// (vehicle.test.ts freshCar idiom, Rapier-in-Node only).
import { beforeAll, describe, expect, it } from "vitest";
import { TUNES } from "../../src/data/tunes";
import { STEP_DT, ensureRapierReady, PhysicsWorld } from "../../src/physics/world";
import { tuneFromCarTune, Vehicle } from "../../src/vehicles/vehicle";

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

describe("physics settle band", () => {
  it("settles a 1.2 m drop inside 0.035 m over the last second", () => {
    const { car } = freshCar({ x: 0, y: 1.2, z: 0 });
    const heights: number[] = [];
    for (let i = 0; i < 4 * 60; i += 1) {
      car.step(STEP_DT);
      heights.push(car.position().y);
    }
    const tail = heights.slice(-60);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.035);
  });
});
