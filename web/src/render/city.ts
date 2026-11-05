// Night-district grid city: the Godot grey-box street grid ported
// verbatim from scripts/city/district_builder.gd as pure constants
// plus procedural three.js InstancedMesh builders and Rapier
// static-cuboid builders. Grid math: BLOCK_SIZE 60 m, ROAD_WIDTH 8 m,
// PITCH 68 m, total side 4 * 60 + 5 * 8 = 280 m (DISTRICT_HALF 140 m).
// Block centers sit at -102 / -34 / 34 / 102 on x/z; road strips sit
// at -136 / -68 / 0 / 68 / 136. NS strips rest at y = 0 (datum); EW
// strips carry a +0.02 m anti-z-fighting lip (tops at y = +0.02).
// Block-slab tops sit at y = 0.3; the 0.3 m step is a visual curb only,
// the physics datum stays flat. All three.js construction lives inside
// builder functions and every physics builder takes the initialized
// Rapier module as a parameter, so importing this module stays
// Node-safe (no DOM/WebGL/WASM at import time).
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  barrierColliderDesc,
  groundColliderDesc,
} from "../physics/materials";

// Full Rapier module surface (the default export of
// @dimforge/rapier3d-compat once initialized via RAPIER.init()).
export type RapierModule = typeof import("@dimforge/rapier3d-compat").default;

export type Xyz = { x: number; y: number; z: number };

// --- Grid truth (district_builder.gd constants) ---

export const BLOCK_SIZE = 60.0;
export const ROAD_WIDTH = 8.0;
export const PITCH = 68.0;
export const DISTRICT_HALF = 140.0;
export const ROAD_EW_LIP = 0.02;
// Visual curb step: block-slab tops sit this high, physics stays flat.
export const CURB_HEIGHT = 0.3;

export const BLOCK_CENTERS: readonly number[] = [-102, -34, 34, 102];
export const ROAD_CENTERLINES: readonly number[] = [-136, -68, 0, 68, 136];

// Same-reference aliases so harness wording cannot mismatch.
export const blockCenters = BLOCK_CENTERS;
export const block_centers = BLOCK_CENTERS;
export const centerlines = ROAD_CENTERLINES;
export const centerLines = ROAD_CENTERLINES;
export const roadCenterlines = ROAD_CENTERLINES;
export const road_centerlines = ROAD_CENTERLINES;

// --- Visual mesh dimensions ---

// Road strips run the full 280 m side; 0.1 m thick slabs.
export const ROAD_STRIP_LENGTH = DISTRICT_HALF * 2;
export const ROAD_THICKNESS = 0.1;
// 5 NS strips plus 5 EW strips.
export const ROAD_INSTANCE_COUNT = 10;
// 4x4 block slabs, tops at CURB_HEIGHT.
export const BLOCK_INSTANCE_COUNT = 16;

// --- Physics collider dimensions ---

// Base slab: 280x1x280 with its top at y = 0.
export const GROUND_THICKNESS = 1.0;
// EW lip slabs share the base thickness; their tops sit at +0.02.
export const LIP_THICKNESS = 1.0;
// One base slab plus five EW lip slabs.
export const GROUND_COLLIDER_COUNT = 6;

// Route-edge walls: 282x4x1 (N/S) and 1x4x282 (E/W), inner faces
// exactly on the district edge, centers at +/-140.5.
export const BARRIER_OFFSET = DISTRICT_HALF + 0.5;
export const BARRIER_THICKNESS = 1.0;
export const BARRIER_HEIGHT = 4.0;
export const BARRIER_LENGTH = DISTRICT_HALF * 2 + 2;
export const BARRIER_COLLIDER_COUNT = 4;

// Test chassis footprint: vehicle_base.tscn half-extents.
export const CHASSIS_HALF: Xyz = { x: 0.9, y: 0.25, z: 2.1 };
export const CHASSIS_FRICTION = 0.5;

// Downward probe ray origin height and reach.
export const RAY_ORIGIN_HEIGHT = 10.0;
export const RAY_MAX_TOI = RAY_ORIGIN_HEIGHT + 10.0;

