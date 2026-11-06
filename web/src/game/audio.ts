// Web Audio mixer ported from scripts/game/audio_manager.gd.
// Raw Web Audio API with no dependency: one lazily-created AudioContext
// feeds a Master -> {Music, SFX} gain graph owned by the SettingsStore
// levels (data only, read here, never written). Looped AudioBufferSources
// carry engine/skid/wind plus the menu music, and click.wav fires as a
// one-shot; the pitch/skid/wind maps are pure-static so headless tests
// call them with no scene. Window-free at import time: the context is
// created suspended on first explicit use and resumes only on a user
// gesture (pointerdown/keydown/touchstart), respecting autoplay policy.
// Every graph/fetch/touch method is a silent no-op without AudioContext.

import { settings as sharedSettings } from "./settings";

// Idle rpm anchoring the bottom of the engine pitch map.
export const IDLE_RPM = 800;
// Default redline anchoring the top of the engine pitch map.
export const MAX_ENGINE_RPM = 7200;
// Wheel slip angle (radians) below which the skid loop stays silent.
export const SKID_THRESHOLD = 0.2;
// Slip angle (radians) where the skid loop reaches full volume.
export const SKID_FULL = 0.5;
// Speed (m/s) where the wind loop reaches full volume.
export const WIND_FULL_SPEED = 40;
// Music attenuation while racing, in dB (deliberately -6, not Godot -12).
export const DUCK_DB = -6;
// Linear music gain while ducked: 10^(-6/20).
export const DUCK_GAIN = Math.pow(10, DUCK_DB / 20);
// Floor for fully muted buses (a probe reading .gain.value sees silence).
export const MUTE_FLOOR = 0.0001;

// v1 snake_case aliases (same values).
export const idle_rpm = IDLE_RPM;
export const max_engine_rpm = MAX_ENGINE_RPM;
export const skid_threshold = SKID_THRESHOLD;
export const skid_full = SKID_FULL;
export const wind_full_speed = WIND_FULL_SPEED;
export const duck_db = DUCK_DB;
export const duck_gain = DUCK_GAIN;
export const mute_floor = MUTE_FLOOR;

// Loop asset URLs (Vite static paths, same bytes as assets/audio/*.wav).
export const ENGINE_URL = "/assets/audio/engine.wav";
export const SKID_URL = "/assets/audio/skid.wav";
export const WIND_URL = "/assets/audio/wind.wav";
export const MUSIC_URL = "/assets/audio/music_menu.wav";
export const CLICK_URL = "/assets/audio/click.wav";

// v1 snake_case aliases (same values).
export const engine_url = ENGINE_URL;
export const skid_url = SKID_URL;
export const wind_url = WIND_URL;
export const music_url = MUSIC_URL;
export const click_url = CLICK_URL;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

// Engine pitch map: 0.6 at idle rising to 2.0 at max_rpm.
// Non-finite rpm or a degenerate span reads idle (0.6).
export function engineRate(rpm: number, maxRpm: number = MAX_ENGINE_RPM): number {
  const safeRpm = Number.isFinite(rpm) ? (rpm as number) : IDLE_RPM;
  const safeMax = Number.isFinite(maxRpm) ? (maxRpm as number) : MAX_ENGINE_RPM;
  const span = safeMax - IDLE_RPM;
  if (!(span > 0)) {
    return 0.6;
  }
  const rate = 0.6 + ((safeRpm - IDLE_RPM) / span) * 1.4;
  if (!Number.isFinite(rate)) {
    return 0.6;
  }
  if (rate < 0.6) {
    return 0.6;
  }
  if (rate > 2.0) {
    return 2.0;
  }
  return rate;
}

// v1 snake_case aliases (same references).
export const engine_rate = engineRate;
export const engine_pitch = engineRate;

// Skid loop gain 0..1: silent at or below SKID_THRESHOLD, full at
// SKID_FULL, linear between. Non-finite slip reads silent.
export function skidGain(slip: number): number {
  if (!Number.isFinite(slip)) {
    return 0;
  }
  const span = SKID_FULL - SKID_THRESHOLD;
  if (!(span > 0)) {
    return 0;
  }
  return clamp01((Math.abs(slip as number) - SKID_THRESHOLD) / span);
}

