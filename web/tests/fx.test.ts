// FX acceptance suite (scripts/fx/ port idiom: pooled smoke, skid ring,
// brake lights, hinge flash). Covers the issue contract with no padding:
// 0.3 rad drift growth past 5 puffs in 1 s, parked silence, brake
// on/off emissive gates, camera_shake:false zero offset, skid ring
// cap/fade, validator green/red, and a static scan proving
// vehicles/fx.ts carries no runtime three.js import. Node-safe: no
// WebGL/DOM/network.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BRAKE_OFF_INTENSITY,
  BRAKE_ON_INTENSITY,
  SKID_FADE_TIME,
  SKID_MAX_SEGMENTS,
  SLIP_THRESHOLD,
  SMOKE_LIFETIME,
  SMOKE_MAX,
  SMOKE_SPAWN_PER_TICK,
  SPEED_GATE,
  BrakeLights,
  brake_off_intensity,
  brake_on_intensity,
  skid_fade_time,
  skid_max_segments,
  slip_threshold,
  smoke_max,
  smoke_spawn_per_tick,
  speed_gate,
  SmokePool,
  SkidTrail,
  VehicleFX,
  rearSkidAnchors,
} from "../src/vehicles/fx";
import { IDENTITY_QUAT, yawToQuat } from "../src/physics/vec";
import { ChaseCamera, shakeOffset } from "../src/vehicles/camera";
import {
  buildSkidMesh,
  buildSmokeBillboards,
  build_skid_mesh,
  build_smoke_billboards,
  createBrakeLightMaterial,
  create_brake_light_material,
  ensureFlashOverlay,
  ensure_flash_overlay,
  HingeFlash,
  syncBrakeLight,
  sync_brake_light,
  syncSkids,
  sync_skids,
  syncSmoke,
  sync_smoke,
  validateEffectsConfig,
  validate_effects_config,
} from "../src/render/effects";

const DT = 1 / 60;

function driftOneSecond(fx: VehicleFX): void {
  for (let i = 0; i < 60; i += 1) {
    fx.update(DT, { slip: 0.3, speed: 20 });
  }
}

describe("fx pins", () => {
  it("pins the v1 thresholds", () => {
    expect(SMOKE_MAX).toBe(64);
    expect(SMOKE_LIFETIME).toBe(0.8);
    expect(SMOKE_SPAWN_PER_TICK).toBe(2);
    expect(SLIP_THRESHOLD).toBe(0.25);
    expect(SPEED_GATE).toBe(5.0);
    expect(SKID_MAX_SEGMENTS).toBe(256);
    expect(SKID_FADE_TIME).toBe(8.0);
    expect(BRAKE_ON_INTENSITY).toBe(4.0);
    expect(BRAKE_OFF_INTENSITY).toBe(0.3);
    expect(smoke_max).toBe(SMOKE_MAX);
    expect(smoke_spawn_per_tick).toBe(SMOKE_SPAWN_PER_TICK);
    expect(slip_threshold).toBe(SLIP_THRESHOLD);
    expect(speed_gate).toBe(SPEED_GATE);
    expect(skid_max_segments).toBe(SKID_MAX_SEGMENTS);
    expect(skid_fade_time).toBe(SKID_FADE_TIME);
    expect(brake_on_intensity).toBe(BRAKE_ON_INTENSITY);
    expect(brake_off_intensity).toBe(BRAKE_OFF_INTENSITY);
  });
});

