// Rapier init retry (issue #229 step 2, guarded follower in #241): a
// transient WASM failure resets the cached promise so concurrent boot
// callers share one in-flight init and the next call retries instead of
// re-rejecting the cached failure. Both the leader and the followers
// reset only their own failed attempt, so a stale waiter settling after
// a fresh retry started never clears it. The compat module is stubbed
// before world.ts loads (per-file workers keep the stub isolated from
// the physics suites); each test re-imports world.ts for a fresh
// module-level handle.
import { beforeEach, describe, expect, it, vi } from "vitest";

type ScriptEntry = "resolve" | "reject" | "deferred";

type Gatekeeper = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

const controls = vi.hoisted(() => ({
  initCalls: 0,
  script: [] as ScriptEntry[],
  gatekeepers: [] as Gatekeeper[],
}));

vi.mock("@dimforge/rapier3d-compat", () => ({
  default: {
    init: (): Promise<void> => {
      controls.initCalls += 1;
      const entry: ScriptEntry =
        controls.script[controls.initCalls - 1] ?? "resolve";
      if (entry === "reject") {
        return Promise.reject(new Error("transient wasm failure"));
      }
      if (entry === "deferred") {
        let resolve!: () => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        controls.gatekeepers.push({ promise, resolve, reject });
        return promise;
      }
      return Promise.resolve();
    },
  },
}));

async function freshWorld(): Promise<{
  ensureRapierReady: () => Promise<void>;
}> {
  vi.resetModules();
  return await import("../src/physics/world");
}

beforeEach(() => {
  controls.initCalls = 0;
  controls.script = [];
  controls.gatekeepers = [];
});

describe("rapier init retry", () => {
  it("rejects the stub init once, then succeeds on retry", async () => {
    controls.script = ["reject"];
    const { ensureRapierReady } = await freshWorld();
    await expect(ensureRapierReady()).rejects.toThrow(
      "transient wasm failure",
    );
    await expect(ensureRapierReady()).resolves.toBeUndefined();
    await expect(ensureRapierReady()).resolves.toBeUndefined();
    expect(controls.initCalls).toBe(2);
  });

  it("concurrent callers share one failing init and the next call retries", async () => {
    controls.script = ["reject"];
    const { ensureRapierReady } = await freshWorld();
    const attempts = [
      ensureRapierReady(),
      ensureRapierReady(),
      ensureRapierReady(),
    ];
    const results = await Promise.allSettled(attempts);
    expect(
      results.every((result) => result.status === "rejected"),
    ).toBe(true);
    expect(controls.initCalls).toBe(1);
    await expect(ensureRapierReady()).resolves.toBeUndefined();
    expect(controls.initCalls).toBe(2);
  });

  it("a stale follower settling after a fresh retry started does not clear it", async () => {
    controls.script = ["deferred", "deferred"];
    const { ensureRapierReady } = await freshWorld();
    const leader = ensureRapierReady();
    const rawFirst = controls.gatekeepers[0].promise;
    // Re-enter between the leader clearing the failed handle and the
    // follower settling, like a boot retry racing the waiter drain.
    let retry: Promise<void> | undefined;
    void rawFirst.then(
      () => {},
      () => {
        retry = ensureRapierReady();
      },
    );
    const follower = ensureRapierReady();
    controls.gatekeepers[0].reject(new Error("transient wasm failure"));
    await expect(leader).rejects.toThrow("transient wasm failure");
    await expect(follower).rejects.toThrow("transient wasm failure");
    expect(retry).toBeDefined();
    expect(controls.initCalls).toBe(2);
    controls.gatekeepers[1].resolve();
    await expect(retry).resolves.toBeUndefined();
    await expect(ensureRapierReady()).resolves.toBeUndefined();
    expect(controls.initCalls).toBe(2);
  });
});
