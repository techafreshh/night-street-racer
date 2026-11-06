// Physics cornering band: 20 degrees of heading change is nominal for
// 2 s of full lock at speed. Suite asserts 17 degrees with −15% slack
// and a staying-upright tail (vehicle.test.ts freshCar idiom).
import { beforeAll, describe, expect, it } from "vitest";
import { TUNES } from "../../src/data/tunes";
import {
  STEP_DT,
  ensureRapierReady,
  PhysicsWorld,
  rotateVecByQuat,
} from "../../src/physics/world";
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

// main.ts worldTick yaw idiom: forward −z rotated by body attitude.
function headingOf(car: Vehicle): number {
  const quat = car.body.rotation() as { x: number; y: number; z: number; w: number };
  const fwd = rotateVecByQuat({ x: 0, y: 0, z: -1 }, quat);
  return Math.atan2(-fwd.x, -fwd.z);
}

beforeAll(async () => {
  await ensureRapierReady();
});

describe("physics cornering band", () => {
  it("turns more than 17 degrees in 2 s of full lock at speed", () => {
    const { car } = freshCar();
    car.inputs.throttle = 1;
    for (let i = 0; i < 10 * 60; i += 1) {
      car.step(STEP_DT);
      if (car.speedMs >= 10.0) {
        break;
      }
    }
    expect(car.speedMs).toBeGreaterThanOrEqual(10.0);
    const before = headingOf(car);
    car.inputs.steer = 1;
    for (let i = 0; i < 2 * 60; i += 1) {
      car.step(STEP_DT);
    }
    const after = headingOf(car);
    let change = Math.abs(after - before);
    if (change > Math.PI) {
      change = 2 * Math.PI - change;
    }
    expect((change * 180) / Math.PI).toBeGreaterThan(17);
    expect(car.upVector().y).toBeGreaterThan(0.5);
  });
});
