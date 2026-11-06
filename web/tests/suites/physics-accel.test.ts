// Physics accel band: full throttle reaches 25 m/s nominal within 8 s.
// Suite asserts the −15% retune floor (21.25 m/s) plus 3rd-gear
// engagement (vehicle.test.ts freshCar idiom, Rapier-in-Node only).
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

describe("physics accel band", () => {
  it("reaches 21.25 m/s within 8 s and engages 3rd gear", () => {
    const { car } = freshCar();
    car.inputs.throttle = 1;
    let top = 0;
    for (let i = 0; i < 8 * 60; i += 1) {
      car.step(STEP_DT);
      top = Math.max(top, car.speedMs);
      if (car.speedMs >= 25.0) {
        break;
      }
    }
    expect(top).toBeGreaterThanOrEqual(21.25);
    expect(car.currentGear).toBeGreaterThanOrEqual(3);
  });
});
