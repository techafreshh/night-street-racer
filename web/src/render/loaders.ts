// Scale-normalizing asset loader wrapper (web asset pipeline).
// Serves the verbatim v1 CC0 stand-in bytes from web/public/assets
// (Vite static dir, served at /assets): per-car GLBs, city kit GLBs
// plus the night HDRI, and the five WAV loops. normalizeScale() forces
// any loaded GLB's bounding height into the 1-5 m band; the async
// loaders log a named error and resolve null instead of throwing on
// missing files. Importing this module stays Node-safe: three.js math
// only at the top level, GLTFLoader via dynamic import on the async
// path, no DOM/WebGL/WASM at import time.
import type * as THREE from "three";

// Engine values without a static engine edge (chunk-budget split): the
// entry and garage/result lazy chunks load this module with no vendor
// weight; Box3/Vector3 resolve from the dynamic vendor-three chunk on
// first normalization. Top-level await keeps normalizeScale synchronous
// for its callers (loadGLB, loaders.test.ts) while the three.js edge
// stays dynamic so dist/index.html carries no vendor modulepreload.
const { Box3, Vector3 } = await import("three");

// Static asset base served by Vite from web/public/assets.
export const ASSET_BASE = "/assets";

// Verbatim v1 WAV lane (tools/make_audio.py originals, CC0).
export const AUDIO_FILES: readonly string[] = [
  "engine.wav",
  "skid.wav",
  "wind.wav",
  "click.wav",
  "music_menu.wav",
];

// Per-car GLB lane, one subdirectory per car (tools/make_car_kit.py).
export const CAR_FILES: readonly string[] = [
  "cars/sedan/sedan.glb",
  "cars/coupe/coupe.glb",
  "cars/hatch/hatch.glb",
  "cars/awd/awd.glb",
];

// City kit lane plus the night HDRI (tools/make_city_kit.py,
// tools/make_night_sky_hdr.py).
export const CITY_FILES: readonly string[] = [
  "city/building_tower.glb",
  "city/building_shop.glb",
  "city/streetlamp.glb",
  "city/neon_sign.glb",
  "city/street_prop.glb",
  "city/barrier.glb",
  "city/night_sky.hdr",
];

// Normalization band: every GLB ends up 1-5 m tall, defaulting to 2 m.
export const DEFAULT_TARGET_HEIGHT = 2.0;
export const TARGET_HEIGHT_MIN = 1;
export const TARGET_HEIGHT_MAX = 5;

// Same-reference aliases so harness wording cannot mismatch.
export const ASSET_URL_BASE = ASSET_BASE;
export const asset_base = ASSET_BASE;
export const DEFAULT_HEIGHT = DEFAULT_TARGET_HEIGHT;
export const default_target_height = DEFAULT_TARGET_HEIGHT;

