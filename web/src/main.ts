import type * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { EventEmitter, createRaceEmitter, type RaceEvents } from "./core/events";
import { STEP_DT, createFpsMeter, start, type LoopHandle } from "./core/loop";
import { Router } from "./core/router";
import { getTune } from "./data/tunes";
import { IDENTITY_QUAT, rotateVecByQuat, type Quat, type Vec3 } from "./physics/vec";
import type { PhysicsWorld } from "./physics/world";
import type {
  Vehicle,
  VehicleInputs,
  VehicleState,
  PlayerInputSource,
} from "./vehicles/vehicle";
import { input, type PlayerInput } from "./vehicles/input";
import {
  ChaseCamera,
  FOV_MIN,
  fovForSpeed,
  lagWeight,
  shakeOffset,
  type CameraPose,
  type CameraSample,
} from "./vehicles/camera";
import { VehicleFX, rearSkidAnchors, type FxSample } from "./vehicles/fx";
import type { HingeFlash } from "./render/effects";
import {
  SAVE_KEY,
  SAVE_VERSION,
  SCHEMA_VERSION,
  defaultSave,
  loadSave,
  saveNow,
  validateSave,
} from "./game/save";
import {
  LADDER,
  REWARD_CARS,
  applyResult,
  canUnlockNext,
  carReward,
  isCarUnlockedWith,
  isEventUnlocked,
  isUnlockedWith,
  mappedCar,
  nextEventAfter,
  unlockedCars,
  unlockedEvents,
} from "./game/progression";
import * as recordsApi from "./game/records";
import { SettingsStore, settings } from "./game/settings";
import {
  audio as audioManager,
  DUCK_DB as AUDIO_DUCK_DB,
  DUCK_GAIN as AUDIO_DUCK_GAIN,
  engineRate as audioEngineRate,
  IDLE_RPM as AUDIO_IDLE_RPM,
  levelToGain as audioLevelToGain,
  MAX_ENGINE_RPM as AUDIO_MAX_ENGINE_RPM,
  MUTE_FLOOR as AUDIO_MUTE_FLOOR,
  SKID_FULL as AUDIO_SKID_FULL,
  SKID_THRESHOLD as AUDIO_SKID_THRESHOLD,
  skidGain as audioSkidGain,
  WIND_FULL_SPEED as AUDIO_WIND_FULL_SPEED,
  windGain as audioWindGain,
  type AudioNamespace,
} from "./game/audio";

import { GameState, gameState } from "./game/state";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { LightRig } from "./render/lights";
import { Traffic, sharedTraffic, type CarState, type TrafficCar } from "./traffic/traffic";
import * as hud from "./ui/hud";
import * as minimap from "./ui/minimap";
import { renderMenu } from "./ui/menu";
import { attachPause } from "./ui/pause";
import {
  failLoading,
  hideLoading,
  renderLoading,
  setLoadingProgress,
} from "./ui/loading";
import { getEvent } from "./data/events";
import * as drift from "./race/drift";
import * as order from "./race/order";
import * as positions from "./race/positions";
import * as timetrial from "./race/timetrial";
import { manager as raceManager, type RaceManager } from "./race/manager";
import {
  armGridForEvent,
  grid,
  type GridBuildOpts,
  type GridPoint,
  type RaceGrid,
  type RivalState,
} from "./race/grid";
import * as raceRoute from "./race/route";
import * as aiInputMod from "./ai/ai_input";
import * as racingLine from "./ai/racing_line";
import * as rubberBandMod from "./ai/rubber_band";

// Probe-facing handles for the v1 save/progression system: bundled so the
// running service exposes the same load/save behavior the issue pins to
// localStorage["nsr_save"]. Read-only besides explicit setter/flush calls.
declare global {
  interface Window {
    __fixedSteps: number;
    setPaused: (paused: boolean) => void;
    pause: (paused: boolean) => void;
    __setPaused: (paused: boolean) => void;
    __raceEmitter: EventEmitter<RaceEvents>;
    __emitter: EventEmitter<RaceEvents>;
    __input: PlayerInput;
    __city: CityNamespace;
    __nsr: {
      save: {
        SAVE_KEY: string;
        SAVE_VERSION: number;
        SCHEMA_VERSION: number;
        defaultSave: typeof defaultSave;
        validateSave: typeof validateSave;
        loadSave: typeof loadSave;
        saveNow: typeof saveNow;
      };
      progression: {
        LADDER: string[];
        REWARD_CARS: string[];
        nextEventAfter: typeof nextEventAfter;
        mappedCar: typeof mappedCar;
        canUnlockNext: typeof canUnlockNext;
        carReward: typeof carReward;
        applyResult: typeof applyResult;
        unlockedEvents: typeof unlockedEvents;
        unlockedCars: typeof unlockedCars;
        isUnlockedWith: typeof isUnlockedWith;
        isEventUnlocked: typeof isEventUnlocked;
        isCarUnlockedWith: typeof isCarUnlockedWith;
      };
      records: typeof recordsApi;
      startRace: (eventId: string) => void;
      settings: SettingsStore;
      gameState: GameState;
      input: PlayerInput;
      race: {
        order: typeof order;
        positions: typeof positions;
        drift: typeof drift;
        timetrial: typeof timetrial;
        manager: RaceManager;
        route: typeof raceRoute;
        grid: GridNamespace;
      };
      ai: AiNamespace;
      traffic: TrafficNamespace;
      camera: CameraNamespace;
      city: CityNamespace;
      lighting: LightingNamespace;
      loaders: typeof import("./render/loaders");
      hud: hud.HudNamespace;
      audio: AudioNamespace;
      minimap: minimap.MinimapNamespace;
      fx: FxNamespace;
      vehicle?: VehicleNamespace;
      physics?: PhysicsNamespace;
    };
  }
}

// Staged engine handles (chunk-budget split): every engine value import
// that used to sit at the top level now resolves through these module
// handles, populated by bootEngineStages() automatically right after the
// menu paints. The entry chunk therefore carries only the DOM shell,
// router, pure game/race/AI math, and HUD plumbing; the vendor chunks
// download post-menu with no modulepreload links. Every reader below
// degrades to identical pure fallbacks until its stage lands, and never
// throws.
type EngineHandles = {
  rapier: typeof import("@dimforge/rapier3d-compat").default | null;
  physics: typeof import("./physics/world") | null;
  vehicleMod: typeof import("./vehicles/vehicle") | null;
  three: typeof import("three") | null;
  city: typeof import("./render/city") | null;
  effects: typeof import("./render/effects") | null;
  composer: typeof import("./render/composer") | null;
  lights: typeof import("./render/lights") | null;
  materials: typeof import("./render/materials") | null;
  rendererMod: typeof import("./render/renderer") | null;
  sky: typeof import("./render/sky") | null;
  loadersMod: typeof import("./render/loaders") | null;
  perf: typeof import("./render/perf") | null;
};

const engine: EngineHandles = {
  rapier: null,
  physics: null,
  vehicleMod: null,
  three: null,
  city: null,
  effects: null,
  composer: null,
  lights: null,
  materials: null,
  rendererMod: null,
  sky: null,
  loadersMod: null,
  perf: null,
};

// Pure fallbacks behind the staged getters (chunk-budget split): the
// probe namespaces publish synchronously at menu paint, before the
// vendor chunks land, so each engine constant mirrored here matches its
// source module value verbatim (district grid truth in render/city.ts,
// pass order in render/composer.ts, light budget in render/lights.ts,
// ACES tone mapping in render/renderer.ts). Getters below prefer the
// live module and read these only while its stage loads.
const FALLBACK_ROAD_CENTERLINES: readonly number[] = [-136, -68, 0, 68, 136];
const FALLBACK_BLOCK_CENTERS: readonly number[] = [-102, -34, 34, 102];
const FALLBACK_PASS_NAMES: readonly string[] = [
  "RenderPass",
  "UnrealBloomPass",
  "OutputPass",
];
const FALLBACK_MAX_LIGHTS_PER_MESH = 8;
const FALLBACK_TONE_MAPPING = 4;
const FALLBACK_ROAD_EW_LIP = 0.02;
const FALLBACK_ROAD_WIDTH = 8.0;
const FALLBACK_PITCH = 68.0;
const FALLBACK_BLOCK_SIZE = 60.0;
const FALLBACK_DISTRICT_HALF = 140.0;

// Stock-shape grid check mirroring render/city.ts checkGrid verbatim
// (same fields, aliases, and finite-number picks) so the pre-stage
// validateCityGrid fallback rejects non-stock grids exactly as the
// live module does once stage C lands.

// Analytic ground-top fallback mirroring render/city.ts groundTopY
// (EW road strips carry the anti-z-fighting lip, datum elsewhere).
function fallbackGroundTopY(x: number, z: number): number {
  try {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return 0;
    }
    const onRoad = FALLBACK_ROAD_CENTERLINES.some(
      (c) => Math.abs(z - c) <= FALLBACK_ROAD_WIDTH / 2 + 1e-9,
    );
    return onRoad ? FALLBACK_ROAD_EW_LIP : 0;
  } catch {
    return 0;
  }
}

function fallbackCheckGrid(grid: Record<string, unknown>): boolean {
  const pick = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const pitch = pick(grid.pitch ?? grid.PITCH, FALLBACK_PITCH);
  const blockSize = pick(
    grid.blockSize ?? grid.block_size ?? grid.BLOCK_SIZE,
    FALLBACK_BLOCK_SIZE,
  );
  const roadWidth = pick(
    grid.roadWidth ?? grid.road_width ?? grid.ROAD_WIDTH,
    FALLBACK_ROAD_WIDTH,
  );
  const half = pick(
    grid.districtHalf ?? grid.district_half ?? grid.DISTRICT_HALF,
    FALLBACK_DISTRICT_HALF,
  );
  const lip = pick(
    grid.roadEwLip ?? grid.road_ew_lip ?? grid.ROAD_EW_LIP,
    FALLBACK_ROAD_EW_LIP,
  );
  const centers = (grid.blockCenters ??
    grid.block_centers ??
    grid.BLOCK_CENTERS ??
    FALLBACK_BLOCK_CENTERS) as unknown;
  const lines = (grid.centerlines ??
    grid.centerLines ??
    grid.roadCenterlines ??
    grid.road_centerlines ??
    grid.ROAD_CENTERLINES ??
    FALLBACK_ROAD_CENTERLINES) as unknown;
  const equals = (value: unknown, stock: readonly number[]): boolean =>
    Array.isArray(value) &&
    value.length === stock.length &&
    (value as unknown[]).every((entry, index) => entry === stock[index]);
  return (
    pitch === FALLBACK_PITCH &&
    blockSize === FALLBACK_BLOCK_SIZE &&
    roadWidth === FALLBACK_ROAD_WIDTH &&
    half === FALLBACK_DISTRICT_HALF &&
    lip === FALLBACK_ROAD_EW_LIP &&
    equals(centers, FALLBACK_BLOCK_CENTERS) &&
    equals(lines, FALLBACK_ROAD_CENTERLINES)
  );
}