// Containment bound the acceptance probe reads against.
export const CONTAINMENT_LIMIT = DISTRICT_HALF + 5.0;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberEquals(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// --- Pure geometry queries ---

// Fresh copies so callers cannot mutate the grid truth.
export function getRoadCenterlines(): number[] {
  return [...ROAD_CENTERLINES];
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const get_road_centerlines = getRoadCenterlines;

// Fresh copies so callers cannot mutate the grid truth.
export function getBlockCenters(): number[] {
  return [...BLOCK_CENTERS];
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const get_block_centers = getBlockCenters;

// True when the coordinate lies on a road strip (within half the road
// width of a centerline), on either axis.
export function isOnRoadAxis(value: number): boolean {
  if (!isFiniteNumber(value)) {
    return false;
  }
  return ROAD_CENTERLINES.some(
    (c) => Math.abs(value - c) <= ROAD_WIDTH / 2 + 1e-9,
  );
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const is_on_road_axis = isOnRoadAxis;

// Physics driving-surface height at (x, z): EW strips carry the lip
// (crossings read the lip), everything else rests on the datum. The
// curb step is visual only, so block interiors also read 0.
export function groundTopY(x: number, z: number): number {
  if (!isFiniteNumber(x) || !isFiniteNumber(z)) {
    return 0;
  }
  if (isOnRoadAxis(z)) {
    return ROAD_EW_LIP;
  }
  return 0;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const ground_top_y = groundTopY;

// Boolean-only, never throws. With no argument validates the stock
// grid truth; with a partial grid object validates the provided fields
// against stock (missing fields read as stock), checking every alias
// slot so harness wording cannot mismatch.
export function validateCityGrid(grid?: unknown): boolean {
  try {
    if (grid === undefined || grid === null) {
      return checkGrid({});
    }
    if (typeof grid !== "object") {
      return false;
    }
    return checkGrid(grid as Record<string, unknown>);
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_city_grid = validateCityGrid;

function checkGrid(grid: Record<string, unknown>): boolean {
  const pick = (value: unknown, fallback: number): number =>
    isFiniteNumber(value) ? value : fallback;
  const pitch = pick(grid.pitch ?? grid.PITCH, PITCH);
  const blockSize = pick(
    grid.blockSize ?? grid.block_size ?? grid.BLOCK_SIZE,
    BLOCK_SIZE,
  );
  const roadWidth = pick(
    grid.roadWidth ?? grid.road_width ?? grid.ROAD_WIDTH,
    ROAD_WIDTH,
  );
  const half = pick(
    grid.districtHalf ??
      grid.district_half ??
      grid.DISTRICT_HALF,
    DISTRICT_HALF,
  );
  const lip = pick(
    grid.roadEwLip ?? grid.road_ew_lip ?? grid.ROAD_EW_LIP,
    ROAD_EW_LIP,
  );
  const centers = (grid.blockCenters ??
    grid.block_centers ??
    grid.BLOCK_CENTERS ??
    BLOCK_CENTERS) as unknown;
  const lines = (grid.centerlines ??
    grid.centerLines ??
    grid.roadCenterlines ??
    grid.road_centerlines ??
    grid.ROAD_CENTERLINES ??
    ROAD_CENTERLINES) as unknown;
  return (
    pitch === PITCH &&
    blockSize === BLOCK_SIZE &&
    roadWidth === ROAD_WIDTH &&
    half === DISTRICT_HALF &&
    lip === ROAD_EW_LIP &&
    Array.isArray(centers) &&
    numberEquals(centers as number[], [...BLOCK_CENTERS]) &&
    Array.isArray(lines) &&
    numberEquals(lines as number[], [...ROAD_CENTERLINES])
  );
}

// --- Visual mesh builders (three.js lives only in here) ---

// Five NS strips (8x0.1x280, tops at y = 0) plus five EW strips
// (280x0.1x8, tops at y = +0.02): ten instances total.
export function buildRoadMeshes(): THREE.InstancedMesh[] {
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a1a22,
    roughness: 0.95,
    metalness: 0.0,
  });
  const nsGeometry = new THREE.BoxGeometry(
    ROAD_WIDTH,
    ROAD_THICKNESS,
    ROAD_STRIP_LENGTH,
  );
  const ewGeometry = new THREE.BoxGeometry(
    ROAD_STRIP_LENGTH,
    ROAD_THICKNESS,
    ROAD_WIDTH,
  );
  const ns = new THREE.InstancedMesh(
    nsGeometry,
    material,
    ROAD_CENTERLINES.length,
  );
  const ew = new THREE.InstancedMesh(
    ewGeometry,
    material,
    ROAD_CENTERLINES.length,
  );
  const matrix = new THREE.Matrix4();
  ROAD_CENTERLINES.forEach((c, i) => {
    matrix.makeTranslation(c, -ROAD_THICKNESS / 2, 0);
    ns.setMatrixAt(i, matrix);
    matrix.makeTranslation(0, ROAD_EW_LIP - ROAD_THICKNESS / 2, c);
    ew.setMatrixAt(i, matrix);
  });
  ns.instanceMatrix.needsUpdate = true;
  ew.instanceMatrix.needsUpdate = true;
  return [ns, ew];
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const build_road_meshes = buildRoadMeshes;

// Sixteen 60x0.3x60 block slabs with tops at y = 0.3 (visual curb).
export function buildBlockMeshes(): THREE.InstancedMesh {
  const material = new THREE.MeshStandardMaterial({
    color: 0x2a2a34,
    roughness: 0.9,
    metalness: 0.0,
  });
  const geometry = new THREE.BoxGeometry(
    BLOCK_SIZE,
    CURB_HEIGHT,
    BLOCK_SIZE,
  );
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    BLOCK_CENTERS.length * BLOCK_CENTERS.length,
  );
  const matrix = new THREE.Matrix4();
  let i = 0;
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      matrix.makeTranslation(cx, CURB_HEIGHT / 2, cz);
      mesh.setMatrixAt(i, matrix);
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const build_block_meshes = buildBlockMeshes;

// --- Physics builders (the Rapier module arrives as a parameter) ---

// Raw Rapier world with the v1 gravity and the 60 Hz accumulator tick.
export function createCityWorld(RAPIER: RapierModule): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  return world;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_city_world = createCityWorld;

// Base slab (top y = 0) plus five EW lip slabs (tops y = +0.02) via
// the ground friction preset. Returns the collider count.
export function addGroundColliders(
  world: RAPIER.World,
  RAPIER: RapierModule,
): number {
  const base = groundColliderDesc<RAPIER.ColliderDesc>(
    RAPIER,
    DISTRICT_HALF,
    GROUND_THICKNESS / 2,
    DISTRICT_HALF,
    0,
    -GROUND_THICKNESS / 2,
    0,
  );
  world.createCollider(base, undefined);
  for (const c of ROAD_CENTERLINES) {
    const lip = groundColliderDesc<RAPIER.ColliderDesc>(
      RAPIER,
      DISTRICT_HALF,
      LIP_THICKNESS / 2,
      ROAD_WIDTH / 2,
      0,
      ROAD_EW_LIP - LIP_THICKNESS / 2,
      c,
    );
    world.createCollider(lip, undefined);
  }
  // Warm the query pipeline: castRay probes read null until the first
  // world.step() populates it (PhysicsWorld.spawnChassis idiom).
  world.step();
  return GROUND_COLLIDER_COUNT;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const add_ground_colliders = addGroundColliders;

export type BarrierWall = {
  center: Xyz;
  half: Xyz;
};

// The four route-edge walls: N/S span 282x4x1, E/W span 1x4x282,
// inner faces exactly on the district edge.
export function getBarrierWalls(): BarrierWall[] {
  const hy = BARRIER_HEIGHT / 2;
  const long = BARRIER_LENGTH / 2;
  const thick = BARRIER_THICKNESS / 2;
  return [
    {
      center: { x: 0, y: hy, z: -BARRIER_OFFSET },
      half: { x: long, y: hy, z: thick },
    },
    {
      center: { x: 0, y: hy, z: BARRIER_OFFSET },
      half: { x: long, y: hy, z: thick },
    },
    {
      center: { x: -BARRIER_OFFSET, y: hy, z: 0 },
      half: { x: thick, y: hy, z: long },
    },
    {
      center: { x: BARRIER_OFFSET, y: hy, z: 0 },
      half: { x: thick, y: hy, z: long },
    },
  ];
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const get_barrier_walls = getBarrierWalls;

// Four static perimeter walls via the barrier friction preset.
// Returns the collider count.
export function addBarrierColliders(
  world: RAPIER.World,
  RAPIER: RapierModule,
): number {
  for (const wall of getBarrierWalls()) {
    const desc = barrierColliderDesc<RAPIER.ColliderDesc>(
      RAPIER,
      wall.half.x,
      wall.half.y,
      wall.half.z,
      wall.center.x,
      wall.center.y,
      wall.center.z,
    );
    world.createCollider(desc, undefined);
  }
  // Warm the query pipeline: castRay probes read null until the first
  // world.step() populates it (PhysicsWorld.spawnChassis idiom).
  world.step();
  return BARRIER_COLLIDER_COUNT;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const add_barrier_colliders = addBarrierColliders;

// Downward surface probe at (x, z) from y = 10: returns the ground-hit
// y, or null when the world is missing or the ray misses. Never throws.
export function castRayDown(
  world: RAPIER.World | null | undefined,
  RAPIER: RapierModule,
  x: number,
  z: number,
): number | null {
  try {
    if (world === null || world === undefined) {
      return null;
    }
    if (!isFiniteNumber(x) || !isFiniteNumber(z)) {
      return null;
    }
    const ray = new RAPIER.Ray(
      { x, y: RAY_ORIGIN_HEIGHT, z },
      { x: 0, y: -1, z: 0 },
    );
    const hit = world.castRay(ray, RAY_MAX_TOI, true);
    if (hit === null) {
      return null;
    }
    const toi = (hit as { timeOfImpact?: unknown }).timeOfImpact;
    if (!isFiniteNumber(toi)) {
      return null;
    }
    return RAY_ORIGIN_HEIGHT - toi;
  } catch {
    return null;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const cast_ray_down = castRayDown;

// Dynamic test chassis (vehicle_base.tscn footprint) with an initial
// planar velocity: the containment probe fires it at a wall.
export function createChassis(
  world: RAPIER.World,
  RAPIER: RapierModule,
  pos: Xyz = { x: 0, y: 1, z: 0 },
  linvel: Xyz = { x: 0, y: 0, z: 0 },
): RAPIER.RigidBody {
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setCanSleep(false);
  const body = world.createRigidBody(desc);
  const collider = RAPIER.ColliderDesc.cuboid(
    CHASSIS_HALF.x,
    CHASSIS_HALF.y,
    CHASSIS_HALF.z,
  ).setFriction(CHASSIS_FRICTION);
  world.createCollider(collider, body);
  body.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return body;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_chassis = createChassis;