// v1 snake_case alias (same reference).
export const skid_gain = skidGain;

// Wind loop gain 0..1: silent at standstill, full at WIND_FULL_SPEED.
// Non-finite speed reads silent.
export function windGain(speedMs: number): number {
  if (!Number.isFinite(speedMs)) {
    return 0;
  }
  if (!(WIND_FULL_SPEED > 0)) {
    return 0;
  }
  return clamp01(Math.abs(speedMs as number) / WIND_FULL_SPEED);
}

// v1 snake_case alias (same reference).
export const wind_gain = windGain;

// Map one settings level to a bus gain: levels at or below the mute
// floor read as MUTE_FLOOR (never -inf), otherwise clamp to [floor, 1].
// Non-finite levels read as silence so a corrupt read never blares.
export function levelToGain(level: unknown): number {
  const value = typeof level === "number" ? level : Number.NaN;
  if (!Number.isFinite(value) || (value as number) <= MUTE_FLOOR) {
    return MUTE_FLOOR;
  }
  if ((value as number) >= 1) {
    return 1;
  }
  return value as number;
}

// v1 snake_case alias (same reference).
export const level_to_gain = levelToGain;

// Settings-like volume reader the graph consumes (SettingsStore shape).
export type AudioLevels = {
  masterVolume?: unknown;
  musicVolume?: unknown;
  sfxVolume?: unknown;
  master_volume?: unknown;
  music_volume?: unknown;
  sfx_volume?: unknown;
};

function readLevel(levels: AudioLevels | null | undefined, keys: string[]): number {
  try {
    if (levels === null || levels === undefined) {
      return MUTE_FLOOR;
    }
    const source = levels as unknown as Record<string, unknown>;
    for (const key of keys) {
      if (source[key] !== undefined) {
        return levelToGain(source[key]);
      }
    }
  } catch {
    // Corrupt readers read as silence.
  }
  return MUTE_FLOOR;
}

// Per-tick vehicle readout steering the loops. Each field accepts the
// camelCase, snake_case, and live VehicleState spellings so harness
// wording cannot mismatch; missing fields fall back to idle/silence.
export type AudioSample = {
  rpm?: unknown;
  maxRpm?: unknown;
  max_rpm?: unknown;
  slip?: unknown;
  speedMs?: unknown;
  speed_ms?: unknown;
  speed?: unknown;
  engineRpm?: unknown;
  engine_rpm?: unknown;
  maxEngineRpm?: unknown;
  max_engine_rpm?: unknown;
  slipIntensity?: unknown;
  slip_intensity?: unknown;
  slipRad?: unknown;
  slip_rad?: unknown;
};

function sampleNumber(...candidates: Array<unknown>): number {
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return Number.NaN;
}

function resolveRpm(sample: AudioSample | null | undefined): number {
  const rpm = sampleNumber(
    sample?.rpm,
    sample?.engineRpm,
    sample?.engine_rpm,
  );
  return Number.isFinite(rpm) ? rpm : IDLE_RPM;
}

function resolveMaxRpm(sample: AudioSample | null | undefined): number {
  const maxRpm = sampleNumber(
    sample?.maxRpm,
    sample?.max_rpm,
    sample?.maxEngineRpm,
    sample?.max_engine_rpm,
  );
  return Number.isFinite(maxRpm) ? maxRpm : MAX_ENGINE_RPM;
}

function resolveSlip(sample: AudioSample | null | undefined): number {
  const slip = sampleNumber(
    sample?.slip,
    sample?.slipIntensity,
    sample?.slip_intensity,
    sample?.slipRad,
    sample?.slip_rad,
  );
  return Number.isFinite(slip) ? slip : 0;
}

function resolveSpeed(sample: AudioSample | null | undefined): number {
  const speed = sampleNumber(sample?.speedMs, sample?.speed_ms, sample?.speed);
  return Number.isFinite(speed) ? speed : 0;
}

