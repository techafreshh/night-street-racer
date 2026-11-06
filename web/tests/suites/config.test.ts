// Config contract suite: pins the fixed-step and serve constants the
// harness and scenario probes read (single-source values in
// src/core/loop and vite.config, never hardcoded in tests).
import { describe, expect, it } from "vitest";
import { STEP_DT, STEP_HZ } from "../../src/core/loop";
import { DEFAULT_PORT, HEALTH_PAYLOAD } from "../../vite.config";

describe("config step", () => {
  it("runs the fixed step at 60 Hz", () => {
    expect(STEP_HZ).toBe(60);
    expect(STEP_DT).toBe(1 / 60);
    expect(STEP_DT).toBeCloseTo(0.0167, 3);
  });
});

describe("config serve", () => {
  it("serves on 8080 by default", () => {
    expect(DEFAULT_PORT).toBe(8080);
  });

  it("health payload is the ok envelope", () => {
    expect(HEALTH_PAYLOAD).toBe('{"status":"ok"}');
    expect(JSON.parse(HEALTH_PAYLOAD)).toEqual({ status: "ok" });
  });
});