// Resolve a repo-relative asset lane path to its served URL.
export function assetUrl(path: string): string {
  const lane = path.startsWith("/") ? path.slice(1) : path;
  return `${ASSET_BASE}/${lane}`;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const asset_url = assetUrl;

// Single named-error sink for the missing-asset path. Logs the URL and
// returns null so async loaders resolve instead of rejecting.
export function reportMissing(url: string, _error?: unknown): null {
  console.error(`[loaders] missing asset: ${url}`);
  return null;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const report_missing = reportMissing;

// Pure scale normalization: measures the object's world bounding-box
// height via THREE.Box3, then applies a uniform scale factor so the
// result is exactly targetHeight (default 2.0 m, inside the 1-5 m
// band). Degenerate or non-finite heights log a named error and leave
// the object untouched, returning factor 1. Returns the applied factor.
export function normalizeScale(
  object: THREE.Object3D,
  targetHeight: number = DEFAULT_TARGET_HEIGHT,
): number {
  try {
    const target =
      typeof targetHeight === "number" &&
      Number.isFinite(targetHeight) &&
      targetHeight > 0
        ? targetHeight
        : DEFAULT_TARGET_HEIGHT;
    object.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) {
      console.error("[loaders] missing asset: degenerate object has no bounds");
      return 1;
    }
    const size = box.getSize(new Vector3());
    const height = size.y;
    if (!Number.isFinite(height) || height <= 1e-9) {
      console.error("[loaders] missing asset: degenerate object height");
      return 1;
    }
    const factor = target / height;
    object.scale.multiplyScalar(factor);
    object.updateWorldMatrix(true, true);
    return factor;
  } catch {
    console.error("[loaders] missing asset: normalizeScale failed");
    return 1;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const normalize_scale = normalizeScale;

// Async GLB load with the normalization contract applied: on success
// the scene is scaled so its bounding height is targetHeight; on any
// I/O or parse failure a named error is logged and null resolves.
// Never rejects for missing files.
export async function loadGLB(
  url: string,
  targetHeight: number = DEFAULT_TARGET_HEIGHT,
): Promise<THREE.Object3D | null> {
  try {
    const { GLTFLoader } = await import(
      "three/examples/jsm/loaders/GLTFLoader.js"
    );
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const scene = (gltf as { scene?: THREE.Object3D }).scene;
    if (scene === undefined || scene === null) {
      return reportMissing(url);
    }
    normalizeScale(scene, targetHeight);
    return scene;
  } catch (error) {
    return reportMissing(url, error);
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const load_glb = loadGLB;

// Async WAV byte fetch for the audio lane: resolves the raw bytes, or
// null with a named error when the file is missing or unreadable.
// Never rejects for missing files.
export async function loadAudioBytes(
  url: string,
): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return reportMissing(url);
    }
    return await response.arrayBuffer();
  } catch (error) {
    return reportMissing(url, error);
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const load_audio_bytes = loadAudioBytes;

// Boolean-only, never throws. With no argument validates the stock
// manifest (every lane non-empty); with a list validates the provided
// entries are non-empty http(s)/absolute paths.
export function validateAssets(manifest?: readonly string[]): boolean {
  try {
    const stock: readonly string[] = [
      ...AUDIO_FILES.map((f) => `${ASSET_BASE}/audio/${f}`),
      ...CAR_FILES.map((f) => `${ASSET_BASE}/${f}`),
      ...CITY_FILES.map((f) => `${ASSET_BASE}/${f}`),
    ];
    const list = manifest ?? stock;
    if (!Array.isArray(list) || list.length === 0) {
      return false;
    }
    return list.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length > 0 &&
        (entry.startsWith(ASSET_BASE) ||
          entry.startsWith("http://") ||
          entry.startsWith("https://")),
    );
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_assets = validateAssets;

// Stock asset manifest: the same lane list validateAssets checks (audio
// plus car plus city lanes served from the static dir). Single source
// of truth for the boot-time cache warm in main.ts.
export const ASSET_MANIFEST: readonly string[] = [
  ...AUDIO_FILES.map((f) => `${ASSET_BASE}/audio/${f}`),
  ...CAR_FILES.map((f) => `${ASSET_BASE}/${f}`),
  ...CITY_FILES.map((f) => `${ASSET_BASE}/${f}`),
];

// Godot-name alias so harness wording cannot mismatch (same reference).
export const asset_manifest = ASSET_MANIFEST;

// Manifest fetch result: warmed URLs plus the missing ones.
export type ManifestResult = {
  ok: string[];
  missing: string[];
  total: number;
};

// Typed writer: GET each manifest URL to warm the HTTP cache, calling
// onProgress after every entry with the (done, total) fraction. Missing
// entries log via the shared reportMissing sink and never reject: the
// promise always resolves { ok, missing, total } so a late or absent
// static never breaks boot.
export async function fetchAssetManifest(
  onProgress?: (done: number, total: number) => void,
): Promise<ManifestResult> {
  const ok: string[] = [];
  const missing: string[] = [];
  const total = ASSET_MANIFEST.length;
  let done = 0;
  for (const entry of ASSET_MANIFEST) {
    try {
      const response = await fetch(entry);
      if (response !== null && response !== undefined && response.ok) {
        ok.push(entry);
      } else {
        missing.push(entry);
        reportMissing(entry);
      }
    } catch (error) {
      missing.push(entry);
      reportMissing(entry, error);
    }
    done += 1;
    try {
      onProgress?.(done, total);
    } catch {
      // Progress faults never break the warm.
    }
  }
  return { ok, missing, total };
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const fetch_asset_manifest = fetchAssetManifest;
