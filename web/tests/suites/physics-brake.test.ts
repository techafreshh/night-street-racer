// Physics brake band: 20 m/s stops inside 30 m nominal. Suite asserts
// the +15% retune ceiling (34.5 m) and a sub-0.5 m/s rest
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

describe("physics brake band", () => {
  it("stops from 20 m/s within 34.5 m", () => {
    const { car } = freshCar();
    car.inputs.throttle = 1;
    for (let i = 0; i < 10 * 60; i += 1) {
      car.step(STEP_DT);
      if (car.speedMs >= 20.0) {
        break;
      }
    }
    expect(car.speedMs).toBeGreaterThanOrEqual(20.0);
    car.inputs.throttle = 0;
    car.inputs.brake = 1;
    const start = car.position();
    let dist = 0;
    for (let i = 0; i < 6 * 60; i += 1) {
      car.step(STEP_DT);
      const p = car.position();
      dist = Math.hypot(p.x - start.x, p.z - start.z);
      if (car.speedMs < 0.5) {
        break;
      }
    }
    expect(car.speedMs).toBeLessThan(0.5);
    expect(dist).toBeLessThanOrEqual(34.5);
  });
});