// Probe-facing AI namespace: the pure racing-line / pursuit / rubber-band
// port (no vehicle or WASM init needed), so black-box probes read the same
// numbers the tests pin through window.__nsr.ai on the running service.
export type AiNamespace = {
  bakeRacingLine: typeof racingLine.bakeRacingLine;
  bake_racing_line: typeof racingLine.bake_racing_line;
  bakeSpeeds: typeof racingLine.bakeSpeeds;
  bake_speeds: typeof racingLine.bake_speeds;
  curvatureOf: typeof racingLine.curvatureOf;
  curvature_of: typeof racingLine.curvature_of;
  rawSpeed: typeof racingLine.rawSpeed;
  raw_speed: typeof racingLine.raw_speed;
  throttleCap: typeof racingLine.throttleCap;
  throttle_cap: typeof racingLine.throttle_cap;
  trackLength: typeof racingLine.trackLength;
  track_length: typeof racingLine.track_length;
  arcOf: typeof racingLine.arcOf;
  arc_of: typeof racingLine.arc_of;
  lookaheadPoint: typeof racingLine.lookaheadPoint;
  lookahead_point: typeof racingLine.lookahead_point;
  pointAtArc: typeof racingLine.pointAtArc;
  point_at_arc: typeof racingLine.point_at_arc;
  speedAtArc: typeof racingLine.speedAtArc;
  speed_at_arc: typeof racingLine.speed_at_arc;
  closestIndex: typeof racingLine.closestIndex;
  closest_index: typeof racingLine.closest_index;
  aiInput: typeof aiInputMod.aiInput;
  ai_input: typeof aiInputMod.ai_input;
  lookaheadFor: typeof aiInputMod.lookaheadFor;
  lookahead_for: typeof aiInputMod.lookahead_for;
  rubberBand: typeof rubberBandMod.rubberBand;
  rubber_band: typeof rubberBandMod.rubber_band;
  computeAid: typeof rubberBandMod.computeAid;
  compute_aid: typeof rubberBandMod.compute_aid;
  wrapGap: typeof rubberBandMod.wrapGap;
  wrap_gap: typeof rubberBandMod.wrap_gap;
  MIN_SPEED: number;
  MAX_SPEED: number;
  LATERAL_ACCEL: number;
  BRAKE_DECEL: number;
  GRIP_BUDGET: number;
  MAX_AID: number;
  GAIN: number;
};

// Probe-facing chase-camera namespace: the live ChaseCamera plus the pure
// port helpers (FOV/lag/shake math) so black-box probes can read the same
// numbers the tests pin, even before WASM/vehicle init.
export type CameraNamespace = {
  instance: ChaseCamera;
  fovForSpeed: typeof fovForSpeed;
  fov_for_speed: typeof fovForSpeed;
  lagWeight: typeof lagWeight;
  lag_weight: typeof lagWeight;
  shakeOffset: typeof shakeOffset;
  shake_offset: typeof shakeOffset;
  update: (dt: number, sample: CameraSample) => CameraPose;
  getState: () => CameraPose;
  readonly fov: number;
  readonly yaw: number;
  readonly shake: { x: number; y: number };
  readonly offset: { x: number; y: number };
  readonly position: Vec3;
  readonly lookAt: Vec3;
};

// Probe-facing starting-grid namespace: the shared kinematic rival
// fleet plus its build/advance/feed helpers, so black-box probes read
// the same headcounts, poses, and tune snapshots the tests pin through
// window.__nsr.race.grid on the running service (publishTraffic idiom:
// live getters plus dual-casing aliases).
export type GridNamespace = {
  instance: RaceGrid;
  rivals: RivalState[];
  racers: string[];
  eventId: string;
  event_id: string;
  build: (eventId: string, opts?: GridBuildOpts) => RaceGrid;
  advance: (dt?: number) => void;
  reset: () => void;
  chassisWith: (playerPos?: GridPoint | null) => GridPoint[];
  chassis_with: (playerPos?: GridPoint | null) => GridPoint[];
};

// Probe-facing traffic namespace: the live kinematic fleet plus the pure
// lane helpers behind getters, so black-box probes read the same numbers
// the tests pin (car count, speeds, poses) with either casing.
export type TrafficNamespace = {
  instance: Traffic;
  cars: TrafficCar[];
  active: boolean;
  isActive: () => boolean;
  is_active: () => boolean;
  setActive: (value: boolean) => void;
  set_active: (value: boolean) => void;
  step: (dt?: number, playerPos?: Vec3) => void;
  setBlocked: (index: number, value: boolean | null) => void;
  set_blocked: (index: number, value: boolean | null) => void;
  setBlockedOverride: (index: number, value: boolean | null) => void;
  teleportCar: (index: number, position: Vec3) => void;
  teleport_car: (index: number, position: Vec3) => void;
  setPlayerPos: (position: Vec3) => void;
  set_player_pos: (position: Vec3) => void;
  getState: (index: number) => CarState;
};

// Probe-facing vehicle namespace: the live Rapier car plus the pure
// port functions (suspension/tire/gearbox/reset math) so black-box
// probes can drive the car and read the same numbers the tests pin.
export type VehicleNamespace = {
  instance: Vehicle;
  inputs: VehicleInputs;
  step: (dt: number) => void;
  getState: () => VehicleState;
  placeAt: (position: Vec3, quat?: Quat) => void;
  setForwardSpeed: (speed: number) => void;
  reset: () => void;
  computeSuspensionForce: typeof import("./vehicles/vehicle").computeSuspensionForce;
  computeLateralForce: typeof import("./vehicles/vehicle").computeLateralForce;
  clampToFrictionCircle: typeof import("./vehicles/vehicle").clampToFrictionCircle;
  resolveLimiterOrder: typeof import("./vehicles/vehicle").resolveLimiterOrder;
  resetCandidates: typeof import("./vehicles/vehicle").resetCandidates;
  sampleTorque: typeof import("./vehicles/vehicle").sampleTorque;
};

// Probe-facing physics namespace: the Rapier world wrapper.
export type PhysicsNamespace = {
  instance: PhysicsWorld;
  stepWorld: () => void;
  findClearResetPosition: (desired: Vec3) => Vec3;
};

// Probe-facing city namespace: the built district grid (constants plus
// analytic queries) with the live Rapier city world behind getters, so
// black-box probes read the same numbers the tests pin even before
// WASM init finishes (the raycast falls back to the analytic surface).
export type CityNamespace = {
  centerlines: readonly number[];
  centerLines: readonly number[];
  blockCenters: readonly number[];
  groundTopY: (x: number, z: number) => number;
  ground_top_y: (x: number, z: number) => number;
  castRayDown: (x: number, z: number) => number | null;
  cast_ray_down: (x: number, z: number) => number | null;
  createChassis: (pos?: Vec3, linvel?: Vec3) => unknown;
  validateCityGrid: (grid?: unknown) => boolean;
  validate_city_grid: (grid?: unknown) => boolean;
  stepOnce: () => void;
  readonly world: RAPIER.World | null;
  readonly ready: boolean;
};

// Probe-facing night lighting namespace: the live renderer/composer
// plus the light rig behind getters, so black-box probes read the same
// tone mapping, pass list, and light counts the tests pin. Additive
// aliases (tone_mapping, pass_names) mirror the existing __nsr idiom.
export type LightingNamespace = {
  readonly renderer: THREE.WebGLRenderer | null;
  readonly composer: EffectComposer | null;
  readonly passes: readonly string[];
  readonly pass_names: readonly string[];
  readonly drawCalls: number;
  readonly draw_calls: number;
  readonly fps: number;
  readonly rig: LightRig | null;
  readonly counts: { total: number; maxPerMesh: number };
  readonly toneMapping: number;
  readonly tone_mapping: number;
};

// Construct the lighting probe namespace over the module rig handles.
// Live getters so probes always read the current renderer/composer.
function publishLighting(): LightingNamespace {
  return {
    get renderer(): THREE.WebGLRenderer | null {
      return nightRenderer;
    },
    get composer(): EffectComposer | null {
      return nightComposer;
    },
    get passes(): readonly string[] {
      return engine.composer?.PASS_NAMES ?? FALLBACK_PASS_NAMES;
    },
    get pass_names(): readonly string[] {
      return engine.composer?.PASS_NAMES ?? FALLBACK_PASS_NAMES;
    },
    get drawCalls(): number {
      try {
        if (engine.perf !== null) {
          return engine.perf.sampleDrawCalls(nightRenderer) ?? 0;
        }
      } catch {
        // The meter must never break probes.
      }
      return 0;
    },
    get draw_calls(): number {
      try {
        if (engine.perf !== null) {
          return engine.perf.sampleDrawCalls(nightRenderer) ?? 0;
        }
      } catch {
        // The meter must never break probes.
      }
      return 0;
    },
    get fps(): number {
      try {
        return fpsMeter.fps;
      } catch {
        return 0;
      }
    },
    get rig(): LightRig | null {
      return lightRig;
    },
    get counts(): { total: number; maxPerMesh: number } {
      try {
        if (lightRig !== null && engine.lights !== null) {
          return {
            total: engine.lights.countRigLights(lightRig),
            maxPerMesh: engine.lights.MAX_LIGHTS_PER_MESH,
          };
        }
      } catch {
        // The rig must never break probes.
      }
      return { total: 0, maxPerMesh: FALLBACK_MAX_LIGHTS_PER_MESH };
    },
    get toneMapping(): number {
      try {
        if (nightRenderer !== null && nightRenderer !== undefined) {
          const tone = nightRenderer.toneMapping;
          if (typeof tone === "number" && Number.isFinite(tone)) {
            return tone;
          }
        }
        if (engine.rendererMod !== null) {
          return engine.rendererMod.TONE_MAPPING;
        }
      } catch {
        // The rig must never break probes.
      }
      return FALLBACK_TONE_MAPPING;
    },
    get tone_mapping(): number {
      try {
        if (nightRenderer !== null && nightRenderer !== undefined) {
          const tone = nightRenderer.toneMapping;
          if (typeof tone === "number" && Number.isFinite(tone)) {
            return tone;
          }
        }
        if (engine.rendererMod !== null) {
          return engine.rendererMod.TONE_MAPPING;
        }
      } catch {
        // The rig must never break probes.
      }
      return FALLBACK_TONE_MAPPING;
    },
  };
}

// Probe-facing FX namespace: the shared VehicleFX instance (pooled smoke,
// skid ring, snap brake lights) plus the hinge-flash level, behind live
// getters so black-box probes read the same numbers the tests pin through
// window.__nsr.fx on the running service (publishTraffic idiom: one bound
// handle per method, shared by both casings).
export type FxNamespace = {
  instance: VehicleFX;
  smoke: {
    readonly activeCount: number;
    readonly active_count: number;
    clear: () => void;
  };
  skids: { readonly segmentCount: number; readonly segment_count: number };
  skidMarks: { readonly segmentCount: number; readonly segment_count: number };
  brake: {
    readonly emissiveIntensity: number;
    readonly emissive_intensity: number;
    readonly material: THREE.MeshStandardMaterial;
  };
  brakeLights: {
    readonly emissiveIntensity: number;
    readonly emissive_intensity: number;
    readonly material: THREE.MeshStandardMaterial;
  };
  readonly brakeMaterial: THREE.MeshStandardMaterial;
  readonly brake_material: THREE.MeshStandardMaterial;
  readonly smokeMesh: THREE.InstancedMesh | null;
  readonly smoke_mesh: THREE.InstancedMesh | null;
  readonly skidMesh: THREE.LineSegments | null;
  readonly skid_mesh: THREE.LineSegments | null;
  readonly flash: HingeFlash;
  readonly flashLevel: number;
  readonly flash_level: number;
  update: (dt: number, sample?: FxSample) => void;
  reset: () => void;
  clear: () => void;
  forceSlip: boolean;
  force_slip: boolean;
};

