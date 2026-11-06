// Time-trial delta math ported from scripts/race/time_trial.gd (pure core).
// Pure zero-dependency module: no imports, no disk I/O (best
// persistence lives in the save layer).

export const REWARD_MIN = 0;
export const REWARD_MAX = 5000;

// Signed gap to the stored best: race_time - best (ahead is negative).
export function computeDelta(nowS: number, bestS: number): number {
  return nowS - bestS;
}

// v1 snake_case alias (same reference).
export const compute_delta = computeDelta;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

// Race clock in seconds; time-trial shows zero-padded mm:ss.mmm.
export function formatTime(seconds: number): string {
  const t = Number.isFinite(seconds) ? Math.max(seconds, 0.0) : 0.0;
  const minutes = Math.floor(t / 60.0);
  const secs = Math.floor(t) % 60;
  let millis = Math.round((t - Math.floor(t)) * 1000.0);
  if (millis >= 1000) {
    millis = 999;
  }
  return `${pad2(minutes)}:${pad2(secs)}.${pad3(millis)}`;
}

// v1 snake_case alias (same reference).
export const format_time = formatTime;

// Signed delta; ahead (negative) shows "-", behind shows "+".
export function formatDelta(d: number): string {
  const value = Number.isFinite(d) ? d : 0.0;
  const sign = value >= 0.0 ? "+" : "-";
  return `${sign}${formatTime(Math.abs(value))}`;
}

// v1 snake_case alias (same reference).
export const format_delta = formatDelta;

// Credit payout bounds shared with the race order math (0-5000 inclusive).
export function isValidReward(reward: unknown): boolean {
  return (
    typeof reward === "number" &&
    Number.isFinite(reward) &&
    reward >= REWARD_MIN &&
    reward <= REWARD_MAX
  );
}

// Disk-free personal-best read over a records table
// ({eventId: {best_time_s, ...}}): the float best when present and
// positive, otherwise -1 (absent, corrupt, non-positive). Never throws,
// never touches storage (the game/records owner injects the table).
export function bestFromTable(table: unknown, eventId: string): number {
  try {
    if (typeof eventId !== "string" || eventId === "") {
      return -1;
    }
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      return -1;
    }
    const entry = (table as Record<string, unknown>)[eventId];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return -1;
    }
    const best = (entry as Record<string, unknown>).best_time_s;
    if (typeof best !== "number" || !Number.isFinite(best) || best <= 0) {
      return -1;
    }
    return best;
  } catch {
    return -1;
  }
}

// v1 snake_case alias (same reference).
export const best_from_table = bestFromTable;

// Disk-free snapshot of every positive personal best ({eventId: best});
// absent/corrupt tables yield {}, non-positive entries are skipped.
// Never throws, never touches storage.
export function allBestsFromTable(table: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      return out;
    }
    for (const [key, entry] of Object.entries(
      table as Record<string, unknown>,
    )) {
      if (key === "") {
        continue;
      }
      if (
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry)
      ) {
        continue;
      }
      const best = (entry as Record<string, unknown>).best_time_s;
      if (
        typeof best === "number" &&
        Number.isFinite(best) &&
        best > 0
      ) {
        out[key] = best;
      }
    }
  } catch {
    // Best effort: return whatever survived the scan.
  }
  return out;
}

// v1 snake_case alias (same reference).
export const all_bests_from_table = allBestsFromTable;
