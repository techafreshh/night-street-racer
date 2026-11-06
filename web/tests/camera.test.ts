// Chase-camera acceptance suite (chase_camera.gd port idiom).
// Covers the issue contract with no padding: FOV endpoints, the
// camera_shake:false zero-jitter gate, the 90deg-snap/500ms lag bound,
// look-back slot flip, exponential-weight monotonicity, deterministic
// shake, NaN guards, and a static scan proving the module carries no
// runtime three.js import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ChaseCamera,
  FOLLOW_DISTANCE,
  FOLLOW_HEIGHT,
  FOV_MAX,
  FOV_MIN,
  fov_for_speed,
  fovForSpeed,
  lag_weight,
  lagWeight,
  LOOKAHEAD_DISTANCE,
  POSITION_SMOOTHING,
  SHAKE_AMPLITUDE,
  shake_offset,
  shakeOffset,
} from "../src/vehicles/camera";

const DT = 1 / 60;

function behindSlot(carYaw: number): { x: number; z: number } {
  return {
    x: 0 - -Math.sin(carYaw) * FOLLOW_DISTANCE,
    z: 0 - -Math.cos(carYaw) * FOLLOW_DISTANCE,
  };
}

describe("chase camera fov", () => {
  it("reads 70 plus/minus 2 at standstill", () => {
    expect(fovForSpeed(0)).toBeCloseTo(70.0, 6);
    expect(fov_for_speed(0)).toBe(70.0);
    expect(new ChaseCamera().fov).toBeCloseTo(70.0, 6);
  });

  it("pins the v1 constants", () => {
    expect(FOV_MIN).toBe(70.0);
    expect(FOV_MAX).toBe(85.0);
    expect(FOLLOW_DISTANCE).toBe(7.0);
    expect(FOLLOW_HEIGHT).toBe(3.0);
    expect(LOOKAHEAD_DISTANCE).toBe(4.0);
    expect(POSITION_SMOOTHING).toBe(6.0);
    expect(SHAKE_AMPLITUDE).toBe(0.06);
  });

  it("widens past 80 above 35 m/s", () => {
    expect(fovForSpeed(35)).toBeGreaterThan(80.0);
    expect(fovForSpeed(40)).toBe(85.0);
    expect(fovForSpeed(120)).toBe(85.0);
    const cam = new ChaseCamera();
    cam.update(DT, { carPos: { x: 0, y: 0, z: 0 }, carYaw: 0, speedMs: 40 });
    expect(cam.fov).toBe(85.0);
    expect(cam.getState().fov).toBe(85.0);
  });

  it("guards NaN speed as standstill", () => {
    expect(fovForSpeed(Number.NaN)).toBe(70.0);
    expect(fovForSpeed(Number.POSITIVE_INFINITY)).toBe(70.0);
  });
});

describe("chase camera shake", () => {
  it("reads exactly zero offset jitter when disabled at speed", () => {
    for (const slip of [0, 0.25, 0.5, -1.0]) {
      expect(shakeOffset(3.7, 30, slip, false)).toEqual({ x: 0, y: 0 });
      expect(shake_offset(3.7, 30, slip, false)).toEqual({ x: 0, y: 0 });
    }
    const cam = new ChaseCamera();
    const pose = cam.update(DT, {
      carPos: { x: 0, y: 0, z: 0 },
      carYaw: 0,
      speedMs: 30,
      slipRad: 0.5,
      shakeEnabled: false,
    });
    expect(pose.shake).toEqual({ x: 0, y: 0 });
    expect(pose.offset).toEqual({ x: 0, y: 0 });
    expect(pose.jitter).toEqual({ x: 0, y: 0 });
    expect(cam.getState().shake).toEqual({ x: 0, y: 0 });
  });

  it("stays silent at or below 1 m/s even when enabled", () => {
    expect(shakeOffset(9.1, 1.0, 0.5, true)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(9.1, 0.0, 0.5, true)).toEqual({ x: 0, y: 0 });
  });

  it("scales with speed and slip and repeats for fixed time", () => {
    const slow = shakeOffset(2.5, 10, 0, true);
    const fast = shakeOffset(2.5, 40, 0, true);
    expect(Math.hypot(fast.x, fast.y)).toBeGreaterThan(
      Math.hypot(slow.x, slow.y),
    );
    const straight = shakeOffset(2.5, 30, 0, true);
    const sliding = shakeOffset(2.5, 30, 0.5, true);
    expect(Math.hypot(sliding.x, sliding.y)).toBeGreaterThan(
      Math.hypot(straight.x, straight.y),
    );
    expect(shakeOffset(2.5, 30, 0.4, true)).toEqual(
      shakeOffset(2.5, 30, 0.4, true),
    );
  });
});

