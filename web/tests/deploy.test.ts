// Static deploy contract suite (duplicate-mutate-reject idiom: green
// on stock, red on one bad-bound mutation per dimension). Covers the
// issue #228 portable-build contract with no padding: the Vite base
// stays root-absolute ("/") so the built bundle agrees with the
// public dir and ASSET_BASE ("/assets") for dist/, Pages, and
// unzip-and-serve from /, the out dir stays dist/ with a clean empty, every imported
// byte stays a same-origin file (no inline data URIs), and every
// GLB/WAV/HDR lane URL stays same-origin (no http(s) CDN). Node-safe:
// reads the config object and the loader constants, no build output.
import { describe, expect, it } from "vitest";
import config from "../vite.config";
import {
  ASSET_BASE,
  ASSET_MANIFEST,
  assetUrl,
  validateAssets,
} from "../src/render/loaders";

type BuildConfig = {
  outDir?: unknown;
  emptyOutDir?: unknown;
  assetsInlineLimit?: unknown;
};

function buildOf(cfg: unknown): BuildConfig {
  return ((cfg as { build?: BuildConfig }).build ?? {}) as BuildConfig;
}

describe("portable vite base", () => {
  it("serves every built URL root-absolute", () => {
    expect((config as { base?: unknown }).base).toBe("/");
  });

  it("emits a clean dist/ of same-origin files", () => {
    const build = buildOf(config);
    expect(build.outDir).toBe("dist");
    expect(build.emptyOutDir).toBe(true);
    expect(build.assetsInlineLimit).toBe(0);
  });
});

describe("same-origin asset lanes", () => {
  it("keeps the static base off any CDN", () => {
    expect(typeof ASSET_BASE).toBe("string");
    expect(ASSET_BASE.startsWith("http://")).toBe(false);
    expect(ASSET_BASE.startsWith("https://")).toBe(false);
  });

  it("resolves every manifest lane same-origin", () => {
    expect(ASSET_MANIFEST.length).toBeGreaterThan(0);
    for (const entry of ASSET_MANIFEST) {
      expect(entry.startsWith("http://")).toBe(false);
      expect(entry.startsWith("https://")).toBe(false);
      expect(entry.startsWith(ASSET_BASE)).toBe(true);
    }
    expect(assetUrl("city/night_sky.hdr")).toBe(
      `${ASSET_BASE}/city/night_sky.hdr`,
    );
    expect(validateAssets()).toBe(true);
    expect(validateAssets([...ASSET_MANIFEST])).toBe(true);
  });
});
