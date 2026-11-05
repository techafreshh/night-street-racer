// City grid acceptance suite (test_event_select_grid_skips_invalid idiom:
// duplicate-mutate-reject). Covers the issue contract with no padding:
// centerline truth on both axes, ground heights (analytic plus a real
// Rapier raycast in Node), mesh instance counts and placements, barrier
// extents with a 10 m/s chassis contained for 60 steps, materials
// presets, validators green on stock and red on one bad-bound mutation
// per dimension, and a static scan proving the materials module carries
// no three.js import and no imports at all.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { ensureRapierReady } from "../src/physics/world";
import {
  BARRIER_FRICTION,
  BARRIER_RESTITUTION,
  GROUND_FRICTION,
  GROUND_RESTITUTION,
  barrierColliderDesc,
  groundColliderDesc,
  validateMaterials,
} from "../src/physics/materials";
import {
  BARRIER_COLLIDER_COUNT,
  BARRIER_OFFSET,
  BLOCK_CENTERS,
  BLOCK_INSTANCE_COUNT,
  BLOCK_SIZE,
  CONTAINMENT_LIMIT,
  CURB_HEIGHT,
  DISTRICT_HALF,
  GROUND_COLLIDER_COUNT,
  PITCH,
  ROAD_CENTERLINES,
  ROAD_EW_LIP,
  ROAD_INSTANCE_COUNT,
  ROAD_STRIP_LENGTH,
  ROAD_WIDTH,
  addBarrierColliders,
  addGroundColliders,
  blockCenters,
  block_centers,
  buildBlockMeshes,
  buildRoadMeshes,
  castRayDown,
  centerLines,
  centerlines,
  createChassis,
  createCityWorld,
  getBarrierWalls,
  getBlockCenters,
  getRoadCenterlines,
  groundTopY,
  validateCityGrid,
} from "../src/render/city";

const physicsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "physics");

function freshCity(): RAPIER.World {
  const world = createCityWorld(RAPIER);
  addGroundColliders(world, RAPIER);
  addBarrierColliders(world, RAPIER);
  return world;
}

beforeAll(async () => {
  await ensureRapierReady();
});

describe("grid truth", () => {
  it("exports the documented constants", () => {
    expect(BLOCK_SIZE).toBe(60);
    expect(ROAD_WIDTH).toBe(8);
    expect(PITCH).toBe(68);
    expect(DISTRICT_HALF).toBe(140);
    expect(ROAD_EW_LIP).toBe(0.02);
    expect(CURB_HEIGHT).toBe(0.3);
    expect(ROAD_STRIP_LENGTH).toBe(280);
  });

  it("counts road centerlines equal to [-136,-68,0,68,136] on both axes", () => {
    expect([...ROAD_CENTERLINES]).toEqual([-136, -68, 0, 68, 136]);
    expect(getRoadCenterlines()).toEqual([-136, -68, 0, 68, 136]);
    expect(centerlines).toBe(ROAD_CENTERLINES);
    expect(centerLines).toBe(ROAD_CENTERLINES);
  });

  it("counts block centers equal to [-102,-34,34,102]", () => {
    expect([...BLOCK_CENTERS]).toEqual([-102, -34, 34, 102]);
    expect(getBlockCenters()).toEqual([-102, -34, 34, 102]);
    expect(blockCenters).toBe(BLOCK_CENTERS);
    expect(block_centers).toBe(BLOCK_CENTERS);
  });

  it("reads the EW lip on EW roads and the datum elsewhere", () => {
    expect(groundTopY(0, 136)).toBe(ROAD_EW_LIP);
    expect(Math.abs(groundTopY(0, 136))).toBeLessThanOrEqual(0.05);
    expect(groundTopY(20, 68)).toBe(ROAD_EW_LIP);
    expect(groundTopY(0, 20)).toBe(0);
    expect(groundTopY(34, 34)).toBe(0);
  });

  it("validates the stock grid", () => {
    expect(validateCityGrid()).toBe(true);
    expect(validateCityGrid({})).toBe(true);
    expect(
      validateCityGrid({ pitch: 68, centerlines: [-136, -68, 0, 68, 136] }),
    ).toBe(true);
  });

  it("rejects a mutated pitch", () => {
    expect(validateCityGrid({ pitch: 70 })).toBe(false);
    expect(validateCityGrid({ PITCH: 64 })).toBe(false);
  });

  it("rejects mutated centerlines", () => {
    expect(validateCityGrid({ centerlines: [-136, -68, 0, 68, 100] })).toBe(false);
    expect(validateCityGrid({ centerLines: [0, 0, 0, 0, 0] })).toBe(false);
  });

  it("rejects mutated block size and non-objects", () => {
    expect(validateCityGrid({ blockSize: 50 })).toBe(false);
    expect(validateCityGrid({ roadWidth: 10 })).toBe(false);
    expect(validateCityGrid(42)).toBe(false);
  });
});

