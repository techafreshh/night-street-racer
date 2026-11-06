// Chunk-budget acceptance suite (issue #243 contract): proves the ~5 MB
// initial payload is gone with no padding. Entry hygiene reads main.ts
// source (import type and dynamic import() stay allowed; static engine
// value imports fail), vec/traffic/loaders sources carry no engine
// value edge, manualChunks still routes the vendors, the warning
// tripwire reads exactly 500, and the extracted vec math matches the
// wrapper re-export number-for-number.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../vite.config";
import {
  IDENTITY_QUAT,
  resetCandidates,
  rotateVecByQuat,
  yawToQuat,
} from "../src/physics/vec";
import {
  resetCandidates as worldResetCandidates,
  yawToQuat as worldYawToQuat,
} from "../src/physics/world";

const testDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(testDir, "..", "src");

function readSource(relative: string): string {
  return readFileSync(join(srcDir, relative), "utf8");
}

// Source with comments, import-type blocks, and dynamic import()
// expressions removed, so only static value imports can match.
function valueImportSource(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/import\s+type\b[\s\S]*?;/g, "")
    .replace(/typeof\s+import\s*\([^)]*\)/g, "")
    .replace(/(await\s+)?import\s*\([^)]*\)/g, "");
}

describe("entry hygiene", () => {
  it("carries no static engine value imports", () => {
    const text = valueImportSource(readSource("main.ts"));
    expect(text).not.toMatch(/from\s+["']three["']/);
    expect(text).not.toMatch(/from\s+["']@dimforge/);
    expect(text).not.toMatch(/from\s+["']\.\/physics\/world["']/);
    expect(text).not.toMatch(/from\s+["']\.\/vehicles\/vehicle["']/);
    expect(text).not.toMatch(/from\s+["']\.\/render\//);
  });

  it("keeps the staged dynamic engine loader", () => {
    const text = readSource("main.ts");
    expect(text).toMatch(/import\("\.\/physics\/world"\)/);
    expect(text).toMatch(/import\("@dimforge\/rapier3d-compat"\)/);
    expect(text).toMatch(/import\("three"\)/);
    expect(text).toMatch(/import\("\.\/vehicles\/vehicle"\)/);
    expect(text).toMatch(/import\("\.\/render\/city"\)/);
    expect(text).toMatch(/import\("\.\/render\/loaders"\)/);
  });
});

describe("pure module edges", () => {
  it("vec carries zero engine matches", () => {
    const text = valueImportSource(readSource("physics/vec.ts"));
    expect(text).not.toMatch(/three/i);
    expect(text).not.toMatch(/rapier/i);
    expect(text).not.toMatch(/@dimforge/);
  });

  it("traffic carries no engine value edge", () => {
    const text = valueImportSource(readSource("traffic/traffic.ts"));
    expect(text).not.toMatch(/from\s+["']three["']/);
    expect(text).not.toMatch(/from\s+["']@dimforge/);
    expect(text).not.toMatch(/from\s+["']\.\.\/physics\/world["']/);
    // The concrete Rapier module arrives as a parameter (type-only
    // edge), mirroring the physics/materials.ts header idiom.
    const raw = readSource("traffic/traffic.ts");
    expect(raw).toMatch(
      /import\s+type\s+RAPIER\s+from\s+"@dimforge\/rapier3d-compat"/,
    );
  });

  it("loaders carries no static engine edge", () => {
    const text = valueImportSource(readSource("render/loaders.ts"));
    expect(text).not.toMatch(/from\s+["']three["']/);
    expect(text).not.toMatch(/rapier/i);
    expect(text).not.toMatch(/@dimforge/);
  });
});

describe("chunk routing", () => {
  type ManualChunks = (id: string) => string | undefined;

  function manualChunks(): ManualChunks {
    const build = (config as { build?: unknown }).build as
      | {
          rollupOptions?: {
            output?: { manualChunks?: ManualChunks };
          };
          chunkSizeWarningLimit?: unknown;
        }
      | undefined;
    const fn = build?.rollupOptions?.output?.manualChunks;
    expect(typeof fn).toBe("function");
    return fn as ManualChunks;
  }

  it("routes three into vendor-three", () => {
    expect(manualChunks()("project/node_modules/three/src/Three.js")).toBe(
      "vendor-three",
    );
  });

  it("routes rapier compat into vendor-rapier", () => {
    expect(
      manualChunks()(
        "project/node_modules/@dimforge/rapier3d-compat/rapier.es.js",
      ),
    ).toBe("vendor-rapier");
  });

  it("leaves app code unchunked", () => {
    expect(manualChunks()("project/web/src/main.ts")).toBeUndefined();
  });

  it("keeps the honest 500 kB warning tripwire", () => {
    const build = (config as { build?: unknown }).build as {
      chunkSizeWarningLimit?: unknown;
    };
    expect(build?.chunkSizeWarningLimit).toBe(500);
  });
});

describe("vec parity", () => {
  it("yawToQuat(0) is the identity quaternion", () => {
    expect(yawToQuat(0)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(yawToQuat(0)).toEqual(IDENTITY_QUAT);
  });

  it("rotateVecByQuat preserves the yaw axis exactly", () => {
    expect(rotateVecByQuat({ x: 0, y: 1, z: 0 }, yawToQuat(1.23))).toEqual({
      x: 0,
      y: 1,
      z: 0,
    });
  });

  it("rotateVecByQuat turns forward into back over half a turn", () => {
    const out = rotateVecByQuat({ x: 0, y: 0, z: -1 }, yawToQuat(Math.PI));
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.y).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(1, 10);
  });

  it("resetCandidates stays non-empty with the base first", () => {
    const out = resetCandidates({ x: 0, y: 0, z: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("matches the world re-export number-for-number", () => {
    expect(worldYawToQuat(0.7)).toEqual(yawToQuat(0.7));
    expect(worldResetCandidates({ x: 1, y: 2, z: 3 })).toEqual(
      resetCandidates({ x: 1, y: 2, z: 3 }),
    );
  });
});
