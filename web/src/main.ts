import * as THREE from "three";
import { EventEmitter, createRaceEmitter, type RaceEvents } from "./core/events";
import { start, type LoopHandle } from "./core/loop";
import { Router } from "./core/router";
import { getTune } from "./data/tunes";
import { ensureRapierReady, PhysicsWorld, type Quat, type Vec3 } from "./physics/world";
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
import { GameState, gameState } from "./game/state";
import * as drift from "./race/drift";
import * as order from "./race/order";
import * as positions from "./race/positions";
import * as timetrial from "./race/timetrial";

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
      };
      vehicle?: VehicleNamespace;
      physics?: PhysicsNamespace;
    };
  }
}

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

// Synchronous fixed-step world hook: steps the live Rapier car when
// physics has initialized; a no-op until then (menu still boots
// without WASM). Driven by the 60 Hz accumulator in `loop`.
export function worldTick(dt: number): void {
  if (vehicle !== null) {
    vehicle.step(dt);
  }
}

let vehicle: Vehicle | null = null;

// Async drive initialization: WASM embed (no fetch), flat slab, the
// sedan-tune car. Failure leaves the menu drivable-less but alive.
async function initDrive(): Promise<void> {
  try {
    await ensureRapierReady();
    const world = new PhysicsWorld();
    world.makeGround();
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
}

type RenderScene = () => void;

function initScene(canvas: HTMLCanvasElement): RenderScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a12);
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 2, 6);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  renderer.render(scene, camera);
  return (): void => {
    renderer.render(scene, camera);
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
    race: { order, positions, drift, timetrial },
  };
  // Real keyboard feeds the shared table through window listeners;
  // the fixed step below re-polls every tick for gamepad state.
  input.attach();
  // Physics initializes asynchronously (WASM compile); the loop keeps
  // stepping the menu meanwhile and picks up the car once ready.
  void initDrive();
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
