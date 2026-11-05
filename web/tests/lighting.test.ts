// Lighting rig acceptance suite (duplicate-mutate-reject idiom:
// green on stock, red on one bad-bound mutation per dimension).
// Covers the issue contract with no padding: ACES tone mapping export,
// bloom threshold/strength/radius pins, neon-vs-asphalt luminance ratio
// proxy (>= 2x), the 8-light rig shape with exactly 2 spots and 4
// points, the FogExp2 density pin, and boolean-only validators green
// on stock and red on one mutated field each. Node-safe: no renderer,
// composer, or environment construction.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  BLOOM_RADIUS,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  PASS_NAMES,
  bloom_radius,
  bloom_strength,
  bloom_threshold,
  pass_names,
  validateComposerConfig,
  validate_composer_config,
} from "../src/render/composer";
import {
  HEADLIGHT_ANGLE,
  HEADLIGHT_DISTANCE,
  HEADLIGHT_PENUMBRA,
  LAMP_POSITIONS,
  MAX_LIGHTS_PER_MESH,
  buildLightRig,
  build_light_rig,
  countRigLights,
  count_rig_lights,
  lamp_positions,
  max_lights_per_mesh,
  updateHeadlights,
  update_headlights,
  validateLightRig,
  validate_light_rig,
} from "../src/render/lights";
import {
  NEON_EMISSIVE_INTENSITY,
  NEON_SIGN_POSITION,
  WET_ASPHALT_ENVMAP_INTENSITY,
  WET_ASPHALT_ROUGHNESS,
  WINDOW_EMISSIVE_INTENSITY,
  buildEmissiveDressing,
  build_emissive_dressing,
  createNeonMaterial,
  createWetAsphalt,
  createWindowBandMaterial,
  create_neon_material,
  create_wet_asphalt,
  create_window_band_material,
  neon_emissive_intensity,
  validateLightingMaterials,
  validate_lighting_materials,
  wet_asphalt_roughness,
  window_emissive_intensity,
} from "../src/render/materials";
import {
  TONE_MAPPING,
  TONE_MAPPING_EXPOSURE,
  tone_mapping,
  tone_mapping_exposure,
} from "../src/render/renderer";
import {
  FOG_COLOR,
  FOG_DENSITY,
  fog_color,
  fog_density,
  createFog,
  create_fog,
  validateSky,
  validate_sky,
} from "../src/render/sky";

// Relative luminance of a working-space color.
function luminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

describe("tone mapping", () => {
  it("pins the ACES filmic export and exposure", () => {
    expect(TONE_MAPPING).toBe(THREE.ACESFilmicToneMapping);
    expect(TONE_MAPPING_EXPOSURE).toBe(1.1);
    expect(tone_mapping).toBe(TONE_MAPPING);
    expect(tone_mapping_exposure).toBe(TONE_MAPPING_EXPOSURE);
  });
});

describe("bloom pass parameters", () => {
  it("thresholds at 1.0 so only HDR emissives bloom", () => {
    expect(BLOOM_THRESHOLD).toBe(1.0);
    expect(BLOOM_THRESHOLD).toBeGreaterThanOrEqual(1.0);
    expect(bloom_threshold).toBe(BLOOM_THRESHOLD);
  });

  it("keeps strength in (0, 1.5] and radius in [0, 1]", () => {
    expect(BLOOM_STRENGTH).toBeGreaterThan(0);
    expect(BLOOM_STRENGTH).toBeLessThanOrEqual(1.5);
    expect(BLOOM_RADIUS).toBeGreaterThanOrEqual(0);
    expect(BLOOM_RADIUS).toBeLessThanOrEqual(1);
    expect(bloom_strength).toBe(BLOOM_STRENGTH);
    expect(bloom_radius).toBe(BLOOM_RADIUS);
  });

  it("names the RenderPass -> UnrealBloomPass -> OutputPass chain", () => {
    expect([...PASS_NAMES]).toEqual([
      "RenderPass",
      "UnrealBloomPass",
      "OutputPass",
    ]);
    expect(pass_names).toBe(PASS_NAMES);
  });

  it("validates the stock config and rejects a low threshold", () => {
    expect(validateComposerConfig()).toBe(true);
    expect(validateComposerConfig({})).toBe(true);
    expect(validateComposerConfig({ threshold: 0.2 })).toBe(false);
    expect(validateComposerConfig({ strength: 5 })).toBe(false);
    expect(validate_composer_config).toBe(validateComposerConfig);
  });
});