// Shared FX instance stepped by worldTick (module handle, same reference
// the probe namespace publishes).
let fxInstance: VehicleFX | null = null;
// Hinge flash behind the staged effects module (chunk-budget split): the
// module pulls three.js, so the instance materializes on first use after
// the menu paints instead of at entry evaluation. Pre-stage callers get
// a behavior-identical local fallback (same decay, same level math);
// bootEngineStages migrates the live level onto the real module instance
// so probes never see a reset.
type FlashHandle = {
  readonly level: number;
  flash: (strength?: number) => void;
  update: (dt: number) => void;
  reset: () => void;
};

const FLASH_DECAY_FALLBACK = 2.5;

function makeFallbackFlash(): FlashHandle {
  let strength = 0.0;
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  return {
    get level(): number {
      return strength;
    },
    flash: (value = 1.0): void => {
      const kick = finite(value) && value > 0.0 ? value : 1.0;
      strength = Math.max(strength, Math.min(kick, 1.0));
    },
    update: (dt: number): void => {
      const step =
        typeof dt === "number" && Number.isFinite(dt) && dt > 0 ? dt : 0;
      strength = Math.max(0.0, strength - FLASH_DECAY_FALLBACK * step);
      if (strength < 1e-4) {
        strength = 0.0;
      }
    },
    reset: (): void => {
      strength = 0.0;
    },
  };
}

let fxFlashInstance: HingeFlash | FlashHandle | null = null;

function ensureFlash(): HingeFlash | FlashHandle {
  if (fxFlashInstance === null) {
    try {
      if (engine.effects !== null) {
        fxFlashInstance = new engine.effects.HingeFlash();
      }
    } catch {
      // Headless: the fallback below keeps probes numeric.
    }
    if (fxFlashInstance === null) {
      fxFlashInstance = makeFallbackFlash();
    }
  }
  return fxFlashInstance;
}

// Swap a pre-stage fallback for the real module instance, carrying the
// live level across so the flash never visibly resets. Never throws.
function migrateFlash(): void {
  try {
    if (engine.effects !== null && fxFlashInstance !== null) {
      if (!(fxFlashInstance instanceof engine.effects.HingeFlash)) {
        const level = fxFlashInstance.level;
        const real = new engine.effects.HingeFlash();
        if (level > 0) {
          real.flash(level);
        }
        fxFlashInstance = real;
      }
    }
  } catch {
    // The fallback stays; the flash stays numeric.
  }
}
// Probe brake-light material synced from the FX brakes every tick.
// The stub keeps pre-stage probes numeric; only the real module
// material is ever cached, so the first post-stage call swaps live.
let fxBrakeMaterial: THREE.MeshStandardMaterial | null = null;
const stubBrakeMaterial = {
  emissiveIntensity: 0,
} as unknown as THREE.MeshStandardMaterial;
// Hinge-flash DOM overlay (null until boot wires the document).
let flashElement: HTMLElement | null = null;

// Probe-readable FPS meter sampled every renderFrame (issue #229):
// a numeric surface for the soak average with zero visual impact.
const fpsMeter = createFpsMeter();

// FX scene meshes mounted once in initScene (null until then); the
// worldTick FX sink syncs the live pools into them.
let smokeMesh: THREE.InstancedMesh | null = null;
let skidMesh: THREE.LineSegments | null = null;

// Scene resize teardown: drops the stored window resize listener so a
// second initScene boot (HMR/tests) cannot stack a duplicate. Delegates
// to the staged renderer helper (chunk-budget split: no static render
// value import) and never throws, even before stage C lands.
export function disposeScene(): void {
  try {
    try {
      engine.rendererMod?.disposeSceneResize();
    } catch {
      // Disposal is best-effort.
    }
  } catch {
    // Disposal never throws.
  }
}

// HMR teardown: the module swap must not stack a listener across
// reloads, so disposing on module dispose keeps exactly one live
// resize listener. Guarded: plain browsers and vitest have no hot
// runtime.
try {
  if (
    typeof import.meta.hot !== "undefined" &&
    import.meta.hot !== undefined &&
    import.meta.hot !== null
  ) {
    import.meta.hot.dispose(() => {
      try {
        disposeScene();
      } catch {
        // HMR teardown never throws.
      }
    });
  }
} catch {
  // No HMR runtime: nothing to dispose.
}

function ensureFx(): VehicleFX {
  if (fxInstance === null) {
    fxInstance = new VehicleFX();
  }
  return fxInstance;
}

function ensureBrakeMaterial(): THREE.MeshStandardMaterial {
  if (fxBrakeMaterial === null) {
    try {
      if (engine.effects !== null) {
        fxBrakeMaterial = engine.effects.createBrakeLightMaterial();
      }
    } catch {
      // Headless: the stub below keeps probes numeric.
    }
  }
  return fxBrakeMaterial ?? stubBrakeMaterial;
}

// Construct the FX probe namespace over the shared instance (live
// getters, same-instance references, dual-casing aliases).
function publishFx(): FxNamespace {
  const instance = ensureFx();
  const syncBrakes = (): void => {
    try {
      const live = ensureBrakeMaterial();
      if (engine.effects !== null) {
        engine.effects.syncBrakeLight(live, instance.brakes);
      } else {
        live.emissiveIntensity = instance.brakes.emissiveIntensity;
      }
    } catch {
      // Probes must never break stepping.
    }
  };
  const update = (dt: number, sample?: FxSample): void => {
    instance.update(dt, sample ?? {});
    syncBrakes();
  };
  const reset = (): void => {
    instance.reset();
    syncBrakes();
  };
  const clear = (): void => {
    instance.clear();
  };
  const smoke = {
    get activeCount(): number {
      return instance.smoke.activeCount;
    },
    get active_count(): number {
      return instance.smoke.activeCount;
    },
    clear,
  };
  const skids = {
    get segmentCount(): number {
      return instance.skids.segmentCount;
    },
    get segment_count(): number {
      return instance.skids.segmentCount;
    },
  };
  const brake = {
    get emissiveIntensity(): number {
      return instance.brakes.emissiveIntensity;
    },
    get emissive_intensity(): number {
      return instance.brakes.emissiveIntensity;
    },
    get material(): THREE.MeshStandardMaterial {
      return ensureBrakeMaterial();
    },
  };
  return {
    instance,
    smoke,
    skids,
    skidMarks: skids,
    brake,
    brakeLights: brake,
    get brakeMaterial(): THREE.MeshStandardMaterial {
      return ensureBrakeMaterial();
    },
    get brake_material(): THREE.MeshStandardMaterial {
      return ensureBrakeMaterial();
    },
    get smokeMesh(): THREE.InstancedMesh | null {
      return smokeMesh;
    },
    get smoke_mesh(): THREE.InstancedMesh | null {
      return smokeMesh;
    },
    get skidMesh(): THREE.LineSegments | null {
      return skidMesh;
    },
    get skid_mesh(): THREE.LineSegments | null {
      return skidMesh;
    },
    get flash(): HingeFlash {
      return ensureFlash() as HingeFlash;
    },
    get flashLevel(): number {
      return ensureFlash().level;
    },
    get flash_level(): number {
      return ensureFlash().level;
    },
    update,
    reset,
    clear,
    get forceSlip(): boolean {
      return instance.forceSlip;
    },
    set forceSlip(value: boolean) {
      instance.forceSlip = value;
    },
    get force_slip(): boolean {
      return instance.forceSlip;
    },
    set force_slip(value: boolean) {
      instance.forceSlip = value;
    },
  };
}

type BootEvents = {
  boot: string;
  menu: string;
};

const bootEvents = new EventEmitter<BootEvents>();

// Shared race signal bus; aliased to window.__raceEmitter/__emitter in boot.
const raceEmitter = createRaceEmitter();

// Monotonic fixed-step counter mirrored to window.__fixedSteps.
let fixedSteps = 0;
let loop: LoopHandle | null = null;

function renderRace(ui: HTMLElement): void {
  const race = document.createElement("div");
  race.className = "race";

  const title = document.createElement("h1");
  title.textContent = "Race";
  race.appendChild(title);

  const status = document.createElement("p");
  status.textContent = "Get ready…";
  race.appendChild(status);

  ui.replaceChildren(race);
}

// Live vehicle behind the module handle when the harness replaced the
// `window.__nsr.vehicle` namespace (same instance, belt and suspenders).
function windowNSRVehicle(): Vehicle | null {
  try {
    if (typeof window !== "undefined") {
      const probe = (
        window as unknown as { __nsr?: { vehicle?: { instance?: Vehicle } } }
      ).__nsr;
      const instance = probe?.vehicle?.instance;
      if (instance !== undefined && instance !== null) {
        return instance;
      }
    }
  } catch {
    // Unavailable: fall back to the module handle.
  }
  return null;
}

// Live look-back flag: the probe table first (the harness may stub it),
// then the shared input singleton. Never throws.
function readLookBack(): boolean {
  try {
    if (typeof window !== "undefined") {
      const probe = (
        window as unknown as {
          __input?: {
            lookBack?: unknown;
            look_back?: unknown;
            state?: { lookBack?: unknown; look_back?: unknown };
          };
        }
      ).__input;
      if (probe !== undefined && probe !== null) {
        const direct = probe.lookBack ?? probe.look_back;
        if (direct !== undefined) {
          return direct === true;
        }
        const nested = probe.state?.lookBack ?? probe.state?.look_back;
        if (nested !== undefined) {
          return nested === true;
        }
      }
    }
  } catch {
    // Fall through to the singleton.
  }
  try {
    return input.state.lookBack === true;
  } catch {
    return false;
  }
}

// Fallback input bridge while the vehicle stage loads: identical
// guards to the staged vehicle-module helper (finite numbers win,
// booleans need an exact true/false), kept local so the entry chunk
// carries no static engine import (budget gate, issue #243).
function copyPlayerInputs(target: VehicleInputs, source: PlayerInputSource): void {
  try {
    if (typeof source.throttle === "number" && Number.isFinite(source.throttle)) {
      target.throttle = source.throttle;
    }
    if (typeof source.brake === "number" && Number.isFinite(source.brake)) {
      target.brake = source.brake;
    }
    if (typeof source.steer === "number" && Number.isFinite(source.steer)) {
      target.steer = source.steer;
    }
    if (source.handbrake === true) {
      target.handbrake = true;
    } else if (source.handbrake === false) {
      target.handbrake = false;
    }
    if (source.reset === true) {
      target.reset = true;
    } else if (source.reset === false) {
      target.reset = false;
    }
  } catch {
    // A torn table never breaks the fixed step.
  }
}

