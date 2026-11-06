// Rapier init retry (issue #229 step 2): a transient WASM failure resets
// the cached promise so concurrent boot callers share one in-flight init
// and the next call retries instead of re-rejecting the cached failure.
// The compat module is stubbed before world.ts loads (per-file workers
// keep the stub isolated from the physics suites).
import { describe, expect, it, vi } from "vitest";

let initCalls = 0;

vi.mock("@dimforge/rapier3d-compat", () => ({
  default: {
    init: async (): Promise<void> => {
      initCalls += 1;
      if (initCalls === 1) {
        throw new Error("transient wasm failure");
      }
    },
  },
}));

const { ensureRapierReady } = await import("../src/physics/world");

describe("rapier init retry", () => {
  it("rejects the stub init once, then succeeds on retry", async () => {
    await expect(ensureRapierReady()).rejects.toThrow("transient wasm failure");
    await expect(ensureRapierReady()).resolves.toBeUndefined();
    await expect(ensureRapierReady()).resolves.toBeUndefined();
    expect(initCalls).toBe(2);
  });
});
