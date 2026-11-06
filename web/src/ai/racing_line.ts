// Racing-line bake ported from scripts/ai/racing_line.gd (bake statics).
// Pure zero-dependency module: no imports, no DOM, no 3D engine — the fixed
// step and vitest load it directly. Curvature is the v1 heading-change form
// (angle between segment directions over mean segment length, 0 on
// straights); target speeds are sqrt(lateral_accel / kappa) clamped to
// [MIN_SPEED, MAX_SPEED] with a backward braking pass so the car brakes
// before corners instead of arriving too hot.

export const MIN_SPEED = 8.0;
export const MAX_SPEED = 28.0;
export const LATERAL_ACCEL = 7.0;
export const BRAKE_DECEL = 6.0;

export type XZPoint = {
  x: number;
  y?: number;
  z: number;
};

type Flat = {
  x: number;
  z: number;
  y: number;
};

function num(value: unknown): number {
  return typeof value === "number" ? value : NaN;
}

function coordOf(point: unknown, key: string): number {
  if (Array.isArray(point)) {
    if (key === "x") {
      return num(point[0]);
    }
    if (key === "z") {
      return num(point.length >= 3 ? point[2] : point[1]);
    }
    return num(point[1]);
  }
  if (point !== null && typeof point === "object") {
    return num((point as Record<string, unknown>)[key]);
  }
  return NaN;
}

function flatOf(point: unknown): Flat {
  const x = coordOf(point, "x");
  const z = coordOf(point, "z");
  const yRaw = coordOf(point, "y");
  return { x, z, y: Number.isFinite(yRaw) ? yRaw : 0 };
}

// Points-like arrays hold point elements (objects or tuples); anything
// else (flat numbers, speeds) is not a waypoint list.
function isPointsArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length === 0) {
    return true;
  }
  const first = value[0];
  return Array.isArray(first) || (first !== null && typeof first === "object");
}

// Container-tolerant coercion: bare lists plus {points}/{waypoints}/{line}
// wrappers all read the same slot so harness wording cannot mismatch.
function asPoints(value: unknown): Flat[] {
  let src = value;
  if (!Array.isArray(src) && src !== null && typeof src === "object") {
    const rec = src as Record<string, unknown>;
    if (Array.isArray(rec.points)) {
      src = rec.points;
    } else if (Array.isArray(rec.waypoints)) {
      src = rec.waypoints;
    } else if (Array.isArray(rec.line)) {
      src = rec.line;
    } else {
      return [];
    }
  }
  if (!Array.isArray(src)) {
    return [];
  }
  return src.map(flatOf);
}

function loopOf(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    for (const key of ["loop", "loop_line", "loopLine", "closed"]) {
      if (typeof rec[key] === "boolean") {
        return rec[key] as boolean;
      }
    }
  }
  return fallback;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function fposmod(value: number, mod: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mod) || mod <= 0) {
    return 0;
  }
  return ((value % mod) + mod) % mod;
}

function imod(index: number, n: number): number {
  return ((index % n) + n) % n;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Heading-change curvature at point i over mean segment length
// (circumcircle-equivalent; 0 on straights, ~1/R on arcs). Degenerate
// inputs yield 0 instead of dividing by zero.
export function curvatureOf(points: unknown, index: unknown, loop?: unknown): number {
  const pts = asPoints(points);
  const n = pts.length;
  if (n < 3) {
    return 0;
  }
  const i = typeof index === "number" && Number.isFinite(index) ? Math.trunc(index) : 0;
  if (i < 0 || i >= n) {
    return 0;
  }
  const closed = loopOf(loop, true);
  if (!closed && (i <= 0 || i >= n - 1)) {
    return 0;
  }
  const prev = pts[imod(i - 1, n)];
  const cur = pts[i];
  const nxt = pts[imod(i + 1, n)];
  const ax = cur.x - prev.x;
  const az = cur.z - prev.z;
  const bx = nxt.x - cur.x;
  const bz = nxt.z - cur.z;
  if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
    return 0;
  }
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 0.001 || lb < 0.001) {
    return 0;
  }
  const cross = ax * bz - az * bx;
  const dot = ax * bx + az * bz;
  const ang = Math.abs(Math.atan2(cross, dot));
  const avg = (la + lb) * 0.5;
  if (!Number.isFinite(ang) || avg < 0.001) {
    return 0;
  }
  return ang / avg;
}