// Per-tick player-input bridge (readLookBack probe-first idiom for
// the source, windowNSRVehicle belt-and-suspenders idiom for the
// target): copies the five held fields (throttle/brake/steer/
// handbrake/reset) from the polled input table into the live vehicle
// inputs in place, preserving the shared `window.__nsr.vehicle.inputs`
// reference. Prefers the staged vehicle-module helper, falls back to
// the local copy above. Pause/look-back are not vehicle inputs;
// consume-once latches are never forwarded. Never throws and no-ops
// when no vehicle or no table exists.
function syncPlayerInputs(): void {
  try {
    let source: PlayerInputSource | null = null;
    try {
      if (typeof window !== "undefined") {
        const probe = (
          window as unknown as { __input?: { state?: unknown } | null }
        ).__input;
        if (probe !== null && probe !== undefined) {
          const nested = (probe as { state?: PlayerInputSource }).state;
          source =
            nested !== null && nested !== undefined
              ? nested
              : (probe as PlayerInputSource);
        }
      }
    } catch {
      // Fall through to the singleton.
    }
    if (source === null) {
      try {
        source = input.state;
      } catch {
        return;
      }
    }
    if (source === null || source === undefined) {
      return;
    }
    const targets: { inputs?: VehicleInputs }[] = [];
    try {
      if (vehicle !== null) {
        targets.push(vehicle);
      }
    } catch {
      // No module handle; the probe instance still syncs below.
    }
    try {
      const live = windowNSRVehicle();
      if (live !== null && !targets.includes(live)) {
        targets.push(live);
      }
    } catch {
      // The probe lookup never breaks the sync.
    }
    if (targets.length === 0) {
      return;
    }
    let apply: ((target: VehicleInputs, source: PlayerInputSource) => void) | null = null;
    try {
      const helper = engine.vehicleMod?.applyPlayerInput;
      if (typeof helper === "function") {
        apply = helper as (target: VehicleInputs, source: PlayerInputSource) => void;
      }
    } catch {
      apply = null;
    }
    for (const target of targets) {
      try {
        const inputs = target.inputs;
        if (inputs === null || inputs === undefined) {
          continue;
        }
        if (apply !== null) {
          apply(inputs, source);
        } else {
          copyPlayerInputs(inputs, source);
        }
      } catch {
        // One torn car never breaks the sync of the other.
      }
    }
  } catch {
    // The input bridge must never break the fixed step.
  }
}

// Live shake flag, polled every tick and never cached (settings.gd poll
// idiom): the probe namespace first (dual vocabulary: the probe may use
// `camera_shake` snake_case or the shakeEnabled/shake_enabled twins),
// then the settings singleton.
function readShakeEnabled(): boolean {
  try {
    if (typeof window !== "undefined") {
      const probe = (
        window as unknown as {
          __nsr?: { settings?: Record<string, unknown> };
        }
      ).__nsr;
      const bag = probe?.settings;
      if (bag !== undefined && bag !== null) {
        // Snake_case first: `camera_shake` is an expando on the store
        // while `cameraShake` is a live getter, so the probe spelling
        // must win over the singleton default.
        const candidates = [
          bag.camera_shake,
          bag.cameraShake,
          bag.shake_enabled,
          bag.shakeEnabled,
        ];
        for (const candidate of candidates) {
          if (typeof candidate === "boolean") {
            return candidate;
          }
        }
      }
    }
  } catch {
    // Fall through to the singleton.
  }
  try {
    return settings.cameraShake !== false;
  } catch {
    return true;
  }
}

// Synchronous fixed-step world hook: steps the live Rapier car when
// physics has initialized, then the chase camera from the live sample
// (position/yaw/speed/slip plus look-back and the polled shake flag).
// Driven by the 60 Hz accumulator in `loop`.
export function worldTick(dt: number): void {
  if (traffic !== null) {
    try {
      traffic.step(dt, currentAnchor());
      traffic.syncKinematics();
    } catch {
      // Traffic must never break the fixed step.
    }
  }
  // Player-input bridge: the polled keyboard/gamepad table lands in
  // the live vehicle inputs in place on every fixed tick, immediately
  // before the vehicle step, so held pedals drive physics. Never gated
  // on race state; harmless before initDrive (no vehicle, no-op).
  syncPlayerInputs();
  if (vehicle !== null) {
    vehicle.step(dt);
  }
  // Race flow: the manager is clock-authoritative, so every fixed step
  // advances it while a race is armed. The grid advances its kinematic
  // rivals first, then the full chassis array ([player, ...rivals]) feeds
  // racer gate proximity (clock-only step when no vehicle exists yet).
  // Traffic already stepped above, so it moves alongside the racers in
  // race mode and eases to 0 when parked. Never throws: the race flow
  // must not break the fixed step.
  try {
    if (raceManager.state === "countdown" || raceManager.state === "racing") {
      try {
        grid.advance(dt);
      } catch {
        // A stuck grid never breaks the race flow.
      }
      const live = vehicle ?? windowNSRVehicle();
      let sample: Vec3 | null = null;
      if (live !== null) {
        try {
          sample = live.getState().position;
        } catch {
          sample = null;
        }
      }
      let chassis: GridPoint[] | undefined;
      try {
        chassis = grid.chassisWith(sample ?? undefined);
      } catch {
        chassis = undefined;
      }
      if (chassis !== undefined) {
        raceManager.step(dt, chassis);
      } else if (sample !== null) {
        raceManager.step(dt, { x: sample.x, y: sample.y, z: sample.z });
      } else {
        raceManager.step(dt);
      }
    }
  } catch {
    // The race flow must never break the fixed step.
  }
  // Judged-drift accrual: sample the live slip/speed into the
  // HUD-held drift total while racing and pop the HUD drift readout
  // on new whole points (drift_park judged-run idiom). Never throws.
  try {
    if (raceManager.state === "racing" && Number.isFinite(dt) && dt > 0) {
      const live = vehicle ?? windowNSRVehicle();
      let slipRad = 0;
      let speedMs = 0;
      if (live !== null) {
        try {
          const carState = live.getState();
          slipRad = carState.slipIntensity;
          speedMs = carState.speedMs;
        } catch {
          // Keep the parked defaults; drift never breaks stepping.
        }
      }
      const gain = drift.scoreDrift(slipRad, speedMs, dt);
      if (gain > 0) {
        const before = Math.trunc(raceManager.driftTotal);
        raceManager.driftTotal += gain;
        if (Math.trunc(raceManager.driftTotal) > before) {
          try {
            hud.showDrift(Math.trunc(raceManager.driftTotal));
          } catch {
            // The drift readout never breaks the fixed step.
          }
        }
      }
    }
  } catch {
    // Drift accrual must never break the fixed step.
  }
  let carPos: Vec3 = { x: 0, y: 0, z: 0 };
  let carYaw = chase !== null ? chase.yaw : 0;
  if (chase !== null) {
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    let speedMs = 0;
    let slipRad = 0;
    const live = vehicle ?? windowNSRVehicle();
    if (live !== null) {
      try {
        const state = live.getState();
        carPos = state.position;
        speedMs = state.speedMs;
        slipRad = state.slipIntensity;
        const quat = live.body.rotation() as Quat;
        const fwd = rotateVecByQuat({ x: 0, y: 0, z: -1 }, quat);
        if (Math.hypot(fwd.x, fwd.z) > 1e-6) {
          carYaw = Math.atan2(-fwd.x, -fwd.z);
        }
      } catch {
        // Keep the last-sample defaults; the camera never breaks stepping.
      }
    }
    chase.update(stepDt, {
      carPos,
      carYaw,
      speedMs,
      slipRad,
      lookBack: readLookBack(),
      shakeEnabled: readShakeEnabled(),
    });
  }
  // FX sink: samples the live car (pos/slip/speed/brake/grounded) into
  // the shared VehicleFX instance, syncs the pooled smoke/skid scene
  // meshes plus the probe brake material, and decays the hinge flash.
  // FX never reads the shake flag (it never shakes the camera itself).
  // Guarded so FX never breaks the step.
  try {
    const fxLive = ensureFx();
    const car = vehicle ?? windowNSRVehicle();
    let fxPos: Vec3 = carPos;
    let fxQuat: Quat = { ...IDENTITY_QUAT };
    let slip = 0;
    let speed = 0;
    let braking = false;
    let grounded = true;
    if (car !== null) {
      try {
        const state = car.getState();
        fxPos = { ...state.position };
        slip = state.slipIntensity;
        speed = state.speedMs;
        grounded = state.isGrounded;
        const pedal = car.inputs.brake;
        braking = typeof pedal === "number" && pedal > 0.05;
        try {
          fxQuat = { ...(car.body.rotation() as Quat) };
        } catch {
          // Keep the identity heading; anchors stay axis-aligned.
        }
      } catch {
        // Keep the parked defaults; FX never breaks stepping.
      }
    }
    if (!braking) {
      try {
        braking = input.state.brake > 0.05;
      } catch {
        braking = false;
      }
    }
    let fxLeft: Vec3 | null = null;
    let fxRight: Vec3 | null = null;
    try {
      const anchors = rearSkidAnchors(fxPos, fxQuat);
      fxLeft = anchors.left;
      fxRight = anchors.right;
    } catch {
      // Keep the nulls; VehicleFX falls back to anchor.x +/- 0.8.
    }
    fxLive.update(dt, {
      slip,
      speed,
      brake: braking,
      grounded,
      pos: fxPos,
      left: fxLeft,
      right: fxRight,
    });
    try {
      // Staged effects (chunk-budget split): skipped until stage C lands.
      if (engine.effects !== null) {
        engine.effects.syncSmoke(smokeMesh, fxLive.smoke);
      }
    } catch {
      // The smoke pool must never break the fixed step.
    }
    try {
      if (engine.effects !== null) {
        engine.effects.syncSkids(skidMesh, fxLive.skids);
      }
    } catch {
      // The skid ribbon must never break the fixed step.
    }
    try {
      const live = ensureBrakeMaterial();
      if (engine.effects !== null) {
        engine.effects.syncBrakeLight(live, fxLive.brakes);
      } else {
        live.emissiveIntensity = fxLive.brakes.emissiveIntensity;
      }
    } catch {
      // The brake material must never break the fixed step.
    }
    try {
      const flash = ensureFlash();
      flash.update(dt);
      if (engine.effects !== null) {
        engine.effects.syncFlashOverlay(flashElement, flash.level);
      } else if (flashElement !== null) {
        try {
          flashElement.style.opacity = String(
            Math.min(Math.max(flash.level, 0), 1),
          );
        } catch {
          // The overlay write must never break the fixed step.
        }
      }
    } catch {
      // The hinge flash must never break the fixed step.
    }
  } catch {
    // FX must never break the fixed step.
  }
  if (lightRig !== null) {
    try {
      // Staged lights (chunk-budget split): skipped until stage C lands.
      if (engine.lights !== null) {
        engine.lights.updateHeadlights(lightRig, carPos, carYaw);
      }
    } catch {
      // Headlights must never break the fixed step.
    }
  }
  if (cityWorld !== null) {
    try {
      cityWorld.step();
    } catch {
      // Probe bodies must never break the fixed step.
    }
  }
  // HUD sink: pushes the live vehicle + race snapshot into the DOM
  // overlay. Guarded so HUD faults never break the fixed step, and no
  // extra render pass or rAF is added.
  try {
    const live = vehicle ?? windowNSRVehicle();
    let sample: hud.HudVehicleSample | null = null;
    let playerPos: { x: number; z: number } | null = null;
    if (live !== null) {
      try {
        const state = live.getState();
        sample = { speedMs: state.speedMs, currentGear: state.currentGear };
        const anchor = state.position;
        if (Number.isFinite(anchor.x) && Number.isFinite(anchor.z)) {
          playerPos = { x: anchor.x, z: anchor.z };
        }
      } catch {
        sample = null;
      }
    }
    hud.update({ vehicle: sample, race: hudRaceSnapshot() }, dt);
    // Minimap sink: same guard, throttled to 10 Hz inside the module.
    // Player reads the live vehicle XZ, rivals the race field behind
    // the player sample, gates the armed event (downtown_gp fallback so
    // the route face renders before a race arms).
    try {
      const manager = activeRaceManager();
      let gates: unknown = manager?.gates ?? null;
      if (!Array.isArray(gates) || gates.length === 0) {
        gates = getEvent("downtown_gp")?.gates ?? null;
      }
      minimap.updateMinimap(dt, {
        player: playerPos,
        rivals: manager?.samples?.slice(1) ?? null,
        gates,
      });
    } catch {
      // The minimap must never break the fixed step.
    }
  } catch {
    // The HUD must never break the fixed step.
  }
  // Audio steer: engine RPM pitch, skid fade, and wind level from the
  // live vehicle readout, plus a settings-volumes re-poll every tick
  // (readShakeEnabled poll idiom). Guarded so audio never breaks the
  // fixed step.
  try {
    const live = vehicle ?? windowNSRVehicle();
    if (live !== null) {
      try {
        const state = live.getState();
        const maxRpm = (live as unknown as { maxEngineRpm?: unknown })
          .maxEngineRpm;
        audioManager.update({
          rpm: state.engineRpm,
          maxRpm: typeof maxRpm === "number" ? maxRpm : undefined,
          slip: state.slipIntensity,
          speedMs: state.speedMs,
        });
      } catch {
        audioManager.update(null);
      }
    }
    audioManager.applyVolumes();
  } catch {
    // Audio must never break the fixed step.
  }
}

