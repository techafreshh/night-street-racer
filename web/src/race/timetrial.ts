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