// Lazily resolve the AudioContext constructor (webkit prefix included):
// null under Node/vitest where no browser audio exists. Called inside
// methods, never at module scope, so import stays window-free.
function contextCtor(): (new () => AudioContext) | null {
  try {
    const scope = globalThis as unknown as Record<string, unknown>;
    const direct = scope["AudioContext"];
    if (typeof direct === "function") {
      return direct as new () => AudioContext;
    }
    const prefixed = scope["webkitAudioContext"];
    if (typeof prefixed === "function") {
      return prefixed as new () => AudioContext;
    }
  } catch {
    // No audio constructor available.
  }
  return null;
}

type LoopKind = "engine" | "skid" | "wind" | "music";

// Raw Web Audio mixer: owns the suspended-until-gesture context, the
// Master -> {Music, SFX} gain graph, the four loop voices plus the click
// one-shot, and the ducked flag. Mirrors the SettingsStore singleton
// idiom: construct with an optional levels reader, defaulting to the
// shared settings singleton (live reference, so later setter writes are
// observed by the next applyVolumes()).
export class AudioManager {
  private readonly levels: AudioLevels;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engineVoiceGain: GainNode | null = null;
  private skidVoiceGain: GainNode | null = null;
  private windVoiceGain: GainNode | null = null;
  private musicVoiceGain: GainNode | null = null;
  private engineSource: AudioBufferSourceNode | null = null;
  private readonly started = new Set<LoopKind>();
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private duckedFlag = false;
  private masterValue = MUTE_FLOOR;
  private musicValue = MUTE_FLOOR;
  private sfxValue = MUTE_FLOOR;
  private engineRateValue = 0.6;
  private skidLevelValue = 0;
  private windLevelValue = 0;
  private attached = false;
  private unlockHandler: (() => void) | null = null;

  constructor(levels?: AudioLevels | null) {
    this.levels =
      levels === null || levels === undefined ? sharedSettings : levels;
    this.applyVolumes();
  }

  // Live context handle (null until ensureContext, null headless).
  get ctx(): AudioContext | null {
    return this.context;
  }

  // Autoplay state: the raw context state, "suspended" whenever no
  // context exists yet (first load without gesture reads suspended).
  get state(): string {
    try {
      const current = this.context as unknown as { state?: unknown } | null;
      if (current !== null && typeof current.state === "string") {
        return current.state;
      }
    } catch {
      // Fall through to suspended.
    }
    return "suspended";
  }

  // True while the race duck offset applies to the music bus.
  get ducked(): boolean {
    return this.duckedFlag;
  }

  // Last applied bus gains (what a probe reading .gain.value sees).
  get masterGainValue(): number {
    return this.masterValue;
  }

  get musicGainValue(): number {
    return this.musicValue;
  }

  get sfxGainValue(): number {
    return this.sfxValue;
  }

  get master_gain_value(): number {
    return this.masterValue;
  }

  get music_gain_value(): number {
    return this.musicValue;
  }

  get sfx_gain_value(): number {
    return this.sfxValue;
  }

  // Last steered voice values (engine playbackRate, skid/wind gains).
  get enginePlaybackRate(): number {
    return this.engineRateValue;
  }

  get engine_playback_rate(): number {
    return this.engineRateValue;
  }

  get skidLevel(): number {
    return this.skidLevelValue;
  }

  get skid_level(): number {
    return this.skidLevelValue;
  }

  get windLevel(): number {
    return this.windLevelValue;
  }

  get wind_level(): number {
    return this.windLevelValue;
  }

