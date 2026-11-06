// Audio acceptance suite (issue #222 contract): pure-map assertions
// plus headless AudioManager checks with no network, no WebGL, no real
// AudioContext. Covers the sfx-0 mute floor, the 5500-vs-800 engine-rate
// ratio, idle/redline/clamp pins, skid/wind maps, -6 dB race ducking,
// the suspended-until-gesture unlock machine, Node headless safety,
// alias identity, and a static hygiene scan proving the game/audio
// module carries no audio-library/three.js/rapier import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  audio,
  AudioManager,
  createAudioManager,
  create_audio_manager,
  DUCK_DB,
  DUCK_GAIN,
  duck_db,
  duck_gain,
  ENGINE_URL,
  engine_pitch,
  engine_rate,
  engineRate,
  IDLE_RPM,
  idle_rpm,
  level_to_gain,
  levelToGain,
  MAX_ENGINE_RPM,
  max_engine_rpm,
  MUSIC_URL,
  MUTE_FLOOR,
  mute_floor,
  SKID_FULL,
  skid_full,
  skid_gain,
  skidGain,
  SKID_THRESHOLD,
  skid_threshold,
  WIND_FULL_SPEED,
  wind_full_speed,
  wind_gain,
  windGain,
} from "../src/game/audio";

const here = dirname(fileURLToPath(import.meta.url));
const moduleSource = readFileSync(join(here, "..", "src", "game", "audio.ts"), "utf8");

// Stub AudioContext installs/removals restore the global afterwards so
// later suites observe the real (absent under Node) constructor.
const savedContext = (globalThis as Record<string, unknown>)["AudioContext"];
afterEach(() => {
  try {
    if (savedContext === undefined) {
      delete (globalThis as Record<string, unknown>)["AudioContext"];
    } else {
      (globalThis as Record<string, unknown>)["AudioContext"] = savedContext;
    }
  } catch {
    // Restore is best effort.
  }
});

type StubGain = { value: number };
type StubContext = {
  state: string;
  resumes: number;
  destination: object;
  resume: () => Promise<void>;
  createGain: () => { gain: StubGain; connect: () => void };
  createBufferSource: () => {
    buffer: unknown;
    loop: boolean;
    playbackRate: StubGain;
    connect: () => void;
    start: () => void;
  };
  decodeAudioData: () => Promise<never>;
};

function installStub(initialState = "suspended"): StubContext {
  const stub: StubContext = {
    state: initialState,
    resumes: 0,
    destination: {},
    resume(): Promise<void> {
      stub.resumes += 1;
      stub.state = "running";
      return Promise.resolve();
    },
    createGain() {
      return { gain: { value: 1 }, connect: () => undefined };
    },
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        connect: () => undefined,
        start: () => undefined,
      };
    },
    decodeAudioData() {
      return Promise.reject(new Error("no audio under test"));
    },
  };
  (globalThis as Record<string, unknown>)["AudioContext"] =
    function () {
      return stub;
    };
  return stub;
}

function levels(master: number, music: number, sfx: number): {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
} {
  return { masterVolume: master, musicVolume: music, sfxVolume: sfx };
}

describe("audio constants", () => {
  it("pins the Godot-verbatim map anchors and the -6 dB duck factor", () => {
    expect(IDLE_RPM).toBe(800);
    expect(MAX_ENGINE_RPM).toBe(7200);
    expect(SKID_THRESHOLD).toBeCloseTo(0.2, 10);
    expect(SKID_FULL).toBeCloseTo(0.5, 10);
    expect(WIND_FULL_SPEED).toBe(40);
    expect(DUCK_DB).toBe(-6);
    expect(DUCK_GAIN).toBeCloseTo(0.5012, 4);
    expect(MUTE_FLOOR).toBe(0.0001);
  });

  it("snake_case constants share the same values", () => {
    expect(idle_rpm).toBe(IDLE_RPM);
    expect(max_engine_rpm).toBe(MAX_ENGINE_RPM);
    expect(skid_threshold).toBe(SKID_THRESHOLD);
    expect(skid_full).toBe(SKID_FULL);
    expect(wind_full_speed).toBe(WIND_FULL_SPEED);
    expect(duck_db).toBe(DUCK_DB);
    expect(duck_gain).toBe(DUCK_GAIN);
    expect(mute_floor).toBe(MUTE_FLOOR);
  });

  it("godot-name aliases share the same reference", () => {
    expect(engine_rate).toBe(engineRate);
    expect(engine_pitch).toBe(engineRate);
    expect(skid_gain).toBe(skidGain);
    expect(wind_gain).toBe(windGain);
    expect(level_to_gain).toBe(levelToGain);
    expect(create_audio_manager).toBe(createAudioManager);
  });

  it("points loops at the Vite static asset paths", () => {
    expect(ENGINE_URL).toBe("/assets/audio/engine.wav");
    expect(MUSIC_URL).toBe("/assets/audio/music_menu.wav");
  });
});

