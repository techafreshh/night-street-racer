// Tire-smoke / skid-mark / brake-light FX port (scripts/fx/ layer:
// vehicle_fx.gd, skid_marks.gd, fx_pool.gd). Pure pooled simulation with
// zero runtime three.js/DOM imports: fixed-size smoke pool with a
// round-robin victim cursor, a skid-mark ring buffer of rear contact
// points with ages, and a snap (no lerp) brake-light level. Only
// `import type` shapes cross the three.js boundary, mirroring the
// vehicles/camera.ts hygiene contract, so Node/vitest stays WebGL-free.
// The three.js scene objects live in render/effects.ts.

import type { Vec3 } from "../physics/world";

// Smoke pool budget: at most this many live billboard puffs.
export const SMOKE_MAX = 64;
// Puff lifetime, in seconds (v1 smoke fade-out).
export const SMOKE_LIFETIME = 0.8;
// Puffs spawned per fixed tick while hot (saturates the pool in ~0.5 s).
export const SMOKE_SPAWN_PER_TICK = 2;
// Slip gate, in radians of planar slip: emission/skids only past this.
export const SLIP_THRESHOLD = 0.25;
// Speed gate, in m/s: a parked car stays silent.
export const SPEED_GATE = 5.0;
// Skid ring budget: oldest rungs drop past this many segments.
export const SKID_MAX_SEGMENTS = 256;
// Skid fade time, in seconds (v1 skid_marks.gd fade).
export const SKID_FADE_TIME = 8.0;
// Brake-light emissive level while braking (reads > 1.0 for the probe).
export const BRAKE_ON_INTENSITY = 4.0;
// Brake-light emissive level released (reads < 0.5 for the probe).
export const BRAKE_OFF_INTENSITY = 0.3;

// v1 snake_case aliases (same values).
export const smoke_max = SMOKE_MAX;
export const SMOKE_POOL_SIZE = SMOKE_MAX;
export const smoke_lifetime = SMOKE_LIFETIME;
export const SMOKE_LIFE = SMOKE_LIFETIME;
export const smoke_spawn_per_tick = SMOKE_SPAWN_PER_TICK;
export const slip_threshold = SLIP_THRESHOLD;
export const speed_gate = SPEED_GATE;
export const skid_max_segments = SKID_MAX_SEGMENTS;
export const SKID_CAPACITY = SKID_MAX_SEGMENTS;
export const skid_fade_time = SKID_FADE_TIME;
export const brake_on_intensity = BRAKE_ON_INTENSITY;
export const BRAKE_ON = BRAKE_ON_INTENSITY;
export const brake_off_intensity = BRAKE_OFF_INTENSITY;
export const BRAKE_OFF = BRAKE_OFF_INTENSITY;

function safeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0.0) {
    return 1 / 60;
  }
  return dt;
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

function copyVec(raw: Vec3 | null | undefined): Vec3 {
  if (raw === null || raw === undefined) {
    return { x: 0.0, y: 0.0, z: 0.0 };
  }
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : 0.0;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : 0.0;
  const z = typeof raw.z === "number" && Number.isFinite(raw.z) ? raw.z : 0.0;
  return { x, y, z };
}

// Fixed-size smoke pool (fx_pool.gd `_pick_victim` idiom): a
// round-robin cursor overwrites the oldest slot, ages tick up in
// `update`, and puffs die past SMOKE_LIFETIME. Preallocated typed
// arrays only; `update` never allocates.
export class SmokePool {
  private readonly px = new Float32Array(SMOKE_MAX);
  private readonly py = new Float32Array(SMOKE_MAX);
  private readonly pz = new Float32Array(SMOKE_MAX);
  private readonly ages = new Float32Array(SMOKE_MAX);
  private readonly alive = new Uint8Array(SMOKE_MAX);
  private cursor = 0;
  private live = 0;

  get capacity(): number {
    return SMOKE_MAX;
  }

  get activeCount(): number {
    return this.live;
  }

  get active_count(): number {
    return this.live;
  }

