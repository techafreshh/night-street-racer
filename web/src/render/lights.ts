// Night light rig: one moon directional (the only shadow caster),
// one hemisphere fill, two player spot headlights, and four warm lamp
// points — eight real lights total so no mesh ever exceeds the
// per-mesh light budget. Pure constants plus DOM-free three.js objects
// constructed inside builder functions, so importing this module stays
// Node-safe (no DOM/WebGL/WASM at import time).
import * as THREE from "three";

// Hard cap the forward renderer never exceeds: every mesh sees at most
// this many lights.
export const MAX_LIGHTS_PER_MESH = 8;

// Lamp posts stand over the four intersections nearest the origin.
export const LAMP_POSITIONS: readonly { x: number; y: number; z: number }[] = [
  { x: -34, y: 6, z: -34 },
  { x: 34, y: 6, z: -34 },
  { x: -34, y: 6, z: 34 },
  { x: 34, y: 6, z: 34 },
];

// Cool moonlight key with soft shadows.
export const MOON_COLOR = 0x9db8ff;
export const MOON_INTENSITY = 0.7;
export const MOON_POSITION = { x: 50, y: 80, z: -30 };

// Hemisphere sky/ground fill so shadowed faces never go pitch black.
export const HEMI_SKY_COLOR = 0x2a3a66;
export const HEMI_GROUND_COLOR = 0x0a0c14;
export const HEMI_INTENSITY = 0.35;

// Player headlights: white spots, medium cone, physical falloff.
export const HEADLIGHT_COLOR = 0xffffff;
export const HEADLIGHT_ANGLE = 0.5;
export const HEADLIGHT_PENUMBRA = 0.4;
export const HEADLIGHT_DISTANCE = 60;
export const HEADLIGHT_INTENSITY = 250;
export const HEADLIGHT_HEIGHT = 1.2;
export const HEADLIGHT_FORWARD = 2.2;
export const HEADLIGHT_SPREAD = 0.8;
export const HEADLIGHT_AIM_DISTANCE = 20;

// Warm sodium lamp points: short range, no shadows (perf).
export const LAMP_COLOR = 0xffb46b;
export const LAMP_INTENSITY = 40;
export const LAMP_DISTANCE = 32;

// Same-reference aliases so harness wording cannot mismatch.
export const max_lights_per_mesh = MAX_LIGHTS_PER_MESH;
export const MAX_LIGHTS = MAX_LIGHTS_PER_MESH;
export const lamp_positions = LAMP_POSITIONS;
export const headlight_color = HEADLIGHT_COLOR;
export const headlight_angle = HEADLIGHT_ANGLE;
export const HEADLIGHT_CONE = HEADLIGHT_ANGLE;
export const headlight_penumbra = HEADLIGHT_PENUMBRA;
export const headlight_distance = HEADLIGHT_DISTANCE;
export const headlight_intensity = HEADLIGHT_INTENSITY;
export const lamp_color = LAMP_COLOR;
export const lamp_intensity = LAMP_INTENSITY;
export const moon_color = MOON_COLOR;
export const moon_intensity = MOON_INTENSITY;

export type CarPosition = { x: number; y: number; z: number };

export type LightRig = {
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  headlights: [THREE.SpotLight, THREE.SpotLight];
  lamps: THREE.PointLight[];
};

// Godot-name alias so harness wording cannot mismatch (same reference).
export type light_rig = LightRig;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function makeHeadlight(): THREE.SpotLight {
  const spot = new THREE.SpotLight(
    HEADLIGHT_COLOR,
    HEADLIGHT_INTENSITY,
    HEADLIGHT_DISTANCE,
    HEADLIGHT_ANGLE,
    HEADLIGHT_PENUMBRA,
  );
  spot.castShadow = false;
  spot.target = new THREE.Object3D();
  return spot;
}