describe("wet asphalt and emissive materials", () => {
  it("pins the wet asphalt response", () => {
    expect(WET_ASPHALT_ROUGHNESS).toBe(0.3);
    expect(WET_ASPHALT_ENVMAP_INTENSITY).toBe(1.25);
    expect(wet_asphalt_roughness).toBe(WET_ASPHALT_ROUGHNESS);
    const asphalt = createWetAsphalt();
    expect(asphalt.roughness).toBe(0.3);
    expect(asphalt.envMapIntensity).toBe(1.25);
    expect(create_wet_asphalt).toBe(createWetAsphalt);
  });

  it("pins the emissive intensities above the bloom threshold", () => {
    expect(NEON_EMISSIVE_INTENSITY).toBe(3.0);
    expect(WINDOW_EMISSIVE_INTENSITY).toBe(1.6);
    expect(neon_emissive_intensity).toBe(NEON_EMISSIVE_INTENSITY);
    expect(window_emissive_intensity).toBe(WINDOW_EMISSIVE_INTENSITY);
    expect(createNeonMaterial().emissiveIntensity).toBe(3.0);
    expect(createWindowBandMaterial().emissiveIntensity).toBe(1.6);
    expect(create_neon_material).toBe(createNeonMaterial);
    expect(create_window_band_material).toBe(createWindowBandMaterial);
  });

  it("reads the neon sign at least 2x brighter than asphalt", () => {
    const asphalt = createWetAsphalt();
    const neon = createNeonMaterial();
    const asphaltGlow = luminance(asphalt.color);
    const neonGlow =
      neon.emissiveIntensity * luminance(neon.emissive as THREE.Color);
    expect(asphaltGlow).toBeGreaterThan(0);
    expect(neonGlow / asphaltGlow).toBeGreaterThanOrEqual(2);
  });

  it("dresses a double-sided neon sign at (6, 4, -10)", () => {
    const dressing = buildEmissiveDressing();
    expect(dressing).toBeInstanceOf(THREE.Group);
    const signs: THREE.Mesh[] = [];
    dressing.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        Math.abs(child.position.x - NEON_SIGN_POSITION.x) < 1e-6 &&
        Math.abs(child.position.y - NEON_SIGN_POSITION.y) < 1e-6 &&
        Math.abs(child.position.z - NEON_SIGN_POSITION.z) < 0.1
      ) {
        signs.push(child);
      }
    });
    expect(signs.length).toBeGreaterThanOrEqual(2);
    for (const sign of signs) {
      const material = sign.material as THREE.MeshStandardMaterial;
      expect(material.emissiveIntensity).toBeGreaterThanOrEqual(2);
    }
    expect(build_emissive_dressing).toBe(buildEmissiveDressing);
  });

  it("validates stock materials and rejects a dimmed neon", () => {
    expect(validateLightingMaterials()).toBe(true);
    expect(validateLightingMaterials({})).toBe(true);
    expect(
      validateLightingMaterials({ neonEmissiveIntensity: 0.5 }),
    ).toBe(false);
    expect(validateLightingMaterials({ wetAsphaltRoughness: 0.9 })).toBe(
      false,
    );
    expect(validate_lighting_materials).toBe(validateLightingMaterials);
  });
});