describe("road and block meshes", () => {
  it("builds 10 road instances across two instanced meshes", () => {
    const meshes = buildRoadMeshes();
    expect(meshes).toHaveLength(2);
    const total = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    expect(total).toBe(ROAD_INSTANCE_COUNT);
    expect(total).toBe(10);
  });

  it("places NS strips on the centerlines with tops at y = 0", () => {
    const [ns] = buildRoadMeshes();
    const matrix = new THREE.Matrix4();
    ns.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(-136);
    ns.getMatrixAt(2, matrix);
    expect(matrix.elements[12]).toBe(0);
    expect(matrix.elements[13]).toBeCloseTo(-0.05, 5);
  });

  it("places EW strips on the centerlines with tops at y = +0.02", () => {
    const [, ew] = buildRoadMeshes();
    const matrix = new THREE.Matrix4();
    ew.getMatrixAt(4, matrix);
    expect(matrix.elements[14]).toBe(136);
    expect(matrix.elements[13]).toBeCloseTo(-0.03, 5);
  });

  it("builds 16 block slabs with tops at y = 0.3", () => {
    const blocks = buildBlockMeshes();
    expect(blocks.count).toBe(BLOCK_INSTANCE_COUNT);
    expect(blocks.count).toBe(16);
    const matrix = new THREE.Matrix4();
    blocks.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(-102);
    expect(matrix.elements[13]).toBeCloseTo(0.15, 5);
    expect(matrix.elements[14]).toBe(-102);
    blocks.getMatrixAt(15, matrix);
    expect(matrix.elements[12]).toBe(102);
    expect(matrix.elements[14]).toBe(102);
  });
});

describe("city physics", () => {
  it("adds 6 ground colliders and 4 barrier colliders", () => {
    const world = createCityWorld(RAPIER);
    expect(addGroundColliders(world, RAPIER)).toBe(GROUND_COLLIDER_COUNT);
    expect(addGroundColliders(world, RAPIER)).toBe(6);
    expect(addBarrierColliders(world, RAPIER)).toBe(BARRIER_COLLIDER_COUNT);
    expect(addBarrierColliders(world, RAPIER)).toBe(4);
  });

  it("centers route-edge barriers at +-140.5 with 282x4x1 spans", () => {
    expect(BARRIER_OFFSET).toBe(140.5);
    const walls = getBarrierWalls();
    expect(walls).toHaveLength(4);
    const zWalls = walls.filter((w) => w.half.x > w.half.z);
    const xWalls = walls.filter((w) => w.half.z > w.half.x);
    expect(zWalls).toHaveLength(2);
    expect(xWalls).toHaveLength(2);
    for (const wall of zWalls) {
      expect(Math.abs(wall.center.z)).toBe(140.5);
      expect(wall.half.x * 2).toBe(282);
      expect(wall.half.y * 2).toBe(4);
      expect(wall.half.z * 2).toBe(1);
    }
    for (const wall of xWalls) {
      expect(Math.abs(wall.center.x)).toBe(140.5);
      expect(wall.half.z * 2).toBe(282);
      expect(wall.half.y * 2).toBe(4);
      expect(wall.half.x * 2).toBe(1);
    }
  });

  it("raycasts down at (0,136) to a ground hit of 0 plus-minus 0.05", () => {
    const world = freshCity();
    const hit = castRayDown(world, RAPIER, 0, 136);
    expect(hit).not.toBeNull();
    expect(Math.abs((hit ?? 99) - 0)).toBeLessThanOrEqual(0.05);
    expect(hit ?? 99).toBeCloseTo(0.02, 2);
  });

  it("raycasts the NS datum away from EW lips", () => {
    const world = freshCity();
    const hit = castRayDown(world, RAPIER, 0, 20);
    expect(hit).not.toBeNull();
    expect(hit ?? 99).toBeCloseTo(0, 2);
  });

  it("returns null for a missing world and never throws", () => {
    expect(castRayDown(null, RAPIER, 0, 136)).toBeNull();
    expect(castRayDown(undefined, RAPIER, 0, 136)).toBeNull();
  });

  it("keeps a 10 m/s chassis inside half-extent 145m after 1s", () => {
    const world = freshCity();
    const body = createChassis(
      world,
      RAPIER,
      { x: 0, y: 1, z: 134 },
      { x: 0, y: 0, z: 10 },
    );
    for (let i = 0; i < 60; i += 1) {
      world.step();
    }
    const p = body.translation() as { x: number; y: number; z: number };
    expect(p.z).toBeGreaterThan(134);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(CONTAINMENT_LIMIT);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(CONTAINMENT_LIMIT);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(145);
  });
});

describe("materials", () => {
  it("carries driving grip and dead walls", () => {
    expect(GROUND_FRICTION).toBe(1.0);
    expect(GROUND_RESTITUTION).toBe(0);
    expect(BARRIER_FRICTION).toBeGreaterThanOrEqual(0);
    expect(BARRIER_FRICTION).toBeLessThanOrEqual(2);
    expect(BARRIER_RESTITUTION).toBe(0);
  });

  it("validates stock presets and rejects bad friction", () => {
    expect(validateMaterials()).toBe(true);
    expect(validateMaterials({ friction: 1.0, restitution: 0 })).toBe(true);
    expect(validateMaterials({ friction: -1, restitution: 0 })).toBe(false);
    expect(validateMaterials({ friction: 1.0, restitution: 5 })).toBe(false);
  });

  it("builds cuboid descs through the factories", () => {
    expect(groundColliderDesc(RAPIER, 1, 1, 1, 0, 0, 0)).toBeDefined();
    expect(barrierColliderDesc(RAPIER, 1, 1, 1, 0, 0, 0)).toBeDefined();
  });
});

describe("materials hygiene", () => {
  it("has no three.js imports", () => {
    const text = readFileSync(join(physicsDir, "materials.ts"), "utf8");
    expect(text).not.toMatch(/three/);
    expect(text).not.toMatch(/^\s*import\s/m);
  });
});