describe("smoke pool", () => {
  it("grows past 5 puffs on a 0.3 rad drift at speed for 1 s", () => {
    const fx = new VehicleFX();
    driftOneSecond(fx);
    expect(fx.smoke.activeCount).toBeGreaterThan(5);
    expect(fx.smoke.active_count).toBe(fx.smoke.activeCount);
  });

  it("accepts the dual-vocabulary sample bags", () => {
    const fx = new VehicleFX();
    for (let i = 0; i < 60; i += 1) {
      fx.update(DT, { slipRad: 0.3, speedMs: 20 });
    }
    expect(fx.smoke.activeCount).toBeGreaterThan(5);
    const aliased = new VehicleFX();
    for (let i = 0; i < 60; i += 1) {
      aliased.update(DT, { slip_rad: 0.3, speed_ms: 20 });
    }
    expect(aliased.smoke.activeCount).toBeGreaterThan(5);
  });

  it("stays silent when parked and fades out at rest", () => {
    const fx = new VehicleFX();
    for (let i = 0; i < 60; i += 1) {
      fx.update(DT, { slip: 0.3, speed: 0 });
    }
    expect(fx.smoke.activeCount).toBe(0);
    const hot = new VehicleFX();
    driftOneSecond(hot);
    expect(hot.smoke.activeCount).toBeGreaterThan(5);
    for (let i = 0; i < 60; i += 1) {
      hot.update(DT, { slip: 0, speed: 0 });
    }
    expect(hot.smoke.activeCount).toBe(0);
  });

  it("caps the pool and round-robins without throwing", () => {
    const pool = new SmokePool();
    for (let i = 0; i < SMOKE_MAX * 3; i += 1) {
      pool.emit({ x: i, y: 0, z: 0 });
      pool.update(DT);
    }
    expect(pool.activeCount).toBeLessThanOrEqual(SMOKE_MAX);
    expect(pool.active_count).toBe(pool.activeCount);
    expect(() => pool.update(Number.NaN)).not.toThrow();
    expect(() => pool.update(-1)).not.toThrow();
    pool.clear();
    expect(pool.activeCount).toBe(0);
  });

  it("forces emission through the forceSlip seam", () => {
    const fx = new VehicleFX();
    fx.forceSlip = true;
    for (let i = 0; i < 60; i += 1) {
      fx.update(DT, { slip: 0, speed: 20 });
    }
    expect(fx.smoke.activeCount).toBeGreaterThan(5);
    expect(fx.force_slip).toBe(true);
    fx.reset();
    expect(fx.forceSlip).toBe(false);
    expect(fx.smoke.activeCount).toBe(0);
  });
});

describe("skid trail", () => {
  it("lays one rung per hot tick while grounded", () => {
    const fx = new VehicleFX();
    driftOneSecond(fx);
    expect(fx.skids.segmentCount).toBe(60);
    expect(fx.skidMarks.segmentCount).toBe(60);
  });

  it("caps the ring at SKID_MAX_SEGMENTS", () => {
    const trail = new SkidTrail();
    for (let i = 0; i < SKID_MAX_SEGMENTS + 40; i += 1) {
      trail.addSegment({ x: -0.8, y: 0, z: -i }, { x: 0.8, y: 0, z: -i });
    }
    expect(trail.segmentCount).toBe(SKID_MAX_SEGMENTS);
    expect(trail.segment_count).toBe(SKID_MAX_SEGMENTS);
  });

  it("empties after the fade time", () => {
    const fx = new VehicleFX();
    driftOneSecond(fx);
    expect(fx.skids.segmentCount).toBeGreaterThan(0);
    fx.update(SKID_FADE_TIME + DT, { slip: 0, speed: 0 });
    expect(fx.skids.segmentCount).toBe(0);
  });
});

describe("brake lights", () => {
  it("snaps above 1.0 pressed and below 0.5 released", () => {
    const brakes = new BrakeLights();
    brakes.setBraking(true);
    expect(brakes.emissiveIntensity).toBeGreaterThan(1.0);
    expect(brakes.emissive_intensity).toBe(brakes.emissiveIntensity);
    brakes.setBraking(false);
    expect(brakes.emissiveIntensity).toBeLessThan(0.5);
  });

  it("tracks the braking flag through VehicleFX", () => {
    const fx = new VehicleFX();
    fx.update(DT, { slip: 0, speed: 0, brake: 1 });
    expect(fx.brakes.emissiveIntensity).toBeGreaterThan(1.0);
    expect(fx.brakeLights.emissiveIntensity).toBeGreaterThan(1.0);
    fx.update(DT, { slip: 0, speed: 0, brake: 0 });
    expect(fx.brakes.emissiveIntensity).toBeLessThan(0.5);
    fx.update(DT, { slip: 0, speed: 0, braking: true });
    expect(fx.brakes.emissiveIntensity).toBeGreaterThan(1.0);
  });
});

