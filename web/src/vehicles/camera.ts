// Chase camera ported from scripts/vehicles/chase_camera.gd (v1 feel).
// Pure chase math with zero runtime three.js/DOM imports: exponential
// position/yaw lag, speed-driven FOV, and deterministic dual-sine
// micro-shake. Only `import type` shapes cross the three.js boundary.

import { clamp, lerp, wrapAngle } from "../core/math";
import type { Vec3 } from "../physics/world";

// Slot behind the chassis, in metres (v1 `@export follow_distance`).
export const FOLLOW_DISTANCE = 7.0;
// Slot height above the chassis, in metres (`follow_height`).
export const FOLLOW_HEIGHT = 3.0;
// Aim point ahead of the chassis, in metres (`lookahead_distance`).
export const LOOKAHEAD_DISTANCE = 4.0;
// Aim-point height above the chassis, in metres (v1 `+ Vector3.UP * 1.2`).
export const LOOKAT_HEIGHT = 1.2;
// Exponential lag rate, per second (`position_smoothing`).
export const POSITION_SMOOTHING = 6.0;
// FOV at standstill, in degrees (`fov = 70.0`).
export const FOV_MIN = 70.0;
// FOV at the top of the speed range, in degrees (`lerpf(70, 85, t)`).
export const FOV_MAX = 85.0;
// Speed that pins the FOV wide open, in m/s (`speed / 40.0`).
export const FOV_SPEED_RANGE = 40.0;
// Micro-shake scale (`shake_amplitude`), in camera-local units.
export const SHAKE_AMPLITUDE = 0.06;
// Dual-sine shake frequencies, in rad/s (`sin(_time * 31)` / `47 + 1.3`).
export const SHAKE_FREQ_X = 31.0;
export const SHAKE_FREQ_Y = 47.0;
// Phase offset of the vertical shake sine, in radians.
export const SHAKE_PHASE_Y = 1.3;
// Slip that pins the shake boost, in radians of planar slip.
export const SHAKE_SLIP_RANGE = 0.5;
// Speed gate below which the shake reads exactly zero, in m/s.
export const SHAKE_SPEED_GATE = 1.0;
// Non-positive dt clamps to one 60 Hz tick.
export const DEFAULT_DT = 1 / 60;

// v1 snake_case aliases (same values).
export const follow_distance = FOLLOW_DISTANCE;
export const follow_height = FOLLOW_HEIGHT;
export const lookahead_distance = LOOKAHEAD_DISTANCE;
export const lookat_height = LOOKAT_HEIGHT;
export const position_smoothing = POSITION_SMOOTHING;
export const fov_min = FOV_MIN;
export const fov_max = FOV_MAX;
export const fov_speed_range = FOV_SPEED_RANGE;
export const shake_amplitude = SHAKE_AMPLITUDE;
export const shake_freq_x = SHAKE_FREQ_X;
export const shake_freq_y = SHAKE_FREQ_Y;
export const shake_phase_y = SHAKE_PHASE_Y;

function safeSpeed(speedMs: number): number {
  if (!Number.isFinite(speedMs)) {
    return 0.0;
  }
  return Math.abs(speedMs);
}

function safeSlip(slipRad: number): number {
  if (!Number.isFinite(slipRad)) {
    return 0.0;
  }
  return slipRad;
}

function safeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0.0) {
    return DEFAULT_DT;
  }
  return dt;
}

// Speed-reactive FOV: 70 + 15 * clamp(|speed| / 40, 0, 1). Non-finite
// speed reads as standstill (70); reverse speed widens like forward.
export function fovForSpeed(speedMs: number): number {
  const t = clamp(safeSpeed(speedMs) / FOV_SPEED_RANGE, 0.0, 1.0);
  return FOV_MIN + (FOV_MAX - FOV_MIN) * t;
}

// v1 snake_case alias (same reference).
export const fov_for_speed = fovForSpeed;

// Exponential lag blend weight for one tick: 1 - exp(-k * dt) clamped
// to [0, 1]. Non-positive or non-finite dt clamps to one 60 Hz tick.
export function lagWeight(dt: number, smoothing: number = POSITION_SMOOTHING): number {
  const step = safeDt(dt);
  const rate = Number.isFinite(smoothing) && smoothing > 0.0 ? smoothing : 0.0;
  return clamp(1.0 - Math.exp(-rate * step), 0.0, 1.0);
}

