// Perf/drawcall audit suite (duplicate-mutate-reject idiom: green on
// stock, red on one bad-bound mutation per dimension). Covers the
// issue #228 contract with no padding: the half-res bloom divisor pin,
// the <1500 drawcall budget pin, the never-throw sampler over
// renderer.info.render.calls, and boolean-only validators green on
// stock and red on one mutated field each. Node-safe: no renderer,
// composer, or environment construction.
import { describe, expect, it } from "vitest";
import {
  BLOOM_RES_DIVISOR,
  bloom_res_divisor,
  validateComposerConfig,
} from "../src/render/composer";
import {
  DRAW_CALL_BUDGET,
  MAX_DRAW_CALLS,
  draw_call_budget,
  max_draw_calls,
  sampleDrawCalls,
  sample_draw_calls,
  validatePerfConfig,
  validate_perf_config,
} from "../src/render/perf";

function mockRenderer(calls: unknown): unknown {
  return { info: { render: { calls } } };
}

describe("half-res bloom divisor", () => {
  it("pins the divisor at 2", () => {
    expect(BLOOM_RES_DIVISOR).toBe(2);
    expect(bloom_res_divisor).toBe(BLOOM_RES_DIVISOR);
  });

  it("validates the stock divisor and rejects full-res", () => {
    expect(validateComposerConfig()).toBe(true);
    expect(validateComposerConfig({})).toBe(true);
    expect(validateComposerConfig({ divisor: 2 })).toBe(true);
    expect(validateComposerConfig({ divisor: 1 })).toBe(false);
    expect(
      validateComposerConfig({ BLOOM_RES_DIVISOR: 1 }),
    ).toBe(false);
  });
});

describe("drawcall budget", () => {
  it("pins the budget below the 1500-call ceiling", () => {
    expect(MAX_DRAW_CALLS).toBe(1500);
    expect(max_draw_calls).toBe(MAX_DRAW_CALLS);
    expect(DRAW_CALL_BUDGET).toBe(MAX_DRAW_CALLS);
    expect(draw_call_budget).toBe(MAX_DRAW_CALLS);
  });
});

describe("drawcall sampler", () => {
  it("reads renderer.info.render.calls", () => {
    expect(sampleDrawCalls(mockRenderer(42))).toBe(42);
    expect(sampleDrawCalls(mockRenderer(0))).toBe(0);
    expect(sample_draw_calls).toBe(sampleDrawCalls);
  });

  it("returns null (never throws) when the count is unavailable", () => {
    expect(sampleDrawCalls(null)).toBe(null);
    expect(sampleDrawCalls(undefined)).toBe(null);
    expect(sampleDrawCalls({})).toBe(null);
    expect(sampleDrawCalls({ info: null })).toBe(null);
    expect(sampleDrawCalls({ info: { render: null } })).toBe(null);
    expect(sampleDrawCalls(mockRenderer(Number.NaN))).toBe(null);
    expect(sampleDrawCalls(mockRenderer(-1))).toBe(null);
    expect(sampleDrawCalls(mockRenderer("42"))).toBe(null);
    expect(() => sampleDrawCalls(null)).not.toThrow();
  });
});

describe("perf config validator", () => {
  it("validates the stock budget and rejects a shrunken ceiling", () => {
    expect(validatePerfConfig()).toBe(true);
    expect(validatePerfConfig({})).toBe(true);
    expect(validatePerfConfig({ maxCalls: 1500 })).toBe(true);
    expect(validatePerfConfig({ maxCalls: 1 })).toBe(false);
    expect(validatePerfConfig({ max_calls: 1 })).toBe(false);
    expect(validatePerfConfig("1500")).toBe(false);
    expect(validate_perf_config).toBe(validatePerfConfig);
  });
});
