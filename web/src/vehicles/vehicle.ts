// Rapier vehicle controller: function-for-function port of
// scripts/vehicles/vehicle_controller.gd onto a Rapier dynamic rigid
// body. Four chassis-local rays are cast each 60 Hz tick; suspension
// (spring + bump/rebound damper, travel-clamped) and tire forces
// (load-sensitive slip-angle lateral force with a friction-circle cap)
// are summed as one force plus one r x F torque per tick — exactly the
// rigid-body mechanics of per-wheel apply_force at the contact offset,
// immune to point-API drift across compat builds. A 5-speed automatic
// gearbox with redline fuel-cut feeds an FWD/RWD/AWD axle split; the
// handbrake cuts rear lateral grip and locks the rears; flip recovery
// teleports after world.step(). Own minimal Vec3 math, no three.js.
import type RAPIER from "@dimforge/rapier3d-compat";
import type { CarTune } from "../data/tunes";
import { ASSISTS_ON, correctSteer, dampSlip } from "./assists";
import { STEP_DT } from "../core/loop";
import { PhysicsWorld } from "../physics/world";
import {
  IDENTITY_QUAT,
  RESET_CLEAR_EXTENTS,
  RESET_LATERAL_RADII,
  RESET_LIFT_MAX,
  RESET_PROBE_OFFSET,
  add,
  cross,
  dot,
  length,
  resetCandidates,
  rotateVecByQuat,
  scale,
  sub,
  yawToQuat,
  type Quat,
  type Vec3,
} from "../physics/vec";

// --- Suspension (per wheel) ---
export const SPRING_RATE = 36000.0;
export const DAMPER_BUMP = 4500.0;
export const DAMPER_REBOUND = 6000.0;
export const WHEEL_TRAVEL = 0.3;
export const SUSPENSION_REST_LENGTH = 0.6;
// --- Tires ---
export const CORNERING_STIFFNESS = 12000.0;
export const SURFACE_GRIP = 1.0;
export const ROLL_STIFFNESS_FRONT = 8000.0;
export const ROLL_STIFFNESS_REAR = 6500.0;
export const DOWNFORCE_COEFFICIENT = 1.2;
// --- Engine and gearbox ---
export const IDLE_RPM = 800.0;
export const SHIFT_UP_RPM = 5500.0;
export const SHIFT_DOWN_RPM = 2500.0;
export const REDLINE_RPM = 6800.0;
export const MAX_ENGINE_RPM = 7200.0;
export const SHIFT_COOLDOWN = 0.4;
// --- Steering and brakes ---
export const MAX_STEER_ANGLE = 0.55;
export const STEER_SPEED_FALLOFF = 0.05;
export const STEER_SLEW = 5.0;
export const BRAKE_FORCE = 5500.0;
export const HANDBRAKE_FORCE = 2500.0;
export const HANDBRAKE_GRIP_FACTOR = 0.1;
// --- Chassis ---
export const WHEEL_RADIUS = 0.33;
export const DRAG_LINEAR = 60.0;
export const DRAG_QUADRATIC = 1.2;
export const ROLLING_RESISTANCE = 150.0;
export const REVERSE_MAX_SPEED = 8.0;

export type DriveMode = "FWD" | "RWD" | "AWD";

export type VehicleTune = {
  engineTorque: number;
  gearRatios: number[];
  finalDrive: number;
  tireGripFront: number;
  tireGripRear: number;
  rollStiffnessFront: number;
  rollStiffnessRear: number;
  downforceCoefficient: number;
  drivetrain: DriveMode;
};

// Default probe car: the sedan tune (380 Nm, 3.2/2.1/1.5/1.1/0.85,
// final 3.9, RWD), mirroring assets/cars/tunes/default_tune.tres.
export const DEFAULT_TUNE: VehicleTune = {
  engineTorque: 380.0,
  gearRatios: [3.2, 2.1, 1.5, 1.1, 0.85],
  finalDrive: 3.9,
  tireGripFront: 1.0,
  tireGripRear: 1.0,
  rollStiffnessFront: 8000.0,
  rollStiffnessRear: 6500.0,
  downforceCoefficient: 1.2,
  drivetrain: "RWD",
};

