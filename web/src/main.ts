import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { EventEmitter, createRaceEmitter, type RaceEvents } from "./core/events";
import { start, type LoopHandle } from "./core/loop";
import { Router } from "./core/router";
import { getTune } from "./data/tunes";
import { ensureRapierReady, PhysicsWorld, rotateVecByQuat, STEP_DT, type Quat, type Vec3 } from "./physics/world";
import {
  clampToFrictionCircle,
  computeLateralForce,
  computeSuspensionForce,
  resolveLimiterOrder,
  resetCandidates,
  sampleTorque,
  tuneFromCarTune,
  Vehicle,
  type VehicleInputs,
  type VehicleState,
} from "./vehicles/vehicle";
import { input, type PlayerInput } from "./vehicles/input";
import {
  ChaseCamera,
  fovForSpeed,
  lagWeight,
  shakeOffset,
  type CameraPose,
  type CameraSample,
} from "./vehicles/camera";
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
  mappedCar,
  nextEventAfter,
} from "./game/progression";
import { SettingsStore, settings } from "./game/settings";
import {
  BLOCK_CENTERS,
  ROAD_CENTERLINES,
  addBarrierColliders,
  addGroundColliders,
  buildBlockMeshes,
  buildRoadMeshes,
  castRayDown,
  createChassis,
  createCityWorld,
  groundTopY,
  validateCityGrid,
} from "./render/city";
import { GameState, gameState } from "./game/state";
import * as loaders from "./render/loaders";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { PASS_NAMES, createNightComposer } from "./render/composer";
import {
  MAX_LIGHTS_PER_MESH,
  buildLightRig,
  countRigLights,
  updateHeadlights,
  type LightRig,
} from "./render/lights";
import {
  buildEmissiveDressing,
  createWetAsphalt,
} from "./render/materials";
import {
  TONE_MAPPING,
  createNightRenderer,
  resizeRenderer,
} from "./render/renderer";
import { createFog, loadEnvironment } from "./render/sky";
import { Traffic, type CarState, type TrafficCar } from "./traffic/traffic";
import * as hud from "./ui/hud";
import * as minimap from "./ui/minimap";
import { getEvent } from "./data/events";
import * as drift from "./race/drift";
import * as order from "./race/order";
import * as positions from "./race/positions";
import * as timetrial from "./race/timetrial";
import { manager as raceManager, type RaceManager } from "./race/manager";
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
      };
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
      };
      ai: AiNamespace;
      traffic: TrafficNamespace;
      camera: CameraNamespace;
      city: CityNamespace;
      lighting: LightingNamespace;
      loaders: typeof loaders;
      hud: hud.HudNamespace;
      minimap: minimap.MinimapNamespace;
      vehicle?: VehicleNamespace;
      physics?: PhysicsNamespace;
    };
  }
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