describe("engine rate map", () => {
  it("runs at least 1.5x faster at 5500 rpm than at idle", () => {
    expect(engineRate(5500) / engineRate(800)).toBeGreaterThanOrEqual(1.5);
  });

  it("pins idle, redline, and clamps", () => {
    expect(engineRate(800)).toBeCloseTo(0.6, 10);
    expect(engineRate(7200)).toBeCloseTo(2.0, 10);
    expect(engineRate(20000)).toBeCloseTo(2.0, 10);
    expect(engineRate(0)).toBeCloseTo(0.6, 10);
  });

  it("reads idle on degenerate spans and non-finite input", () => {
    expect(engineRate(5500, 800)).toBeCloseTo(0.6, 10);
    expect(engineRate(5500, 100)).toBeCloseTo(0.6, 10);
    expect(engineRate(Number.NaN)).toBeCloseTo(0.6, 10);
    expect(engineRate(5500, Number.NaN)).toBeCloseTo(
      engineRate(5500, MAX_ENGINE_RPM),
      10,
    );
  });
});

describe("skid and wind maps", () => {
  it("stays silent at or below 0.20 rad slip", () => {
    expect(skidGain(0.19)).toBe(0);
    expect(skidGain(0.2)).toBe(0);
    expect(skidGain(0)).toBe(0);
  });

  it("fades linearly to full at 0.50 rad", () => {
    const mid = skidGain(0.35);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(skidGain(0.5)).toBe(1);
    expect(skidGain(2.0)).toBe(1);
  });

  it("treats slip magnitude symmetrically and silence on garbage", () => {
    expect(skidGain(-0.35)).toBeCloseTo(skidGain(0.35), 10);
    expect(skidGain(Number.NaN)).toBe(0);
  });

  it("pins the wind speed map", () => {
    expect(windGain(0)).toBe(0);
    expect(windGain(20)).toBeCloseTo(0.5, 10);
    expect(windGain(40)).toBe(1);
    expect(windGain(120)).toBe(1);
    expect(windGain(-20)).toBeCloseTo(0.5, 10);
    expect(windGain(Number.NaN)).toBe(0);
  });
});

describe("bus volumes", () => {
  it("mutes the SFX bus when the settings level is 0", () => {
    const manager = new AudioManager(levels(0.8, 0.7, 0));
    manager.applyVolumes();
    expect(manager.sfxGainValue).toBeLessThanOrEqual(0.0001);
    expect(manager.masterGainValue).toBeCloseTo(0.8, 10);
    expect(manager.musicGainValue).toBeCloseTo(0.7, 10);
  });

  it("floors levels at or below 0.0001 and clamps above 1", () => {
    expect(levelToGain(0)).toBe(0.0001);
    expect(levelToGain(0.0001)).toBe(0.0001);
    expect(levelToGain(0.00001)).toBe(0.0001);
    expect(levelToGain(2)).toBe(1);
    expect(levelToGain(Number.NaN)).toBe(0.0001);
    const manager = new AudioManager(levels(2, -1, 0.5));
    manager.applyVolumes();
    expect(manager.masterGainValue).toBe(1);
    expect(manager.musicGainValue).toBeLessThanOrEqual(0.0001);
    expect(manager.sfxGainValue).toBeCloseTo(0.5, 10);
  });

  it("ducks the music bus by -6 dB for racing and restores after", () => {
    const manager = new AudioManager(levels(0.8, 1, 0.9));
    manager.applyVolumes();
    expect(manager.musicGainValue).toBeCloseTo(1, 10);
    manager.duckMusicForRace();
    expect(manager.ducked).toBe(true);
    expect(manager.musicGainValue).toBeCloseTo(0.5012, 4);
    manager.startMenuMusic();
    expect(manager.ducked).toBe(false);
    expect(manager.musicGainValue).toBeCloseTo(1, 10);
  });

  it("keeps the muted music bus silent while ducked", () => {
    const manager = new AudioManager(levels(0.8, 0, 0.9));
    manager.duckMusicForRace();
    expect(manager.musicGainValue).toBeLessThanOrEqual(0.0001);
  });
});

