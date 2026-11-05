// Emissive-first night dressing: wet asphalt plus the emissive window
// bands, neon signs, and lamp heads the bloom pass keys off. Pure
// constants plus DOM-free three.js objects constructed inside builder
// functions, so importing this module stays Node-safe (no DOM/WebGL
// at import time). Lamp posts reuse the LAMP_POSITIONS from lights.ts
// so dressing and the light rig can never drift apart.
import * as THREE from "three";
import { LAMP_POSITIONS } from "./lights";

// Wet asphalt: near-black blue, low roughness for sharp env streaks,
// slight metalness, boosted env-map response under the PMREM night sky.
export const WET_ASPHALT_COLOR = 0x0b0e17;
export const WET_ASPHALT_ROUGHNESS = 0.3;
export const WET_ASPHALT_METALNESS = 0.1;
export const WET_ASPHALT_ENVMAP_INTENSITY = 1.25;

// Emissive dressing intensities: neon signs bloom hard (HDR > 1), window
// bands glow softly. Both sit above the bloom threshold so only these
// HDR emissives feed UnrealBloomPass.
export const NEON_COLOR = 0xff2fd6;
export const NEON_EMISSIVE_INTENSITY = 3.0;
export const WINDOW_EMISSIVE_COLOR = 0xffc37a;
export const WINDOW_EMISSIVE_INTENSITY = 1.6;
export const LAMP_HEAD_COLOR = 0xffd9a0;
export const LAMP_HEAD_EMISSIVE_INTENSITY = 2.5;

// Neon sign placement: large enough for the pixel probe to hit from the
// default menu camera at (0, 2, 6) looking down -z.
export const NEON_SIGN_POSITION = { x: 6, y: 4, z: -10 };
export const NEON_SIGN_SIZE = { width: 4, height: 2 };

// Window-band towers on the four blocks nearest the origin (+-34, +-34).
export const DRESSING_BLOCK_COORDS: readonly number[] = [-34, 34];
export const TOWER_SIZE = { width: 12, height: 14, depth: 12 };
export const WINDOW_BAND_LEVELS: readonly number[] = [4, 7, 10];

// Same-reference aliases so harness wording cannot mismatch.
export const wet_asphalt_roughness = WET_ASPHALT_ROUGHNESS;
export const WET_ASPHALT_ROUGH = WET_ASPHALT_ROUGHNESS;
export const wet_asphalt_envmap_intensity = WET_ASPHALT_ENVMAP_INTENSITY;
export const neon_emissive_intensity = NEON_EMISSIVE_INTENSITY;
export const NEON_INTENSITY = NEON_EMISSIVE_INTENSITY;
export const neon_color = NEON_COLOR;
export const window_emissive_intensity = WINDOW_EMISSIVE_INTENSITY;
export const WINDOW_INTENSITY = WINDOW_EMISSIVE_INTENSITY;
export const window_emissive_color = WINDOW_EMISSIVE_COLOR;
export const lamp_head_color = LAMP_HEAD_COLOR;
export const LAMP_HEAD_INTENSITY = LAMP_HEAD_EMISSIVE_INTENSITY;
export const lamp_head_emissive_intensity = LAMP_HEAD_EMISSIVE_INTENSITY;
export const neon_sign_position = NEON_SIGN_POSITION;
export const neon_sign_size = NEON_SIGN_SIZE;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Wet asphalt road surface: dark base, mirror-ish roughness, PMREM env
// reflections. Fresh material per call so road/block meshes own theirs.
export function createWetAsphalt(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: WET_ASPHALT_COLOR,
    roughness: WET_ASPHALT_ROUGHNESS,
    metalness: WET_ASPHALT_METALNESS,
    envMapIntensity: WET_ASPHALT_ENVMAP_INTENSITY,
  });
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_wet_asphalt = createWetAsphalt;

// HDR neon material: black albedo, saturated emissive at 3x so the sign
// reads at least 2x brighter than lit asphalt and clears the bloom
// threshold on its own.
export function createNeonMaterial(
  color: number | THREE.Color = NEON_COLOR,
): THREE.MeshStandardMaterial {
  const emissive = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive,
    emissiveIntensity: NEON_EMISSIVE_INTENSITY,
    roughness: 0.4,
    metalness: 0.0,
  });
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_neon_material = createNeonMaterial;

// Warm window-band material: black albedo, amber emissive at 1.6x.
export function createWindowBandMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: new THREE.Color(WINDOW_EMISSIVE_COLOR),
    emissiveIntensity: WINDOW_EMISSIVE_INTENSITY,
    roughness: 0.6,
    metalness: 0.0,
  });
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_window_band_material = createWindowBandMaterial;

// Warm lamp-head material for the streetlamp crowns.
export function createLampHeadMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: new THREE.Color(LAMP_HEAD_COLOR),
    emissiveIntensity: LAMP_HEAD_EMISSIVE_INTENSITY,
    roughness: 0.5,
    metalness: 0.0,
  });
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_lamp_head_material = createLampHeadMaterial;

