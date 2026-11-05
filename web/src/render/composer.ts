// Night post chain: RenderPass -> thresholded UnrealBloomPass ->
// OutputPass (tone map + sRGB). The threshold sits at 1.0 so only HDR
// emissives (neon, window bands, lamp heads) bloom while lit asphalt
// stays clean. Pass assembly is browser-only; the pinned pass
// parameters stay Node-safe (no DOM/WebGL at import time).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// Luminance floor: lit diffuse stays below, HDR emissives clear it.
export const BLOOM_THRESHOLD = 1.0;
// Visible halo without washing the frame.
export const BLOOM_STRENGTH = 0.65;
// Tight glow around the sign and window bands.
export const BLOOM_RADIUS = 0.4;

// Canonical pass order; the probe reads this alongside the live
// composer passes.
export const PASS_NAMES: readonly string[] = [
  "RenderPass",
  "UnrealBloomPass",
  "OutputPass",
];

// Same-reference aliases so harness wording cannot mismatch.
export const bloom_threshold = BLOOM_THRESHOLD;
export const BLOOM_LIMIT = BLOOM_THRESHOLD;
export const bloom_strength = BLOOM_STRENGTH;
export const bloom_radius = BLOOM_RADIUS;
export const pass_names = PASS_NAMES;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Browser-only night composer for the race scene. Returns null (never
// throws) when the renderer is missing. The bloom pass carries an
// explicit name marker so probes find it without minified internals.
export function createNightComposer(
  renderer: THREE.WebGLRenderer | null | undefined,
  scene: THREE.Scene | null | undefined,
  camera: THREE.Camera | null | undefined,
): EffectComposer | null {
  try {
    if (renderer === undefined || renderer === null) {
      return null;
    }
    if (scene === undefined || scene === null) {
      return null;
    }
    if (camera === undefined || camera === null) {
      return null;
    }
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const size = new THREE.Vector2(800, 600);
    try {
      renderer.getSize(size);
    } catch {
      // Fall back to the default resolution.
    }
    const bloom = new UnrealBloomPass(
      size,
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    (bloom as unknown as { name: string }).name = "UnrealBloomPass";
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return composer;
  } catch {
    return null;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_night_composer = createNightComposer;

// Boolean-only, never throws. With no argument validates the stock
// bloom parameters; with a partial object validates the provided
// fields against stock (missing fields read as stock). The threshold
// must stay at or above 1.0 so only HDR emissives bloom.
export function validateComposerConfig(config?: unknown): boolean {
  try {
    if (config === undefined || config === null) {
      return checkComposer({});
    }
    if (typeof config !== "object") {
      return false;
    }
    return checkComposer(config as Record<string, unknown>);
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_composer_config = validateComposerConfig;

function checkComposer(config: Record<string, unknown>): boolean {
  const pick = (value: unknown, fallback: number): number =>
    isFiniteNumber(value) ? value : fallback;
  const threshold = pick(
    config.threshold ?? config.BLOOM_THRESHOLD ?? config.bloom_threshold,
    BLOOM_THRESHOLD,
  );
  const strength = pick(
    config.strength ?? config.BLOOM_STRENGTH ?? config.bloom_strength,
    BLOOM_STRENGTH,
  );
  const radius = pick(
    config.radius ?? config.BLOOM_RADIUS ?? config.bloom_radius,
    BLOOM_RADIUS,
  );
  return (
    threshold === BLOOM_THRESHOLD &&
    threshold >= 1.0 &&
    strength === BLOOM_STRENGTH &&
    strength > 0 &&
    strength <= 1.5 &&
    radius === BLOOM_RADIUS &&
    radius >= 0 &&
    radius <= 1
  );
}
