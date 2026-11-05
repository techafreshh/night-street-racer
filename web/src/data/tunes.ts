// Ported car tunes: the 4 v1 setups as pure data (Appendix B).
// Values transcribed verbatim from assets/cars/tunes/*.tres; drivetrain
// ints map to labels via GarageUI.mode_label() (0 FWD, 1 RWD, 2 AWD).
// No imports so a single file loads under Node/vitest.

export type Drivetrain = "FWD" | "RWD" | "AWD";

// gear_ratios carries a same-reference gears alias so harness wording
// cannot mismatch. Plain mutable objects, never frozen, so probes can
// spread-and-mutate variants.
export type CarTune = {
  engine_torque: number;
  gear_ratios: number[];
  gears: number[];
  final_drive: number;
  tire_grip_front: number;
  tire_grip_rear: number;
  roll_stiffness_front: number;
  roll_stiffness_rear: number;
  downforce_coefficient: number;
  drivetrain: Drivetrain;
};

// Bounds mirrored from scripts/vehicles/car_tune.gd.
export const ENGINE_TORQUE_MIN = 250.0;
export const ENGINE_TORQUE_MAX = 550.0;
export const GEAR_RATIO_MIN = 0.5;
export const GEAR_RATIO_MAX = 4.0;
export const GEAR_COUNT_MIN = 4;
export const GEAR_COUNT_MAX = 6;
export const FINAL_DRIVE_MIN = 2.5;
export const FINAL_DRIVE_MAX = 4.5;
export const TIRE_GRIP_MIN = 0.8;
export const TIRE_GRIP_MAX = 1.4;
export const ROLL_STIFFNESS_MIN = 0.0;
export const ROLL_STIFFNESS_MAX = 15000.0;
export const DOWNFORCE_MIN = 0.0;
export const DOWNFORCE_MAX = 3.0;

function makeTune(
  engineTorque: number,
  gears: number[],
  finalDrive: number,
  gripFront: number,
  gripRear: number,
  rollFront: number,
  rollRear: number,
  downforce: number,
  drivetrain: Drivetrain,
): CarTune {
  return {
    engine_torque: engineTorque,
    gear_ratios: gears,
    gears,
    final_drive: finalDrive,
    tire_grip_front: gripFront,
    tire_grip_rear: gripRear,
    roll_stiffness_front: rollFront,
    roll_stiffness_rear: rollRear,
    downforce_coefficient: downforce,
    drivetrain,
  };
}

// Car id order and .tres mapping follow GarageUI CAR_IDS/CAR_TUNES:
// sedan default_tune, coupe sport_tune, hatch drift_tune, awd drag_tune.
export const TUNES: Record<string, CarTune> = {
  sedan: makeTune(
    380,
    [3.2, 2.1, 1.5, 1.1, 0.85],
    3.9,
    1.0,
    1.0,
    8000,
    6500,
    1.2,
    "RWD",
  ),
  coupe: makeTune(
    450,
    [3.2, 2.1, 1.5, 1.1, 0.85],
    4.1,
    1.15,
    1.1,
    10000,
    8500,
    1.8,
    "FWD",
  ),
  hatch: makeTune(
    340,
    [3.2, 2.1, 1.5, 1.1, 0.85],
    3.7,
    1.05,
    0.85,
    9000,
    2500,
    0.6,
    "RWD",
  ),
  awd: makeTune(
    520,
    [3.4, 2.2, 1.6, 1.2, 0.9],
    4.3,
    0.95,
    1.05,
    7000,
    7500,
    0.8,
    "AWD",
  ),
};

export function getTune(carId: string): CarTune | undefined {
  return TUNES[carId];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validGears(gears: unknown): boolean {
  if (!Array.isArray(gears) || gears.length < GEAR_COUNT_MIN || gears.length > GEAR_COUNT_MAX) {
    return false;
  }
  for (let i = 0; i < gears.length; i += 1) {
    const ratio: unknown = gears[i];
    if (!isFiniteNumber(ratio) || ratio < GEAR_RATIO_MIN || ratio > GEAR_RATIO_MAX) {
      return false;
    }
    if (i > 0 && !((gears[i - 1] as number) > ratio)) {
      return false;
    }
  }
  return true;
}

function validDrivetrain(value: unknown): boolean {
  // String labels are canonical; raw v1 ints (0 FWD, 1 RWD, 2 AWD) are
  // accepted so int-carrying variants still validate by range.
  if (value === "FWD" || value === "RWD" || value === "AWD") {
    return true;
  }
  return value === 0 || value === 1 || value === 2;
}

// Pure port of CarTune.validate(): bound-for-bound, boolean only, never
// throws. Checks every alias slot so spread-and-mutate probes that edit
// either vocabulary still fail.
export function validateTune(tune: unknown): boolean {
  try {
    if (tune === null || typeof tune !== "object") {
      return false;
    }
    const t = tune as Partial<CarTune>;
    if (
      !isFiniteNumber(t.engine_torque) ||
      t.engine_torque < ENGINE_TORQUE_MIN ||
      t.engine_torque > ENGINE_TORQUE_MAX
    ) {
      return false;
    }
    const gears = t.gear_ratios ?? t.gears;
    const aliasGears = t.gears ?? t.gear_ratios;
    if (!validGears(gears) || !validGears(aliasGears)) {
      return false;
    }
    if (
      !isFiniteNumber(t.final_drive) ||
      t.final_drive < FINAL_DRIVE_MIN ||
      t.final_drive > FINAL_DRIVE_MAX
    ) {
      return false;
    }
    for (const grip of [t.tire_grip_front, t.tire_grip_rear]) {
      if (!isFiniteNumber(grip) || grip < TIRE_GRIP_MIN || grip > TIRE_GRIP_MAX) {
        return false;
      }
    }
    for (const roll of [t.roll_stiffness_front, t.roll_stiffness_rear]) {
      if (!isFiniteNumber(roll) || roll < ROLL_STIFFNESS_MIN || roll > ROLL_STIFFNESS_MAX) {
        return false;
      }
    }
    if (
      !isFiniteNumber(t.downforce_coefficient) ||
      t.downforce_coefficient < DOWNFORCE_MIN ||
      t.downforce_coefficient > DOWNFORCE_MAX
    ) {
      return false;
    }
    if (!validDrivetrain(t.drivetrain)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