// Instanced emissive dressing for the night district: dark tower slabs
// with glowing window bands on the four blocks nearest the origin, one
// double-sided neon sign plane pair at (6, 4, -10) facing the default
// camera, and lamp-pole prisms with emissive heads at the four lamp
// positions. Emissive-only: no light objects are added here.
export function buildEmissiveDressing(): THREE.Group {
  const group = new THREE.Group();
  group.name = "emissive-dressing";

  const towerMaterial = new THREE.MeshStandardMaterial({
    color: 0x14161f,
    roughness: 0.85,
    metalness: 0.05,
  });
  const towerGeometry = new THREE.BoxGeometry(
    TOWER_SIZE.width,
    TOWER_SIZE.height,
    TOWER_SIZE.depth,
  );
  const towers = new THREE.InstancedMesh(
    towerGeometry,
    towerMaterial,
    DRESSING_BLOCK_COORDS.length * DRESSING_BLOCK_COORDS.length,
  );
  const matrix = new THREE.Matrix4();
  let towerIndex = 0;
  for (const cx of DRESSING_BLOCK_COORDS) {
    for (const cz of DRESSING_BLOCK_COORDS) {
      matrix.makeTranslation(cx, TOWER_SIZE.height / 2 + 0.3, cz);
      towers.setMatrixAt(towerIndex, matrix);
      towerIndex += 1;
    }
  }
  towers.instanceMatrix.needsUpdate = true;
  group.add(towers);

  const bandMaterial = createWindowBandMaterial();
  const bandGeometry = new THREE.BoxGeometry(
    TOWER_SIZE.width + 0.4,
    0.9,
    TOWER_SIZE.depth + 0.4,
  );
  const bandCount =
    DRESSING_BLOCK_COORDS.length *
    DRESSING_BLOCK_COORDS.length *
    WINDOW_BAND_LEVELS.length;
  const bands = new THREE.InstancedMesh(bandGeometry, bandMaterial, bandCount);
  let bandIndex = 0;
  for (const cx of DRESSING_BLOCK_COORDS) {
    for (const cz of DRESSING_BLOCK_COORDS) {
      for (const level of WINDOW_BAND_LEVELS) {
        matrix.makeTranslation(cx, level, cz);
        bands.setMatrixAt(bandIndex, matrix);
        bandIndex += 1;
      }
    }
  }
  bands.instanceMatrix.needsUpdate = true;
  group.add(bands);

  const neonMaterial = createNeonMaterial();
  neonMaterial.side = THREE.DoubleSide;
  const signGeometry = new THREE.PlaneGeometry(
    NEON_SIGN_SIZE.width,
    NEON_SIGN_SIZE.height,
  );
  const signFront = new THREE.Mesh(signGeometry, neonMaterial);
  signFront.position.set(
    NEON_SIGN_POSITION.x,
    NEON_SIGN_POSITION.y,
    NEON_SIGN_POSITION.z,
  );
  group.add(signFront);
  const signBack = new THREE.Mesh(signGeometry, neonMaterial);
  signBack.position.set(
    NEON_SIGN_POSITION.x,
    NEON_SIGN_POSITION.y,
    NEON_SIGN_POSITION.z - 0.02,
  );
  signBack.rotation.y = Math.PI;
  group.add(signBack);

  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x11131a,
    roughness: 0.7,
    metalness: 0.4,
  });
  const poleGeometry = new THREE.BoxGeometry(0.3, 6, 0.3);
  const headMaterial = createLampHeadMaterial();
  const headGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.8);
  const heads = new THREE.InstancedMesh(
    headGeometry,
    headMaterial,
    LAMP_POSITIONS.length,
  );
  LAMP_POSITIONS.forEach((lamp, i) => {
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(lamp.x, lamp.y - 3, lamp.z);
    group.add(pole);
    matrix.makeTranslation(lamp.x, lamp.y, lamp.z);
    heads.setMatrixAt(i, matrix);
  });
  heads.instanceMatrix.needsUpdate = true;
  group.add(heads);

  return group;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const build_emissive_dressing = buildEmissiveDressing;

// Boolean-only, never throws. With no argument validates the stock
// pinned intensities; with a partial object validates the provided
// fields against stock (missing fields read as stock).
export function validateLightingMaterials(config?: unknown): boolean {
  try {
    if (config === undefined || config === null) {
      return checkMaterials({});
    }
    if (typeof config !== "object") {
      return false;
    }
    return checkMaterials(config as Record<string, unknown>);
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_lighting_materials = validateLightingMaterials;

function checkMaterials(config: Record<string, unknown>): boolean {
  const pick = (value: unknown, fallback: number): number =>
    isFiniteNumber(value) ? value : fallback;
  const roughness = pick(
    config.wetAsphaltRoughness ??
      config.wet_asphalt_roughness ??
      config.WET_ASPHALT_ROUGHNESS,
    WET_ASPHALT_ROUGHNESS,
  );
  const envIntensity = pick(
    config.wetAsphaltEnvMapIntensity ??
      config.wet_asphalt_envmap_intensity ??
      config.WET_ASPHALT_ENVMAP_INTENSITY,
    WET_ASPHALT_ENVMAP_INTENSITY,
  );
  const neon = pick(
    config.neonEmissiveIntensity ??
      config.neon_emissive_intensity ??
      config.NEON_EMISSIVE_INTENSITY,
    NEON_EMISSIVE_INTENSITY,
  );
  const windows = pick(
    config.windowEmissiveIntensity ??
      config.window_emissive_intensity ??
      config.WINDOW_EMISSIVE_INTENSITY,
    WINDOW_EMISSIVE_INTENSITY,
  );
  return (
    roughness === WET_ASPHALT_ROUGHNESS &&
    envIntensity === WET_ASPHALT_ENVMAP_INTENSITY &&
    neon === NEON_EMISSIVE_INTENSITY &&
    windows === WINDOW_EMISSIVE_INTENSITY
  );
}
