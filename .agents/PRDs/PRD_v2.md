# PRD v2: Night Street Racer — Web (TypeScript + three.js)

**Status:** v2 — platform rewrite (2026-11-05); supersedes `PRD.md` (Godot, v2 2026-11-01) as the product contract
**Predecessor:** the Godot 4.7 implementation ships and is playable; its visual quality failed the operators' playtest ("graphics was shit"). v1 code/assets stay in this repo as the **reference implementation** — nothing in v2 is a redesign of the game, only of how it is built and how it looks.
**Engine:** three.js r187 · **Language:** TypeScript (strict) · **Physics:** Rapier (WASM) · **Platform:** desktop browsers (Chrome/Edge primary, Firefox supported)

---

## 1. Executive Summary

Night Street Racer is a single-player, night-city street racing game — tuner cars, neon-lit streets, dodging traffic at speed — with genuinely semi-realistic driving physics: weight transfer, believable grip limits, and slides earned through technique rather than a drift button. The handling target remains Most Wanted '05: planted and weighty, where slides are corner-exit tools, not the default way around a corner.

v2 rebuilds the existing, feature-complete game as a web application on three.js + Rapier, driven by two verdicts from testing the Godot build:

1. **The graphics were not good enough.** Root cause was identified, not speculative: the art is intentional placeholder boxes (documented in `docs/CREDITS` as procedural stand-ins) and the lighting did the scene no favors. v2 fixes the look at its foundation — real CC0 asset packs (Kenney city kit + car kit, Poly Haven night HDRIs), a proper emissive+bloom night lighting design, and a visual quality bar treated as an acceptance gate, not a hope.
2. **Distribution should be a link.** A web build removes installs entirely: a friend opens a URL (or unzips one static folder) and drives.

**Core value proposition:** the same MW'05-handling street racer, now one URL away, with a neon-night look that finally matches the fantasy.

**MVP goal statement:** a player opens the link, reaches the menu within seconds, picks a car, races 6 events against AI through traffic on neon night streets, unlocks cars and events by placing well, chases time-trial records, all with keyboard or gamepad at 60 FPS in a desktop browser.

---

## 2. Mission

**Mission:** prove the same complete great-*feeling* street racer can live in a browser — where the driving is the product and the screenshot is the handshake.

**Core principles (carried from v1, one added):**

1. **Feel is the product.** Every decision defers to how the car feels. "Floaty or on-rails" is failure even if everything else works. The custom raycast vehicle model — not a canned vehicle controller — is ported intact.
2. **Complete beats big.** A polished small game with menus, progression, and saves beats a sprawling tech demo.
3. **Free and clean.** All assets CC0 (or CC-BY with credits). No purchased assets, no license ambiguity.
4. **Scope discipline is a feature.** Police, online multiplayer, open world stay *out*; cutting them is what makes shipping possible.
5. **Playable at every step.** Each milestone ends with something you can drive in a browser.
6. **The look is load-bearing (new).** "It plays great but looks bad" is a failed release per the v1 playtest. Visual quality is checked per milestone, and the perf budget protects it (60 FPS is non-negotiable in both directions: no visual bar cut for perf, no perf collapse for visuals).

---

## 3. Target Users

**Primary persona: the developer and their friends** — PC gamers who grew up on NFS Underground/Most Wanted-era street racers and still want that vibe.

| Attribute | v2 detail |
|---|---|
| Platform | Desktop browser on Windows/Linux/macOS; mid-range GPU (GTX 1060 / RX 580 class); mouse/keyboard or gamepad |
| Access | A shared URL (GitHub Pages) or unzipped static folder — zero install, zero accounts |
| Sessions | 15–45 minutes; replay via time trials and unlocking |
| Browsers | Chrome/Edge (primary), Firefox (supported); Safari best-effort |
| Technical comfort | Developer is technical (WSL2); players click a link |

**Key needs:** driving that feels *good within the first 30 seconds*; a loading experience that doesn't feel like death; visible progression; no setup friction.

---

## 4. MVP Scope

### In Scope

