// Ambient traffic acceptance suite: 6 kinematic lane followers on the 3
// ported lane loops, cruising 9 m/s, yielding to a forward blocker,
// recycling when far from the player, wrapping progress, and carrying
// solid kinematic bodies. Rapier-in-Node only: no rendering, no network.
// Covers the issue contract plus a static scan proving the traffic module
// carries no three.js import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { LANE_LOOPS } from "../src/data/lanePaths";
import {
  STEP_DT,
  ensureRapierReady,
  PhysicsWorld,
} from "../src/physics/world";
import {
  ACCEL_RATE,
  BRAKE_RATE,
  RECYCLE_DISTANCE,
  RESPAWN_AHEAD,
  SAMPLE_COUNT,
  TRAFFIC_COUNT,
  TRAFFIC_COLLIDER_HALF,
  TRAFFIC_CRUISE,
  YIELD_RAY_LENGTH,
  Traffic,
  TrafficCar,
  closestProgress,
  closest_progress,
  laneLength,
  lane_length,
  sampleLane,
  sample_lane,
  wantedSpeed,
  wanted_speed,
} from "../src/traffic/traffic";

const trafficFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "traffic",
  "traffic.ts",
);

beforeAll(async () => {
  await ensureRapierReady();
});

describe("traffic fleet", () => {
  it("spawns 6 cars", () => {
    const traffic = new Traffic();
    expect(traffic.cars).toHaveLength(6);
    expect(TRAFFIC_COUNT).toBe(6);
  });

  it("carries the ported tuning", () => {
    expect(TRAFFIC_CRUISE).toBe(9.0);
    expect(ACCEL_RATE).toBe(6.0);
    expect(BRAKE_RATE).toBe(12.0);
    expect(RECYCLE_DISTANCE).toBe(150.0);
    expect(RESPAWN_AHEAD).toBe(30.0);
    expect(YIELD_RAY_LENGTH).toBe(10.0);
    expect(SAMPLE_COUNT).toBe(64);
  });

  it("assigns lane i % 3 with staggered progress", () => {
    const traffic = new Traffic();
    traffic.cars.forEach((car, i) => {
      expect(car.laneIndex).toBe(i % 3);
      expect(car.lane).toBe(LANE_LOOPS[i % 3]);
      expect(car.cruise).toBe(9.0);
      expect(car.speedMs).toBe(0);
    });
    expect(traffic.cars[0].progress).toBe(0);
    expect(traffic.cars[3].progress).toBeGreaterThan(0);
  });

  it("measures loop 0 longer than 100 m", () => {
    expect(laneLength(LANE_LOOPS[0])).toBeGreaterThan(100);
    expect(lane_length).toBe(laneLength);
    expect(sample_lane).toBe(sampleLane);
    expect(closest_progress).toBe(closestProgress);
    expect(wanted_speed).toBe(wantedSpeed);
  });

  it("selects the cruise target by the yield flag", () => {
    expect(wantedSpeed(true, 9.0)).toBe(0.0);
    expect(wantedSpeed(false, 9.0)).toBe(9.0);
  });

  it("cruises up to 9 m/s unblocked", () => {
    const traffic = new Traffic();
    for (let i = 0; i < 3 * 60; i += 1) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    for (const car of traffic.cars) {
      expect(car.speedMs).toBeCloseTo(9.0, 1);
    }
  });
});

describe("traffic yield", () => {
  it("drops below 3 m/s after 2 s blocked from cruise", () => {
    const traffic = new Traffic();
    for (let i = 0; i < 3 * 60; i += 1) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    expect(traffic.cars[0].speedMs).toBeGreaterThan(8.0);
    traffic.setBlockedOverride(0, true);
    for (let i = 0; i < 2 * 60; i += 1) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    expect(traffic.cars[0].speedMs).toBeLessThan(3.0);
    traffic.setBlockedOverride(0, null);
    for (let i = 0; i < 3 * 60; i += 1) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    expect(traffic.cars[0].speedMs).toBeGreaterThan(8.0);
  });

  it("stops for a real Rapier blocker 5 m ahead", () => {
    const physics = new PhysicsWorld();
    physics.makeGround();
    const traffic = new Traffic();
    traffic.attachKinematics(physics.world, RAPIER);
    const car = traffic.cars[0];
    car.speedMs = TRAFFIC_CRUISE;
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const blocker = RAPIER.ColliderDesc.cuboid(0.9, 0.5, 2.1).setTranslation(
      car.position.x + fx * 5,
      0.8,
      car.position.z + fz * 5,
    );
    physics.world.createCollider(blocker, undefined);
    physics.world.step();
    for (let i = 0; i < 2 * 60; i += 1) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
      traffic.syncKinematics();
      physics.world.step();
    }
    expect(car.speedMs).toBeLessThan(3.0);
  });
});