describe("shake-off gate", () => {
  it("reads exactly zero offset jitter when disabled at drift speed", () => {
    expect(shakeOffset(3.7, 30, 0.5, false)).toEqual({ x: 0, y: 0 });
    const cam = new ChaseCamera();
    const pose = cam.update(DT, {
      carPos: { x: 0, y: 0, z: 0 },
      carYaw: 0,
      speedMs: 30,
      slipRad: 0.5,
      camera_shake: false,
    });
    expect(pose.shake).toEqual({ x: 0, y: 0 });
    expect(pose.offset).toEqual({ x: 0, y: 0 });
    expect(pose.jitter).toEqual({ x: 0, y: 0 });
  });
});

describe("render effects", () => {
  it("builds instanced smoke billboards over the pool budget", () => {
    const mesh = buildSmokeBillboards();
    expect(mesh.count).toBe(SMOKE_MAX);
    expect(build_smoke_billboards).toBe(buildSmokeBillboards);
    const pool = new SmokePool();
    pool.emit({ x: 1, y: 0.5, z: -2 });
    expect(() => syncSmoke(mesh, pool)).not.toThrow();
    expect(sync_smoke).toBe(syncSmoke);
    expect(() => syncSmoke(null, pool)).not.toThrow();
    expect(() => syncSmoke(mesh, null)).not.toThrow();
    mesh.geometry.dispose();
  });

  it("builds a preallocated skid ribbon and syncs the trail", () => {
    const mesh = buildSkidMesh();
    const trail = new SkidTrail();
    trail.addSegment({ x: -0.8, y: 0, z: 0 }, { x: 0.8, y: 0, z: 0 });
    expect(() => syncSkids(mesh, trail)).not.toThrow();
    expect(mesh.geometry.getAttribute("position")).toBeDefined();
    expect(sync_skids).toBe(syncSkids);
    expect(build_skid_mesh).toBe(buildSkidMesh);
    expect(() => syncSkids(null, trail)).not.toThrow();
    mesh.geometry.dispose();
  });

  it("syncs the brake material from the simulated level", () => {
    const material = createBrakeLightMaterial();
    expect(create_brake_light_material).toBe(createBrakeLightMaterial);
    const brakes = new BrakeLights();
    brakes.setBraking(true);
    syncBrakeLight(material, brakes);
    expect(material.emissiveIntensity).toBeGreaterThan(1.0);
    brakes.setBraking(false);
    syncBrakeLight(material, brakes);
    expect(material.emissiveIntensity).toBeLessThan(0.5);
    expect(sync_brake_light).toBe(syncBrakeLight);
    expect(() => syncBrakeLight(null, brakes)).not.toThrow();
  });

  it("flashes the hinge level and decays it to zero", () => {
    const flash = new HingeFlash();
    expect(flash.level).toBe(0);
    flash.flash();
    expect(flash.level).toBe(1);
    expect(flash.flash_level).toBe(flash.level);
    flash.update(10);
    expect(flash.level).toBe(0);
  });

  it("returns null for the overlay without a document", () => {
    expect(ensureFlashOverlay(null)).toBeNull();
    expect(ensure_flash_overlay).toBe(ensureFlashOverlay);
  });

  it("validates the stock config and rejects one mutated field", () => {
    expect(validateEffectsConfig()).toBe(true);
    expect(validateEffectsConfig({})).toBe(true);
    expect(validateEffectsConfig({ smokeMax: 8 })).toBe(false);
    expect(validateEffectsConfig({ skidMax: 8 })).toBe(false);
    expect(validateEffectsConfig({ flashDecay: 99 })).toBe(false);
    expect(validate_effects_config).toBe(validateEffectsConfig);
  });
});

