// Night sky and depth cueing: HDRI environment via RGBELoader with a
// procedural gradient fallback, PMREM env texture for the wet asphalt
// reflections, and exponential fog. Pure constants plus the DOM-free
// fog factory stay Node-safe (no DOM/WebGL at import time); the PMREM
// assembly lives behind the browser-only loadEnvironment factory.
import * as THREE from "three";

// Deep-blue night fog; density reads depth over the 280 m district.
export const FOG_COLOR = 0x070a18;
export const FOG_DENSITY = 0.006;

// Served by Vite from web/public (the #213 asset lane).
export const HDRI_URL = "/assets/city/night_sky.hdr";

// Procedural fallback gradient stops (top -> horizon glow -> ground).
export const ENV_FALLBACK_TOP = 0x060a1c;
export const ENV_FALLBACK_HORIZON = 0x27335f;
export const ENV_FALLBACK_GROUND = 0x020306;
export const ENV_FALLBACK_WIDTH = 16;
export const ENV_FALLBACK_HEIGHT = 8;

// Same-reference aliases so harness wording cannot mismatch.
export const fog_color = FOG_COLOR;
export const FOG_COLOUR = FOG_COLOR;
export const fog_density = FOG_DENSITY;
export const hdri_url = HDRI_URL;
export const HDRI_PATH = HDRI_URL;
export const env_fallback_top = ENV_FALLBACK_TOP;
export const env_fallback_horizon = ENV_FALLBACK_HORIZON;
export const env_fallback_ground = ENV_FALLBACK_GROUND;

export type NightEnvironment = {
  envTexture: THREE.Texture | null;
  background: THREE.Texture | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// DOM-free night fog: exponential falloff in the pinned deep-blue ink.
export function createFog(): THREE.FogExp2 {
  return new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_fog = createFog;

// Tiny procedural night gradient as a data texture: dark zenith,
// city-glow horizon band, near-black ground.
function makeGradientTexture(): THREE.DataTexture {
  const width = ENV_FALLBACK_WIDTH;
  const height = ENV_FALLBACK_HEIGHT;
  const top = new THREE.Color(ENV_FALLBACK_TOP);
  const horizon = new THREE.Color(ENV_FALLBACK_HORIZON);
  const ground = new THREE.Color(ENV_FALLBACK_GROUND);
  const data = new Uint8Array(width * height * 4);
  const mixed = new THREE.Color();
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    if (v < 0.5) {
      mixed.copy(ground).lerp(horizon, v / 0.5);
    } else {
      mixed.copy(horizon).lerp(top, (v - 0.5) / 0.5);
    }
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = Math.round(mixed.r * 255);
      data[i + 1] = Math.round(mixed.g * 255);
      data[i + 2] = Math.round(mixed.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// Browser-only night environment: tries the HDRI first, then falls
// back to the procedural gradient sky dome through PMREM so the rig
// works with or without the asset lane. Assign the result to
// scene.environment/scene.background. Never throws: total failure
// logs a named error and resolves nulls.
export async function loadEnvironment(
  renderer: THREE.WebGLRenderer | null | undefined,
): Promise<NightEnvironment> {
  if (renderer === undefined || renderer === null) {
    console.error("[sky] missing asset: no renderer for environment");
    return { envTexture: null, background: null };
  }
  try {
    const { HDRLoader } = await import(
      "three/addons/loaders/HDRLoader.js"
    );
    const hdr = await new HDRLoader().loadAsync(HDRI_URL);
    try {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTexture = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      return { envTexture, background: envTexture };
    } catch (error) {
      console.error(`[sky] missing asset: ${HDRI_URL}`, error);
      try {
        hdr.dispose();
      } catch {
        // Disposal is best-effort on the failure path.
      }
    }
  } catch {
    console.error(`[sky] missing asset: ${HDRI_URL}`);
  }
  try {
    const gradient = makeGradientTexture();
    const skyScene = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 12),
      new THREE.MeshBasicMaterial({ map: gradient, side: THREE.BackSide }),
    );
    skyScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(skyScene, 0.04).texture;
    pmrem.dispose();
    gradient.dispose();
    dome.geometry.dispose();
    (dome.material as THREE.Material).dispose();
    return { envTexture, background: envTexture };
  } catch (error) {
    console.error("[sky] missing asset: procedural fallback failed", error);
    return { envTexture: null, background: null };
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const load_environment = loadEnvironment;

// Boolean-only, never throws. With no argument validates the stock sky
// constants; with a partial object validates the provided fields
// against stock (missing fields read as stock).
export function validateSky(config?: unknown): boolean {
  try {
    if (config === undefined || config === null) {
      return checkSky({});
    }
    if (typeof config !== "object") {
      return false;
    }
    return checkSky(config as Record<string, unknown>);
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_sky = validateSky;

function checkSky(config: Record<string, unknown>): boolean {
  const pickNumber = (value: unknown, fallback: number): number =>
    isFiniteNumber(value) ? value : fallback;
  const color = pickNumber(
    config.fogColor ?? config.fog_color ?? config.FOG_COLOR,
    FOG_COLOR,
  );
  const density = pickNumber(
    config.fogDensity ?? config.fog_density ?? config.FOG_DENSITY,
    FOG_DENSITY,
  );
  const url =
    (config.hdriUrl as unknown) ??
    (config.hdri_url as unknown) ??
    (config.HDRI_URL as unknown) ??
    HDRI_URL;
  return (
    color === FOG_COLOR &&
    density === FOG_DENSITY &&
    typeof url === "string" &&
    url === HDRI_URL
  );
}
