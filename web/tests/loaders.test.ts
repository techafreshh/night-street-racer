// Loaders acceptance suite: proves the issue #213 contract with no
// padding -- 100x-scale GLBs normalize into the 1-5 m band, degenerate
// input returns factor 1 with a named error, missing URLs resolve null
// with the URL in the logged error, the audio lane holds >= 3 WAVs,
// and docs/CREDITS names Kenney and Poly Haven.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TARGET_HEIGHT,
  loadGLB,
  normalize_scale,
  normalizeScale,
  TARGET_HEIGHT_MAX,
  TARGET_HEIGHT_MIN,
  validateAssets,
} from "../src/render/loaders";

const testDir = dirname(fileURLToPath(import.meta.url));
const audioDir = join(testDir, "..", "public", "assets", "audio");
const creditsPath = join(testDir, "..", "..", "docs", "CREDITS");

function boundingHeight(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, true);
  const size = new THREE.Box3()
    .setFromObject(object)
    .getSize(new THREE.Vector3());
  return size.y;
}

describe("normalizeScale", () => {
  it("lands a 100x-scale GLB inside 1-5 m", () => {
    const group = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.5, 4.2),
      new THREE.MeshBasicMaterial(),
    );
    box.scale.setScalar(100);
    group.add(box);
    expect(boundingHeight(group)).toBeGreaterThan(100);
    const factor = normalizeScale(group);
    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThan(1);
    const height = boundingHeight(group);
    expect(height).toBeGreaterThanOrEqual(TARGET_HEIGHT_MIN);
    expect(height).toBeLessThanOrEqual(TARGET_HEIGHT_MAX);
    expect(height).toBeCloseTo(DEFAULT_TARGET_HEIGHT, 6);
  });

  it("returns factor 1 with a named error for degenerate input", () => {
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });
    try {
      const factor = normalizeScale(new THREE.Group());
      expect(factor).toBe(1);
      expect(errors.some((line) => line.includes("[loaders]"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("exposes the normalize_scale alias by reference", () => {
    expect(normalize_scale).toBe(normalizeScale);
  });
});

describe("loadGLB missing-asset path", () => {
  it("resolves null and names the URL", async () => {
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });
    try {
      const missing = "/assets/missing-probe-model.glb";
      const result = await loadGLB(missing);
      expect(result).toBeNull();
      expect(
        errors.some(
          (line) => line.includes("[loaders]") && line.includes(missing),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("asset lanes", () => {
  it("serves at least 3 WAVs", () => {
    const wavs = readdirSync(audioDir).filter((f) => f.endsWith(".wav"));
    expect(wavs.length).toBeGreaterThanOrEqual(3);
  });

  it("credits Kenney and Poly Haven", () => {
    const text = readFileSync(creditsPath, "utf8");
    expect(text).toContain("Kenney");
    expect(text).toContain("Poly Haven");
  });

  it("validateAssets accepts the stock manifest", () => {
    expect(validateAssets()).toBe(true);
    expect(validateAssets([])).toBe(false);
  });
});
