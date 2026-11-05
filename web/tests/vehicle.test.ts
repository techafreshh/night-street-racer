// Rapier vehicle acceptance suite (test_accel_reaches_25ms_in_8s,
// test_brake_20ms_within_30m, test_handbrake_reduces_rear_grip idioms).
// Flat ground, sedan tune, STEP_DT stepping, Rapier-in-Node only: no
// rendering, no network. Covers the issue contract plus torque-cutoff,
// limiter-repair, reset-spiral, assists, settle, reset, and a static
// scan proving the vehicle/physics modules carry no three.js import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { TUNES } from "../src/data/tunes";
import {
  STEP_DT,
  ensureRapierReady,
  PhysicsWorld,
} from "../src/physics/world";
import {
  clampToFrictionCircle,
  clamp_to_friction_circle,
  computeLateralForce,
  computeSuspensionForce,
  compute_lateral_force,
  compute_suspension_force,
  resolveLimiterOrder,
  resolve_limiter_order,
  resetCandidates,
  reset_candidates,
  sampleTorque,
  sample_torque,
  tuneFromCarTune,
  Vehicle,
} from "../src/vehicles/vehicle";
import {
  ASSISTS_ON,
  correctSteer,
  correct_steer,
  dampSlip,
  damp_slip,
} from "../src/vehicles/assists";

const suiteDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

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

describe("vehicle accel", () => {
  it("reaches 25 m/s within 8 s from standstill", () => {
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
    expect(top).toBeGreaterThanOrEqual(25.0);
    expect(car.currentGear).toBeGreaterThanOrEqual(3);
    expect(car.engineRpm).toBeGreaterThanOrEqual(800.0);
    expect(car.engineRpm).toBeLessThanOrEqual(7000.0);
  });
});

describe("vehicle brake", () => {
  it("stops from 20 m/s within 30 m", () => {
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
    expect(dist).toBeLessThanOrEqual(30.0);
  });
});

describe("vehicle handbrake", () => {
  it("cuts rear lateral grip to less than 30%", () => {
    const full = computeLateralForce(0.3, 3000.0, 1.0, 12000.0, 1.0, 1.0);
    expect(Math.abs(full)).toBeGreaterThan(1.0);
    const held = computeLateralForce(0.3, 3000.0, 1.0, 12000.0, 1.0, 0.1);
    expect(Math.abs(held / full)).toBeLessThan(0.3);
  });
});

describe("vehicle torque curve", () => {
  it("applies redline fuel-cut", () => {
    expect(sampleTorque(3000.0, 380.0, 6800.0)).toBeCloseTo(380.0, 6);
    expect(sampleTorque(6500.0, 380.0, 6800.0)).toBeCloseTo(0.6 * 380.0, 6);
    const near = sampleTorque(6700.0, 380.0, 6800.0);
    expect(near).toBeGreaterThan(0.0);
    expect(near).toBeLessThan(0.6 * 380.0);
    expect(sampleTorque(6800.0, 380.0, 6800.0)).toBe(0.0);
    expect(sampleTorque(8000.0, 380.0, 6800.0)).toBe(0.0);
  });
});

describe("vehicle limiter order", () => {
  it("repairs inversions keeping the cap authoritative", () => {
    expect(resolveLimiterOrder(7000.0, 6800.0, 6000.0)).toEqual([6000.0, 6000.0, 6000.0]);
    expect(resolveLimiterOrder(5500.0, 6800.0, 7200.0)).toEqual([5500.0, 6800.0, 7200.0]);
  });
});

describe("vehicle reset spiral", () => {
  it("emits 25 non-decreasing candidates from base", () => {
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

describe("vehicle assists", () => {
  it("reduces steer and slip when on, passes through when off", () => {
    expect(correctSteer(0.8, 20.0, false)).toBe(0.8);
    const on = correctSteer(0.8, 20.0, true);
    expect(Math.abs(on)).toBeLessThan(Math.abs(0.8));
    expect(Math.sign(on)).toBe(Math.sign(0.8));
    expect(dampSlip(0.25, false)).toBe(0.25);
    expect(Math.abs(dampSlip(0.25, true))).toBeLessThan(Math.abs(0.25));
    expect(ASSISTS_ON).toBe(true);
  });

  it("defaults on for controller and module", () => {
    const { car } = freshCar();
    expect(car.assistsEnabled).toBe(true);
  });
});

describe("vehicle suspension", () => {
  it("settles after a drop", () => {
    const { car } = freshCar({ x: 0, y: 1.2, z: 0 });
    const heights: number[] = [];
    for (let i = 0; i < 4 * 60; i += 1) {
      car.step(STEP_DT);
      heights.push(car.position().y);
    }
    const tail = heights.slice(-60);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.03);
  });
});

describe("vehicle reset", () => {
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
    expect(car.upVector().y).toBeGreaterThan(0.9);
    const lin = car.body.linvel() as { x: number; y: number; z: number };
    expect(Math.hypot(lin.x, lin.y, lin.z)).toBeLessThan(1.0);
    const y = car.position().y;
    expect(y).toBeGreaterThan(0.3);
    expect(y).toBeLessThan(2.0);
  });

  it("self-rights when inverted and slow", () => {
    const { car } = freshCar();
    car.placeAt({ x: 0, y: 0.7, z: 0 }, { x: 1, y: 0, z: 0, w: 0 });
    for (let i = 0; i < 3 * 60; i += 1) {
      car.step(STEP_DT);
    }
    expect(car.upVector().y).toBeGreaterThan(0.9);
  });
});

describe("vehicle vocabulary", () => {
  it("exposes snake_case aliases", () => {
    expect(compute_suspension_force).toBe(computeSuspensionForce);
    expect(compute_lateral_force).toBe(computeLateralForce);
    expect(clamp_to_friction_circle).toBe(clampToFrictionCircle);
    expect(resolve_limiter_order).toBe(resolveLimiterOrder);
    expect(reset_candidates).toBe(resetCandidates);
    expect(sample_torque).toBe(sampleTorque);
    expect(correct_steer).toBe(correctSteer);
    expect(damp_slip).toBe(dampSlip);
    expect(reset_candidates({ x: 0, y: 1, z: 0 })).toHaveLength(25);
  });
});

describe("vehicle module hygiene", () => {
  it("imports no three.js", () => {
    const roots = [join(suiteDir, "vehicles"), join(suiteDir, "physics")];
    const files = ["assists.ts", "vehicle.ts", "world.ts"];
    for (const file of files) {
      const root = file === "world.ts" ? roots[1] : roots[0];
      const text = readFileSync(join(root, file), "utf8");
      expect(text).not.toMatch(/from\s+["']three["']/);
    }
  });
});