// v1 snake_case alias (same reference).
export const curvature_of = curvatureOf;

// Corner speed from the lateral grip budget, clamped to [low, high].
export function rawSpeed(kappa: unknown, grip?: unknown, top?: unknown, low?: unknown): number {
  const k = typeof kappa === "number" ? kappa : NaN;
  const gripAccel = finiteOr(grip, LATERAL_ACCEL);
  const hi = finiteOr(top, MAX_SPEED);
  const lo = finiteOr(low, MIN_SPEED);
  if (!Number.isFinite(k) || k <= 0.0001) {
    return hi;
  }
  return clamp(Math.sqrt(Math.max(gripAccel, 0.01) / k), lo, hi);
}

// v1 snake_case alias (same reference).
export const raw_speed = rawSpeed;

// Grip budget for the cornering-load throttle cap (distinct from the
// LATERAL_ACCEL bake budget): the rear friction circle headroom left for
// drive force once lateral demand is accounted for.
export const GRIP_BUDGET = 9.0;

// Throttle cap from cornering load: linear headroom against the grip
// budget keeps the combined force inside the friction circle, so full
// throttle while cornering hard does not power-oversteer. Port of
// RacingLine.throttle_cap (0 -> 1, >=budget -> 0.25 floor).
export function throttleCap(latAccel: unknown, grip?: unknown): number {
  const lat = typeof latAccel === "number" ? latAccel : NaN;
  if (!Number.isFinite(lat)) {
    return 1.0;
  }
  const budget = finiteOr(grip, GRIP_BUDGET);
  return clamp(1 - Math.abs(lat) / Math.max(budget, 0.01), 0.25, 1.0);
}

// v1 snake_case alias (same reference).
export const throttle_cap = throttleCap;