**Core gameplay** (ports of working v1 systems; constants preserved)
- [ ] Custom raycast-suspension car on a Rapier rigid body: per-wheel spring/damper suspension, load-sensitive slip-angle tire model with friction-circle cap, torque curve + 5-speed auto, FWD/RWD/AWD, handbrake
- [ ] Driver assists default ON (traction/stability), toggleable; flip/reset recovery with clear-spot probing
- [ ] Chase camera port: exponential lag, FOV 70→85 with speed, shake
- [ ] AI opponents (3–5) driving the same car via racing-line waypoints + rubber banding
- [ ] Ambient traffic: 6 kinematic cars on lane loops, yield-when-blocked, recycle/respawn
- [ ] Night-city district regenerated from the documented grid constants, built from Kenney kits

**The look (new in v2 — the reason for the rewrite)**
- [ ] Kenney City Kit buildings/props/roads + Car Kit tuners (tinted via the existing 4-palette system), scale-normalized at import
- [ ] Poly Haven night HDRI: sky + image-based lighting (PMREM)
- [ ] Emissive-first night design: windows/neon/signs glow, `UnrealBloomPass` tuned so only emissives bloom; fog for depth; headlights + restrained point-light set
- [ ] Wet-look asphalt (low roughness + env reflections — cheap, no SSR)

**Game systems**
- [ ] 6 events (3 circuits, 2 sprints, 1 drift) as data modules with the ported checkpoint coordinates; time-trial mode on every route
- [ ] Race logic: 3 s countdown, directed checkpoints, laps, live positions, timers, results screen
- [ ] Unlock ladder: top 3 opens next event; 1st unlocks cars; persists (localStorage, same schema v1)
- [ ] Garage/car select: 4 tuners, stat labels, color variants, 3D preview
- [ ] UI: main menu, event select (+ race/time-trial toggle), garage, pause, results, settings (volumes, assists, camera shake)
- [ ] HUD: speedometer, gear, lap/position, timer, time-trial delta, drift popup, 2D-canvas minimap

**Content & polish**
- [ ] Audio: engine (pitch-follows-RPM), skid, wind, UI click, menu music — reuses the v1 CC0 WAVs verbatim; Web Audio buses (Master/Music/SFX) + race ducking
- [ ] FX: tire smoke, skid marks, speed feel, brake lights
- [ ] Keyboard + gamepad (Gamepad API, standard mapping)

**Technical & deployment**
- [ ] Vite + TypeScript strict build; pinned three.js version
- [ ] Vitest: ported logic suites + physics assertions with Rapier in Node; Playwright boot smokes; CI on every push
- [ ] Loading screen with progress (Rapier WASM + asset manifest)
- [ ] Static deploy to GitHub Pages (share-a-link) + zip of `dist/`

### Out of Scope (rejected or deferred — unchanged from v1 unless noted)

- [ ] Online multiplayer, split-screen, police/pursuit, car damage, tuning parts, livery editor, open-world free roam, multiple maps (v1 anti-goals stand)
- [ ] Mobile/touch support (desktop browsers only; touch controls deferred)
- [ ] PWA/offline install (post-MVP)
- [ ] WebGPU renderer (WebGL renderer this ship; WebGPU is a later, contained swap)
- [ ] C#/GDExtension-equivalent native WASM modules written by hand (Rapier is the only WASM)
- [ ] Localization, cloud saves, achievements, accounts/DRM

---

## 5. User Stories

1. **As a player, I want the car to feel planted and weighty with slides I earn, so that driving itself is the reason I come back.**
   *Example:* brake in a straight line, feather the throttle at corner exit, and the rear steps out just enough to use the full road width — recoverable, not punishing.
2. **As a player, I want a night city that looks like the fantasy, so that the first screenshot sells the game.**
   *Example:* neon signs bloom over wet asphalt, emissive windows texture the dark, the HDRI sky grounds the skyline — and nothing dims below playability.
3. **As a player, I want to race AI opponents through traffic, so that I get the street-racing thrill.**
   *Example:* a 3-lap circuit vs 5 rivals, position changes on the HUD, a lane-blocking sedan forcing a late call at speed.
4. **As a player, I want to pick a car in the garage, so that I can race in the style I like.**
   *Example:* four tuners with distinct personalities (grip coupe, drifty hatch, balanced sedan, top-end AWD), each with a color choice and a live 3D preview.
5. **As a player, I want podium finishes to unlock the next event and wins to unlock cars, so that there is a reason to keep playing.**
   *Example:* 3rd in Harbor Sprint opens Downtown GP; winning it grants the hatch.