describe("chase camera lag", () => {
  it("converges a 90deg yaw snap below 20deg error after 500ms", () => {
    const cam = new ChaseCamera();
    cam.update(DT, { carPos: { x: 0, y: 0, z: 0 }, carYaw: 0, speedMs: 0 });
    const snapped = Math.PI / 2;
    for (let i = 0; i < 30; i += 1) {
      cam.update(DT, {
        carPos: { x: 0, y: 0, z: 0 },
        carYaw: snapped,
        speedMs: 20,
      });
    }
    let error = Math.abs(cam.yaw - snapped);
    if (error > Math.PI) {
      error = 2 * Math.PI - error;
    }
    expect(error).toBeLessThan((20 * Math.PI) / 180);
  });

  it("does not snap: one tick moves only the exponential weight", () => {
    const cam = new ChaseCamera();
    cam.update(DT, { carPos: { x: 0, y: 0, z: 0 }, carYaw: 0, speedMs: 0 });
    cam.update(DT, {
      carPos: { x: 0, y: 0, z: 0 },
      carYaw: Math.PI / 2,
      speedMs: 0,
    });
    expect(Math.abs(cam.yaw)).toBeGreaterThan(0);
    expect(Math.abs(cam.yaw)).toBeLessThan(Math.PI / 4);
    const start = behindSlot(0);
    expect(Math.hypot(cam.position.x - start.x, cam.position.z - start.z)).toBeGreaterThan(
      0.1,
    );
  });

  it("grows the blend weight monotonically with dt", () => {
    expect(lagWeight(DT)).toBeGreaterThan(0);
    expect(lagWeight(DT)).toBeLessThan(1);
    expect(lag_weight(DT * 2)).toBeGreaterThan(lagWeight(DT));
    expect(lagWeight(10)).toBeCloseTo(1, 6);
    expect(lagWeight(0)).toBe(lagWeight(DT));
    expect(lagWeight(Number.NaN)).toBe(lagWeight(DT));
  });
});

describe("chase camera look-back", () => {
  it("flips the slot ahead of the car while held", () => {
    const free = new ChaseCamera();
    free.update(DT, { carPos: { x: 0, y: 0, z: 0 }, carYaw: 0, speedMs: 10 });
    const back = new ChaseCamera();
    back.update(DT, {
      carPos: { x: 0, y: 0, z: 0 },
      carYaw: 0,
      speedMs: 10,
      lookBack: true,
    });
    // Trail slot sits at +z (behind a -z-facing car); the mirrored
    // look-back slot sits at -z.
    expect(back.position.z).toBeLessThan(0);
    expect(free.position.z).toBeGreaterThan(back.position.z);
  });

  it("snaps on the release frame, then resumes lag", () => {
    const cam = new ChaseCamera();
    cam.update(DT, { carPos: { x: 0, y: 0, z: 0 }, carYaw: 0, speedMs: 0 });
    cam.update(DT, {
      carPos: { x: 0, y: 0, z: 0 },
      carYaw: 0,
      speedMs: 0,
      lookBack: true,
    });
    expect(cam.position.z).toBeCloseTo(-FOLLOW_DISTANCE, 6);
    cam.update(DT, { carPos: { x: 0, y: 0, z: 0 }, carYaw: 0, speedMs: 0 });
    expect(cam.position.z).toBeCloseTo(FOLLOW_DISTANCE, 6);
    expect(cam.getState().position.z).toBeCloseTo(FOLLOW_DISTANCE, 6);
  });
});

describe("camera module hygiene", () => {
  it("imports no three.js at runtime", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vehicles");
    const text = readFileSync(join(root, "camera.ts"), "utf8");
    expect(text).not.toMatch(/from\s+["']three["']/);
    expect(text).not.toMatch(/require\(\s*["']three["']\s*\)/);
  });

  it("builds the initial scene camera from FOV_MIN", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const text = readFileSync(join(root, "main.ts"), "utf8");
    expect(text).toMatch(
      /import\s*\{[^}]*\bFOV_MIN\b[^}]*\}\s*from\s*["']\.\/vehicles\/camera["']/,
    );
    const constructed = text.match(
      /new\s+THREE\.PerspectiveCamera\(\s*([^,)]+)/,
    );
    expect(constructed).not.toBeNull();
    expect(constructed?.[1]?.trim()).toBe("FOV_MIN");
  });
});