// Per-point target speeds with a backward braking pass over segment arc
// lengths, so the car brakes before corners instead of arriving too hot.
// Loops iterate to convergence (at most n passes); open lines take one
// reverse sweep. Budgets fall back to the pinned v1 defaults.
export function bakeSpeeds(
  points: unknown,
  loopOrOpts?: unknown,
  topSpeed?: unknown,
  lowSpeed?: unknown,
  gripAccel?: unknown,
  brake?: unknown,
): number[] {
  const pts = asPoints(points);
  const n = pts.length;
  if (n === 0) {
    return [];
  }
  let closed = true;
  let hi = finiteOr(topSpeed, MAX_SPEED);
  let lo = finiteOr(lowSpeed, MIN_SPEED);
  let grip = finiteOr(gripAccel, LATERAL_ACCEL);
  let decel = finiteOr(brake, BRAKE_DECEL);
  if (loopOrOpts !== null && typeof loopOrOpts === "object" && !Array.isArray(loopOrOpts)) {
    const rec = loopOrOpts as Record<string, unknown>;
    closed = loopOf(rec, true);
    hi = finiteOr(
      rec.topSpeed ?? rec.top_speed ?? rec.top ?? rec.maxSpeed ?? rec.max_speed ?? rec.max,
      hi,
    );
    lo = finiteOr(
      rec.lowSpeed ?? rec.low_speed ?? rec.low ?? rec.minSpeed ?? rec.min_speed ?? rec.min,
      lo,
    );
    grip = finiteOr(
      rec.gripAccel ?? rec.grip_accel ?? rec.grip ?? rec.lateralAccel ?? rec.lateral_accel,
      grip,
    );
    decel = finiteOr(rec.brake ?? rec.brakeDecel ?? rec.brake_decel ?? rec.decel, decel);
  } else {
    closed = loopOf(loopOrOpts, true);
  }
  if (hi < lo) {
    const swap = hi;
    hi = lo;
    lo = swap;
  }
  decel = Math.max(decel, 0.01);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(rawSpeed(curvatureOf(pts, i, closed), grip, hi, lo));
  }
  const ds: number[] = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    if (!closed && i === n - 1) {
      ds[i] = 0;
      continue;
    }
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    ds[i] = Number.isFinite(d) ? d : 0;
  }
  if (closed) {
    for (let pass = 0; pass < n; pass += 1) {
      let changed = false;
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        const allow = Math.sqrt(Math.max(out[j] * out[j] + 2 * decel * ds[i], 0));
        if (!Number.isFinite(allow)) {
          continue;
        }
        if (out[i] > allow + 0.001) {
          out[i] = Math.min(out[i], allow);
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
  } else {
    for (let i = n - 2; i >= 0; i -= 1) {
      const allow = Math.sqrt(Math.max(out[i + 1] * out[i + 1] + 2 * decel * ds[i], 0));
      if (!Number.isFinite(allow)) {
        continue;
      }
      out[i] = Math.min(out[i], allow);
    }
  }
  return out;
}

// Issue-spelled entry plus v1 spellings (same reference).
export const bakeRacingLine = bakeSpeeds;
export const bake_speeds = bakeSpeeds;
export const bake_racing_line = bakeSpeeds;

// XZ polyline length; degenerate inputs yield 0.
export function trackLength(points: unknown, loop?: unknown): number {
  let ptsArg = points;
  let loopArg = loop;
  if (!isPointsArray(ptsArg) && isPointsArray(loopArg)) {
    ptsArg = loop;
    loopArg = points;
  }
  const pts = asPoints(ptsArg);
  const n = pts.length;
  if (n < 2) {
    return 0;
  }
  const closed = loopOf(loopArg, true);
  const count = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (Number.isFinite(d)) {
      total += d;
    }
  }
  return total;
}

// v1 snake_case alias (same reference).
export const track_length = trackLength;

// Nearest waypoint index to a position (XZ only); empty or non-finite
// input yields 0 instead of crashing.
export function closestIndex(points: unknown, pos?: unknown): number {
  let ptsArg = points;
  let posArg = pos;
  if (!isPointsArray(ptsArg) && isPointsArray(posArg)) {
    ptsArg = pos;
    posArg = points;
  }
  const pts = asPoints(ptsArg);
  if (pts.length === 0) {
    return 0;
  }
  const p = flatOf(posArg);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
    return 0;
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const dx = p.x - pts[i].x;
    const dz = p.z - pts[i].z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
      continue;
    }
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// v1 snake_case alias (same reference).
export const closest_index = closestIndex;

// Arc distance of the car's projection onto the line from points[0].
export function arcOf(points: unknown, pos?: unknown, loop?: unknown): number {
  let ptsArg = points;
  let posArg = pos;
  let loopArg = loop;
  if (!isPointsArray(ptsArg) && isPointsArray(posArg)) {
    ptsArg = pos;
    posArg = points;
  }
  if (posArg !== null && typeof posArg === "object" && !Array.isArray(posArg)) {
    const rec = posArg as Record<string, unknown>;
    if (Array.isArray(rec.points) || Array.isArray(rec.waypoints) || Array.isArray(rec.line)) {
      loopArg = loopArg ?? rec.loop ?? rec.closed;
      posArg = rec.pos ?? rec.position ?? rec.carPos ?? rec.car_pos ?? rec;
    }
  }
  const pts = asPoints(ptsArg);
  const n = pts.length;
  if (n < 2) {
    return 0;
  }
  const p = flatOf(posArg);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
    return 0;
  }
  const closed = loopOf(loopArg, true);
  const count = closed ? n : n - 1;
  let bestD = Infinity;
  let bestS = 0;
  let s = 0;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    if (!Number.isFinite(abx) || !Number.isFinite(abz)) {
      continue;
    }
    const segLen = Math.hypot(abx, abz);
    const denom = abx * abx + abz * abz;
    let t = 0;
    if (denom > 0.000001) {
      t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / denom, 0, 1);
    }
    const dx = p.x - (a.x + abx * t);
    const dz = p.z - (a.z + abz * t);
    const d = Math.hypot(dx, dz);
    if (Number.isFinite(d) && d < bestD) {
      bestD = d;
      bestS = s + segLen * t;
    }
    if (Number.isFinite(segLen)) {
      s += segLen;
    }
  }
  return bestS;
}