let vehicle: Vehicle | null = null;

// Live ambient traffic fleet behind the probe namespace (pure until the
// shared drive world attaches kinematics in initDrive).
let traffic: Traffic | null = null;

function ensureTraffic(): Traffic {
  if (traffic === null) {
    traffic = sharedTraffic();
  }
  return traffic;
}

// Player anchor for the traffic tick: the live vehicle position, falling
// back to the stored traffic anchor and finally the origin. Never throws.
function currentAnchor(): Vec3 {
  try {
    const live = vehicle ?? windowNSRVehicle();
    if (live !== null) {
      return { ...live.getState().position };
    }
  } catch {
    // Fall through to the stored anchor.
  }
  try {
    if (traffic !== null) {
      return { ...traffic.playerPos };
    }
  } catch {
    // Fall through to the origin.
  }
  return { x: 0, y: 0, z: 0 };
}

// Probe-facing starting-grid namespace over the shared instance (same
// rivals array reference, so probes read live poses and speeds).
function publishGrid(): GridNamespace {
  const build = (eventId: string, opts?: GridBuildOpts): RaceGrid => {
    try {
      return armGridForEvent(eventId, opts);
    } catch {
      return grid;
    }
  };
  const advance = (dt: number = STEP_DT): void => {
    try {
      grid.advance(dt);
    } catch {
      // Probes must never break stepping.
    }
  };
  const reset = (): void => {
    try {
      grid.reset();
    } catch {
      // Probes must never break stepping.
    }
  };
  const chassisWith = (playerPos?: GridPoint | null): GridPoint[] => {
    try {
      return grid.chassisWith(playerPos);
    } catch {
      return [];
    }
  };
  return {
    instance: grid,
    get rivals(): RivalState[] {
      return grid.rivals;
    },
    get racers(): string[] {
      return grid.racers;
    },
    get eventId(): string {
      return grid.eventId;
    },
    get event_id(): string {
      return grid.eventId;
    },
    build,
    advance,
    reset,
    chassisWith,
    chassis_with: chassisWith,
  };
}

// Probe-facing traffic namespace over the shared fleet instance (same
// cars array reference, so probes read live poses and speeds).
function publishTraffic(): TrafficNamespace {
  const instance = ensureTraffic();
  const setBlocked = (index: number, value: boolean | null): void => {
    instance.setBlockedOverride(index, value);
  };
  const teleportCar = (index: number, position: Vec3): void => {
    instance.teleportCar(index, position);
  };
  const setPlayerPos = (position: Vec3): void => {
    instance.setPlayerPos(position);
  };
  return {
    instance,
    cars: instance.cars,
    get active(): boolean {
      return instance.isActive();
    },
    isActive: (): boolean => instance.isActive(),
    is_active: (): boolean => instance.isActive(),
    setActive: (value: boolean): void => {
      instance.setActive(value);
    },
    set_active: (value: boolean): void => {
      instance.setActive(value);
    },
    step: (dt: number = STEP_DT, playerPos?: Vec3): void => {
      try {
        instance.step(dt, playerPos ?? currentAnchor());
        instance.syncKinematics();
      } catch {
        // Probes must never break stepping.
      }
    },
    setBlocked,
    set_blocked: setBlocked,
    setBlockedOverride: setBlocked,
    teleportCar,
    teleport_car: teleportCar,
    setPlayerPos,
    set_player_pos: setPlayerPos,
    getState: (index: number): CarState => instance.carState(index),
  };
}

// Live chase camera stepped by worldTick (null until boot publishes it).
let chase: ChaseCamera | null = null;

// Probe-facing HUD namespace: the pure DOM sink plus its formatters, so
// black-box probes read the same speed/gear/lap/position/clock numbers
// the tests pin through window.__nsr.hud on the running service.
function publishHud(): hud.HudNamespace {
  return {
    speedKmhFor: hud.speedKmhFor,
    speed_kmh_for: hud.speed_kmh_for,
    gearTextFor: hud.gearTextFor,
    gear_text_for: hud.gear_text_for,
    positionTextFor: hud.positionTextFor,
    position_text_for: hud.position_text_for,
    lapTextFor: hud.lapTextFor,
    lap_text_for: hud.lap_text_for,
    formatTime: hud.formatTime,
    format_time: hud.format_time,
    formatDelta: hud.formatDelta,
    format_delta: hud.format_delta,
    ensureHud: hud.ensureHud,
    ensure_hud: hud.ensure_hud,
    setSpeed: hud.setSpeed,
    set_speed: hud.set_speed,
    setGear: hud.setGear,
    set_gear: hud.set_gear,
    setLapPosition: hud.setLapPosition,
    set_lap_position: hud.set_lap_position,
    setRaceTime: hud.setRaceTime,
    set_race_time: hud.set_race_time,
    setDelta: hud.setDelta,
    set_delta: hud.set_delta,
    clearDelta: hud.clearDelta,
    clear_delta: hud.clear_delta,
    showDrift: hud.showDrift,
    show_drift: hud.show_drift,
    updateHud: hud.updateHud,
    update_hud: hud.update_hud,
    update: hud.update,
    attachRace: hud.attachRace,
    attach_race: hud.attach_race,
    DRIFT_FADE_TIME: hud.DRIFT_FADE_TIME,
  };
}

// Probe-facing audio namespace: the live Web Audio mixer plus the pure
// pitch/skid/wind maps, so black-box probes read the same numbers the
// tests pin through window.__nsr.audio on the running service
// (publishHud idiom: one bound handle per method, shared by both
// casings so alias wording cannot mismatch).
function publishAudio(): AudioNamespace {
  const ensureContext = (): AudioContext | null => audioManager.ensureContext();
  const applyVolumes = (): void => {
    audioManager.applyVolumes();
  };
  const attachUnlock = (): void => {
    audioManager.attachUnlock();
  };
  const unlock = (): void => {
    audioManager.unlock();
  };
  const startMenuMusic = (): void => {
    audioManager.startMenuMusic();
  };
  const duckMusicForRace = (): void => {
    audioManager.duckMusicForRace();
  };
  const playClick = (): void => {
    audioManager.playClick();
  };
  const updateAudio = (sample?: Parameters<AudioNamespace["update"]>[0]): void => {
    audioManager.update(sample);
  };
  const disposeAudio = (): void => {
    audioManager.dispose();
  };
  return {
    instance: audioManager,
    engineRate: audioEngineRate,
    engine_rate: audioEngineRate,
    engine_pitch: audioEngineRate,
    skidGain: audioSkidGain,
    skid_gain: audioSkidGain,
    windGain: audioWindGain,
    wind_gain: audioWindGain,
    levelToGain: audioLevelToGain,
    level_to_gain: audioLevelToGain,
    ensureContext,
    ensure_context: ensureContext,
    applyVolumes,
    apply_volumes: applyVolumes,
    attachUnlock,
    attach_unlock: attachUnlock,
    unlock,
    startMenuMusic,
    start_menu_music: startMenuMusic,
    duckMusicForRace,
    duck_music_for_race: duckMusicForRace,
    playClick,
    play_click: playClick,
    update: updateAudio,
    dispose: disposeAudio,
    get context(): AudioContext | null {
      return audioManager.ctx;
    },
    get state(): string {
      return audioManager.state;
    },
    get ducked(): boolean {
      return audioManager.ducked;
    },
    get masterGainValue(): number {
      return audioManager.masterGainValue;
    },
    get musicGainValue(): number {
      return audioManager.musicGainValue;
    },
    get sfxGainValue(): number {
      return audioManager.sfxGainValue;
    },
    IDLE_RPM: AUDIO_IDLE_RPM,
    MAX_ENGINE_RPM: AUDIO_MAX_ENGINE_RPM,
    SKID_THRESHOLD: AUDIO_SKID_THRESHOLD,
    SKID_FULL: AUDIO_SKID_FULL,
    WIND_FULL_SPEED: AUDIO_WIND_FULL_SPEED,
    DUCK_DB: AUDIO_DUCK_DB,
    DUCK_GAIN: AUDIO_DUCK_GAIN,
    MUTE_FLOOR: AUDIO_MUTE_FLOOR,
  };
}

// Probe-facing minimap namespace: the pure normalized-XZ math plus the
// canvas sink, so black-box probes read the same projection and dot
// numbers the tests pin through window.__nsr.minimap on the running
// service (publishHud idiom).
function publishMinimap(): minimap.MinimapNamespace {
  return {
    normalizeMinimap: minimap.normalizeMinimap,
    normalize_minimap: minimap.normalize_minimap,
    projectToMap: minimap.projectToMap,
    project_to_map: minimap.project_to_map,
    ensureMinimap: minimap.ensureMinimap,
    ensure_minimap: minimap.ensure_minimap,
    drawMinimap: minimap.drawMinimap,
    draw_minimap: minimap.draw_minimap,
    updateMinimap: minimap.updateMinimap,
    update_minimap: minimap.update_minimap,
    resetMinimapClock: minimap.resetMinimapClock,
    reset_minimap_clock: minimap.reset_minimap_clock,
    MAP_SIZE: minimap.MAP_SIZE,
    map_size: minimap.map_size,
    HALF_EXTENT: minimap.HALF_EXTENT,
    half_extent: minimap.half_extent,
    GATE_DOT: minimap.GATE_DOT,
    gate_dot: minimap.gate_dot,
    PLAYER_DOT: minimap.PLAYER_DOT,
    player_dot: minimap.player_dot,
    RIVAL_DOT: minimap.RIVAL_DOT,
    rival_dot: minimap.rival_dot,
    UPDATE_INTERVAL: minimap.UPDATE_INTERVAL,
    update_interval: minimap.update_interval,
  };
}