function drivetrainFromData(value: CarTune["drivetrain"]): DriveMode {
  if (value === "FWD" || value === "RWD" || value === "AWD") {
    return value;
  }
  return value === 0 ? "FWD" : value === 2 ? "AWD" : "RWD";
}

// Map a data/tunes.ts CarTune onto the controller tune shape.
export function tuneFromCarTune(tune: CarTune): VehicleTune {
  const gears = [...(tune.gear_ratios ?? tune.gears)];
  return {
    engineTorque: tune.engine_torque,
    gearRatios: gears,
    finalDrive: tune.final_drive,
    tireGripFront: tune.tire_grip_front,
    tireGripRear: tune.tire_grip_rear,
    rollStiffnessFront: tune.roll_stiffness_front,
    rollStiffnessRear: tune.roll_stiffness_rear,
    downforceCoefficient: tune.downforce_coefficient,
    drivetrain: drivetrainFromData(tune.drivetrain),
  };
}

// Spring + bump/rebound damper, clamped at zero. Port of
// `compute_suspension_force`.
export function computeSuspensionForce(
  compression: number,
  compressionVelocity: number,
  spring: number,
  dampBump: number,
  dampRebound: number,
): number {
  const rate = compressionVelocity >= 0.0 ? dampBump : dampRebound;
  return Math.max(0.0, spring * Math.max(compression, 0.0) + rate * compressionVelocity);
}

// Load-sensitive slip-angle lateral force with a grip cap. Port of
// `compute_lateral_force`, bound-for-bound including the 3500 kg load
// normalization.
export function computeLateralForce(
  slipAngle: number,
  wheelLoad: number,
  grip: number,
  stiffness: number,
  surface: number = SURFACE_GRIP,
  gripFactor: number = 1.0,
): number {
  const load = Math.max(wheelLoad, 0.0);
  const loadFactor = Math.min(Math.max(load / 3500.0, 0.25), 1.6);
  const raw = -stiffness * slipAngle * loadFactor;
  const cap = grip * load * surface * gripFactor;
  return Math.min(Math.max(raw, -cap), cap);
}

export type FrictionCircle = { x: number; y: number };

// Longitudinal clamp plus lateral room left inside the friction
// circle. Port of `clamp_to_friction_circle`.
export function clampToFrictionCircle(
  fx: number,
  fy: number,
  maxForce: number,
  lateralGripFactor: number = 1.0,
): FrictionCircle {
  const capped = Math.max(maxForce, 0.0);
  const cx = Math.min(Math.max(fx, -capped), capped);
  const latCap = capped * Math.min(Math.max(lateralGripFactor, 0.0), 1.0);
  const room = Math.max(latCap * latCap - Math.min(cx * cx, latCap * latCap), 0.0);
  return { x: cx, y: Math.min(Math.max(fy, -Math.sqrt(room)), Math.sqrt(room)) };
}

// Limiter ordering guard: repairs shift_up/redline/max triples to
// shift_up <= redline <= max with the absolute cap authoritative.
// Port of `resolve_limiter_order`.
export function resolveLimiterOrder(
  shiftUp: number,
  redline: number,
  maxRpm: number,
): [number, number, number] {
  const fixedRedline = Math.min(redline, maxRpm);
  const fixedShift = Math.min(shiftUp, fixedRedline);
  return [fixedShift, fixedRedline, maxRpm];
}

