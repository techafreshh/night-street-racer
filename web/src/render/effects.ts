// three.js FX scene layer (scripts/fx/ scene idiom): instanced smoke
// billboards, a preallocated skid-mark ribbon, brake-light material
// sync, and the countdown/finish hinge flash. Construction happens only
// inside builder functions so importing this module stays Node-safe
// (no DOM/WebGL at import time); the pure pooled state lives in
// vehicles/fx.ts next to the simulation it mirrors.
import * as THREE from "three";
import {
  BRAKE_OFF_INTENSITY,
  SKID_FADE_TIME,
  SKID_MAX_SEGMENTS,
  SMOKE_LIFETIME,
  SMOKE_MAX,
  type BrakeLights,
  type SkidTrail,
  type SmokePool,
} from "../vehicles/fx";

// Hinge-flash decay, per second: a full flash clears in ~0.4 s.
export const FLASH_DECAY = 2.5;
// Smoke billboard base size, in metres.
export const SMOKE_SIZE = 1.0;
// Skid ribbon lift above the asphalt, in metres (z-fighting guard).
export const SKID_LIFT = 0.02;

// Same-reference aliases so harness wording cannot mismatch.
export const flash_decay = FLASH_DECAY;
export const smoke_size = SMOKE_SIZE;
export const skid_lift = SKID_LIFT;
export const FLASH_OVERLAY_ID = "nsr-flash";
export const flash_overlay_id = FLASH_OVERLAY_ID;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0.0) {
    return 1 / 60;
  }
  return dt;
}