// Attached race holder for the HUD snapshot: the harness may replace
// window.__nsr.race.manager, so prefer the probe table before the module
// handle (windowNSRVehicle belt-and-suspenders idiom). Never throws.
function activeRaceManager(): RaceManager | null {
  try {
    if (typeof window !== "undefined") {
      const probe = (
        window as unknown as { __nsr?: { race?: { manager?: RaceManager } } }
      ).__nsr;
      const injected = probe?.race?.manager;
      if (injected !== undefined && injected !== null) {
        return injected;
      }
    }
  } catch {
    // Fall through to the module handle.
  }
  return raceManager;
}

// Duck-typed race snapshot for the HUD: reads only plain fields inside
// try/catch and treats anything missing as no attached race (hidden).
function hudRaceSnapshot(): hud.HudRaceSnapshot | null {
  try {
    const manager = activeRaceManager();
    if (manager === null || manager === undefined) {
      return null;
    }
    const state = manager.state;
    if (state === "idle") {
      return null;
    }
    if (manager.event === null || manager.event === undefined) {
      return null;
    }
    const field = Array.isArray(manager.positions) && manager.positions.length > 0
      ? manager.positions
      : manager.racers.map((_, i) => i);
    const total = Math.max(1, field.length);
    const rank = field.indexOf(0);
    const pos = rank === -1 ? total : rank + 1;
    const laps = Math.max(1, manager.totalLaps);
    const lap = Math.min(laps, Math.max(1, manager.currentLap + 1));
    const holder = manager as unknown as Record<string, unknown>;
    const bestRaw = holder["best"] ?? holder["bestTime"] ?? holder["best_time"];
    const best =
      typeof bestRaw === "number" && Number.isFinite(bestRaw) ? bestRaw : null;
    const driftRaw = holder["driftTotal"] ?? holder["drift_total"] ?? holder["driftScore"] ?? holder["drift_score"];
    const driftTotal =
      typeof driftRaw === "number" && Number.isFinite(driftRaw) ? driftRaw : null;
    return {
      pos,
      total,
      lap,
      laps,
      raceTime: manager.raceTime,
      best,
      driftTotal,
    };
  } catch {
    return null;
  }
}

// Live Rapier city world behind the probe namespace (null until the
// async WASM init lands city colliders without blocking menu render).
let cityWorld: RAPIER.World | null = null;

// Live night rig handles behind the lighting probe namespace (set in
// initScene, stepped in worldTick).
let nightRenderer: THREE.WebGLRenderer | null = null;
let nightComposer: EffectComposer | null = null;
let lightRig: LightRig | null = null;

// Synchronous probe namespace over the district grid with live getters
// for the async city world. Additive aliases (window.__city plus
// window.__nsr.city); existing __fixedSteps/__nsr behavior is unchanged.
function publishCity(): CityNamespace {
  // Staged city (chunk-budget split): the live module arrives in stage
  // C; until then every reader degrades to the verbatim pure fallback.
  const analyticTop = (x: number, z: number): number => {
    try {
      if (engine.city !== null) {
        return engine.city.groundTopY(x, z);
      }
    } catch {
      // Fall through to the verbatim fallback.
    }
    return fallbackGroundTopY(x, z);
  };
  const raycast = (x: number, z: number): number | null => {
    try {
      if (
        cityWorld !== null &&
        engine.city !== null &&
        engine.rapier !== null
      ) {
        const hit = engine.city.castRayDown(
          cityWorld,
          engine.rapier,
          x,
          z,
        );
        if (hit !== null) {
          return hit;
        }
      }
    } catch {
      // Fall through to the analytic surface.
    }
    return analyticTop(x, z);
  };
  const validateGrid = (grid?: unknown): boolean => {
    try {
      if (engine.city !== null) {
        return engine.city.validateCityGrid(grid);
      }
    } catch {
      // Fall through to the stock-shape fallback.
    }
    try {
      if (grid === undefined || grid === null) {
        return fallbackCheckGrid({});
      }
      if (typeof grid !== "object") {
        return false;
      }
      return fallbackCheckGrid(grid as Record<string, unknown>);
    } catch {
      return false;
    }
  };
  return {
    get centerlines(): readonly number[] {
      return engine.city?.ROAD_CENTERLINES ?? FALLBACK_ROAD_CENTERLINES;
    },
    get centerLines(): readonly number[] {
      return engine.city?.ROAD_CENTERLINES ?? FALLBACK_ROAD_CENTERLINES;
    },
    get blockCenters(): readonly number[] {
      return engine.city?.BLOCK_CENTERS ?? FALLBACK_BLOCK_CENTERS;
    },
    groundTopY: analyticTop,
    ground_top_y: analyticTop,
    castRayDown: raycast,
    cast_ray_down: raycast,
    createChassis: (pos?: Vec3, linvel?: Vec3) => {
      try {
        if (
          cityWorld === null ||
          engine.city === null ||
          engine.rapier === null
        ) {
          return null;
        }
        return engine.city.createChassis(
          cityWorld,
          engine.rapier,
          pos ?? { x: 0, y: 1, z: 0 },
          linvel ?? { x: 0, y: 0, z: 0 },
        );
      } catch {
        return null;
      }
    },
    validateCityGrid: validateGrid,
    validate_city_grid: validateGrid,
    stepOnce: (): void => {
      try {
        cityWorld?.step();
      } catch {
        // Probe bodies must never break the fixed step.
      }
    },
    get world(): RAPIER.World | null {
      return cityWorld;
    },
    get ready(): boolean {
      return cityWorld !== null;
    },
  };
}

// Async city build: WASM embed (no fetch), base slab plus EW lips plus
// route-edge walls. Failure leaves the menu drivable-less but alive.
async function initCityPhysics(): Promise<void> {
  try {
    // Staged physics (chunk-budget split): no-ops until stage A lands.
    if (
      engine.physics === null ||
      engine.city === null ||
      engine.rapier === null
    ) {
      return;
    }
    await engine.physics.ensureRapierReady();
    if (cityWorld !== null) {
      return;
    }
    const world = engine.city.createCityWorld(engine.rapier);
    engine.city.addGroundColliders(world, engine.rapier);
    engine.city.addBarrierColliders(world, engine.rapier);
    cityWorld = world;
  } catch {
    cityWorld = null;
  }
}

// Async drive initialization: WASM embed (no fetch), flat slab, the
// sedan-tune car. Failure leaves the menu drivable-less but alive.
async function initDrive(): Promise<void> {
  try {
    // Staged drive (chunk-budget split): no-ops until stages A/B land.
    if (
      engine.physics === null ||
      engine.vehicleMod === null ||
      engine.rapier === null
    ) {
      return;
    }
    const vehicleMod = engine.vehicleMod;
    const rapier = engine.rapier;
    await engine.physics.ensureRapierReady();
    const world = new engine.physics.PhysicsWorld();
    // Single ground slab (issue #240): city statics carry the y=0 plane;
    // the flat fallback slab mounts only when the city step fails.
    world.mountDriveGround(() => {
      if (engine.city === null || engine.rapier === null) {
        throw new Error("city statics not staged");
      }
      engine.city.addGroundColliders(world.world, engine.rapier);
      engine.city.addBarrierColliders(world.world, engine.rapier);
    });
    const sedan = getTune("sedan");
    const car = new vehicleMod.Vehicle(world, sedan === undefined ? {} : { tune: vehicleMod.tuneFromCarTune(sedan) });
    vehicle = car;
    window.__nsr.vehicle = {
      instance: car,
      inputs: car.inputs,
      step: (dt: number) => car.step(dt),
      getState: () => car.getState(),
      placeAt: (position: Vec3, quat?: Quat) => car.placeAt(position, quat),
      setForwardSpeed: (speed: number) => car.setForwardSpeed(speed),
      reset: () => car.resetVehicle(),
      computeSuspensionForce: vehicleMod.computeSuspensionForce,
      computeLateralForce: vehicleMod.computeLateralForce,
      clampToFrictionCircle: vehicleMod.clampToFrictionCircle,
      resolveLimiterOrder: vehicleMod.resolveLimiterOrder,
      resetCandidates: vehicleMod.resetCandidates,
      sampleTorque: vehicleMod.sampleTorque,
    };
    try {
      ensureTraffic().attachKinematics(world.world, rapier);
    } catch {
      // Traffic stays pure-lane; the fleet still cruises without bodies.
    }
    window.__nsr.physics = {
      instance: world,
      stepWorld: () => world.stepWorld(),
      findClearResetPosition: (desired: Vec3) => world.findClearResetPosition(desired),
    };
  } catch {
    vehicle = null;
  }
}

// Pause entry point: gates stepping only while the rAF loop and DOM stay
// alive. Aliased to window.setPaused/window.pause/window.__setPaused.
function setPaused(paused: boolean): void {
  loop?.setPaused(paused);
  try {
    raceManager.setPaused(paused);
  } catch {
    // The race clock shares the pause gate; never break it.
  }
}

type RenderScene = () => void;