  emit(pos?: Vec3 | null): void {
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % SMOKE_MAX;
    const at = copyVec(pos ?? null);
    this.px[slot] = at.x;
    this.py[slot] = at.y;
    this.pz[slot] = at.z;
    if (this.alive[slot] === 0) {
      this.live += 1;
    }
    this.ages[slot] = 0.0;
    this.alive[slot] = 1;
  }

  update(dt: number): void {
    const step = safeDt(dt);
    for (let i = 0; i < SMOKE_MAX; i += 1) {
      if (this.alive[i] === 0) {
        continue;
      }
      const age = this.ages[i] + step;
      if (age >= SMOKE_LIFETIME) {
        this.ages[i] = 0.0;
        this.alive[i] = 0;
        this.live -= 1;
      } else {
        this.ages[i] = age;
      }
    }
  }

  isAlive(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= SMOKE_MAX) {
      return false;
    }
    return this.alive[index] === 1;
  }

  is_alive(index: number): boolean {
    return this.isAlive(index);
  }

  puffAge(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= SMOKE_MAX) {
      return 0.0;
    }
    return this.ages[index];
  }

  puff_age(index: number): number {
    return this.puffAge(index);
  }

  puffPosition(index: number, out: Vec3): Vec3 {
    if (Number.isInteger(index) && index >= 0 && index < SMOKE_MAX) {
      out.x = this.px[index];
      out.y = this.py[index];
      out.z = this.pz[index];
    } else {
      out.x = 0.0;
      out.y = 0.0;
      out.z = 0.0;
    }
    return out;
  }

  puff_position(index: number, out: Vec3): Vec3 {
    return this.puffPosition(index, out);
  }

  clear(): void {
    this.ages.fill(0.0);
    this.alive.fill(0);
    this.live = 0;
    this.cursor = 0;
  }
}

// Skid-mark ring buffer (skid_marks.gd idiom): rear left/right contact
// points with ages; oldest rungs drop past SKID_MAX_SEGMENTS and aged
// rungs fade out past SKID_FADE_TIME. Plain arrays, no three.js.
export type SkidSegment = {
  left: Vec3;
  right: Vec3;
  age: number;
};

export class SkidTrail {
  private segments: SkidSegment[] = [];

  get segmentCount(): number {
    return this.segments.length;
  }

  get segment_count(): number {
    return this.segments.length;
  }

  addSegment(left: Vec3, right: Vec3): void {
    this.segments.push({ left: copyVec(left), right: copyVec(right), age: 0.0 });
    while (this.segments.length > SKID_MAX_SEGMENTS) {
      this.segments.shift();
    }
  }

  add_segment(left: Vec3, right: Vec3): void {
    this.addSegment(left, right);
  }

  update(dt: number): void {
    const step = safeDt(dt);
    let kept = 0;
    for (let i = 0; i < this.segments.length; i += 1) {
      const rung = this.segments[i];
      rung.age += step;
      if (rung.age <= SKID_FADE_TIME) {
        this.segments[kept] = rung;
        kept += 1;
      }
    }
    this.segments.length = kept;
  }

  segment(index: number): SkidSegment | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.segments.length) {
      return null;
    }
    const rung = this.segments[index];
    return {
      left: { ...rung.left },
      right: { ...rung.right },
      age: rung.age,
    };
  }

  clear(): void {
    this.segments.length = 0;
  }
}

// Brake-light state: a snap (no lerp) emissive level so the probe reads
// > 1.0 pressed and < 0.5 released on the very next tick.
export class BrakeLights {
  private intensity: number = BRAKE_OFF_INTENSITY;

  setBraking(hot: boolean): void {
    this.intensity = hot === true ? BRAKE_ON_INTENSITY : BRAKE_OFF_INTENSITY;
  }

  set_braking(hot: boolean): void {
    this.setBraking(hot);
  }

  get braking(): boolean {
    return this.intensity === BRAKE_ON_INTENSITY;
  }

  get emissiveIntensity(): number {
    return this.intensity;
  }

  get emissive_intensity(): number {
    return this.intensity;
  }
}