6. **As a player, I want to chase best times in time trials, so that there is replay after unlocking everything.**
   *Example:* solo run with live delta to my personal best, persisted across visits in the same browser.
7. **As a player, I want gamepad support, so that I can play the way racing games are meant to be played.**
   *Example:* triggers for throttle/brake, stick for steering, button for handbrake — plug in and it works.
8. **As a player, I want to send the link to a friend and have them just *play*, so that sharing requires no explanation.**
   *Example:* they open the URL in Chrome, see a progress bar once, and are on the menu inside ~10 s on broadband.
9. **Technical: as the developer, I want the physics verifiable headlessly, so that feel regressions fail CI instead of playtests.**
   *Example:* "reaches 25 m/s within 8 s", "brakes 20→0 m/s within 30 m", "handbrake measurably cuts rear-axle grip" run as Vitest suites with Rapier in Node on every push.

---

## 6. Core Architecture & Patterns

**High-level approach:** a Vite + TypeScript single-page app. three.js renders the world; a DOM overlay is every menu/screen/HUD (the v1 UI was pure text labels + one 2D minimap — DOM is the idiomatic equivalent and keeps the GPU on the game); Rapier owns rigid-body physics; game rules are pure TypeScript modules with **no three.js imports**, so they test in Node exactly like the v1 pure-static GDScript modules tested headless.

**Directory structure:**

```
flash/                          # repo root (v1 Godot game untouched, stays in CI as reference)
├── .agents/PRDs/PRD_v2.md      # this document
├── docs/CREDITS                # extended with Kenney + Poly Haven entries
└── web/                        # v2 project root
    ├── index.html              # canvas + #ui overlay root + loading screen
    ├── package.json / tsconfig.json / vite.config.ts
    ├── public/assets/
    │   ├── cars/               # car GLBs (Kenney Car Kit derivatives, tinted)
    │   ├── city/               # Kenney kit GLBs, HDRI
    │   ├── audio/              # v1 WAVs reused
    │   └── ui/
    ├── src/
    │   ├── main.ts             # boot: Rapier WASM init → asset preload → fixed-step loop
    │   ├── core/               # fixed-step accumulator, typed EventEmitter (signal port), screen router, math/utils
    │   ├── data/               # events.ts, tunes.ts, lanePaths.ts — ported .tres values, no code logic
    │   ├── physics/            # rapier world wrapper (60 Hz step), collider material presets, raycast helpers
    │   ├── vehicles/           # vehicle.ts (ported controller), assists, chase camera, player/gamepad input, fx, paint
    │   ├── ai/                 # racing_line.ts, ai_input.ts, rubber_band.ts (verbatim-port algorithms)
    │   ├── traffic/
    │   ├── race/               # event manager (state machine), route/checkpoints, positions, drift, time trial
    │   ├── game/               # state.ts, settings.ts, save.ts (localStorage), progression.ts, audio.ts (Web Audio)
    │   ├── render/             # renderer, composer+bloom, sky/env, city builder, light rig, materials
    │   └── ui/                 # DOM screens: menu, event-select, garage (3D preview), pause, results, settings, hud, minimap
    └── tests/
        ├── suites/             # vitest: logic + physics-in-Node suites (names mirror tests/suites/*.gd)
        └── e2e/                # Playwright: screen boots, short drive, no console errors
```

**Key patterns (v1 → v2 mapping):**

- **One vehicle for all:** `VehicleController` port keeps the Strategy seam — `use_player_input` toggles between input-table reads (gamepad/keyboard) and field reads (AI/tests), identical physics for player, rivals, and tests.
- **Autoloads → module singletons:** `GameState`/`Settings`/`AudioManager` become imported module objects with the same typed writer/reader APIs (e.g. `select_event()`, `get_last_result()`). SaveSystem/Progression stay pure-static functions.
- **Signals → typed events:** the `onCheckpoint`, onRaceStateChanged style signal wiring becomes a small typed `EventEmitter`; the HUD keeps v1's defensive-subscribe contract (only reacts when a race is attached).
- **Scene tree → router + factories:** `change_scene_to_file` becomes a screen router; `PackedScene` instancing becomes object factories (car config → spawned chassis); node groups become explicitly tracked arrays (`racers[]`).
- **Fixed-step determinism:** one 60 Hz accumulator steps Rapier and all gameplay logic; rendering interpolates/last-states; pause gates the fixed steps, never the DOM.
- **Data-driven everything:** events, tunes, lane paths are data modules — adding an event stays a data change.
- **Flip recovery via teleport-at-step-end:** v1's `_integrate_forces` teleport maps to Rapier's `setTranslation`/`setRotation`/`setLinvel` applied after `world.step()`, keeping the 1.0 s inverted timer and probe radii (2/4/6 m lateral, clear box 2×2×4.4 m).