function initScene(canvas: HTMLCanvasElement): RenderScene {
  // Staged scene (chunk-budget split): every render module resolves
  // through the post-menu stage-C handles. Any missing stage leaves a
  // clean no-op so the menu stays usable with no WebGL/engine.
  const THREE = engine.three;
  const rendererMod = engine.rendererMod;
  const composerMod = engine.composer;
  const lightsMod = engine.lights;
  const materialsMod = engine.materials;
  const skyMod = engine.sky;
  const effectsMod = engine.effects;
  const cityMod = engine.city;
  if (
    THREE === null ||
    rendererMod === null ||
    composerMod === null ||
    lightsMod === null ||
    materialsMod === null ||
    skyMod === null ||
    effectsMod === null ||
    cityMod === null
  ) {
    return (): void => {};
  }
  const renderer = rendererMod.createNightRenderer(canvas);
  nightRenderer = renderer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a12);
  scene.fog = skyMod.createFog();
  const camera = new THREE.PerspectiveCamera(
    FOV_MIN,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 2, 6);
  try {
    lightRig = lightsMod.buildLightRig();
    const rig = lightRig;
    scene.add(rig.moon);
    scene.add(rig.hemi);
    for (const spot of rig.headlights) {
      scene.add(spot);
      scene.add(spot.target);
    }
    for (const lamp of rig.lamps) {
      scene.add(lamp);
    }
  } catch {
    lightRig = null;
  }
  try {
    const wetAsphalt = materialsMod.createWetAsphalt();
    for (const mesh of cityMod.buildRoadMeshes()) {
      mesh.material = wetAsphalt;
      scene.add(mesh);
    }
    const blocks = cityMod.buildBlockMeshes();
    blocks.material = materialsMod.createWetAsphalt();
    scene.add(blocks);
  } catch {
    // The menu renders without the district when headless.
  }
  try {
    scene.add(materialsMod.buildEmissiveDressing());
  } catch {
    // Emissive dressing is additive; the menu stays without it.
  }
  // FX scene layer: instanced smoke billboards plus the preallocated
  // skid ribbon, mounted once beside the district dressing (same
  // guarded pattern) and synced from the worldTick FX sink.
  try {
    smokeMesh = effectsMod.buildSmokeBillboards();
    scene.add(smokeMesh);
  } catch {
    smokeMesh = null;
  }
  try {
    skidMesh = effectsMod.buildSkidMesh();
    scene.add(skidMesh);
  } catch {
    skidMesh = null;
  }
  if (renderer !== null) {
    try {
      nightComposer = composerMod.createNightComposer(renderer, scene, camera);
    } catch {
      nightComposer = null;
    }
    try {
      void skyMod.loadEnvironment(renderer).then((env) => {
        try {
          if (env.envTexture !== null) {
            scene.environment = env.envTexture;
          }
          if (env.background !== null) {
            scene.background = env.background;
          }
        } catch {
          // Environment assignment must never break rendering.
        }
      });
    } catch {
      // The rig holds the fog fallback without the HDRI.
    }
    try {
      const stagedRenderer = rendererMod;
      const onResize = (): void => {
        try {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          stagedRenderer.resizeRenderer(
            nightRenderer,
            nightComposer,
            window.innerWidth,
            window.innerHeight,
          );
        } catch {
          // Resizes must never break rendering.
        }
      };
      try {
        stagedRenderer.disposeSceneResize();
      } catch {
        // Dispose is best-effort; attach replaces stale listeners.
      }
      try {
        stagedRenderer.attachSceneResize(onResize);
      } catch {
        // Resize wiring is best-effort.
      }
    } catch {
      // Resize wiring is best-effort.
    }
  } else {
    nightComposer = null;
    try {
      rendererMod.disposeSceneResize();
    } catch {
      // A null-renderer re-init still drops the stale listener.
    }
  }
  const renderNow = (): void => {
    try {
      if (nightComposer !== null) {
        nightComposer.render();
      } else if (nightRenderer !== null) {
        nightRenderer.render(scene, camera);
      }
    } catch {
      try {
        nightRenderer?.render(scene, camera);
      } catch {
        // Headless: the menu stays alive without frames.
      }
    }
  };
  renderNow();
  return (): void => {
    try {
      if (chase !== null) {
        const state = chase.getState();
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
        camera.position.set(
          state.position.x + state.shake.x,
          state.position.y + state.shake.y,
          state.position.z,
        );
        camera.lookAt(state.lookAt.x, state.lookAt.y, state.lookAt.z);
      }
    } catch {
      // The chase view must never break rendering.
    }
    renderNow();
  };
}

// Construct the live chase camera and publish the probe namespace.
// The pure helpers stay available even when the vehicle never
// initializes (the camera degrades to helper exposure plus a parked
// zero-speed chase view).
function publishCamera(): CameraNamespace {
  const instance = new ChaseCamera();
  chase = instance;
  return {
    instance,
    fovForSpeed,
    fov_for_speed: fovForSpeed,
    lagWeight,
    lag_weight: lagWeight,
    shakeOffset,
    shake_offset: shakeOffset,
    update: (dt: number, sample: CameraSample): CameraPose =>
      instance.update(dt, sample),
    getState: (): CameraPose => instance.getState(),
    get fov(): number {
      return instance.fov;
    },
    get yaw(): number {
      return instance.yaw;
    },
    get shake(): { x: number; y: number } {
      return { ...instance.getState().shake };
    },
    get offset(): { x: number; y: number } {
      return { ...instance.getState().offset };
    },
    get position(): Vec3 {
      return { ...instance.position };
    },
    get lookAt(): Vec3 {
      return { ...instance.getState().lookAt };
    },
  };
}

// Code-split screen loader: dynamic-import()s the module on first
// navigation and caches the promise, so the entry chunk carries only
// the menu while event-select/garage/settings/results split out. The
// cached path paints synchronously (eager semantics); the in-flight
// path paints on resolve only while the target screen is still showing.
// Never throws.
function lazyScreen(
  router: Router,
  name: string,
  importer: () => Promise<Record<string, unknown>>,
  render: string,
): (container: HTMLElement) => void {
  let cached: Record<string, unknown> | null = null;
  let pending: Promise<Record<string, unknown>> | null = null;
  let ticket = 0;
  return (container: HTMLElement): void => {
    try {
      const mine = (ticket += 1);
      if (cached !== null) {
        try {
          const paint = cached[render];
          if (typeof paint === "function") {
            (paint as (c: HTMLElement, r?: Router | null) => void)(
              container,
              router,
            );
          }
        } catch {
          // Screen faults never break routing.
        }
        return;
      }
      if (pending === null) {
        try {
          pending = importer();
        } catch {
          pending = null;
        }
      }
      if (pending === null) {
        return;
      }
      void pending.then(
        (mod) => {
          try {
            cached = mod;
            if (mine !== ticket || router.current() !== name) {
              return;
            }
            const paint = mod[render];
            if (typeof paint === "function") {
              (paint as (c: HTMLElement, r?: Router | null) => void)(
                container,
                router,
              );
            }
          } catch {
            // Screen faults never break routing.
          }
        },
        (error) => {
          // Chunk failure must never stall silently: release the gate so the
          // next visit retries, and log via the shared named-error sink.
          // The loaders module itself arrives staged post-menu; before it
          // lands the same message goes straight to the console.
          pending = null;
          try {
            if (engine.loadersMod !== null) {
              engine.loadersMod.reportMissing(`screen:${name}`, error);
            } else {
              console.error(`[loaders] missing asset: screen:${name}`, error);
            }
          } catch {
            // Logging faults never break routing.
          }
        },
      );
    } catch {
      // Screen faults never break routing.
    }
  };
}