// v1 snake_case alias (same reference).
export const arc_of = arcOf;

// Track point at arc distance s from points[0] (wraps on closed loops).
export function pointAtArc(points: unknown, s?: unknown, loop?: unknown): XZPoint {
  let ptsArg = points;
  let sArg = s;
  let loopArg = loop;
  if (typeof ptsArg === "number" && isPointsArray(sArg)) {
    ptsArg = s;
    sArg = points;
  }
  if (sArg !== null && typeof sArg === "object" && !Array.isArray(sArg)) {
    const rec = sArg as Record<string, unknown>;
    if (Array.isArray(rec.points) || Array.isArray(rec.waypoints)) {
      loopArg = loopArg ?? rec.loop ?? rec.closed;
      sArg = rec.s ?? rec.arc ?? rec.dist ?? rec.distance ?? 0;
    }
  }
  const pts = asPoints(ptsArg);
  const n = pts.length;
  if (n === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (n === 1) {
    return { x: pts[0].x, y: pts[0].y, z: pts[0].z };
  }
  const closed = loopOf(loopArg, true);
  const total = trackLength(pts, closed);
  if (total < 0.001) {
    return { x: pts[0].x, y: pts[0].y, z: pts[0].z };
  }
  const dist = finiteOr(sArg, 0);
  let rest = closed ? fposmod(dist, total) : clamp(dist, 0, total);
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (!Number.isFinite(seg)) {
      continue;
    }
    if (rest <= seg) {
      const t = seg > 0.0001 ? rest / seg : 0;
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
    }
    rest -= seg;
  }
  const last = closed ? pts[0] : pts[n - 1];
  return { x: last.x, y: last.y, z: last.z };
}

// v1 snake_case alias (same reference).
export const point_at_arc = pointAtArc;