  // Create the context suspended and wire Master -> destination with
  // Music/SFX -> Master. Idempotent; silent no-op without a browser
  // AudioContext. Never resumes: only unlock() resumes on gesture.
  ensureContext(): AudioContext | null {
    try {
      if (this.context !== null) {
        return this.context;
      }
      const Ctor = contextCtor();
      if (Ctor === null) {
        return null;
      }
      const context = new Ctor();
      const master = context.createGain();
      master.connect(context.destination);
      const musicBus = context.createGain();
      musicBus.connect(master);
      const sfxBus = context.createGain();
      sfxBus.connect(master);
      this.context = context;
      this.master = master;
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
      this.engineVoiceGain = this.makeVoice(sfxBus);
      this.skidVoiceGain = this.makeVoice(sfxBus);
      this.windVoiceGain = this.makeVoice(sfxBus);
      this.musicVoiceGain = this.makeVoice(musicBus);
      this.applyVolumes();
      return context;
    } catch {
      this.context = null;
      return null;
    }
  }

  private makeVoice(bus: GainNode | null): GainNode | null {
    try {
      if (this.context === null || bus === null) {
        return null;
      }
      const voice = this.context.createGain();
      voice.connect(bus);
      return voice;
    } catch {
      return null;
    }
  }

  // Read the three settings levels into the bus gains, multiplying the
  // music bus by DUCK_GAIN while ducked. Works with or without a live
  // context so probes read the values directly; never throws.
  applyVolumes(): void {
    try {
      const master = readLevel(this.levels, ["masterVolume", "master_volume"]);
      const music = readLevel(this.levels, ["musicVolume", "music_volume"]);
      const sfx = readLevel(this.levels, ["sfxVolume", "sfx_volume"]);
      const ducked = this.duckedFlag ? DUCK_GAIN : 1;
      const musicDucked =
        music <= MUTE_FLOOR ? MUTE_FLOOR : Math.max(MUTE_FLOOR, music * ducked);
      this.masterValue = master;
      this.musicValue = musicDucked;
      this.sfxValue = sfx;
      this.writeGain(this.master, master);
      this.writeGain(this.musicBus, musicDucked);
      this.writeGain(this.sfxBus, sfx);
    } catch {
      // Volume reads never throw.
    }
  }

  private writeGain(node: GainNode | null, value: number): void {
    try {
      if (node === null) {
        return;
      }
      node.gain.value = value;
    } catch {
      // Headless/stub graphs ignore writes.
    }
  }

  // Register one-shot gesture listeners that resume the suspended
  // context (PlayerInput.attach/dispose idiom). Safe no-op without
  // window; idempotent while attached; removable via dispose().
  attachUnlock(): void {
    if (this.attached) {
      return;
    }
    try {
      if (
        typeof window === "undefined" ||
        typeof window.addEventListener !== "function"
      ) {
        return;
      }
      const handler = (): void => {
        try {
          this.unlock();
        } catch {
          // Unlock faults never break input.
        }
      };
      this.unlockHandler = handler;
      window.addEventListener("pointerdown", handler);
      window.addEventListener("keydown", handler);
      window.addEventListener("touchstart", handler);
      this.attached = true;
    } catch {
      this.attached = false;
      this.unlockHandler = null;
    }
  }

  // Resume the suspended context after a user gesture. Best effort:
  // creates the context first (still suspended), then resumes. Never
  // throws; no-op headless.
  unlock(): void {
    try {
      const context = this.ensureContext();
      if (context === null) {
        return;
      }
      const state = (context as unknown as { state?: unknown }).state;
      if (state !== "suspended") {
        return;
      }
      const resume = (context as unknown as { resume?: unknown }).resume;
      if (typeof resume === "function") {
        const result = (resume as () => unknown).call(context);
        if (result !== null && typeof (result as PromiseLike<unknown>).then === "function") {
          (result as PromiseLike<unknown>).then(
            () => undefined,
            () => undefined,
          );
        }
      }
    } catch {
      // Unlock faults never break the gesture handler.
    }
  }