async function boot(): Promise<void> {
  try {
    renderLoading();
  } catch {
    // The static shell already paints without JS.
  }
  try {
    setLoadingProgress(5, "Starting…");
  } catch {
    // Progress faults never break boot.
  }
  const ui = document.getElementById("ui");
  if (ui === null) {
    try {
      failLoading("Boot failed", "missing #ui");
    } catch {
      // The error line is best-effort without a shell.
    }
    return;
  }
  const router = new Router(ui);
  router.register("menu", (container) => renderMenu(container, router));
  router.register(
    "event-select",
    lazyScreen(router, "event-select", () => import("./ui/eventSelect"), "renderEventSelect"),
  );
  router.register(
    "garage",
    lazyScreen(router, "garage", () => import("./ui/garage"), "renderGarage"),
  );
  router.register(
    "settings",
    lazyScreen(router, "settings", () => import("./ui/settings"), "renderSettings"),
  );
  router.register(
    "results",
    lazyScreen(router, "results", () => import("./ui/results"), "renderResults"),
  );
  router.register("race", renderRace);
  // Chunk-budget staged boot: the menu paints with zero engine bytes.
  // The 5 MB physics/render chunks load automatically right after
  // (no click-to-load) via bootEngineStages below, so black-box probes
  // polling window.__nsr.vehicle get the live car within their timeouts
  // while the menu stays usable with no WebGL/engine from second zero.
  router.show("menu");
  try {
    attachPause(ui, router);
  } catch {
    // The pause overlay is additive; the menu stays without it.
  }
  try {
    hud.ensureHud(document);
  } catch {
    // The HUD overlay is additive; the menu stays without it.
  }
  try {
    minimap.ensureMinimap(document);
  } catch {
    // The minimap canvas is additive; the menu stays without it.
  }
  bootEvents.emit("menu", "menu-ready");
  // The render scene holder lets the frame loop start synchronously
  // with the menu while stage C swaps in the real scene once the
  // vendor chunks land (pause gates steps while the DOM stays alive).
  const sceneHolder: { scene: RenderScene } = { scene: (): void => {} };
  bootEvents.emit("boot", "booted");
  fixedSteps = 0;
  window.__fixedSteps = 0;
  window.__raceEmitter = raceEmitter;
  window.__emitter = raceEmitter;
  window.setPaused = setPaused;
  window.pause = setPaused;
  window.__setPaused = setPaused;
  window.__input = input;
  // Race flow signals: manager phase/checkpoint callbacks forward into
  // the shared raceEmitter (onRaceStateChanged/onCheckpoint), closing
  // the loop without the pure manager importing events or the DOM.
  raceManager.onStateChanged = (state): void => {
    if (state === "idle") {
      return;
    }
    try {
      raceEmitter.emit("onRaceStateChanged", { state });
    } catch {
      // Signal faults must never break boot.
    }
    // Countdown/finish hinge flash: kick the FX flash level on the
    // state transitions (the raceEmitter forward above stays first).
    // Guarded so flash faults never break the fixed step.
    if (state === "countdown" || state === "finished") {
      try {
        ensureFlash().flash();
      } catch {
        // The flash must never break the race.
      }
    }
    // Finished while the race screen is up: hand the standings to the
    // results screen (race.gd _on_finished scene-change idiom) so a
    // completed run always lands on #screen-results. Guarded so routing
    // faults never break the fixed step.
    if (state === "finished") {
      try {
        if (router.current() === "race") {
          const results = raceManager.results;
          if (results !== null && results !== undefined) {
            try {
              gameState.setLastResult({
                event_id: results.eventId,
                player_racer: "player",
                places: results.places.map((row) => ({
                  racer: row.racer,
                  time_s: row.time_s,
                  place: row.place,
                })),
                drift_score: Math.max(0, Math.trunc(raceManager.driftTotal)),
              });
            } catch {
              // Handoff faults fall back to the results mock.
            }
          }
          router.show("results");
        }
      } catch {
        // Results routing never breaks the race.
      }
    }
  };
  raceManager.onCheckpoint = (index): void => {
    try {
      raceEmitter.emit("onCheckpoint", { index });
    } catch {
      // Signal faults must never break boot.
    }
  };
  const city = publishCity();
  window.__city = city;
  // Solo-aware race arming shared by the event flow and probes
  // (time_trial arms a 1-racer field with no AI, race arms the full
  // event field): the HUD-readable holders seed here from the stored
  // best (null clears the delta) with a zeroed drift total.
  const startRace = (eventId: string): void => {
    try {
      const id =
        typeof eventId === "string" && eventId !== ""
          ? eventId
          : "harbor_sprint";
      try {
        gameState.selectEvent(id);
      } catch {
        // Selection faults never block arming.
      }
      const solo = gameState.isTimeTrialMode();
      try {
        raceManager.startEvent(id, solo ? 1 : undefined);
      } catch {
        raceManager.startEvent("harbor_sprint", solo ? 1 : undefined);
      }
      try {
        raceManager.driftTotal = 0;
        const stored = recordsApi.getBest(id);
        raceManager.best = stored > 0 ? stored : null;
      } catch {
        // Holder faults never block arming.
      }
      // Full-grid arming (race.gd _spawn_rivals idiom): the shared grid
      // bakes the same event with the player's selected car, and traffic
      // cruises in race mode but parks (eases to 0) in time-trial. The
      // effective id follows the manager fallback so grid and manager
      // never disagree. Guarded so arming never throws.
      try {
        const carId = gameState.getSelectedCar() || gameState.getDefaultCar();
        const effective = raceManager.eventId !== "" ? raceManager.eventId : id;
        armGridForEvent(effective, { carId, solo });
      } catch {
        // Grid faults never block arming.
      }
      try {
        ensureTraffic().setActive(!solo);
      } catch {
        // Traffic-mode faults never block arming.
      }
    } catch {
      // Arming never throws.
    }
    try {
      router.show("race");
    } catch {
      // Navigation faults never break arming.
    }
  };
  // Mirror the Godot autoload _ready reload: lenient-load the v1 save on
  // boot (read-only; writes happen only through setters plus flush()).
  loadSave();
  window.__nsr = {
    save: {
      SAVE_KEY,
      SAVE_VERSION,
      SCHEMA_VERSION,
      defaultSave,
      validateSave,
      loadSave,
      saveNow,
    },
    progression: {
      LADDER,
      REWARD_CARS,
      nextEventAfter,
      mappedCar,
      canUnlockNext,
      carReward,
      applyResult,
      unlockedEvents,
      unlockedCars,
      isUnlockedWith,
      isEventUnlocked,
      isCarUnlockedWith,
    },
    records: recordsApi,
    startRace,
    settings,
    gameState,
    input,
    race: { order, positions, drift: { ...drift, ...recordsApi.driftApi }, timetrial: { ...timetrial, ...recordsApi.timetrialApi }, manager: raceManager, route: raceRoute, grid: publishGrid() },
    ai: {
      bakeRacingLine: racingLine.bakeRacingLine,
      bake_racing_line: racingLine.bake_racing_line,
      bakeSpeeds: racingLine.bakeSpeeds,
      bake_speeds: racingLine.bake_speeds,
      curvatureOf: racingLine.curvatureOf,
      curvature_of: racingLine.curvature_of,
      rawSpeed: racingLine.rawSpeed,
      raw_speed: racingLine.raw_speed,
      throttleCap: racingLine.throttleCap,
      throttle_cap: racingLine.throttle_cap,
      trackLength: racingLine.trackLength,
      track_length: racingLine.track_length,
      arcOf: racingLine.arcOf,
      arc_of: racingLine.arc_of,
      lookaheadPoint: racingLine.lookaheadPoint,
      lookahead_point: racingLine.lookahead_point,
      pointAtArc: racingLine.pointAtArc,
      point_at_arc: racingLine.point_at_arc,
      speedAtArc: racingLine.speedAtArc,
      speed_at_arc: racingLine.speed_at_arc,
      closestIndex: racingLine.closestIndex,
      closest_index: racingLine.closest_index,
      aiInput: aiInputMod.aiInput,
      ai_input: aiInputMod.ai_input,
      lookaheadFor: aiInputMod.lookaheadFor,
      lookahead_for: aiInputMod.lookahead_for,
      rubberBand: rubberBandMod.rubberBand,
      rubber_band: rubberBandMod.rubber_band,
      computeAid: rubberBandMod.computeAid,
      compute_aid: rubberBandMod.compute_aid,
      wrapGap: rubberBandMod.wrapGap,
      wrap_gap: rubberBandMod.wrap_gap,
      MIN_SPEED: racingLine.MIN_SPEED,
      MAX_SPEED: racingLine.MAX_SPEED,
      LATERAL_ACCEL: racingLine.LATERAL_ACCEL,
      BRAKE_DECEL: racingLine.BRAKE_DECEL,
      GRIP_BUDGET: racingLine.GRIP_BUDGET,
      MAX_AID: rubberBandMod.MAX_AID,
      GAIN: rubberBandMod.GAIN,
    },
    camera: publishCamera(),
    traffic: publishTraffic(),
    city,
    lighting: publishLighting(),
    // Staged loaders (chunk-budget split): the module arrives post-menu
    // in stage A and replaces this placeholder in place, so probes
    // polling window.__nsr.loaders read the identical namespace.
    loaders: (engine.loadersMod ?? {}) as typeof import("./render/loaders"),
    hud: publishHud(),
    audio: publishAudio(),
    minimap: publishMinimap(),
    fx: publishFx(),
  };
  // Real keyboard feeds the shared table through window listeners;
  // the fixed step below re-polls every tick for gamepad state.
  input.attach();
  // Audio unlock + volumes: attach the one-shot gesture listeners and
  // poll the settings levels without resuming, so the context stays
  // suspended until the first gesture (autoplay policy). Menu music
  // starts best-effort; race phases duck/restore it; menu clicks fire
  // the one-shot.
  try {
    audioManager.attachUnlock();
    audioManager.applyVolumes();
  } catch {
    // Audio setup never breaks boot.
  }
  try {
    audioManager.startMenuMusic();
  } catch {
    // Menu music is best effort without a gesture.
  }
  try {
    raceEmitter.on("onRaceStateChanged", (payload) => {
      try {
        if (payload.state === "racing" || payload.state === "countdown") {
          audioManager.duckMusicForRace();
        } else {
          audioManager.startMenuMusic();
        }
      } catch {
        // Audio routing never breaks the race signal.
      }
    });
  } catch {
    // Race-phase ducking is additive; the menu stays without it.
  }
  try {
    document.addEventListener("click", () => {
      try {
        if (router.current() !== "race") {
          audioManager.playClick();
        }
      } catch {
        // Clicks never break navigation.
      }
    });
  } catch {
    // Click sounds are additive; the menu stays without them.
  }
  // The fixed-step loop starts synchronously with the menu (pure world
  // tick: traffic/chase/FX/HUD advance while the engine stages load);
  // the drive/car pick-up lands via initDrive once stage B resolves.
  loop = start((dt) => {
    try {
      input.poll();
    } catch {
      // Input must never break the fixed step (no pad, no vehicle).
    }
    worldTick(dt);
    fixedSteps += 1;
    window.__fixedSteps = fixedSteps;
  });
  // Render reads the latest state every frame, independent of stepping,
  // so pause gates steps while the scene and DOM stay alive. The fps
  // meter samples wall time here (never in the fixed step) for the
  // probe-readable soak average.
  const renderFrame = (): void => {
    try {
      fpsMeter.sample(performance.now());
    } catch {
      // The meter must never break rendering.
    }
    try {
      sceneHolder.scene();
    } catch {
      // Headless: the menu stays alive without frames.
    }
    requestAnimationFrame(renderFrame);
  };
  requestAnimationFrame(renderFrame);
  console.info("MENU_READY");
  // Engine stages boot automatically after the menu paints
  // (no click-to-load); never throws, never blocks the menu.
  void bootEngineStages(sceneHolder);
}

// Staged engine boot (chunk-budget split): runs automatically right
// after the menu paints. Stage A loads physics (progress 50) plus the
// asset-manifest warm (progress 80); stage B arms the drive and city
// bodies; stage C builds the night scene (progress 95/100). The compat
// WASM embed needs no fetch; every stage degrades to a live menu when
// its chunks fail. Never throws.
async function bootEngineStages(
  sceneHolder: { scene: RenderScene },
): Promise<void> {
  // Stage A: physics module plus the Rapier runtime (compat embed).
  try {
    const [physicsMod, rapierMod] = await Promise.all([
      import("./physics/world"),
      import("@dimforge/rapier3d-compat"),
    ]);
    engine.physics = physicsMod;
    engine.rapier = rapierMod.default;
    try {
      await physicsMod.ensureRapierReady();
    } catch (error) {
      try {
        failLoading("Rapier initialization failed", error);
      } catch {
        // The error line is best-effort.
      }
    }
  } catch (error) {
    try {
      failLoading("Rapier initialization failed", error);
    } catch {
      // The error line is best-effort.
    }
  }
  try {
    setLoadingProgress(50, "Physics ready");
  } catch {
    // Progress faults never break boot.
  }
  // Manifest warm through the staged loaders module (no static engine
  // edge post-split); the live namespace replaces the boot placeholder
  // in place so probes read identical values and casings.
  try {
    engine.loadersMod = await import("./render/loaders");
  } catch {
    // The manifest warm is best-effort; assets stream on demand.
  }
  try {
    await engine.loadersMod?.fetchAssetManifest((done, total) => {
      try {
        const frac = total > 0 ? done / total : 1;
        setLoadingProgress(
          50 + Math.round(frac * 30),
          `Loading assets ${done}/${total}`,
        );
      } catch {
        // Progress faults never break the warm.
      }
    });
    if (engine.loadersMod !== null) {
      try {
        window.__nsr.loaders = engine.loadersMod;
      } catch {
        // The placeholder stays; values arrive with the next stage.
      }
    }
  } catch {
    // The manifest never rejects; missing entries only warn.
  }
  try {
    setLoadingProgress(80, "Assets ready");
  } catch {
    // Progress faults never break boot.
  }
  // Stage B: drive plus city bodies (auto, no click-to-load). The city
  // statics module must land before either init: initDrive's ground
  // callback mounts city ground+barrier colliders into the drive world,
  // and initCityPhysics early-returns while engine.city is null.
  try {
    engine.vehicleMod = await import("./vehicles/vehicle");
  } catch {
    // The drive stays unarmed; the menu stays alive.
  }
  try {
    if (engine.city === null) {
      engine.city = await import("./render/city");
    }
  } catch {
    // The city statics stay unmounted; the menu stays alive.
  }
  await initDrive();
  await initCityPhysics();
  // Stage C: render modules plus the night scene.
  try {
    const [
      threeMod,
      effectsMod,
      composerMod,
      lightsMod,
      materialsMod,
      rendererMod,
      skyMod,
      perfMod,
    ] = await Promise.all([
      import("three"),
      import("./render/effects"),
      import("./render/composer"),
      import("./render/lights"),
      import("./render/materials"),
      import("./render/renderer"),
      import("./render/sky"),
      import("./render/perf"),
    ]);
    engine.three = threeMod;
    engine.effects = effectsMod;
    engine.composer = composerMod;
    engine.lights = lightsMod;
    engine.materials = materialsMod;
    engine.rendererMod = rendererMod;
    engine.sky = skyMod;
    engine.perf = perfMod;
  } catch {
    // WebGL unavailable (headless without GPU): menu stays.
  }
  // Belt-and-suspenders: if the stage-B city import raced or failed but
  // the module resolves now, build the probe bodies (no-op when the
  // stage-B initCityPhysics already built them).
  try {
    if (engine.city === null) {
      engine.city = await import("./render/city");
    }
  } catch {
    // The city statics stay unmounted; the menu stays alive.
  }
  await initCityPhysics();
  migrateFlash();
  try {
    if (flashElement === null && engine.effects !== null) {
      flashElement = engine.effects.ensureFlashOverlay(document);
    }
  } catch {
    flashElement = null;
  }
  // The menu renders from DOM regardless of WebGL availability so the
  // page stays usable even when headless Chromium lacks a GPU.
  try {
    const canvas = document.getElementById("scene");
    if (canvas instanceof HTMLCanvasElement) {
      sceneHolder.scene = initScene(canvas);
    }
  } catch {
    // WebGL unavailable (e.g. headless without GPU): menu stays.
  }
  try {
    setLoadingProgress(95, "Scene ready");
  } catch {
    // Progress faults never break boot.
  }
  try {
    setLoadingProgress(100, "Ready");
  } catch {
    // Progress faults never break boot.
  }
  try {
    hideLoading();
  } catch {
    // Hide faults never break boot.
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void boot();
  });
} else {
  void boot();
}