// Torque curve table with redline fuel-cut: tapers from (6500, 0.6) to
// (redline, 0.0) and stays exactly 0.0 at or above redline. Port of
// `_sample_torque`.
export function sampleTorque(
  rpm: number,
  engineMaxTorque: number = DEFAULT_TUNE.engineTorque,
  redlineRpm: number = REDLINE_RPM,
): number {
  if (rpm >= redlineRpm) {
    return 0.0;
  }
  const pts: Array<[number, number]> = [
    [800.0, 0.55],
    [1500.0, 0.75],
    [3000.0, 1.0],
    [4500.0, 1.0],
    [5500.0, 0.85],
    [6500.0, 0.6],
    [redlineRpm, 0.0],
  ];
  if (rpm <= pts[0][0]) {
    return engineMaxTorque * pts[0][1];
  }
  for (let i = 1; i < pts.length; i += 1) {
    if (rpm <= pts[i][0]) {
      const t = (rpm - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return engineMaxTorque * (pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
    }
  }
  return engineMaxTorque * pts[pts.length - 1][1];
}

// snake_case aliases for the v1 vocabulary.
export const compute_suspension_force = computeSuspensionForce;
export const compute_lateral_force = computeLateralForce;
export const clamp_to_friction_circle = clampToFrictionCircle;
export const resolve_limiter_order = resolveLimiterOrder;
export const sample_torque = sampleTorque;

// Reset spiral + probe constants re-exported so the whole controller
// surface is importable from this module.
export {
  RESET_CLEAR_EXTENTS,
  RESET_LATERAL_RADII,
  RESET_LIFT_MAX,
  RESET_PROBE_OFFSET,
  STEP_DT,
  resetCandidates,
};
export const reset_candidates = resetCandidates;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function moveToward(from: number, to: number, delta: number): number {
  if (Math.abs(to - from) <= delta) {
    return to;
  }
  return from + Math.sign(to - from) * delta;
}

type WheelMount = {
  offset: Vec3;
  front: boolean;
  left: boolean;
};

// Chassis-local mounts in the v1 frame, mirroring vehicle_base.tscn
// WheelFL/FR/RL/RR (front is -z, Godot forward; mounts at y = 0).
// Torques use lever arms from the center of mass (COM_BODY below),
// matching Godot's apply_force offset-from-COM solver behavior.
const WHEEL_MOUNTS: WheelMount[] = [
  { offset: { x: -0.85, y: 0, z: -1.35 }, front: true, left: true },
  { offset: { x: 0.85, y: 0, z: -1.35 }, front: true, left: false },
  { offset: { x: -0.85, y: 0, z: 1.35 }, front: false, left: true },
  { offset: { x: 0.85, y: 0, z: 1.35 }, front: false, left: false },
];

// Body-frame center of mass, mirroring `center_of_mass =
// (0, -0.35, 0)` in vehicle_base.tscn (enforced on the Rapier body
// via the collider mass properties in spawnChassis). Lever arms for
// the summed r x F torque are measured from the world COM so the
// torque is about the point Rapier integrates rotation around.
const COM_BODY: Vec3 = { x: 0, y: -0.35, z: 0 };
const DEFAULT_SPAWN: Vec3 = { x: 0, y: 0.9, z: 0 };

export type VehicleInputs = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  reset: boolean;
};

export type VehicleOptions = {
  tune?: Partial<VehicleTune>;
  position?: Vec3;
  yaw?: number;
  assistsEnabled?: boolean;
  shiftUpRpm?: number;
  shiftDownRpm?: number;
  redlineRpm?: number;
  maxEngineRpm?: number;
};

export type VehicleState = {
  position: Vec3;
  up: Vec3;
  speedMs: number;
  currentGear: number;
  engineRpm: number;
  fuelCut: boolean;
  isGrounded: boolean;
  slipIntensity: number;
  wheelSlips: number[];
  brakeLockup: boolean;
};

export class Vehicle {
  readonly physics: PhysicsWorld;
  readonly body: RAPIER.RigidBody;
  readonly tune: VehicleTune;
  inputs: VehicleInputs = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    reset: false,
  };
  assistsEnabled: boolean;
  shiftUpRpm: number;
  shiftDownRpm: number;
  redlineRpm: number;
  maxEngineRpm: number;

  speedMs = 0;
  currentGear = 1;
  engineRpm: number = IDLE_RPM;
  fuelCut = false;
  isGrounded = false;
  slipIntensity = 0;
  wheelSlips: number[] = [0, 0, 0, 0];
  brakeLockup = false;

  private currentSteer = 0;
  private reversing = false;
  private shiftCooldown = 0;
  private invertedTime = 0;
  private pendingReset = false;
  private resetWasDown = false;
  private resetTarget: Vec3 | null = null;
  private prevComp: number[] = [0, 0, 0, 0];

  constructor(physics: PhysicsWorld, opts: VehicleOptions = {}) {
    this.physics = physics;
    this.tune = { ...DEFAULT_TUNE, ...(opts.tune ?? {}) };
    this.tune.gearRatios = [...this.tune.gearRatios];
    this.assistsEnabled = opts.assistsEnabled ?? ASSISTS_ON;
    this.shiftUpRpm = opts.shiftUpRpm ?? SHIFT_UP_RPM;
    this.shiftDownRpm = opts.shiftDownRpm ?? SHIFT_DOWN_RPM;
    this.redlineRpm = opts.redlineRpm ?? REDLINE_RPM;
    this.maxEngineRpm = opts.maxEngineRpm ?? MAX_ENGINE_RPM;
    const repaired = resolveLimiterOrder(
      this.shiftUpRpm,
      this.redlineRpm,
      this.maxEngineRpm,
    );
    this.shiftUpRpm = repaired[0];
    this.redlineRpm = repaired[1];
    this.maxEngineRpm = repaired[2];
    this.body = physics.spawnChassis({
      position: opts.position ?? DEFAULT_SPAWN,
      yaw: opts.yaw,
    });
  }

  resetVehicle(): void {
    this.pendingReset = true;
  }

  private drivenWheelCount(): number {
    return this.tune.drivetrain === "AWD" ? 4 : 2;
  }

  private isDriven(front: boolean): boolean {
    if (this.tune.drivetrain === "FWD") {
      return front;
    }
    if (this.tune.drivetrain === "RWD") {
      return !front;
    }
    return true;
  }

  upVector(): Vec3 {
    const q = this.body.rotation() as Quat;
    return rotateVecByQuat({ x: 0, y: 1, z: 0 }, q);
  }

  // Body origin position (mount-plane frame, like Godot's
  // `global_position`).
  position(): Vec3 {
    const t = this.body.translation() as Vec3;
    return { x: t.x, y: t.y, z: t.z };
  }

  getState(): VehicleState {
    return {
      position: this.position(),
      up: this.upVector(),
      speedMs: this.speedMs,
      currentGear: this.currentGear,
      engineRpm: this.engineRpm,
      fuelCut: this.fuelCut,
      isGrounded: this.isGrounded,
      slipIntensity: this.slipIntensity,
      wheelSlips: [...this.wheelSlips],
      brakeLockup: this.brakeLockup,
    };
  }

  // Test helper: park the body (teleports immediately, mid-test).
  placeAt(position: Vec3, quat: Quat = IDENTITY_QUAT): void {
    this.physics.teleportBody(this.body, position, quat);
    this.resetTarget = null;
    this.pendingReset = false;
    this.invertedTime = 0;
  }

  // Test helper: set planar forward speed, keeping heading.
  setForwardSpeed(speed: number): void {
    const q = this.body.rotation() as Quat;
    const fwd = rotateVecByQuat({ x: 0, y: 0, z: -1 }, q);
    const planar = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z);
    const dir =
      planar > 1e-6
        ? { x: fwd.x / planar, y: 0, z: fwd.z / planar }
        : { x: 0, y: 0, z: -1 };
    this.body.setLinvel(
      { x: dir.x * speed, y: 0, z: dir.z * speed },
      true,
    );
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // One fixed tick: sample inputs, steer assist, reverse latch,
  // gearbox, per-wheel suspension/tire forces summed as one force +
  // one r x F torque, anti-roll, downforce, drag, rolling resistance,
  // reset latch, then world.step() with teleport-after-step.
  step(dt: number = STEP_DT): void {
    const stepDt = dt > 0 ? dt : STEP_DT;
    const throttle = clamp(this.inputs.throttle, 0, 1);
    const brake = clamp(this.inputs.brake, 0, 1);
    const steer = clamp(this.inputs.steer, -1, 1);
    const handbrake = this.inputs.handbrake;

    const posRaw = this.body.translation() as Vec3;
    const pos: Vec3 = { x: posRaw.x, y: posRaw.y, z: posRaw.z };
    const quat = this.body.rotation() as Quat;
    const linRaw = this.body.linvel() as Vec3;
    const lin: Vec3 = { x: linRaw.x, y: linRaw.y, z: linRaw.z };
    const angRaw = this.body.angvel() as Vec3;
    const ang: Vec3 = { x: angRaw.x, y: angRaw.y, z: angRaw.z };

    const up = rotateVecByQuat({ x: 0, y: 1, z: 0 }, quat);
    const fwd = rotateVecByQuat({ x: 0, y: 0, z: -1 }, quat);
    const right = rotateVecByQuat({ x: 1, y: 0, z: 0 }, quat);
    const forwardSpeed = dot(lin, fwd);
    this.speedMs = forwardSpeed;

    // Speed-sensitive front steering, smoothed toward target.
    const assisted = correctSteer(steer, forwardSpeed, this.assistsEnabled);
    const steerTarget =
      (assisted * MAX_STEER_ANGLE) / (1.0 + Math.abs(forwardSpeed) * STEER_SPEED_FALLOFF);
    this.currentSteer = moveToward(this.currentSteer, steerTarget, STEER_SLEW * stepDt);

    // Reverse latch: brake to near-standstill in 1st with no throttle
    // latches reverse; any throttle unlatches.
    if (
      brake > 0.5 &&
      forwardSpeed > -0.5 &&
      forwardSpeed < 0.8 &&
      this.currentGear === 1 &&
      throttle < 0.05
    ) {
      this.reversing = true;
    }
    if (throttle > 0.05) {
      this.reversing = false;
    }

    // Automatic gearbox with shift hysteresis from vehicle speed. The
    // pre-shift ratio feeds both rpm and drive force on shift frames.
    const limiter = resolveLimiterOrder(this.shiftUpRpm, this.redlineRpm, this.maxEngineRpm);
    this.shiftUpRpm = limiter[0];
    this.redlineRpm = limiter[1];
    this.maxEngineRpm = limiter[2];
    const ratios = this.tune.gearRatios;
    const gearRatio = ratios[clamp(this.currentGear - 1, 0, ratios.length - 1)];
    const wheelRps = Math.abs(forwardSpeed) / (2 * Math.PI * WHEEL_RADIUS);
    this.engineRpm = clamp(
      Math.max(IDLE_RPM, wheelRps * gearRatio * this.tune.finalDrive * 60.0),
      IDLE_RPM,
      this.maxEngineRpm,
    );
    if (forwardSpeed < -0.1) {
      this.engineRpm = -this.engineRpm;
    }
    this.fuelCut = this.engineRpm >= this.redlineRpm;
    this.shiftCooldown -= stepDt;
    if (!this.reversing && this.shiftCooldown <= 0) {
      if (this.currentGear < ratios.length && this.engineRpm > this.shiftUpRpm) {
        this.currentGear += 1;
        this.shiftCooldown = SHIFT_COOLDOWN;
      } else if (this.currentGear > 1 && this.engineRpm < this.shiftDownRpm) {
        this.currentGear -= 1;
        this.shiftCooldown = SHIFT_COOLDOWN;
      }
    }

    // Engine force from the torque curve at this tick's rpm.
    const engineForceTotal =
      (throttle *
        sampleTorque(this.engineRpm, this.tune.engineTorque, this.redlineRpm) *
        gearRatio *
        this.tune.finalDrive) /
      WHEEL_RADIUS;
    const drivenCount = this.drivenWheelCount();

    // External forces/torques persist on the body until explicitly
    // cleared (resetForces leaves torques behind and vice versa), so
    // both are reset every tick before accumulation.
    this.body.resetForces(true);
    this.body.resetTorques(true);
    let force: Vec3 = { x: 0, y: 0, z: 0 };
    let torque: Vec3 = { x: 0, y: 0, z: 0 };
    let grounded = 0;
    let maxSlip = 0;
    this.brakeLockup = false;
    const contactR: Array<Vec3 | null> = [null, null, null, null];
    const comps: number[] = [0, 0, 0, 0];

    for (let i = 0; i < WHEEL_MOUNTS.length; i += 1) {
      const mount = WHEEL_MOUNTS[i];
      const origin = add(pos, rotateVecByQuat(mount.offset, quat));
      const hit = this.physics.castSuspensionRay(
        origin,
        scale(up, -1),
        SUSPENSION_REST_LENGTH,
        this.body,
      );
      if (hit === null) {
        this.wheelSlips[i] = 0;
        continue;
      }
      const comp = clamp(SUSPENSION_REST_LENGTH - hit.toi, 0, WHEEL_TRAVEL);
      const compVel = (comp - this.prevComp[i]) / Math.max(stepDt, 0.0001);
      this.prevComp[i] = comp;
      comps[i] = comp;
      const susp = computeSuspensionForce(
        comp,
        compVel,
        SPRING_RATE,
        DAMPER_BUMP,
        DAMPER_REBOUND,
      );

      const contact = hit.point;
      // Lever arm from the world center of mass: Rapier integrates
      // rotation about the COM and applies force there.
      const comWorld = add(pos, rotateVecByQuat(COM_BODY, quat));
      const r = sub(contact, comWorld);
      contactR[i] = r;
      const vel = add(lin, cross(ang, r));
      const wheelSteer = mount.front ? this.currentSteer : 0;
      const cosS = Math.cos(wheelSteer);
      const sinS = Math.sin(wheelSteer);
      const wFwd = add(scale(fwd, cosS), scale(right, sinS));
      const wRight = sub(scale(right, cosS), scale(fwd, sinS));
      const fSpeed = dot(vel, wFwd);
      const lSpeed = dot(vel, wRight);
      const slip = Math.atan2(lSpeed, Math.abs(fSpeed) + 1.0);
      maxSlip = Math.max(maxSlip, Math.abs(slip));
      const ramp = clamp(Math.abs(fSpeed) / 2.0, 0.0, 1.0);
      this.wheelSlips[i] = Math.abs(slip) * ramp;
      grounded += 1;
      if (
        brake > 0.5 &&
        Math.abs(this.speedMs) > 5.0 &&
        this.isDriven(mount.front) &&
        Math.abs(fSpeed) < 0.8
      ) {
        this.brakeLockup = true;
      }

      // Longitudinal: drive split per drive mode, service brake on all
      // wheels, handbrake lock on the rears.
      let fx = 0;
      if (this.reversing && this.isDriven(mount.front)) {
        if (fSpeed > -REVERSE_MAX_SPEED) {
          fx =
            (-brake *
              this.tune.engineTorque *
              0.6 *
              ratios[0] *
              this.tune.finalDrive) /
            WHEEL_RADIUS /
            drivenCount;
        }
      } else if (this.isDriven(mount.front)) {
        fx += engineForceTotal / drivenCount;
      }
      if (handbrake && !mount.front) {
        if (Math.abs(fSpeed) > 0.5) {
          fx += -Math.sign(fSpeed) * HANDBRAKE_FORCE;
        } else {
          fx += -fSpeed * HANDBRAKE_FORCE * 2.0;
        }
      } else if (brake > 0.01 && !this.reversing) {
        if (Math.abs(fSpeed) > 0.5) {
          fx += -Math.sign(fSpeed) * brake * BRAKE_FORCE;
        } else {
          fx += -fSpeed * brake * BRAKE_FORCE * 2.0;
        }
      }

      const latFactor = handbrake && !mount.front ? HANDBRAKE_GRIP_FACTOR : 1.0;
      const axleGrip = mount.front ? this.tune.tireGripFront : this.tune.tireGripRear;
      const fyRaw =
        computeLateralForce(
          slip,
          susp,
          axleGrip,
          CORNERING_STIFFNESS,
          SURFACE_GRIP,
          latFactor,
        ) * ramp;
      const fy = dampSlip(fyRaw, this.assistsEnabled);
      const maxF = axleGrip * susp * SURFACE_GRIP;
      const capped = clampToFrictionCircle(fx, fy, maxF, latFactor);
      const wheelForce = add(add(scale(up, susp), scale(wFwd, capped.x)), scale(wRight, capped.y));
      force = add(force, wheelForce);
      torque = add(torque, cross(r, wheelForce));
    }

    // Anti-roll bars: pure torque pairs, zero net force.
    for (const front of [true, false]) {
      const stiffness = front ? this.tune.rollStiffnessFront : this.tune.rollStiffnessRear;
      let leftComp = 0;
      let rightComp = 0;
      let leftR: Vec3 | null = null;
      let rightR: Vec3 | null = null;
      for (let i = 0; i < WHEEL_MOUNTS.length; i += 1) {
        if (WHEEL_MOUNTS[i].front !== front || contactR[i] === null) {
          continue;
        }
        if (WHEEL_MOUNTS[i].left) {
          leftComp = comps[i];
          leftR = contactR[i];
        } else {
          rightComp = comps[i];
          rightR = contactR[i];
        }
      }
      if (leftR === null || rightR === null) {
        continue;
      }
      const transfer = stiffness * (leftComp - rightComp);
      const forceL = scale(up, transfer);
      const forceR = scale(up, -transfer);
      force = add(add(force, forceL), forceR);
      torque = add(add(torque, cross(leftR, forceL)), cross(rightR, forceR));
    }

    // Central aero/drag/rolling forces.
    const planarSpeed = Math.sqrt(lin.x * lin.x + lin.z * lin.z);
    if (planarSpeed > 0.01) {
      force = add(force, scale(up, -this.tune.downforceCoefficient * planarSpeed * planarSpeed));
    }
    const horizontal: Vec3 = { x: lin.x, y: 0, z: lin.z };
    const horizontalSpeed = length(horizontal);
    force = add(
      force,
      scale(horizontal, -(DRAG_LINEAR + DRAG_QUADRATIC * horizontalSpeed)),
    );
    if (Math.abs(forwardSpeed) > 0.1) {
      force = add(force, scale(fwd, -Math.sign(forwardSpeed) * ROLLING_RESISTANCE));
    }

    this.isGrounded = grounded > 0;
    this.slipIntensity = maxSlip;
    if (handbrake && planarSpeed > 3.0) {
      this.slipIntensity = Math.max(this.slipIntensity, 0.3);
    }

    // Reset on demand (press edge) plus automatic recovery when
    // inverted and slow; the edge fires once per press.
    if (up.y < 0.3 && length(lin) < 3.0) {
      this.invertedTime += stepDt;
    } else {
      this.invertedTime = 0;
    }
    const resetDown = this.inputs.reset;
    if (resetDown && !this.resetWasDown) {
      this.pendingReset = true;
    }
    this.resetWasDown = resetDown;
    if (this.invertedTime > 1.0) {
      this.pendingReset = true;
    }
    if (this.pendingReset && this.resetTarget === null) {
      const parked: Vec3 = {
        x: pos.x,
        y: Math.max(pos.y, 0.0) + 1.0,
        z: pos.z,
      };
      this.resetTarget = this.physics.findClearResetPosition(parked, this.body);
    }

    this.body.addForce(force, true);
    this.body.addTorque(torque, true);
    this.physics.stepWorld();

    if (this.pendingReset) {
      const target = this.resetTarget ?? {
        x: pos.x,
        y: Math.max(pos.y, 0.0) + 1.0,
        z: pos.z,
      };
      // Keep the post-step heading, drop roll/pitch.
      const post = this.body.rotation() as Quat;
      const postFwd = rotateVecByQuat({ x: 0, y: 0, z: -1 }, post);
      const flat = Math.sqrt(postFwd.x * postFwd.x + postFwd.z * postFwd.z);
      let yaw = 0;
      if (flat > 0.01) {
        yaw = Math.atan2(-postFwd.x, -postFwd.z);
      }
      this.physics.teleportBody(this.body, target, yawToQuat(yaw));
      this.pendingReset = false;
      this.resetTarget = null;
      this.currentGear = 1;
      this.engineRpm = IDLE_RPM;
      this.fuelCut = false;
      this.reversing = false;
      this.invertedTime = 0;
      this.currentSteer = 0;
      this.speedMs = 0;
    }
  }
}