// Probe-facing traffic namespace: the live kinematic fleet plus the pure
// lane helpers behind getters, so black-box probes read the same numbers
// the tests pin (car count, speeds, poses) with either casing.
export type TrafficNamespace = {
  instance: Traffic;
  cars: TrafficCar[];
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
  computeSuspensionForce: typeof computeSuspensionForce;
  computeLateralForce: typeof computeLateralForce;
  clampToFrictionCircle: typeof clampToFrictionCircle;
  resolveLimiterOrder: typeof resolveLimiterOrder;
  resetCandidates: typeof resetCandidates;
  sampleTorque: typeof sampleTorque;
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
    passes: PASS_NAMES,
    pass_names: PASS_NAMES,
    get rig(): LightRig | null {
      return lightRig;
    },
    get counts(): { total: number; maxPerMesh: number } {
      return {
        total: lightRig !== null ? countRigLights(lightRig) : 0,
        maxPerMesh: MAX_LIGHTS_PER_MESH,
      };
    },
    get toneMapping(): number {
      return nightRenderer?.toneMapping ?? TONE_MAPPING;
    },
    get tone_mapping(): number {
      return nightRenderer?.toneMapping ?? TONE_MAPPING;
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

interface MenuEvent {
  routeId: string;
  locked: boolean;
}

// Placeholder event roster mirroring MenuUI.EVENT_PATHS; every entry is
// locked until the progression ladder lands in a later lap.
const MENU_EVENTS: MenuEvent[] = [
  { routeId: "harbor_sprint", locked: true },
  { routeId: "downtown_gp", locked: true },
  { routeId: "neon_loop", locked: true },
  { routeId: "bayline_circuit", locked: true },
  { routeId: "alley_sprint", locked: true },
  { routeId: "drift_park", locked: true },
];

function renderMenu(ui: HTMLElement): void {
  const menu = document.createElement("div");
  menu.className = "menu";

  const title = document.createElement("h1");
  title.textContent = "Night Street Racer";
  menu.appendChild(title);

  for (const label of ["Race", "Garage", "Settings", "Quit"]) {
    const button = document.createElement("button");
    button.id = `${label}Button`;
    button.type = "button";
    button.textContent = label;
    menu.appendChild(button);
  }

  const list = document.createElement("ul");
  list.className = "event-list";
  for (const event of MENU_EVENTS) {
    const item = document.createElement("li");
    item.textContent = event.locked ? `${event.routeId} 🔒 Locked` : event.routeId;
    list.appendChild(item);
  }
  menu.appendChild(list);

  ui.replaceChildren(menu);
}

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

// Live shake flag, polled every tick and never cached (settings.gd poll
// idiom): the probe namespace first, then the settings singleton.
function readShakeEnabled(): boolean {
  try {
    if (typeof window !== "undefined") {
      const probe = (
        window as unknown as { __nsr?: { settings?: { cameraShake?: unknown } } }
      ).__nsr;
      const flag = probe?.settings?.cameraShake;
      if (typeof flag === "boolean") {
        return flag;
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
  if (vehicle !== null) {
    vehicle.step(dt);
  }
  // Race flow: the manager is clock-authoritative, so every fixed step
  // advances it while a race is armed. The live vehicle sample feeds
  // racer 0 gate proximity (clock-only step when no vehicle exists yet).
  // Never throws: the race flow must not break the fixed step.
  try {
    if (raceManager.state === "countdown" || raceManager.state === "racing") {
      const live = vehicle ?? windowNSRVehicle();
      let sample: Vec3 | null = null;
      if (live !== null) {
        try {
          sample = live.getState().position;
        } catch {
          sample = null;
        }
      }
      if (sample !== null) {
        raceManager.step(dt, { x: sample.x, y: sample.y, z: sample.z });
      } else {
        raceManager.step(dt);
      }
    }
  } catch {
    // The race flow must never break the fixed step.
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
  if (lightRig !== null) {
    try {
      updateHeadlights(lightRig, carPos, carYaw);
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
}

let vehicle: Vehicle | null = null;

// Live ambient traffic fleet behind the probe namespace (pure until the
// shared drive world attaches kinematics in initDrive).
let traffic: Traffic | null = null;

function ensureTraffic(): Traffic {
  if (traffic === null) {
    traffic = new Traffic();
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
  const raycast = (x: number, z: number): number | null => {
    try {
      if (cityWorld !== null) {
        const hit = castRayDown(cityWorld, RAPIER, x, z);
        if (hit !== null) {
          return hit;
        }
      }
    } catch {
      // Fall through to the analytic surface.
    }
    return groundTopY(x, z);
  };
  return {
    centerlines: ROAD_CENTERLINES,
    centerLines: ROAD_CENTERLINES,
    blockCenters: BLOCK_CENTERS,
    groundTopY,
    ground_top_y: groundTopY,
    castRayDown: raycast,
    cast_ray_down: raycast,
    createChassis: (pos?: Vec3, linvel?: Vec3) => {
      try {
        if (cityWorld === null) {
          return null;
        }
        return createChassis(
          cityWorld,
          RAPIER,
          pos ?? { x: 0, y: 1, z: 0 },
          linvel ?? { x: 0, y: 0, z: 0 },
        );
      } catch {
        return null;
      }
    },
    validateCityGrid,
    validate_city_grid: validateCityGrid,
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
    await ensureRapierReady();
    if (cityWorld !== null) {
      return;
    }
    const world = createCityWorld(RAPIER);
    addGroundColliders(world, RAPIER);
    addBarrierColliders(world, RAPIER);
    cityWorld = world;
  } catch {
    cityWorld = null;
  }
}

// Async drive initialization: WASM embed (no fetch), flat slab, the
// sedan-tune car. Failure leaves the menu drivable-less but alive.
async function initDrive(): Promise<void> {
  try {
    await ensureRapierReady();
    const world = new PhysicsWorld();
    world.makeGround();
    try {
      addGroundColliders(world.world, RAPIER);
      addBarrierColliders(world.world, RAPIER);
    } catch {
      // City statics are additive; the flat slab still drives.
    }
    const sedan = getTune("sedan");
    const car = new Vehicle(world, sedan === undefined ? {} : { tune: tuneFromCarTune(sedan) });
    vehicle = car;
    window.__nsr.vehicle = {
      instance: car,
      inputs: car.inputs,
      step: (dt: number) => car.step(dt),
      getState: () => car.getState(),
      placeAt: (position: Vec3, quat?: Quat) => car.placeAt(position, quat),
      setForwardSpeed: (speed: number) => car.setForwardSpeed(speed),
      reset: () => car.resetVehicle(),
      computeSuspensionForce,
      computeLateralForce,
      clampToFrictionCircle,
      resolveLimiterOrder,
      resetCandidates,
      sampleTorque,
    };
    try {
      ensureTraffic().attachKinematics(world.world, RAPIER);
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
  const renderer = createNightRenderer(canvas);
  nightRenderer = renderer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a12);
  scene.fog = createFog();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 2, 6);
  try {
    lightRig = buildLightRig();
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
    const wetAsphalt = createWetAsphalt();
    for (const mesh of buildRoadMeshes()) {
      mesh.material = wetAsphalt;
      scene.add(mesh);
    }
    const blocks = buildBlockMeshes();
    blocks.material = createWetAsphalt();
    scene.add(blocks);
  } catch {
    // The menu renders without the district when headless.
  }
  try {
    scene.add(buildEmissiveDressing());
  } catch {
    // Emissive dressing is additive; the menu stays without it.
  }
  if (renderer !== null) {
    try {
      nightComposer = createNightComposer(renderer, scene, camera);
    } catch {
      nightComposer = null;
    }
    try {
      void loadEnvironment(renderer).then((env) => {
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
      window.addEventListener("resize", () => {
        try {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          resizeRenderer(
            nightRenderer,
            nightComposer,
            window.innerWidth,
            window.innerHeight,
          );
        } catch {
          // Resizes must never break rendering.
        }
      });
    } catch {
      // Resize wiring is best-effort.
    }
  } else {
    nightComposer = null;
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

function boot(): void {
  const ui = document.getElementById("ui");
  if (ui === null) {
    return;
  }
  const router = new Router(ui);
  router.register("menu", renderMenu);
  router.register("race", renderRace);
  router.show("menu");
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
  // The menu renders from DOM regardless of WebGL availability so the
  // page is usable even when headless Chromium lacks a GPU.
  let renderScene: RenderScene = (): void => {};
  try {
    const canvas = document.getElementById("scene");
    if (canvas instanceof HTMLCanvasElement) {
      renderScene = initScene(canvas);
    }
  } catch {
    // WebGL unavailable (e.g. headless without GPU): menu stays.
  }
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
    },
    settings,
    gameState,
    input,
    race: { order, positions, drift, timetrial, manager: raceManager, route: raceRoute },
    ai: {
      bakeRacingLine: racingLine.bakeRacingLine,
      bake_racing_line: racingLine.bake_racing_line,
      bakeSpeeds: racingLine.bakeSpeeds,
      bake_speeds: racingLine.bake_speeds,
      curvatureOf: racingLine.curvatureOf,
      curvature_of: racingLine.curvature_of,
      rawSpeed: racingLine.rawSpeed,
      raw_speed: racingLine.raw_speed,
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
      MAX_AID: rubberBandMod.MAX_AID,
      GAIN: rubberBandMod.GAIN,
    },
    camera: publishCamera(),
    traffic: publishTraffic(),
    city,
    lighting: publishLighting(),
    loaders,
    hud: publishHud(),
    minimap: publishMinimap(),
  };
  // Real keyboard feeds the shared table through window listeners;
  // the fixed step below re-polls every tick for gamepad state.
  input.attach();
  // Physics initializes asynchronously (WASM compile); the loop keeps
  // stepping the menu meanwhile and picks up the car once ready.
  void initDrive();
  void initCityPhysics();
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
  // so pause gates steps while the scene and DOM stay alive.
  const renderFrame = (): void => {
    renderScene();
    requestAnimationFrame(renderFrame);
  };
  requestAnimationFrame(renderFrame);
  console.info("MENU_READY");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