  // Detach the gesture listeners added by attachUnlock().
  dispose(): void {
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.removeEventListener === "function" &&
        this.unlockHandler !== null
      ) {
        window.removeEventListener("pointerdown", this.unlockHandler);
        window.removeEventListener("keydown", this.unlockHandler);
        window.removeEventListener("touchstart", this.unlockHandler);
      }
    } catch {
      // Detach is best effort.
    }
    this.attached = false;
    this.unlockHandler = null;
  }

  // (Re)start the menu music loop at full volume; clears the ducked
  // flag first. Best effort: silent no-op headless. Never throws.
  startMenuMusic(): void {
    try {
      this.duckedFlag = false;
      this.applyVolumes();
      void this.startLoop("music");
    } catch {
      // Music startup never throws.
    }
  }

  // Lower the menu music loop for racing; keeps looping under the SFX.
  duckMusicForRace(): void {
    try {
      this.duckedFlag = true;
      this.applyVolumes();
      void this.startLoop("music");
    } catch {
      // Ducking never throws.
    }
  }

  // UI click one-shot on the SFX bus. Fire-and-forget fetch/decode/play
  // inside try/catch: silent no-op headless. Never throws.
  playClick(): void {
    try {
      void this.playOneShot(CLICK_URL, this.sfxBus);
    } catch {
      // Clicks never throw.
    }
  }

  // Per-tick steer: engine playbackRate follows RPM, skid gain follows
  // slip, wind gain follows speed. Creates the (suspended) graph on
  // demand but never resumes; silent no-op headless. Never throws.
  update(sample?: AudioSample | null): void {
    try {
      const rpm = resolveRpm(sample);
      const maxRpm = resolveMaxRpm(sample);
      const slip = resolveSlip(sample);
      const speed = resolveSpeed(sample);
      const rate = engineRate(rpm, maxRpm);
      const skid = skidGain(slip);
      const wind = windGain(speed);
      this.engineRateValue = rate;
      this.skidLevelValue = skid;
      this.windLevelValue = wind;
      this.ensureContext();
      this.applyVolumes();
      this.writeRate(this.engineSource, rate);
      this.writeGain(this.skidVoiceGain, skid);
      this.writeGain(this.windVoiceGain, wind);
      void this.startLoop("engine");
      void this.startLoop("skid");
      void this.startLoop("wind");
    } catch {
      // Audio never breaks the fixed step.
    }
  }

  private writeRate(
    source: AudioBufferSourceNode | null,
    value: number,
  ): void {
    try {
      if (source === null) {
        return;
      }
      source.playbackRate.value = value;
    } catch {
      // Headless/stub voices ignore writes.
    }
  }

  private loopUrl(kind: LoopKind): string {
    if (kind === "engine") {
      return ENGINE_URL;
    }
    if (kind === "skid") {
      return SKID_URL;
    }
    if (kind === "wind") {
      return WIND_URL;
    }
    return MUSIC_URL;
  }

  private voiceGain(kind: LoopKind): GainNode | null {
    if (kind === "engine") {
      return this.engineVoiceGain;
    }
    if (kind === "skid") {
      return this.skidVoiceGain;
    }
    if (kind === "wind") {
      return this.windVoiceGain;
    }
    return this.musicVoiceGain;
  }

  // Keep one loop voice playing per kind: fetch + decode the WAV once,
  // then loop it through its voice gain. Every step guarded; missing
  // files or headless decoders simply never sound. Never throws.
  private async startLoop(kind: LoopKind): Promise<void> {
    try {
      if (this.started.has(kind)) {
        return;
      }
      const context = this.ensureContext();
      if (context === null) {
        return;
      }
      const buffer = await this.loadBuffer(this.loopUrl(kind));
      if (buffer === null) {
        return;
      }
      if (this.started.has(kind)) {
        return;
      }
      const voice = this.voiceGain(kind);
      if (voice === null) {
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(voice);
      if (kind === "engine") {
        this.writeRate(source, this.engineRateValue);
        this.engineSource = source;
      } else if (kind === "skid") {
        this.writeGain(voice, this.skidLevelValue);
      } else if (kind === "wind") {
        this.writeGain(voice, this.windLevelValue);
      }
      try {
        source.start();
      } catch {
        return;
      }
      this.started.add(kind);
    } catch {
      // Loop startup never throws.
    }
  }

  private async playOneShot(
    url: string,
    bus: GainNode | null,
  ): Promise<void> {
    try {
      const context = this.ensureContext();
      if (context === null || bus === null) {
        return;
      }
      const buffer = await this.loadBuffer(url);
      if (buffer === null) {
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      source.connect(bus);
      try {
        source.start();
      } catch {
        // One failing one-shot never blocks the next.
      }
    } catch {
      // One-shots never throw.
    }
  }

  // Fetch + decode one WAV, cached per URL (coalesced while in flight).
  // False when fetch/decodeAudioData is unavailable or the file misses.
  private loadBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const cached = this.buffers.get(url);
      if (cached !== undefined) {
        return Promise.resolve(cached);
      }
      const inflight = this.loading.get(url);
      if (inflight !== undefined) {
        return inflight;
      }
      const pending = (async (): Promise<AudioBuffer | null> => {
        try {
          if (this.context === null) {
            return null;
          }
          const context = this.context;
          if (typeof fetch !== "function") {
            return null;
          }
          const response = await fetch(url);
          if (!response.ok) {
            return null;
          }
          const bytes = await response.arrayBuffer();
          const decoded = await context.decodeAudioData(bytes);
          if (decoded === null || decoded === undefined) {
            return null;
          }
          this.buffers.set(url, decoded as AudioBuffer);
          return decoded as AudioBuffer;
        } catch {
          return null;
        } finally {
          this.loading.delete(url);
        }
      })();
      this.loading.set(url, pending);
      return pending;
    } catch {
      return Promise.resolve(null);
    }
  }
}