// v1 snake_case alias (same reference).
export const lag_weight = lagWeight;

export type ShakeOffset = { x: number; y: number };

// Deterministic dual-sine micro-shake for one tick. `s` is the speed
// term (`SHAKE_AMPLITUDE * clamp(speed / 40)`) boosted up to 1.5x by
// slip (`0.5 * min(|slip| / 0.5, 1)`). Disabled or at/below 1 m/s the
// offset is exactly {x: 0, y: 0} with no residual sine.
export function shakeOffset(
  time: number,
  speedMs: number,
  slipRad: number,
  enabled: boolean,
): ShakeOffset {
  if (enabled !== true) {
    return { x: 0.0, y: 0.0 };
  }
  const speed = safeSpeed(speedMs);
  if (!(speed > SHAKE_SPEED_GATE)) {
    return { x: 0.0, y: 0.0 };
  }
  const t = Number.isFinite(time) ? time : 0.0;
  const base = SHAKE_AMPLITUDE * clamp(speed / FOV_SPEED_RANGE, 0.0, 1.0);
  const slipBoost = 1.0 + 0.5 * clamp(Math.abs(safeSlip(slipRad)) / SHAKE_SLIP_RANGE, 0.0, 1.0);
  const s = base * slipBoost;
  return {
    x: Math.sin(t * SHAKE_FREQ_X) * s,
    y: Math.sin(t * SHAKE_FREQ_Y + SHAKE_PHASE_Y) * s * 0.6,
  };
}

// v1 snake_case alias (same reference).
export const shake_offset = shakeOffset;

// One fixed-tick camera sample. Snake_case twins ride along so harness
// wording cannot mismatch; each pair reads the same value.
export type CameraSample = {
  carPos?: Vec3 | null;
  car_pos?: Vec3 | null;
  position?: Vec3 | null;
  carYaw?: number;
  car_yaw?: number;
  yaw?: number;
  speedMs?: number;
  speed_ms?: number;
  speed?: number;
  slipRad?: number;
  slip_rad?: number;
  slip?: number;
  lookBack?: boolean;
  look_back?: boolean;
  shakeEnabled?: boolean;
  shake_enabled?: boolean;
  cameraShake?: boolean;
  camera_shake?: boolean;
};

function sampleCarPos(sample: CameraSample): Vec3 {
  const raw = sample.carPos ?? sample.car_pos ?? sample.position ?? null;
  if (raw === null || raw === undefined) {
    return { x: 0.0, y: 0.0, z: 0.0 };
  }
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : 0.0;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : 0.0;
  const z = typeof raw.z === "number" && Number.isFinite(raw.z) ? raw.z : 0.0;
  return { x, y, z };
}

function sampleNumber(
  ...candidates: Array<number | undefined | null>
): number {
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0.0;
}

function sampleFlag(
  ...candidates: Array<boolean | undefined | null>
): boolean {
  for (const value of candidates) {
    if (value !== undefined && value !== null) {
      return value === true;
    }
  }
  return false;
}

// Rendered chase pose: the smoothed slot plus the aim point plus the
// shake twin (`offset`/`jitter` read the same `{x, y}` so probe
// wording cannot mismatch).
export type CameraPose = {
  position: Vec3;
  lookAt: Vec3;
  look_at: Vec3;
  yaw: number;
  fov: number;
  shake: ShakeOffset;
  offset: ShakeOffset;
  jitter: ShakeOffset;
  time: number;
};

// Stateful chase camera: exponential position/yaw lag toward the
// behind-chassis slot, speed FOV, deterministic shake, snap-while-held
// look-back with a snap on the release frame before lag resumes.
export class ChaseCamera {
  position: Vec3;
  yaw: number;
  fov: number;
  time: number;
  wasLookingBack: boolean;
  private lastLook: Vec3;
  private lastShake: ShakeOffset;

  constructor(
    position: Vec3 = { x: 0.0, y: FOLLOW_HEIGHT, z: FOLLOW_DISTANCE },
    yaw = 0.0,
    fov: number = FOV_MIN,
  ) {
    this.position = { ...position };
    this.yaw = Number.isFinite(yaw) ? yaw : 0.0;
    this.fov = Number.isFinite(fov) ? fov : FOV_MIN;
    this.time = 0.0;
    this.wasLookingBack = false;
    this.lastLook = { ...this.position };
    this.lastShake = { x: 0.0, y: 0.0 };
  }