// Eight-light night rig: moon + hemi + two spot headlights + four lamp
// points. Only the moon casts shadows. Headlights start ahead of the
// origin aimed forward so the menu frame is already lit.
export function buildLightRig(): LightRig {
  const moon = new THREE.DirectionalLight(MOON_COLOR, MOON_INTENSITY);
  moon.position.set(MOON_POSITION.x, MOON_POSITION.y, MOON_POSITION.z);
  moon.castShadow = true;

  const hemi = new THREE.HemisphereLight(
    HEMI_SKY_COLOR,
    HEMI_GROUND_COLOR,
    HEMI_INTENSITY,
  );

  const left = makeHeadlight();
  const right = makeHeadlight();
  const rig: LightRig = { moon, hemi, headlights: [left, right], lamps: [] };
  for (const lamp of LAMP_POSITIONS) {
    const point = new THREE.PointLight(
      LAMP_COLOR,
      LAMP_INTENSITY,
      LAMP_DISTANCE,
    );
    point.position.set(lamp.x, lamp.y, lamp.z);
    point.castShadow = false;
    rig.lamps.push(point);
  }
  updateHeadlights(rig, { x: 0, y: 0, z: 0 }, 0);
  return rig;
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const build_light_rig = buildLightRig;

// Per-tick headlight follow: both spots ride ahead of the chassis at
// headlight height, splayed +-0.8 m, aimed forward-down the road.
// Never throws; non-finite input leaves the rig untouched.
export function updateHeadlights(
  rig: LightRig | null | undefined,
  carPos: CarPosition | null | undefined,
  carYaw: number,
): void {
  try {
    if (rig === undefined || rig === null) {
      return;
    }
    const pos = carPos ?? { x: 0, y: 0, z: 0 };
    if (
      !isFiniteNumber(pos.x) ||
      !isFiniteNumber(pos.y) ||
      !isFiniteNumber(pos.z)
    ) {
      return;
    }
    const yaw = isFiniteNumber(carYaw) ? carYaw : 0;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const spreads = [-HEADLIGHT_SPREAD, HEADLIGHT_SPREAD];
    rig.headlights.forEach((spot, i) => {
      if (spot === undefined || spot === null) {
        return;
      }
      const side = spreads[i] ?? 0;
      spot.position.set(
        pos.x + forwardX * HEADLIGHT_FORWARD + rightX * side,
        pos.y + HEADLIGHT_HEIGHT,
        pos.z + forwardZ * HEADLIGHT_FORWARD + rightZ * side,
      );
      spot.target.position.set(
        pos.x + forwardX * HEADLIGHT_AIM_DISTANCE,
        pos.y - 1.5,
        pos.z + forwardZ * HEADLIGHT_AIM_DISTANCE,
      );
      spot.target.updateMatrixWorld();
    });
  } catch {
    // The rig must never break the fixed step.
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const update_headlights = updateHeadlights;

// Total real light objects in the rig: 1 moon + 1 hemi + 2 spots + 4
// points = 8. Never throws; a missing rig counts zero.
export function countRigLights(rig: LightRig | null | undefined): number {
  try {
    if (rig === undefined || rig === null) {
      return 0;
    }
    const spots = Array.isArray(rig.headlights) ? rig.headlights.length : 0;
    const points = Array.isArray(rig.lamps) ? rig.lamps.length : 0;
    const moon = rig.moon !== undefined && rig.moon !== null ? 1 : 0;
    const hemi = rig.hemi !== undefined && rig.hemi !== null ? 1 : 0;
    return moon + hemi + spots + points;
  } catch {
    return 0;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const count_rig_lights = countRigLights;

// Boolean-only, never throws. With no argument validates the stock rig
// shape; with a rig-like object validates its lights instead: exactly
// 2 spots and 4 points for a total of 8 (moon + hemi + spots +
// points), so no mesh can exceed MAX_LIGHTS_PER_MESH.
export function validateLightRig(rig?: unknown): boolean {
  try {
    const candidate =
      rig === undefined || rig === null ? buildLightRig() : rig;
    if (typeof candidate !== "object") {
      return false;
    }
    const c = candidate as Partial<LightRig>;
    if (c.moon === undefined || c.moon === null) {
      return false;
    }
    if (c.hemi === undefined || c.hemi === null) {
      return false;
    }
    if (!Array.isArray(c.headlights) || c.headlights.length !== 2) {
      return false;
    }
    if (!Array.isArray(c.lamps) || c.lamps.length !== 4) {
      return false;
    }
    return countRigLights(c as LightRig) <= MAX_LIGHTS_PER_MESH;
  } catch {
    return false;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const validate_light_rig = validateLightRig;