---

## 7. Tools / Features

### Vehicle physics (the core feature — port, keep the numbers)
- Rapier dynamic rigid-body chassis; 4 manual raycasts per tick
- Suspension: spring 36000 N/m, dampers 4500 bump / 6000 rebound, travel 0.30 m, rest 0.60 m, clamped
- Tires: lateral force from slip angle (load-sensitive, cornering stiffness 12000), friction circle, per-axle grip multipliers, surface grip multipliers; brake lockup and per-wheel slip readouts (drives FX + skid audio)
- Powertrain: torque curve, auto gearbox (shift up 5500 rpm / down 2500 rpm, redline 6800 fuel-cut, hard cap 7200, idle 800), per-axle drive FWD/RWD/AWD, reverse latch needs standstill in 1st
- Handbrake: rear lateral grip × 0.1 + locked rears; brake 5500 N; drag 60 linear / 1.2 quadratic + 150 rolling; reverse max 8 m/s
- Assists: steer damp `×(1 − 0.2·min(|v|/40,1))`, slip damp × 0.25
- Steering max 0.55 rad with speed falloff 0.05; wheel radius 0.33 m

### AI racers
- Racing line bake: curvature from heading changes, corner speeds `√(lat_accel/κ)` clamped 8–28 m/s, backward braking pass `v[i] ≤ √(v[j]² + 2·6·ds)` converged
- Pure pursuit: lookahead `clamp(4 + 0.5·v, 4, 16)` m; steering `−1.5·ang − 0.3·yawRate` clamped ±1; target speed scaled `×clamp(1.2 − 1.5·|ang|, 0.35, 1.0)`; throttle/brake gains 0.5/0.4 with 0.5 deadband; throttle capped `clamp(1 − lat_load/9, 0.25, 1)`
- Rubber band: `clamp(gap·0.08, −3, +3)` m/s vs wrapped-loop leader

### Traffic
- 6 kinematic cars on 3 lane loops (curve points ported from `traffic_paths.tscn`), 9 m/s cruise, accel 6 / brake 12 m/s², forward yield-ray eases speed to 0 when blocked, recycle at 150 m / respawn 30 m ahead

### Night city + look
- Grid regenerated from constants: 60 m blocks, 8 m roads, 68 m pitch; block centers x/z ∈ {−102, −34, 34, 102}; road centerlines {−136, −68, 0, 68, 136}; NS roads y=0, EW roads y=+0.02, curb step 0.3; district half-extent 140 m
- Kenney kit meshes instanced into blocks/props; scale-normalized at import (GLB loader wrapper); emissive window bands + neon signs; instanced rendering everywhere repeated
- Lighting: HDRI env + moon directional; ≤ 8 lights per mesh honored by keeping per-block material/light coupling small; headlights (2 spotlights on the player), a handful of streetlamp points; `UnrealBloomPass` threshold-set so only emissives glow (tunable), ACES filmic tonemap, fog

### Events & progression
- 6 events, checkpoint arrays and rules as per Appendix A; gates radius 10 m at y≈1; validation ported (≥4 gates, 6–14 m radii, circuits 2–5 laps, opponents 0–7, reward 0–5000)
- Order math, wrong-way, progress/positions, drift scoring (12° slip, 10 m/s, factor 1.0), time-trial delta/formatting, ladder + reward cars — all pure functions with v1's exact constants

### UI / HUD
- DOM screens styled dark-neon; HUD = speed/gear/position/timer/delta/drift popup; minimap = 2D canvas with the v1 normalized-XZ math (200×200 px, 4 px gate dots, 6 px player dot)
- Garage preview renders the selected car/color into a small live canvas while in the garage

### Audio & FX
- Web Audio graph: Master→{Music, SFX} gains (settings drive them; ≤0.0001 mutes), engine loop `playbackRate` follows RPM, skid fades in above 0.20 rad slip, wind scales with speed, music on menu, ducking in races, click one-shot on UI
- FX: pooled smoke billboards, skid-mark ring buffer as a dynamic BufferGeometry, brake-light emissive, camera shake (respects setting)

