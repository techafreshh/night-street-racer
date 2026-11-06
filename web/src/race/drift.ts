// Slip/drift scoring ported from scripts/race/drift_scoring.gd (scoring
// core). Pure zero-dependency module: no imports, no disk I/O
// (banking and best persistence live in the game layer, per race.gd).

// Slip below 12deg never scores (straight-line wiggles).
export const MIN_SLIP_DEG = 12.0;
// Same gate in radians for the issue-spelled scoreDrift entry point.
export const MIN_SLIP_RAD = (MIN_SLIP_DEG * Math.PI) / 180.0;
// Speed below 10m/s never scores (parking-lot slides).
export const MIN_SPEED_MS = 10.0;
// Points per (slip_deg * speed_ms * second) of sustained slide.
export const SCORE_FACTOR = 1.0;

// Slip angle in degrees from planar velocity components, using the same
// atan2 shape as the v1 tire physics
// (slip = atan2(lateral, |forward| + 1.0)): straight driving reads ~0deg,
// sustained slides read high. Returns the magnitude (always >= 0).
export function slipAngleDeg(
  forwardSpeed: number,
  lateralSpeed: number,
): number {
  if (!Number.isFinite(forwardSpeed) || !Number.isFinite(lateralSpeed)) {
    return 0.0;
  }
  return Math.abs(
    (Math.atan2(lateralSpeed, Math.abs(forwardSpeed) + 1.0) * 180.0) /
      Math.PI,
  );
}

// v1 snake_case alias (same reference).
export const slip_angle_deg = slipAngleDeg;

// Dual-threshold gate: true only when slip and speed both clear their
// minimums. Handbrake is deliberately not a gate.
export function isDrifting(slipDeg: number, speedMs: number): boolean {
  if (!Number.isFinite(slipDeg) || !Number.isFinite(speedMs)) {
    return false;
  }
  return (
    Math.abs(slipDeg) >= MIN_SLIP_DEG &&
    Math.abs(speedMs) >= MIN_SPEED_MS
  );
}

// v1 snake_case alias (same reference).
export const is_drifting = isDrifting;

// Points earned by one sample (slip in degrees): 0 when the gate fails or
// delta <= 0, otherwise slip_deg * speed_ms * delta * SCORE_FACTOR.
export function scoreDelta(
  slipDeg: number,
  speedMs: number,
  delta: number,
): number {
  if (
    !Number.isFinite(slipDeg) ||
    !Number.isFinite(speedMs) ||
    !Number.isFinite(delta)
  ) {
    return 0.0;
  }
  if (delta <= 0.0) {
    return 0.0;
  }
  if (!isDrifting(slipDeg, speedMs)) {
    return 0.0;
  }
  return Math.max(
    Math.abs(slipDeg) * Math.abs(speedMs) * delta * SCORE_FACTOR,
    0.0,
  );
}

// v1 snake_case alias (same reference).
export const score_delta = scoreDelta;

// Issue-spelled entry point: slip in radians (0.25 rad ~= 14.3deg clears
// the 12deg gate); converts to degrees, then delegates to score_delta.
export function scoreDrift(
  slipRad: number,
  speedMs: number,
  delta: number,
): number {
  if (!Number.isFinite(slipRad)) {
    return 0.0;
  }
  return scoreDelta((slipRad * 180.0) / Math.PI, speedMs, delta);
}

// Disk-free judged-run best read over a records table
// ({eventId: {best_drift_score, ...}}): the truncated whole-int best when
// present, otherwise 0 (absent, corrupt, non-numeric). Never throws,
// never touches storage (the game/records owner injects the table).
export function bestFromTable(table: unknown, eventId: string): number {
  try {
    if (typeof eventId !== "string" || eventId === "") {
      return 0;
    }
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      return 0;
    }
    const entry = (table as Record<string, unknown>)[eventId];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return 0;
    }
    const score = (entry as Record<string, unknown>).best_drift_score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return 0;
    }
    return Math.trunc(score);
  } catch {
    return 0;
  }
}

// v1 snake_case alias (same reference).
export const best_from_table = bestFromTable;