describe("eight-light rig", () => {
  it("caps the per-mesh budget at 8", () => {
    expect(MAX_LIGHTS_PER_MESH).toBe(8);
    expect(max_lights_per_mesh).toBe(MAX_LIGHTS_PER_MESH);
  });

  it("builds 1 moon + 1 hemi + 2 spots + 4 points", () => {
    const rig = buildLightRig();
    expect(countRigLights(rig)).toBe(8);
    expect(countRigLights(rig)).toBeLessThanOrEqual(MAX_LIGHTS_PER_MESH);
    expect(rig.headlights).toHaveLength(2);
    expect(rig.lamps).toHaveLength(4);
    expect(LAMP_POSITIONS).toHaveLength(4);
    expect(lamp_positions).toBe(LAMP_POSITIONS);
    expect(build_light_rig).toBe(buildLightRig);
    expect(count_rig_lights).toBe(countRigLights);
  });

  it("casts shadows from the moon only", () => {
    const rig = buildLightRig();
    expect(rig.moon.castShadow).toBe(true);
    for (const spot of rig.headlights) {
      expect(spot.castShadow).toBe(false);
    }
    for (const lamp of rig.lamps) {
      expect(lamp.castShadow).toBe(false);
    }
  });

  it("shapes the headlight cone per the pinned constants", () => {
    const rig = buildLightRig();
    for (const spot of rig.headlights) {
      expect(spot.angle).toBeCloseTo(HEADLIGHT_ANGLE, 5);
      expect(spot.penumbra).toBeCloseTo(HEADLIGHT_PENUMBRA, 5);
      expect(spot.distance).toBe(HEADLIGHT_DISTANCE);
    }
    expect(HEADLIGHT_ANGLE).toBe(0.5);
  });

  it("follows the car without throwing on bad input", () => {
    const rig = buildLightRig();
    const before = rig.headlights[0].position.clone();
    updateHeadlights(rig, { x: 10, y: 0, z: 5 }, Math.PI / 2);
    expect(rig.headlights[0].position.equals(before)).toBe(false);
    for (const spot of rig.headlights) {
      expect(Number.isFinite(spot.position.x)).toBe(true);
      expect(Number.isFinite(spot.position.z)).toBe(true);
      expect(Number.isFinite(spot.target.position.x)).toBe(true);
    }
    expect(() => updateHeadlights(null, { x: 0, y: 0, z: 0 }, 0)).not.toThrow();
    expect(() =>
      updateHeadlights(rig, { x: 0, y: 0, z: 0 }, Number.NaN),
    ).not.toThrow();
    expect(update_headlights).toBe(updateHeadlights);
  });

  it("validates the stock rig and rejects a ninth light", () => {
    expect(validateLightRig()).toBe(true);
    expect(validateLightRig(buildLightRig())).toBe(true);
    const rig = buildLightRig();
    expect(
      validateLightRig({
        ...rig,
        lamps: [...rig.lamps, new THREE.PointLight()],
      }),
    ).toBe(false);
    expect(
      validateLightRig({ ...rig, headlights: [rig.headlights[0]] }),
    ).toBe(false);
    expect(validate_light_rig).toBe(validateLightRig);
  });
});

describe("fog and sky", () => {
  it("pins exponential fog in the deep-blue ink", () => {
    const fog = createFog();
    expect(fog).toBeInstanceOf(THREE.FogExp2);
    expect(fog.density).toBe(FOG_DENSITY);
    expect(fog.density).toBe(0.006);
    expect(fog.color.getHex()).toBe(FOG_COLOR);
    expect(fog_color).toBe(FOG_COLOR);
    expect(fog_density).toBe(FOG_DENSITY);
    expect(create_fog).toBe(createFog);
  });

  it("validates the stock sky and rejects a thick fog mutation", () => {
    expect(validateSky()).toBe(true);
    expect(validateSky({})).toBe(true);
    expect(validateSky({ fogDensity: 0.5 })).toBe(false);
    expect(validateSky({ fog_density: 0.5 })).toBe(false);
    expect(validate_sky).toBe(validateSky);
  });
});
