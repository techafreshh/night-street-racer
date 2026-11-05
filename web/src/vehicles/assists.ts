// Driving assists: pure port of scripts/vehicles/assists.gd.
// Traction/stability helpers, default ON. The math is pure-static so
// headless tests call it with no scene: with `enabled == false` the
// input is returned unchanged, with `enabled == true` a strictly
// smaller magnitude is returned. Zero imports by design so the module
// loads under Node/vitest and never drags in three.js.

// Default ON flag, mirroring `assists_enabled := true` in assists.gd
// and the controller default.
export const ASSISTS_ON = true;

// Damping strengths, mirroring `steer_damp_strength := 0.2` and
// `slip_damp_strength := 0.25` in assists.gd.
export const STEER_DAMP = 0.2;
export const SLIP_DAMP = 0.25;

// Speed-sensitive steering assist: full lock at standstill, linearly
// down to (1 - maxDamp) at 40 m/s. Port of `correct_steer`.
export function correctSteer(
  steer: number,
  speedMs: number,
  enabled: boolean,
  maxDamp: number = STEER_DAMP,
): number {
  if (!enabled) {
    return steer;
  }
  const t = Math.min(Math.max(Math.abs(speedMs) / 40.0, 0), 1);
  return steer * (1.0 - Math.min(Math.max(maxDamp, 0), 0.9) * t);
}

// Lateral-force damper: scales the raw tire force toward zero while
// preserving its sign. Port of `damp_slip`.
export function dampSlip(
  rawSlip: number,
  enabled: boolean,
  damp: number = SLIP_DAMP,
): number {
  if (!enabled) {
    return rawSlip;
  }
  return rawSlip * (1.0 - Math.min(Math.max(damp, 0), 0.9));
}

// snake_case aliases for the v1 vocabulary (assists.gd names).
export const correct_steer = correctSteer;
export const damp_slip = dampSlip;
export const assists_on = ASSISTS_ON;
export const steer_damp_strength = STEER_DAMP;
export const slip_damp_strength = SLIP_DAMP;
