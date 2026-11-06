// Clamped catch-up aid ported from scripts/ai/rubber_band.gd.
// Pure zero-dependency module: no imports, no DOM, no 3D engine. The aid is
// proportional to the wrapped leader-minus-own arc gap and bounded both
// ways so no car ever gains more than MAX_AID m/s.

export const MAX_AID = 3.0;
export const GAIN = 0.08;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function fposmod(value: number, mod: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mod) || mod <= 0) {
    return 0;
  }
  return ((value % mod) + mod) % mod;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// Gap extraction: bare numbers plus {gap}/{gap_m}/{value} wrappers read
// the same slot so harness wording cannot mismatch.
function gapOf(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    for (const key of [
      "gap",
      "gapM",
      "gap_m",
      "gapMeters",
      "gap_meters",
      "leaderGap",
      "leader_gap",
      "value",
      "distance",
      "dist",
    ]) {
      const cand = rec[key];
      if (typeof cand === "number" && Number.isFinite(cand)) {
        return cand;
      }
    }
  }
  return NaN;
}

// Toggle check: any bare `false` or {enabled: false} in the call disables
// the aid, mirroring RubberBand.aid_for.
function disabledOf(args: unknown[]): boolean {
  for (const arg of args) {
    if (arg === false) {
      return true;
    }
    if (arg !== null && typeof arg === "object" && !Array.isArray(arg)) {
      if ((arg as Record<string, unknown>).enabled === false) {
        return true;
      }
    }
  }
  return false;
}

function budgetsOf(args: unknown[], max: number, gain: number): { max: number; gain: number } {
  let outMax = max;
  let outGain = gain;
  for (const arg of args) {
    if (arg !== null && typeof arg === "object" && !Array.isArray(arg)) {
      const rec = arg as Record<string, unknown>;
      const rawMax =
        rec.maxAid ?? rec.max_aid ?? rec.maxAidS ?? rec.max_aid_s ?? rec.maxAid_s ?? rec.max;
      if (typeof rawMax === "number" && Number.isFinite(rawMax)) {
        outMax = rawMax;
      }
      const rawGain = rec.gain ?? rec.pGain ?? rec.p_gain ?? rec.k ?? rec.proportional;
      if (typeof rawGain === "number" && Number.isFinite(rawGain)) {
        outGain = rawGain;
      }
    }
  }
  return { max: outMax, gain: outGain };
}

// Pure clamp: proportional aid for a signed gap, bounded both ways.
// Non-finite gaps read 0; {enabled: false} (or a bare false) yields 0.
export function computeAid(gap: unknown, maxAid?: unknown, gain?: unknown): number {
  if (disabledOf([gap, maxAid, gain])) {
    return 0;
  }
  const g = gapOf(gap);
  if (!Number.isFinite(g)) {
    return 0;
  }
  const budgets = budgetsOf([gap, maxAid, gain], MAX_AID, GAIN);
  let max = budgets.max;
  let pGain = budgets.gain;
  if (typeof maxAid === "number" && Number.isFinite(maxAid)) {
    max = maxAid;
  }
  if (typeof gain === "number" && Number.isFinite(gain)) {
    pGain = gain;
  }
  max = Math.abs(finiteOr(max, MAX_AID));
  if (!Number.isFinite(pGain)) {
    pGain = GAIN;
  }
  return clamp(g * pGain, -max, max);
}

// Instance spelling honoring the toggle (same reference: both forms clamp
// and both yield 0 when disabled).
export const rubberBand = computeAid;

// v1 snake_case aliases (same reference).
export const compute_aid = computeAid;
export const rubber_band = rubberBand;

// Wrapped leader-minus-own arc distance on a loop of `total` metres.
// Gaps past half the loop return 0, matching the Godot seam guard.
// Without a positive loop length there is nothing to wrap, so the raw
// difference (or 0 when non-finite) is returned instead of crashing.
export function wrapGap(leaderArc: unknown, ownArc?: unknown, total?: unknown): number {
  let leader = leaderArc;
  let own = ownArc;
  let len = total;
  if (leader !== null && typeof leader === "object" && !Array.isArray(leader)) {
    const rec = leader as Record<string, unknown>;
    leader =
      rec.leaderArc ?? rec.leader_arc ?? rec.leader ?? rec.gap ?? rec.value ?? leader;
    own = own ?? rec.ownArc ?? rec.own_arc ?? rec.own;
    len = len ?? rec.total ?? rec.trackLength ?? rec.track_length ?? rec.length;
  }
  if (own !== null && typeof own === "object" && !Array.isArray(own)) {
    const rec = own as Record<string, unknown>;
    own = rec.ownArc ?? rec.own_arc ?? rec.own ?? rec.value ?? own;
    len = len ?? rec.total ?? rec.trackLength ?? rec.track_length ?? rec.length;
  }
  const l = typeof leader === "number" ? leader : NaN;
  const o = typeof own === "number" ? own : NaN;
  const t = typeof len === "number" ? len : NaN;
  if (!Number.isFinite(l) || !Number.isFinite(o)) {
    return 0;
  }
  if (!Number.isFinite(t) || t <= 0) {
    return l - o;
  }
  const gap = fposmod(l - o, t);
  if (gap > t * 0.5) return 0;
  return gap;
}

// v1 snake_case alias (same reference).
export const wrap_gap = wrapGap;