// Instanced smoke billboards over the pool budget: one plane per puff,
// billboarding left to the per-frame camera pass (positions/scales come
// from syncSmoke). Fresh mesh per call so scenes own theirs.
export function buildSmokeBillboards(
  poolSize: number = SMOKE_MAX,
): THREE.InstancedMesh {
  const size =
    Number.isInteger(poolSize) && poolSize > 0 ? poolSize : SMOKE_MAX;
  const geometry = new THREE.PlaneGeometry(SMOKE_SIZE, SMOKE_SIZE);
  const material = new THREE.MeshBasicMaterial({
    color: 0x9aa0a8,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, size);
  mesh.name = "smoke-billboards";
  mesh.frustumCulled = false;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < size; i += 1) {
    mesh.setMatrixAt(i, zero);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Godot-name alias (same reference).
export const build_smoke_billboards = buildSmokeBillboards;

const smokeDummy = new THREE.Object3D();
const smokeAt = { x: 0.0, y: 0.0, z: 0.0 };

// Write the live pool into the billboard instances: alive puffs grow
// with age (0.6x fresh to ~2.2x spent), dead slots collapse to zero
// scale. Never throws; a size mismatch syncs the overlap only.
export function syncSmoke(
  mesh: THREE.InstancedMesh | null | undefined,
  pool: SmokePool | null | undefined,
): void {
  try {
    if (mesh === null || mesh === undefined) {
      return;
    }
    if (pool === null || pool === undefined) {
      return;
    }
    const size = Math.min(mesh.count, pool.capacity);
    for (let i = 0; i < size; i += 1) {
      if (pool.isAlive(i)) {
        pool.puffPosition(i, smokeAt);
        const t = pool.puffAge(i) / SMOKE_LIFETIME;
        const s = SMOKE_SIZE * (0.6 + 1.6 * Math.min(Math.max(t, 0), 1));
        smokeDummy.position.set(smokeAt.x, smokeAt.y, smokeAt.z);
        smokeDummy.scale.set(s, s, s);
        smokeDummy.rotation.set(0, 0, 0);
      } else {
        smokeDummy.position.set(0, 0, 0);
        smokeDummy.scale.set(0, 0, 0);
        smokeDummy.rotation.set(0, 0, 0);
      }
      smokeDummy.updateMatrix();
      mesh.setMatrixAt(i, smokeDummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  } catch {
    // Scene sync must never break the fixed step.
  }
}

// Godot-name alias (same reference).
export const sync_smoke = syncSmoke;

// Skid ribbon over the trail budget: a preallocated LineSegments pair
// (left/right contact per rung) with DynamicDrawUsage, so per-frame
// syncs upload but never reallocate. Fresh mesh per call.
export function buildSkidMesh(
  capacity: number = SKID_MAX_SEGMENTS,
): THREE.LineSegments {
  const rungs =
    Number.isInteger(capacity) && capacity > 0 ? capacity : SKID_MAX_SEGMENTS;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(rungs * 2 * 3);
  const colors = new Float32Array(rungs * 2 * 3);
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("color", colorAttr);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = "skid-marks";
  mesh.frustumCulled = false;
  mesh.userData.capacity = rungs;
  return mesh;
}

// Godot-name alias (same reference).
export const build_skid_mesh = buildSkidMesh;

// Write the live trail into the ribbon: rung endpoints sit SKID_LIFT
// above the asphalt and darken toward the fade horizon. Never throws.
export function syncSkids(
  mesh: THREE.LineSegments | null | undefined,
  trail: SkidTrail | null | undefined,
): void {
  try {
    if (mesh === null || mesh === undefined) {
      return;
    }
    if (trail === null || trail === undefined) {
      return;
    }
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positionAttr = geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    const colorAttr = geometry.getAttribute("color") as
      | THREE.BufferAttribute
      | undefined;
    if (positionAttr === undefined || colorAttr === undefined) {
      return;
    }
    const rawCapacity = (mesh.userData as { capacity?: unknown }).capacity;
    const budget =
      typeof rawCapacity === "number" && Number.isInteger(rawCapacity) && rawCapacity > 0
        ? rawCapacity
        : Math.floor(positionAttr.count / 2);
    const count = Math.min(trail.segmentCount, budget);
    for (let i = 0; i < count; i += 1) {
      const rung = trail.segment(i);
      if (rung === null) {
        continue;
      }
      const shade = 0.16 * (1 - Math.min(Math.max(rung.age / SKID_FADE_TIME, 0), 1));
      positionAttr.setXYZ(i * 2, rung.left.x, rung.left.y + SKID_LIFT, rung.left.z);
      positionAttr.setXYZ(i * 2 + 1, rung.right.x, rung.right.y + SKID_LIFT, rung.right.z);
      colorAttr.setXYZ(i * 2, shade, shade, shade);
      colorAttr.setXYZ(i * 2 + 1, shade, shade, shade);
    }
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geometry.setDrawRange(0, count * 2);
  } catch {
    // Scene sync must never break the fixed step.
  }
}

// Godot-name alias (same reference).
export const sync_skids = syncSkids;

// Brake-light material: near-black albedo, red emissive at the released
// level. Fresh material per call so cars own theirs.
export function createBrakeLightMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x1a0505,
    emissive: new THREE.Color(0xff1a1a),
    emissiveIntensity: BRAKE_OFF_INTENSITY,
    roughness: 0.4,
    metalness: 0.0,
  });
}

// Godot-name alias (same reference).
export const create_brake_light_material = createBrakeLightMaterial;

// Copy the simulated brake level onto the material. Never throws.
export function syncBrakeLight(
  material: THREE.MeshStandardMaterial | null | undefined,
  brakes: BrakeLights | null | undefined,
): void {
  try {
    if (material === null || material === undefined) {
      return;
    }
    if (brakes === null || brakes === undefined) {
      return;
    }
    material.emissiveIntensity = brakes.emissiveIntensity;
  } catch {
    // Scene sync must never break the fixed step.
  }
}

// Godot-name alias (same reference).
export const sync_brake_light = syncBrakeLight;

// Countdown/finish hinge flash: a numeric level (1 flash, decaying to 0
// at FLASH_DECAY per second) plus a DOM overlay div sink. Pure math on
// the level; the overlay write stays behind try/catch so Node stays safe.
export class HingeFlash {
  private strength = 0.0;

  get level(): number {
    return this.strength;
  }

  get flash_level(): number {
    return this.strength;
  }

  flash(strength = 1.0): void {
    const kick = isFiniteNumber(strength) && strength > 0.0 ? strength : 1.0;
    this.strength = Math.max(this.strength, Math.min(kick, 1.0));
  }

  update(dt: number): void {
    const step = safeDt(dt);
    this.strength = Math.max(0.0, this.strength - FLASH_DECAY * step);
    if (this.strength < 1e-4) {
      this.strength = 0.0;
    }
  }

  reset(): void {
    this.strength = 0.0;
  }
}

// Godot-name alias (same reference).
export const Hinge_flash = HingeFlash;

// DOM sink for the hinge flash: one fixed full-screen div, looked up by
// id or created on demand. Returns null (never throws) when no document
// is available, so Node/vitest stays DOM-free.
export function ensureFlashOverlay(
  doc?: Document | null,
): HTMLElement | null {
  try {
    const root: Document | null =
      doc ?? (typeof document !== "undefined" ? document : null);
    if (root === null || root === undefined) {
      return null;
    }
    const body = (root as Document).body;
    if (body === null || body === undefined) {
      return null;
    }
    const existing = root.getElementById(FLASH_OVERLAY_ID);
    if (existing instanceof HTMLElement) {
      return existing;
    }
    const overlay = root.createElement("div");
    overlay.id = FLASH_OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.background = "#ffffff";
    overlay.style.opacity = "0";
    overlay.style.zIndex = "40";
    body.appendChild(overlay);
    return overlay;
  } catch {
    return null;
  }
}

// Godot-name alias (same reference).
export const ensure_flash_overlay = ensureFlashOverlay;

// Write the numeric flash level into the overlay div. Never throws.
export function syncFlashOverlay(
  overlay: HTMLElement | null | undefined,
  level: number,
): void {
  try {
    if (overlay === null || overlay === undefined) {
      return;
    }
    const value = isFiniteNumber(level)
      ? Math.min(Math.max(level, 0), 1)
      : 0;
    overlay.style.opacity = String(value);
  } catch {
    // DOM sync must never break the fixed step.
  }
}

// Godot-name alias (same reference).
export const sync_flash_overlay = syncFlashOverlay;

// Boolean-only, never throws. With no argument validates the stock
// pinned budgets; with a partial object validates the provided fields
// against stock (missing fields read as stock).
export function validateEffectsConfig(config?: unknown): boolean {
  try {
    if (config === undefined || config === null) {
      return checkEffects({});
    }
    if (typeof config !== "object") {
      return false;
    }
    return checkEffects(config as Record<string, unknown>);
  } catch {
    return false;
  }
}

// Godot-name alias (same reference).
export const validate_effects_config = validateEffectsConfig;

function checkEffects(config: Record<string, unknown>): boolean {
  const pick = (value: unknown, fallback: number): number =>
    isFiniteNumber(value) ? value : fallback;
  const smoke = pick(
    config.smokeMax ?? config.smoke_max ?? config.SMOKE_MAX,
    SMOKE_MAX,
  );
  const skids = pick(
    config.skidMax ?? config.skid_max ?? config.SKID_MAX_SEGMENTS,
    SKID_MAX_SEGMENTS,
  );
  const decay = pick(
    config.flashDecay ?? config.flash_decay ?? config.FLASH_DECAY,
    FLASH_DECAY,
  );
  return (
    smoke === SMOKE_MAX && skids === SKID_MAX_SEGMENTS && decay === FLASH_DECAY
  );
}