// One fixed-tick FX sample. Twins ride along so harness wording cannot
// mismatch; each pair reads the same value (CameraSample idiom).
export type FxSample = {
  slip?: number;
  slipRad?: number;
  slip_rad?: number;
  speed?: number;
  speedMs?: number;
  speed_ms?: number;
  brake?: number | boolean;
  braking?: number | boolean;
  handbrake?: boolean;
  hand_brake?: boolean;
  brakeLockup?: boolean;
  brake_lockup?: boolean;
  grounded?: boolean;
  isGrounded?: boolean;
  is_grounded?: boolean;
  forceSlip?: boolean;
  force_slip?: boolean;
  pos?: Vec3 | null;
  position?: Vec3 | null;
  left?: Vec3 | null;
  right?: Vec3 | null;
};

function sampleBrakeAmount(sample: FxSample): number {
  const raw = sample.brake ?? sample.braking;
  if (typeof raw === "boolean") {
    return raw ? 1.0 : 0.0;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return 0.0;
}

function sampleGrounded(sample: FxSample): boolean {
  if (
    sample.grounded === undefined &&
    sample.isGrounded === undefined &&
    sample.is_grounded === undefined
  ) {
    return true;
  }
  return sampleFlag(sample.grounded, sample.isGrounded, sample.is_grounded);
}

// Stateful vehicle FX: one smoke pool, one skid trail, one brake-light
// level. Hot while forced, past the slip gate at speed, or braking the
// rears loose at speed; while hot every tick spawns SMOKE_SPAWN_PER_TICK
// puffs and appends one grounded skid rung. Never throws.
export class VehicleFX {
  readonly smoke = new SmokePool();
  readonly skids = new SkidTrail();
  readonly brakes = new BrakeLights();
  private forced = false;

  get forceSlip(): boolean {
    return this.forced;
  }

  set forceSlip(value: boolean) {
    this.forced = value === true;
  }

  get force_slip(): boolean {
    return this.forced;
  }

  set force_slip(value: boolean) {
    this.forced = value === true;
  }

  get skidMarks(): SkidTrail {
    return this.skids;
  }

  get skid_marks(): SkidTrail {
    return this.skids;
  }

  get brakeLights(): BrakeLights {
    return this.brakes;
  }

  get brake_lights(): BrakeLights {
    return this.brakes;
  }

  update(dt: number, sample: FxSample = {}): void {
    try {
      const bag: FxSample = sample ?? {};
      const slip = sampleNumber(bag.slip, bag.slipRad, bag.slip_rad);
      const speed = Math.abs(sampleNumber(bag.speed, bag.speedMs, bag.speed_ms));
      const brakeAmount = sampleBrakeAmount(bag);
      const braking = brakeAmount > 0.05;
      const handbrake = sampleFlag(bag.handbrake, bag.hand_brake);
      const lockup = sampleFlag(bag.brakeLockup, bag.brake_lockup);
      const grounded = sampleGrounded(bag);
      const force = this.forced || sampleFlag(bag.forceSlip, bag.force_slip);

      const atSpeed = speed > SPEED_GATE;
      const slipHot = Math.abs(slip) > SLIP_THRESHOLD;
      const hot =
        atSpeed && (force || slipHot || braking || handbrake || lockup);

      if (hot) {
        const anchor = copyVec(bag.pos ?? bag.position ?? null);
        const left: Vec3 = copyVec(bag.left ?? null);
        const right: Vec3 = copyVec(bag.right ?? null);
        const hasLeft = bag.left !== undefined && bag.left !== null;
        const hasRight = bag.right !== undefined && bag.right !== null;
        if (!hasLeft) {
          left.x = anchor.x - 0.8;
          left.y = anchor.y;
          left.z = anchor.z;
        }
        if (!hasRight) {
          right.x = anchor.x + 0.8;
          right.y = anchor.y;
          right.z = anchor.z;
        }
        for (let k = 0; k < SMOKE_SPAWN_PER_TICK; k += 1) {
          this.smoke.emit(anchor);
        }
        if (grounded) {
          this.skids.addSegment(left, right);
        }
      }

      this.smoke.update(dt);
      this.skids.update(dt);
      this.brakes.setBraking(braking || handbrake);
    } catch {
      // FX must never break the fixed step.
    }
  }

  clear(): void {
    this.smoke.clear();
    this.skids.clear();
  }

  reset(): void {
    this.clear();
    this.brakes.setBraking(false);
    this.forced = false;
  }
}