// Track point `dist` metres ahead of the car's projection onto the line.
export function lookaheadPoint(
  points: unknown,
  pos?: unknown,
  dist?: unknown,
  loop?: unknown,
): XZPoint {
  let ptsArg = points;
  let posArg = pos;
  let distArg = dist;
  let loopArg = loop;
  for (const cand of [pos, dist, loop]) {
    if (isPointsArray(cand) && !isPointsArray(ptsArg)) {
      ptsArg = cand;
    }
  }
  if (ptsArg !== null && typeof ptsArg === "object" && !Array.isArray(ptsArg)) {
    const rec = ptsArg as Record<string, unknown>;
    if (Array.isArray(rec.points) || Array.isArray(rec.waypoints) || Array.isArray(rec.line)) {
      posArg = posArg ?? rec.pos ?? rec.position ?? rec.carPos ?? rec.car_pos;
      distArg = distArg ?? rec.dist ?? rec.distance ?? rec.lookahead ?? rec.s;
      loopArg = loopArg ?? rec.loop ?? rec.closed;
      ptsArg = (rec.points ?? rec.waypoints ?? rec.line) as unknown;
    }
  }
  if (posArg !== null && typeof posArg === "object" && !Array.isArray(posArg)) {
    const rec = posArg as Record<string, unknown>;
    if (Array.isArray(rec.points) || Array.isArray(rec.waypoints)) {
      const held = posArg;
      posArg = ptsArg;
      ptsArg = held;
    }
  }
  const pts = asPoints(ptsArg);
  if (pts.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const closed = loopOf(loopArg, true);
  const p = flatOf(posArg);
  const d = finiteOr(distArg, 0);
  return pointAtArc(pts, arcOf(pts, p, closed) + d, closed);
}

// v1 snake_case alias (same reference).
export const lookahead_point = lookaheadPoint;

// Baked target speed interpolated at arc distance s, so braking starts as
// soon as the baked profile ramps down instead of waiting for the nearest
// index to flip. Points and speeds are matched by index (modulo when the
// lengths differ); without geometry the speeds interpolate uniformly.
export function speedAtArc(
  points: unknown,
  speeds?: unknown,
  s?: unknown,
  loop?: unknown,
): number {
  const cands = [points, speeds, s, loop];
  let foundPts: unknown = null;
  let foundSpd: unknown = null;
  for (const cand of cands) {
    if (!Array.isArray(cand)) {
      continue;
    }
    if (cand.length > 0 && cand.every((e) => typeof e === "number")) {
      if (foundSpd === null) {
        foundSpd = cand;
      }
    } else if (foundPts === null) {
      foundPts = cand;
    }
  }
  let sVal: unknown = s;
  let loopVal: unknown = loop;
  for (const cand of cands) {
    if (typeof cand === "number" && !Number.isFinite(sVal)) {
      sVal = cand;
    }
    if (typeof cand === "boolean" && loopVal === undefined) {
      loopVal = cand;
    }
  }
  if (!Number.isFinite(sVal as number)) {
    for (const cand of cands) {
      if (typeof cand === "number") {
        sVal = cand;
        break;
      }
    }
  }
  let container: Record<string, unknown> | null = null;
  for (const cand of cands) {
    if (
      cand !== null &&
      typeof cand === "object" &&
      !Array.isArray(cand) &&
      (Array.isArray((cand as Record<string, unknown>).speeds) ||
        Array.isArray((cand as Record<string, unknown>).targetSpeeds))
    ) {
      container = cand as Record<string, unknown>;
      break;
    }
  }
  if (foundSpd === null && container !== null) {
    foundSpd =
      (container.speeds ?? container.targetSpeeds ?? container.target_speeds) as unknown;
  }
  if (foundPts === null && container !== null) {
    foundPts = (container.points ?? container.waypoints ?? container.line) as unknown;
  }
  if (sVal === undefined && container !== null) {
    sVal = container.s ?? container.arc ?? container.dist ?? container.distance;
  }
  if (loopVal === undefined && container !== null) {
    loopVal = container.loop ?? container.closed;
  }
  const raw = Array.isArray(foundSpd) ? (foundSpd as unknown[]) : [];
  const sp: number[] = raw.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : MAX_SPEED));
  if (sp.length === 0) {
    return MAX_SPEED;
  }
  if (sp.length === 1) {
    return sp[0];
  }
  const pts = foundPts === null ? [] : asPoints(foundPts);
  const closed = loopOf(loopVal, true);
  const dist = finiteOr(sVal, 0);
  if (pts.length < 2) {
    if (!closed) {
      const c = clamp(dist, 0, sp.length - 1);
      const i = Math.min(Math.floor(c), sp.length - 2);
      return lerp(sp[i], sp[i + 1], c - Math.floor(c));
    }
    const rest = fposmod(dist, sp.length);
    const i = Math.floor(rest) % sp.length;
    return lerp(sp[i], sp[(i + 1) % sp.length], rest - Math.floor(rest));
  }
  const n = pts.length;
  const m = sp.length;
  const total = trackLength(pts, closed);
  if (total < 0.001) {
    return sp[0];
  }
  let rest = closed ? fposmod(dist, total) : clamp(dist, 0, total);
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (!Number.isFinite(seg)) {
      continue;
    }
    if (rest <= seg) {
      const t = seg > 0.0001 ? rest / seg : 0;
      return lerp(sp[i % m], sp[(i + 1) % m], t);
    }
    rest -= seg;
  }
  return closed ? sp[0] : sp[(n - 1) % m];
}

// v1 snake_case alias (same reference).
export const speed_at_arc = speedAtArc;