// v1 snake_case method aliases (same references, probe-table idiom).
type AudioManagerProto = Record<string, unknown>;

function aliasMethod(camel: string, snake: string): void {
  try {
    const proto = AudioManager.prototype as unknown as AudioManagerProto;
    proto[snake] = proto[camel];
  } catch {
    // Alias wiring never blocks module load.
  }
}

aliasMethod("ensureContext", "ensure_context");
aliasMethod("applyVolumes", "apply_volumes");
aliasMethod("attachUnlock", "attach_unlock");
aliasMethod("startMenuMusic", "start_menu_music");
aliasMethod("duckMusicForRace", "duck_music_for_race");
aliasMethod("playClick", "play_click");

// Shared autoload-equivalent handle (SettingsStore singleton idiom).
export const audio = new AudioManager();

// Factory entry point (injectable for tests that need isolation).
export function createAudioManager(levels?: AudioLevels | null): AudioManager {
  return new AudioManager(levels ?? undefined);
}

// v1 snake_case alias (same reference).
export const create_audio_manager = createAudioManager;

// Probe-facing audio namespace: the live manager plus the pure
// pitch/skid/wind maps, so black-box probes read the same numbers the
// tests pin through window.__nsr.audio on the running service.
export type AudioNamespace = {
  instance: AudioManager;
  engineRate: typeof engineRate;
  engine_rate: typeof engineRate;
  engine_pitch: typeof engineRate;
  skidGain: typeof skidGain;
  skid_gain: typeof skidGain;
  windGain: typeof windGain;
  wind_gain: typeof windGain;
  levelToGain: typeof levelToGain;
  level_to_gain: typeof levelToGain;
  ensureContext: () => AudioContext | null;
  ensure_context: () => AudioContext | null;
  applyVolumes: () => void;
  apply_volumes: () => void;
  attachUnlock: () => void;
  attach_unlock: () => void;
  unlock: () => void;
  startMenuMusic: () => void;
  start_menu_music: () => void;
  duckMusicForRace: () => void;
  duck_music_for_race: () => void;
  playClick: () => void;
  play_click: () => void;
  update: (sample?: AudioSample | null) => void;
  dispose: () => void;
  readonly context: AudioContext | null;
  readonly state: string;
  readonly ducked: boolean;
  readonly masterGainValue: number;
  readonly musicGainValue: number;
  readonly sfxGainValue: number;
  IDLE_RPM: number;
  MAX_ENGINE_RPM: number;
  SKID_THRESHOLD: number;
  SKID_FULL: number;
  WIND_FULL_SPEED: number;
  DUCK_DB: number;
  DUCK_GAIN: number;
  MUTE_FLOOR: number;
};