describe("fx anchors", () => {
  it("returns the rear WHEEL_MOUNTS pair at identity", () => {
    const { left, right } = rearSkidAnchors(
      { x: 10, y: 2, z: 30 },
      IDENTITY_QUAT,
    );
    expect(left.x).toBeCloseTo(10 - 0.85, 6);
    expect(left.y).toBeCloseTo(2, 6);
    expect(left.z).toBeCloseTo(30 + 1.35, 6);
    expect(right.x).toBeCloseTo(10 + 0.85, 6);
    expect(right.y).toBeCloseTo(2, 6);
    expect(right.z).toBeCloseTo(30 + 1.35, 6);
  });

  it("separates the rung along world z at 90 deg yaw", () => {
    const { left, right } = rearSkidAnchors(
      { x: 0, y: 0, z: 0 },
      yawToQuat(Math.PI / 2),
    );
    expect(left.x).toBeCloseTo(right.x, 6);
    expect(Math.abs(left.z - right.z)).toBeCloseTo(1.7, 6);
    expect(Math.abs(left.z - right.z)).toBeGreaterThan(
      Math.abs(left.x - right.x),
    );
  });

  it("stores the explicit left/right rung in the skid trail", () => {
    const fx = new VehicleFX();
    const pos = { x: 4, y: 0, z: -7 };
    const left = { x: 3.15, y: 0, z: -5.65 };
    const right = { x: 4.85, y: 0, z: -5.65 };
    fx.update(DT, { slip: 0.3, speed: 20, pos, left, right });
    expect(fx.skids.segmentCount).toBe(1);
    const rung = fx.skids.segment(0);
    expect(rung?.left).toEqual(left);
    expect(rung?.right).toEqual(right);
  });

  it("falls back to anchor.x +/- 0.8 when left/right are absent", () => {
    const fx = new VehicleFX();
    const pos = { x: 4, y: 1, z: -7 };
    fx.update(DT, { slip: 0.3, speed: 20, pos });
    expect(fx.skids.segmentCount).toBe(1);
    const rung = fx.skids.segment(0);
    expect(rung?.left).toEqual({ x: 3.2, y: 1, z: -7 });
    expect(rung?.right).toEqual({ x: 4.8, y: 1, z: -7 });
  });
});

describe("fx module hygiene", () => {
  it("imports no three.js at runtime", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vehicles");
    const text = readFileSync(join(root, "fx.ts"), "utf8");
    expect(text).not.toMatch(/from\s+[\"']three[\"']/);
    expect(text).not.toMatch(/require\(\s*[\"']three[\"']\s*\)/);
  });
});

describe("fx scene mount", () => {
  function readMain(): string {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    return readFileSync(join(root, "main.ts"), "utf8");
  }

  it("mounts the smoke and skid meshes to the render scene", () => {
    const text = readMain();
    expect(text).toMatch(/scene\.add\(smokeMesh\)/);
    expect(text).toMatch(/scene\.add\(skidMesh\)/);
    expect(text).toMatch(/buildSmokeBillboards\(\)/);
    expect(text).toMatch(/buildSkidMesh\(\)/);
  });

  it("syncs the live pools into the mounted meshes every tick", () => {
    const text = readMain();
    expect(text).toMatch(/syncSmoke\(smokeMesh/);
    expect(text).toMatch(/syncSkids\(skidMesh/);
  });

  it("publishes the mounted meshes behind live probe getters", () => {
    const text = readMain();
    expect(text).toMatch(/get smokeMesh\(\)/);
    expect(text).toMatch(/get smoke_mesh\(\)/);
    expect(text).toMatch(/get skidMesh\(\)/);
    expect(text).toMatch(/get skid_mesh\(\)/);
  });

  it("names the mounted meshes so probes can check scene membership", () => {
    const smoke = buildSmokeBillboards();
    expect(smoke.name).toBe("smoke-billboards");
    expect(smoke.count).toBe(SMOKE_MAX);
    smoke.geometry.dispose();
    const skids = buildSkidMesh();
    expect(skids.name).toBe("skid-marks");
    skids.geometry.dispose();
  });
});