describe("unlock state machine", () => {
  it("starts suspended and never resumes without a gesture", () => {
    const stub = installStub("suspended");
    const manager = new AudioManager(levels(0.8, 0.7, 0.9));
    expect(manager.state).toBe("suspended");
    manager.ensureContext();
    expect(manager.state).toBe("suspended");
    expect(stub.resumes).toBe(0);
  });

  it("resumes to running on unlock", () => {
    const stub = installStub("suspended");
    const manager = new AudioManager(levels(0.8, 0.7, 0.9));
    manager.ensureContext();
    manager.unlock();
    expect(stub.resumes).toBe(1);
    expect(manager.state).toBe("running");
  });
});

describe("per-tick steering", () => {
  it("steers playbackRate and loop gains from the vehicle sample", () => {
    const manager = new AudioManager(levels(0.8, 0.7, 0.9));
    manager.update({ rpm: 5500, maxRpm: 7200, slip: 0.35, speedMs: 20 });
    expect(manager.enginePlaybackRate).toBeCloseTo(engineRate(5500, 7200), 10);
    expect(manager.skidLevel).toBeCloseTo(skidGain(0.35), 10);
    expect(manager.windLevel).toBeCloseTo(0.5, 10);
  });

  it("reads the VehicleState spellings and falls back to idle", () => {
    const manager = new AudioManager(levels(0.8, 0.7, 0.9));
    manager.update({ engineRpm: 800, slipIntensity: 0, speedMs: 0 });
    expect(manager.enginePlaybackRate).toBeCloseTo(0.6, 10);
    expect(manager.skidLevel).toBe(0);
    expect(manager.windLevel).toBe(0);
    manager.update(null);
    expect(manager.enginePlaybackRate).toBeCloseTo(0.6, 10);
  });
});

describe("headless safety", () => {
  it("constructs and runs every touchpoint with no AudioContext", () => {
    delete (globalThis as Record<string, unknown>)["AudioContext"];
    expect(() => {
      const manager = new AudioManager(levels(0.8, 0.7, 0.9));
      manager.attachUnlock();
      manager.applyVolumes();
      manager.ensureContext();
      manager.startMenuMusic();
      manager.duckMusicForRace();
      manager.playClick();
      manager.update({ rpm: 5500, slip: 0.4, speedMs: 30 });
      manager.unlock();
      manager.dispose();
    }).not.toThrow();
  });

  it("the shared singleton stays usable with no browser", () => {
    delete (globalThis as Record<string, unknown>)["AudioContext"];
    expect(() => {
      audio.applyVolumes();
      audio.update({ rpm: 800, slip: 0, speedMs: 0 });
    }).not.toThrow();
    expect(audio.state).toBe("suspended");
  });

  it("method aliases share the same reference", () => {
    const manager = new AudioManager(levels(0.8, 0.7, 0.9));
    const proto = AudioManager.prototype as unknown as Record<string, unknown>;
    expect(proto["apply_volumes"]).toBe(proto["applyVolumes"]);
    expect(proto["ensure_context"]).toBe(proto["ensureContext"]);
    expect(proto["attach_unlock"]).toBe(proto["attachUnlock"]);
    expect(proto["start_menu_music"]).toBe(proto["startMenuMusic"]);
    expect(proto["duck_music_for_race"]).toBe(proto["duckMusicForRace"]);
    expect(proto["play_click"]).toBe(proto["playClick"]);
    expect(manager.sfx_gain_value).toBe(manager.sfxGainValue);
    expect(manager.music_gain_value).toBe(manager.musicGainValue);
  });
});

describe("dependency hygiene", () => {
  it("imports only the settings store (no audio library, engine, or physics)", () => {
    const imports = moduleSource
      .split("\n")
      .filter((line) => line.trim().startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).not.toMatch(/howler|tone\.js|\btone\b|three|rapier/i);
    }
    expect(moduleSource).toMatch(/from "\.\/settings"/);
  });
});