  // Drop back to the spawn slot (behind the origin, facing -z).
  reset(): void {
    this.position = { x: 0.0, y: FOLLOW_HEIGHT, z: FOLLOW_DISTANCE };
    this.yaw = 0.0;
    this.fov = FOV_MIN;
    this.time = 0.0;
    this.wasLookingBack = false;
    this.lastLook = { ...this.position };
    this.lastShake = { x: 0.0, y: 0.0 };
  }

  // Advance one fixed tick. Missing sample fields fall back to safe
  // defaults (origin, 0 yaw/speed/slip, no look-back, shake on).
  update(dt: number, sample: CameraSample = {}): CameraPose {
    const step = safeDt(dt);
    const carPos = sampleCarPos(sample);
    const carYaw = sampleNumber(sample.carYaw, sample.car_yaw, sample.yaw);
    const speed = sampleNumber(sample.speedMs, sample.speed_ms, sample.speed);
    const slip = sampleNumber(sample.slipRad, sample.slip_rad, sample.slip);
    const lookBack = sampleFlag(sample.lookBack, sample.look_back);
    const hasShakeFlag =
      sample.shakeEnabled !== undefined ||
      sample.shake_enabled !== undefined ||
      sample.cameraShake !== undefined ||
      sample.camera_shake !== undefined;
    const shakeEnabled = hasShakeFlag
      ? sampleFlag(
          sample.shakeEnabled,
          sample.shake_enabled,
          sample.cameraShake,
          sample.camera_shake,
        )
      : true;

    this.time += step;
    this.fov = fovForSpeed(speed);

    // Chassis forward from the car yaw (Godot forward is -z).
    const fx = -Math.sin(carYaw);
    const fz = -Math.cos(carYaw);

    // Snap (weight 1) while held and on the release frame, exponential
    // lag otherwise — the v1 `test_config.gd` 5-frame ahead/behind
    // expectation with no overshoot.
    const snap = lookBack || this.wasLookingBack;
    const weight = snap ? 1.0 : lagWeight(step, POSITION_SMOOTHING);

    this.yaw += wrapAngle(carYaw - this.yaw) * weight;

    const target: Vec3 = lookBack
      ? { x: carPos.x + fx * FOLLOW_DISTANCE, y: carPos.y + FOLLOW_HEIGHT, z: carPos.z + fz * FOLLOW_DISTANCE }
      : { x: carPos.x - fx * FOLLOW_DISTANCE, y: carPos.y + FOLLOW_HEIGHT, z: carPos.z - fz * FOLLOW_DISTANCE };
    this.position = {
      x: lerp(this.position.x, target.x, weight),
      y: lerp(this.position.y, target.y, weight),
      z: lerp(this.position.z, target.z, weight),
    };
    this.wasLookingBack = lookBack;

    // Aim from the smoothed yaw so the view inherits the lag; look-back
    // mirrors the aim back at the car (view-only, the slot already
    // snapped).
    const sx = -Math.sin(this.yaw);
    const sz = -Math.cos(this.yaw);
    const lookAt: Vec3 = lookBack
      ? { x: carPos.x - sx * LOOKAHEAD_DISTANCE, y: carPos.y + LOOKAT_HEIGHT, z: carPos.z - sz * LOOKAHEAD_DISTANCE }
      : { x: carPos.x + sx * LOOKAHEAD_DISTANCE, y: carPos.y + LOOKAT_HEIGHT, z: carPos.z + sz * LOOKAHEAD_DISTANCE };

    const shake = shakeOffset(this.time, speed, slip, shakeEnabled);
    this.lastLook = { ...lookAt };
    this.lastShake = { ...shake };
    return {
      position: { ...this.position },
      lookAt: { ...lookAt },
      look_at: { ...lookAt },
      yaw: this.yaw,
      fov: this.fov,
      shake: { ...shake },
      offset: { ...shake },
      jitter: { ...shake },
      time: this.time,
    };
  }

  // Live snapshot for the `window.__nsr.camera` probe namespace.
  getState(): CameraPose {
    return {
      position: { ...this.position },
      lookAt: { ...this.lastLook },
      look_at: { ...this.lastLook },
      yaw: this.yaw,
      fov: this.fov,
      shake: { ...this.lastShake },
      offset: { ...this.lastShake },
      jitter: { ...this.lastShake },
      time: this.time,
    };
  }
}