describe("traffic recycle", () => {
  it("recycles a car 200 m away to within 60 m", () => {
    const traffic = new Traffic();
    const anchor = sampleLane(LANE_LOOPS[2], 0).position;
    traffic.setPlayerPos(anchor);
    traffic.teleportCar(0, {
      x: anchor.x + 200,
      y: anchor.y,
      z: anchor.z,
    });
    const before = traffic.cars[0].position;
    expect(Math.hypot(before.x - anchor.x, before.z - anchor.z)).toBeGreaterThan(
      150,
    );
    traffic.step(STEP_DT);
    const after = traffic.cars[0].position;
    expect(Math.hypot(after.x - anchor.x, after.z - anchor.z)).toBeLessThan(60);
  });

  it("keeps speed across the recycle", () => {
    const traffic = new Traffic();
    const anchor = sampleLane(LANE_LOOPS[2], 0).position;
    traffic.setPlayerPos(anchor);
    traffic.cars[1].speedMs = 4.0;
    traffic.teleportCar(1, {
      x: anchor.x - 200,
      y: anchor.y,
      z: anchor.z,
    });
    traffic.step(STEP_DT);
    expect(traffic.cars[1].speedMs).toBeGreaterThan(3.9);
    const p = traffic.cars[1].position;
    expect(Math.hypot(p.x - anchor.x, p.z - anchor.z)).toBeLessThan(60);
  });
});

describe("traffic loop", () => {
  it("wraps progress inside [0, length)", () => {
    const traffic = new Traffic();
    const car = traffic.cars[0] as TrafficCar;
    const length = laneLength(car.lane);
    car.speedMs = TRAFFIC_CRUISE;
    car.progress = length - 0.5;
    for (let i = 0; i < 60; i += 1) {
      car.step(STEP_DT, false);
    }
    expect(car.progress).toBeGreaterThanOrEqual(0);
    expect(car.progress).toBeLessThan(length);
    expect(Number.isFinite(car.yaw)).toBe(true);
  });

  it("samples the same pose across the wrap boundary", () => {
    const lane = LANE_LOOPS[0];
    const length = laneLength(lane);
    const a = sampleLane(lane, length + 5).position;
    const b = sampleLane(lane, 5).position;
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it("exposes both casings from getState", () => {
    const traffic = new Traffic();
    const state = traffic.carState(0);
    expect(state.speedMs).toBe(state.speed_ms);
    expect(state.laneIndex).toBe(state.lane_index);
    expect(state.position).toEqual(traffic.cars[0].position);
  });
});

describe("traffic kinematics", () => {
  it("attaches kinematicPositionBased bodies with the 1.8/1.0/4.2 cuboid", () => {
    const physics = new PhysicsWorld();
    physics.makeGround();
    const traffic = new Traffic();
    traffic.attachKinematics(physics.world, RAPIER);
    expect(TRAFFIC_COLLIDER_HALF).toEqual({ x: 0.9, y: 0.5, z: 2.1 });
    for (const car of traffic.cars) {
      expect(car.body).not.toBeNull();
      expect(car.body?.bodyType()).toBe(
        RAPIER.RigidBodyType.KinematicPositionBased,
      );
    }
  });

  it("syncs bodies from lane poses without stepping", () => {
    const physics = new PhysicsWorld();
    physics.makeGround();
    const traffic = new Traffic();
    traffic.attachKinematics(physics.world, RAPIER);
    traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    traffic.syncKinematics();
    physics.world.step();
    for (const car of traffic.cars) {
      const t = car.body?.translation() as { x: number; y: number; z: number };
      expect(t.x).toBeCloseTo(car.position.x, 4);
      expect(t.z).toBeCloseTo(car.position.z, 4);
    }
  });
});

describe("traffic hygiene", () => {
  it("imports no three.js", () => {
    const text = readFileSync(trafficFile, "utf8");
    expect(text).not.toMatch(/from\s+["']three["']/);
  });
});
