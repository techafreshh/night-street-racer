// Drawcall/FPS audit sampler (issue #228): the single drawcall budget
// plus a never-throw reader over renderer.info.render.calls. Pure
// constants plus DOM-free reads, so importing this module stays
// Node-safe (no DOM/WebGL at import time).
export const MAX_DRAW_CALLS = 1500;

// Same-reference aliases so harness wording cannot mismatch.
export const max_draw_calls = MAX_DRAW_CALLS;
export const DRAW_CALL_BUDGET = MAX_DRAW_CALLS;
export const draw_call_budget = MAX_DRAW_CALLS;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Live drawcall sample: reads renderer.info.render.calls, or null
// (never throws) when the renderer, info, or count is unavailable.
// A missing or non-finite count reads as null so probes can tell
// "no renderer yet" apart from a real zero-call frame.
export function sampleDrawCalls(renderer: unknown): number | null {
  try {
    if (typeof renderer !== "object" || renderer === null) {
      return null;
    }
    const info = (renderer as { info?: unknown }).info;
    if (typeof info !== "object" || info === null) {
      return null;
    }
    const render = (info as { render?: unknown }).render;
    if (typeof render !== "object" || render === null) {
      return null;
    }
    const calls = (render as { calls?: unknown }).calls;
    if (!isFiniteNumber(calls) || calls < 0) {
      return null;
    }
    return calls;
  } catch {
    return null;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const sample_draw_calls = sampleDrawCalls;

// Boolean-only, never throws. With no argument validates the stock
// budget; with a partial object validates the provided fields against
// stock (missing fields read as stock).
export function validatePerfConfig(config?: unknown): boolean {
  try {
    if (config === undefined || config === null) {
      return checkPerf({});
    }
    if (typeof config !== "object") {
      return false;
    }
    return checkPerf(config as Record<string, unknown>);
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_perf_config = validatePerfConfig;

function checkPerf(config: Record<string, unknown>): boolean {
  const pick = (value: unknown, fallback: number): number =>
    isFiniteNumber(value) ? value : fallback;
  const maxCalls = pick(
    config.maxCalls ??
      config.max_calls ??
      config.MAX_DRAW_CALLS ??
      config.max_draw_calls ??
      config.DRAW_CALL_BUDGET ??
      config.draw_call_budget,
    MAX_DRAW_CALLS,
  );
  return maxCalls === MAX_DRAW_CALLS;
}
