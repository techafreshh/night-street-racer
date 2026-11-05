// Live position math plus the in-memory results table, ported from
// scripts/race/positions.gd. Pure zero-dependency module with no imports.

export type StandingEntry = {
  id: string;
  progress: number;
  [key: string]: unknown;
};

export type PositionsResult = {
  leader: number;
  order: number[];
};

export type FinishRow = {
  racer: string;
  time_s: number;
  place: number;
};

export type XZPoint = {
  x: number;
  y?: number;
  z: number;
};

// Progress score for one racer: raising lap, idx, or frac raises the score,
// and the -1 start sentinel stays below gate 0. frac is clamped to
// [0.0, 1.0]; lap and total are clamped to keep degenerate inputs monotonic
// instead of crashing.
export function progress(
  lap: number,
  idx: number,
  frac: number,
  total: number,
): number {
  const safeLap = Number.isFinite(lap) ? Math.max(0, Math.trunc(lap)) : 0;
  const safeTotal = Number.isFinite(total) ? Math.max(1, Math.trunc(total)) : 1;
  const safeIdx = Number.isFinite(idx) ? idx : 0;
  const safeFrac = Number.isFinite(frac)
    ? Math.min(1, Math.max(0, frac))
    : 0;
  return safeLap * safeTotal + safeIdx + safeFrac;
}

function coordOf(point: XZPoint, key: "x" | "z"): number {
  const raw = (point as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : NaN;
}

// Fractional progress of the car along the XZ segment prev -> next,
// projected and clamped to [0.0, 1.0]. Y is ignored, mirroring the
// is_moving_wrong_way flatten; degenerate segments shorter than 0.001 m
// yield 0.0 instead of dividing by zero.
export function fractionToNext(
  carPos: XZPoint,
  prevPos: XZPoint,
  nextPos: XZPoint,
): number {
  const segX = coordOf(nextPos, "x") - coordOf(prevPos, "x");
  const segZ = coordOf(nextPos, "z") - coordOf(prevPos, "z");
  if (!Number.isFinite(segX) || !Number.isFinite(segZ)) {
    return 0.0;
  }
  if (Math.hypot(segX, segZ) < 0.001) {
    return 0.0;
  }
  const rx = coordOf(carPos, "x") - coordOf(prevPos, "x");
  const rz = coordOf(carPos, "z") - coordOf(prevPos, "z");
  if (!Number.isFinite(rx) || !Number.isFinite(rz)) {
    return 0.0;
  }
  const denom = segX * segX + segZ * segZ;
  const t = (rx * segX + rz * segZ) / denom;
  return Math.min(1, Math.max(0, t));
}

// v1 snake_case alias (same reference).
export const fraction_to_next = fractionToNext;

// Live standings over {"id", "progress"} entries, sorted descending by
// progress with deterministic original-index tiebreak. Returns a new array
// (input is never mutated); entries missing progress sink to the bottom
// instead of crashing.
export function standingsFor(entries: StandingEntry[]): StandingEntry[] {
  const decorated = entries.map((entry, index) => {
    let score = -Infinity;
    if (entry !== null && typeof entry === "object") {
      const raw = (entry as Record<string, unknown>).progress;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        score = raw;
      }
    }
    return { entry, score, index };
  });
  decorated.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });
  return decorated.map((d) => d.entry);
}

// v1 snake_case alias (same reference).
export const standings_for = standingsFor;

// Issue-spelling standings over per-racer scalar progress in the same
// lap/frame (higher wins): leader is the first max index, order is indices
// sorted by descending progress with a stable original-index tiebreak.
export function computePositions(progresses: number[]): PositionsResult {
  const scores = progresses.map((p) =>
    typeof p === "number" && Number.isFinite(p) ? p : -Infinity,
  );
  let leader = -1;
  if (scores.length > 0) {
    leader = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[leader]) {
        leader = i;
      }
    }
  }
  const order = scores
    .map((_, i) => i)
    .sort((a, b) => {
      if (scores[a] !== scores[b]) {
        return scores[b] - scores[a];
      }
      return a - b;
    });
  return { leader, order };
}

// In-memory results table: retains every finisher's place and time at the
// line. Duplicates keep the first time, empty ids and negative times are
// ignored.
export class RaceResults {
  private finishers: Array<{ racer: string; time_s: number }> = [];

  record_finish(racer: string, time_s: number): number {
    if (typeof racer !== "string" || racer === "") {
      return 0;
    }
    if (typeof time_s !== "number" || !Number.isFinite(time_s)) {
      return 0;
    }
    if (time_s < 0.0) {
      return 0;
    }
    for (const f of this.finishers) {
      if (f.racer === racer) {
        return this.place_of(racer);
      }
    }
    this.finishers.push({ racer, time_s });
    return this.place_of(racer);
  }

  recordFinish(racer: string, timeS: number): number {
    return this.record_finish(racer, timeS);
  }

  ordered_results(): FinishRow[] {
    const decorated = this.finishers.map((f, index) => ({
      racer: f.racer,
      time_s: f.time_s,
      index,
    }));
    decorated.sort((a, b) => {
      if (a.time_s !== b.time_s) {
        return a.time_s - b.time_s;
      }
      return a.index - b.index;
    });
    return decorated.map((d, rank) => ({
      racer: d.racer,
      time_s: d.time_s,
      place: rank + 1,
    }));
  }

  orderedResults(): FinishRow[] {
    return this.ordered_results();
  }

  place_of(racer: string): number {
    for (const row of this.ordered_results()) {
      if (row.racer === racer) {
        return row.place;
      }
    }
    return 0;
  }

  placeOf(racer: string): number {
    return this.place_of(racer);
  }

  size(): number {
    return this.finishers.length;
  }

  clear(): void {
    this.finishers.length = 0;
  }
}