---

## 8. Technology Stack (verified 2026-11-05)

| Layer | Choice | Rationale |
|---|---|---|
| Rendering | **three.js r187** (pinned exact version) | Latest stable at decision time; active monthly cadence; `EffectComposer`+`UnrealBloomPass` mature. WebGPURenderer deliberately avoided (churn); swap possible later. |
| Physics | **Rapier `@dimforge/rapier3d-compat` 0.21.0** | Official WASM bindings (Apache-2.0, ~18M weekly npm downloads; bindings now maintained in the Rapier monorepo). Provides rigid bodies + world raycasts + `addForceAtPoint` — exactly the primitives the ported vehicle needs. `-compat` embeds WASM as base64 (no second network fetch). Jolt's JS port (`jolt-physics`) exists but is ergonomically rough (manual memory); cannon-es (0.20.0, ~4 yrs stale) is fallback only. Rapier's built-in `createVehicleController` (Bullet-style) rejected: different, less tunable model — feel parity wins. |
| Language | **TypeScript, strict** | Porting rigorously validated logic (tunes, save schema, race math) wants types; compiles to plain JS. |
| Build | **Vite** | Standard for three.js; fast HMR for feel-tuning iteration. |
| UI | **DOM + CSS overlay** | Menus/HUD as HTML; 2D-canvas minimap. No UI framework. |
| Audio | **Raw Web Audio API** | Buses, pitch-shift via `playbackRate`, positional-ish mixing; no dependency needed. |
| Tests | **Vitest + Playwright** | Vitest runs logic suites and Rapier physics suites in Node (headless like v1's `run_all.gd`); Playwright boots each screen in a real browser; both exit non-zero on failure for CI. |
| CI/CD | **GitHub Actions + GitHub Pages** | New web workflow (install → typecheck → vitest → build → Playwright smoke → deploy Pages on main). v1 Godot CI keeps running until v2 supersedes it. |
| Assets | **Kenney City Kit (Roads, Industrial), Kenney Car Kit, Poly Haven night HDRIs** | All CC0; real geometry/lighting quality the stand-ins lacked; cohesive low-poly night style. v1 WAVs + night-sky `.hdr` reused (procedural CC0 originals). Car models may later be swapped for JDM-style CC0/CC-BY — license review per file into `docs/CREDITS` either way. |

**State/save:** `localStorage["nsr_save"]` — identical JSON schema v1 (see §10); no backend, no env configuration.

---

## 9. Security & Configuration

**Security scope:** client-only, offline-capable game with no accounts, no servers, no telemetry. Attack surface ≈ nil. No auth, no encryption, no network calls at runtime (asset fetches are same-origin static files).

**Configuration management:**
- Settings persist inside the save document (localStorage, schema v1 §10); volumes/assists/camera-shake same keys/defaults
- No env vars in the app; build config is Vite + `tsconfig`
- Input: keyboard defaults per §10 table; gamepad via Gamepad API standard mapping, deadzone 0.2 pre-normalization

**Deployment considerations:**
- Static output (`dist/`) — deploy to GitHub Pages on main; also zipped for offline sharing
- MIME/CORP headers on Pages are fine out of the box for our asset types (GLB, WAV, HDR from same origin; Rapier WASM is base64-embedded via `-compat`)
- First-load budget: JS+WASM+core assets ≤ 15 MB gz; menu interactive < 10 s on broadband; progress bar the whole way

---

## 10. Save Data Schema & Input Map

**Storage:** `localStorage["nsr_save"]`, written on results/settings change (coalesced debounced write, `flush` on unload) — v1's exact persistence semantics, browser edition. Same lenient-load + strict-validate rules (unknown keys dropped; volumes clamp 0–1; flags strictly bool; records: `best_time_s` > 0, `best_position` ≥ 1, `best_drift_score` ≥ 1 whole).

```json
{
  "version": 1,
  "settings": { "master_volume": 0.8, "music_volume": 0.7, "sfx_volume": 0.9, "assists": true, "camera_shake": true },
  "progress": { "unlocked_events": ["harbor_sprint", "downtown_gp"], "unlocked_cars": ["sedan", "coupe"], "selected_car": "sedan", "selected_color": 2, "current_event": "harbor_sprint" },
  "records": { "harbor_sprint": { "best_time_s": 93.24, "best_position": 1 } }
}
```

**Input map (same actions as v1):**

| Action | Keyboard | Gamepad (standard) |
|---|---|---|
| accelerate | W / Up | RT (axis 5) |
| brake | S / Down | LT (axis 4) |
| steer_left / steer_right | A,D / arrows | Left stick X (± with 0.2 deadzone) |
| handbrake | Space | B / Circle (button 1) |
| look_back | C | L1 (button 9... mapped to v1's pad button) |
| reset_car | R | R3+L3 combo (buttons 7/8 as in v1) |
| pause | Esc | Start (button 6) |

---

## 11. Success Criteria

**MVP success:** a friend opens the link in Chrome, drives within 30 seconds of arrival, finishes an event, and returns tomorrow to unlock the next — with zero explanation from me.

**Visual bar (new, explicit):** a random in-race screenshot plausibly belongs on a store page — neon/bloom/readability checked at milestone gates; night scene never unreadable (contrast + landmarks); no placeholder-looking geometry anywhere a player looks.

**Functional requirements**
- [ ] Car passes the "fun to drive" bar (operator playtest) with MW'05-style planted handling
- [ ] All 6 events completable start-to-finish vs AI
- [ ] Unlock ladder functions and persists across browser restarts (same schema)
- [ ] Traffic present and dodgeable in all street events
- [ ] Time trials record/display best times; drift scores persist
- [ ] Keyboard AND gamepad fully playable (gamepad verified on a real pad)
- [ ] Settings persist; audio buses obey them

**Quality indicators**
- [ ] 60 FPS @ 1080p on GTX 1060-class hardware in the night district (Chrome + Firefox)
- [ ] Physics assertions green in CI (accel/brake/handbrake/suspension-settle/reset/cornering-envelope bands; Rapier may need ≤15% threshold retune vs Jolt — bands, not point values)
- [ ] First-load ≤ ~15 MB gz; menu interactive < 10 s broadband; loading progress shown
- [ ] No console errors during a 30-minute session (Playwright-e2e must show none)
- [ ] Zero crash bugs in a 30-minute playtest

**UX goals:** legible HUD at speed; readable night city; AI competitive but beatable; results screens respect your time; audio never blares (autoplay-safe: AudioContext unlocked on first input gesture).

---

## 12. Implementation Phases

*(No deadline — "build until it's right" stands. Each phase ends playable in a browser.)*

### Phase 1 — Driving foundation (web scaffold)
**Goal:** the same car feel, now in a browser tab.
- [ ] Vite + TS scaffold under `web/`; pin three.js + Rapier; fixed-step loop (60 Hz accumulator)
- [ ] Asset pipeline: GLTFLoader + import scale-normalization; v1 WAVs copied
- [ ] Ported `vehicle.ts` on Rapier (suspension → tire → gearbox chain, assists, reset) + keyboard/gamepad input table
- [ ] Chase camera basic; flat tarmac slab
- [ ] Vitest harness: logic suites (config/save/progression/race-math/tunes) + physics-in-Node suites (named assertions)
- **Validation:** drive the car in the browser; all tests green; physics bands hold (±15% retune budget).

### Phase 2 — City + the look (the reason v2 exists)
**Goal:** the night city finally looks like the fantasy.
- [ ] Download/license-review Kenney kits + Poly Haven HDRI → `docs/CREDITS`
- [ ] Grid city builder from constants + kit meshes (instanced); barriers at route edges
- [ ] Night rig: HDRI env + sky, moon, emissive windows/neon, bloom threshold pass, fog, wet-look roads, headlight spots
- [ ] HUD skeleton (speed/gear) + minimap canvas; garage preview canvas
- **Validation:** 60 FPS check on dev hardware; screenshot-vs-store-page bar; no unreadable zones.

### Phase 3 — Race systems
**Goal:** races happen.
- [ ] Route/checkpoint gates from `data/events.ts`; event-manager state machine (3 s countdown → racing → finished); positions
- [ ] Pause gating; results screen; time-trial delta + records; drift event + scoring popup
- [ ] `GameState`/settings persistence in localStorage (schema v1 exact)
- [ ] Event select with race/time-trial toggle; all 6 events wired
- **Validation:** full race grid→results; TT bests + unlocks persist across reload; drift event scores.

### Phase 4 — Rivals + traffic
**Goal:** the streets are alive.
- [ ] Racing lines per route (port the bake; reuse the stadium test line as fallback); rivals use same vehicle
- [ ] Rubber banding; traffic lane loops + yield/recycle/respawn
- **Validation:** vs 4–5 AI race completable, positions correct; traffic dodgeable; rubber band within ±3 m/s.

### Phase 5 — Full shell + polish
**Goal:** it becomes THE game again, just web.
- [ ] All DOM screens: main menu, event select, garage (grid + colors + preview + lock display), settings, pause, results (unlock/best banners, retry/next/menu)
- [ ] Audio graph complete (engine/skid/wind/music/click + ducking + autoplay-safe unlock)
- [ ] FX complete (smoke, skid marks, brake lights, shake); hinge moments (countdown, finish)
- **Validation:** PRD §11 functional checklist walk-through with gamepad.

### Phase 6 — Perf, CI, ship
**Goal:** shareable.
- [ ] Perf pass (instancing audit, bloom resolution budget, draw-call budget < ~1500, asset weight trim)
- [ ] Playwright e2e suite (screens boot; 10 s drive; clean console) into CI; Pages deploy
- [ ] 30-minute friend-test; fix list; re-cut
- **Validation:** §11 quality indicators all checked; the link is live.

---

## 13. Future Considerations (post-MVP)

- WebGPU renderer swap (contained: renderer + composer only behind an interface)
- PWA install/offline; itch.io / Newgrounds embeds as extra channels
- Tauri wrapper to honor v1's native Windows/Linux zips if wanted
- JDM-style CC0/CC-BY car models to replace Kenney Car Kit (with license review pass)
- More districts (docks/industrial), performance tuning garage, photo mode — same v1 wish list, still gated on shipping v2

---

## 14. Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Feel parity with the Jolt-tuned v1 car** — Rapier's solver differs (integration, contact model) | The one thing that matters regresses | Port the model, not a canned controller; keep named physics-band assertions as CI tests (±15% retune budget); operator "fun to drive" verdict at milestone gates, unchanged from v1 |
| 2 | **The look misses again** — lighting design is craft, not a library | Rewrite fails its reason to exist | Real assets first (Kenney/Poly Haven), emissive-first design + bloom threshold discipline, per-milestone screenshot bar, three.js lighting/postprocessing skills as the technique reference |
| 3 | **Night-city perf in WebGL** — no Forward+ clustered lighting like Godot | 60 FPS at risk on mid-range | Emissive+bloom-first (few real lights, ≤8/mesh coupling), instancing, half-res bloom, DOM UI (no extra passes), draw-call budget gate in Phase 6 |
| 4 | **Load weight / first-run friction** | Kills the share-a-link promise | `-compat` WASM embed, asset manifest with progress, ≤15 MB gz budget, code-split screens |
| 5 | **Browser API sharp edges** — AudioContext autoplay policy, gamepad variance, Safari | Broken first impression | Unlock audio on first gesture; deadzone-normalized input abstraction; Chrome/Edge/Firefox primary matrix, Safari best-effort documented |
| 6 | **three.js release churn** (每月-ish majors, deprecations) | Mid-build breakage | Pin exact version; upgrade as conscious PRs with the migration-guide ritual |

---

## 15. Appendix

### A. Ported event data (all 6, gates as (x, z), y=1, radius 10.0)

| Event | Type/laps/rivals | Reward | Unlock req | Checkpoints (x, z) |
|---|---|---|---|---|
| harbor_sprint | sprint · 1 lap · 3 AI | 500 | — (start) | (−102,136) (−51,136) (0,136) (51,136) (102,136) |
| downtown_gp | circuit · 3 laps · 5 AI | 1500 | harbor_sprint | (−68,−68) (0,−68) (68,−68) (68,0) (68,68) (0,68) (−68,68) (−68,0) |
| neon_loop | circuit · 2 laps · 4 AI | 1200 | downtown_gp | (−136,−136) (0,−136) (136,−136) (136,0) (136,136) (0,136) (−136,136) (−136,0) |
| bayline_circuit | circuit · 2 laps · 4 AI | 1000 | neon_loop | (−136,−68) (−68,−68) (−68,0) (−68,68) (−136,68) (−136,0) |
| alley_sprint | sprint · 1 lap · 3 AI | 750 | bayline_circuit | (68,−102) (68,−51) (68,0) (68,51) (68,102) |
| drift_park | drift · 1 judged run · 3 AI | 1000 | alley_sprint | (−102,−102) (−51,−51) (0,0) (51,51) (102,102) |

Time-trial mode available on every route (solo, `mode: "time_trial"`).

### B. Car tunes (ported from `assets/cars/tunes/*.tres`)

| Field | sedan (default) | coupe (sport) | hatch (drift) | awd (drag) |
|---|---|---|---|---|
| engine_torque (Nm) | 380 | 450 | 340 | 520 |
| gear_ratios | 3.2/2.1/1.5/1.1/0.85 | same | same | 3.4/2.2/1.6/1.2/0.9 |
| final_drive | 3.9 | 4.1 | 3.7 | 4.3 |
| tire_grip_front / rear | 1.00 / 1.00 | 1.15 / 1.10 | 1.05 / **0.85** | 0.95 / **1.05** |
| roll_stiffness front / rear | 8000 / 6500 | 10000 / 8500 | **9000 / 2500** | 7000 / 7500 |
| downforce coeff | 1.2 | 1.8 | 0.6 | 0.8 |
| drivetrain | RWD | FWD | RWD | AWD |

Fun ranges (validated at runtime): torque 250–550; gears 4–6 strictly decreasing 0.5–4.0; final drive 2.5–4.5; axle grip 0.8–1.4; roll 0–15000; downforce 0–3.

### C. v1 → v2 reference map

| v1 (Godot, keep as reference) | v2 (web) |
|---|---|
| `scripts/vehicles/vehicle_controller.gd` (550 L) | `web/src/vehicles/vehicle.ts` |
| `scripts/{race,ai,game}/*.gd` pure logic | `web/src/{race,ai,game}/*.ts` + `web/src/data/*` |
| `scripts/game/save_system.gd` (user://save.json) | `web/src/game/save.ts` (localStorage, same schema) |
| Autoloads (GameState/Settings/AudioManager) | module singletons, same APIs |
| `.tres` events/tunes/line | `web/src/data/*.ts` (Appendix A/B) |
| `district_night.tscn` baked grid | `web/src/render/city.ts` from same constants |
| `tests/run_all.gd` + 12 suites | `web/tests/suites/*.test.ts` (names mirrored) |
| Godot CI (boot checks + suite) | web CI (typecheck, vitest, Playwright, Pages) |
| InputMap | input table + Gamepad API |

### D. Supporting agent skills installed (2026-11-05)

Technique references loaded into `~/.agents/skills/` and to be consulted during phases: `threejs-fundamentals`, `threejs-lighting`, `threejs-postprocessing`, `threejs-materials`, `threejs-loaders` (cloudai-x/threejs-skills); `game-feel`, `physics-tuning`, `camera-systems`, `game-ai`, `performance-optimization`, `save-systems`, `game-ui-ux`, `audio-design`, `input-systems` (gamedev-skills/awesome-gamedev-agent-skills); `antfu/skills@vite`, `antfu/skills@vitest`; `wshobson/agents@typescript-advanced-types`.

### E. Decision log (v2, this conversation)

| Decision | Choice | Source |
|---|---|---|
| Platform | Desktop web, share-a-link (GitHub Pages + zip) | User |
| Language | TypeScript strict | User |
| Art | Real CC0 packs (Kenney city + car kit, Poly Haven HDRI) | User |
| Visual direction | Neon night done well — emissive+bloom carried, no realism chase | User |
| Physics | Port custom raycast model onto Rapier; built-in vehicle controller rejected | Research + recommendation |
| Renderer | WebGL (WebGPURenderer deferred) | Research |
| Engine note | v1 Godot build frozen in-repo as reference; its CI continues until superseded | Builder call |
| Trigger for v2 | v1 playtest: visual quality failed the bar (assets were documented stand-ins) | User |

**Key research sources:** three.js releases (r187, 2026-10-30), Rapier JS vehicle-controller guide (API: `createVehicleController`/`addWheel`/`setWheelSuspension*/setWheelEngineForce/setWheelSteering/updateVehicle`), `@dimforge/rapier3d-compat` npm (0.21.0), JoltPhysics.js README, cannon-es npm (0.20.0), kenney.nl 3D assets, skills.sh ecosystem for the supporting agent skills.
