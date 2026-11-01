# PRD: Night Street Racer

**Status:** v2 — factory delivery amendment (2026-11-01)
**Date:** 2026-11-01
**Engine:** Godot 4.7 stable · **Language:** GDScript · **Platforms:** Windows, Linux

---

## 1. Executive Summary

Night Street Racer is a single-player, night-city street racing game built with Godot 4.7. It delivers the classic NFS street-racing fantasy — tuner cars, neon-lit streets, dodging traffic at speed — on top of genuinely semi-realistic driving physics: weight transfer, believable grip limits, and slides that are earned through technique rather than a drift button. The handling target is Most Wanted '05: planted and weighty, where slides are corner-exit tools, not the default way around a corner.

The game is scoped as a **small complete game**: one lovingly built night-city district with several race routes, four tuner cars built from free/CC0 models, AI opponents, ambient traffic, and a full game shell (menus → event select → garage → race → results → unlock progression, saved locally). It ships as a polished, playable build for Windows and Linux that can be handed to friends.

**Core value proposition:** the handling feel of a sim-cade car physics model wrapped in an accessible, atmospheric street-racing package that a solo developer can actually finish.

**MVP goal statement:** a player can start the game, pick a car, race 6–8 events against AI through traffic on neon night streets, unlock cars and events by placing well, chase time-trial records, and do it all with keyboard or gamepad at 60 FPS.

---

## 2. Mission

**Mission:** prove that a solo developer + AI pairing can ship a complete, great-*feeling* racing game in Godot — where the driving itself is the product.

**Core principles:**

1. **Feel is the product.** Every decision defers to how the car feels to drive. "Floaty or on-rails" is failure even if everything else works.
2. **Complete beats big.** A polished small game with menus, progression, and saves beats a sprawling tech demo.
3. **Free and clean.** All assets are CC0 (or CC-BY with a credits screen). No purchased assets, no license ambiguity.
4. **Scope discipline is a feature.** Police chases, online multiplayer, and open worlds are explicitly *not* in this game — cutting them is what makes shipping possible.
5. **Playable at every step.** Each development milestone ends with a build you can actually drive.

---

## 3. Target Users

**Primary persona: the developer and their friends** — PC gamers who grew up on NFS Underground/Most Wanted-era street racers and still want that vibe, but don't need live service features.

| Attribute | Detail |
|---|---|
| Platform | Windows or Linux desktop, mid-range GPU (GTX 1060 / RX 580 class or better) |
| Input | Gamepad preferred (Xbox-style), keyboard supported |
| Sessions | 15–45 minute sessions; replayability via time trials and unlocking |
| Technical comfort | The developer is technical (WSL2 dev environment); players are not |

**Key needs:** driving that feels *good within the first 30 seconds*; visible progression; no setup friction (download, unzip, play).

---

## 4. MVP Scope

### In Scope

**Core gameplay**
- [ ] Custom raycast-suspension car physics on `RigidBody3D` (per-wheel suspension, slip-based tire model, friction circle, auto gearbox, handbrake)
- [ ] MW'05-style handling tuning: planted baseline, progressive slides, forgiving limits
- [ ] Driver assists default ON (mild traction/stability), toggleable in settings
- [ ] Chase camera with speed-based FOV/dynamics
- [ ] AI opponents (3–5 per race) using the same car physics via racing-line waypoints
- [ ] Ambient traffic: kinematic cars on lane paths that yield when blocked (dodge-only, non-physical)
- [ ] Drivable night-city district: grid streets from modular CC0 kits, neon/emissive lighting, night sky HDRI

**Game systems**
- [ ] 6–8 events: 3 circuit races, 2 sprints, time trial on every route; 1 drift event (stretch)
- [ ] Race logic: countdown, checkpoints, laps, live positions, timers, results screen
- [ ] Unlock ladder: top 3 opens the next event; 1st place unlocks cars
- [ ] Garage/car select with 4 tuner cars and color variants
- [ ] Save/load to `user://` (unlocks, best times, settings)
- [ ] UI: main menu, event select, garage, pause, results, settings (volume, assists)
- [ ] HUD: speedometer, gear, lap/position, timer, minimap, drift score popup

**Content & polish**
- [ ] 4 tuner car models (CC0 from Grab3D/Sketchfab; CC-BY fallback with credits)
- [ ] Engine, tire-skid, and wind audio; UI sounds; 1–2 free music tracks
- [ ] Effects: tire smoke, skid marks (stretch), speed effects
- [ ] Keyboard + Xbox-style gamepad input

**Technical & deployment**
- [ ] Godot 4.7 stable, GDScript, Jolt physics (engine default), Forward+ renderer
- [ ] Export presets for Windows and Linux
- [ ] Performance target: 60 FPS at 1080p on mid-range hardware

### Out of Scope (deferred or rejected)

**Gameplay**
- [ ] Online multiplayer (rejected — biggest scope multiplier; revisit post-MVP)
- [ ] Local split-screen (rejected for MVP)
- [ ] Police/pursuit system (rejected — a whole AI system)
- [ ] Car damage (rejected)
- [ ] Performance tuning/upgrade parts (rejected)
- [ ] Livery/paint editor (color variants only)
- [ ] Open-world free-roam city (rejected — single district with routes instead)
- [ ] Multiple maps (one district at launch)

**Technical**
- [ ] Mobile or web export (Jolt has no web support; mobile is out of audience)
- [ ] C# or GDExtension native code (GDScript is sufficient at this scale)
- [ ] Localization (English only)
- [ ] Cloud saves, achievements, DRM

---

## 5. User Stories

1. **As a player, I want the car to feel planted and weighty with slides I earn, so that driving itself is the reason I come back.**
   *Example:* taking a tight corner, I brake in a straight line, feather the throttle on exit, and the rear steps out just enough to use the full road width — recoverable, not punishing.

2. **As a player, I want to race AI opponents through neon-lit streets at night, so that I get the street-racing thrill.**
   *Example:* a 4-lap circuit race against 4 rivals through downtown blocks, position changes visible on the HUD, neon reflecting off wet-looking asphalt.

3. **As a player, I want traffic to dodge, so that races feel risky and alive.**
   *Example:* a sedan pulls out mid-race; I have to choose between a late lane change or bleeding speed.

4. **As a player, I want to pick a car in the garage, so that I can race in the style I like.**
   *Example:* four tuners with distinct weight/grip/power personalities (grip coupe, drifty hatch, balanced sedan, top-end AWD), each with a color choice.

5. **As a player, I want podium finishes to unlock the next event and wins to unlock cars, so that there's a reason to keep playing.**
   *Example:* finishing 3rd in "Harbor Sprint" opens the next event; winning it adds a new car to the garage.

6. **As a player, I want to chase my best times in time trials, so that there's replay after unlocking everything.**
   *Example:* a ghost-free solo run of any unlocked route with live delta to my personal best.

7. **As a player, I want gamepad support, so that I can play the way racing games are meant to be played.**
   *Example:* triggers for throttle/brake, stick for steering, button for handbrake — plugged in and it just works.

8. **Technical: as the developer, I want one car controller class shared by player and AI, so that physics fixes and tuning apply everywhere.**
   *Example:* an AI car and the player car use identical `VehicleController` logic; only the input *source* differs (human input vs. racing-line AI).

---

## 6. Core Architecture & Patterns

**High-level approach:** idiomatic Godot 4 scene-tree architecture. Composition over inheritance; node-based features; autoload singletons only for cross-cutting concerns (game state, save system, settings, audio).

**Directory structure:**

```
flash/                          # repo root & Godot project root
├── project.godot
├── .agents/PRDs/PRD.md
├── docs/                       # design notes, credits/licenses
├── addons/                     # third-party plugins (if any)
├── assets/
│   ├── cars/                   # GLB models, per-car materials
│   ├── city/                   # modular blocks, props, roads, HDRI
│   ├── audio/                  # engine loops, skids, music
│   └── ui/                     # fonts, icons, menu textures
├── scenes/
│   ├── vehicles/               # player/AI/traffic car scenes
│   ├── city/                   # district, blocks, routes
│   ├── races/                  # event scenes, checkpoints
│   └── ui/                     # menus, HUD, garage, results
├── scripts/
│   ├── vehicles/               # VehicleController, tire/suspension code
│   ├── ai/                     # racing line, target speeds, rubber-banding
│   ├── race/                   # event manager, checkpoints, positions
│   ├── game/                   # autoloads: GameState, SaveSystem, Settings, Audio
│   └── ui/
└── tests/                      # headless sanity tests (physics, save)
```

**Key patterns:**

- **VehicleController (Strategy):** one physics car class; input source is swappable (`PlayerInput`, `AIRacerInput`). All cars are the same physics object.
- **Autoload singletons:** `GameState` (current event, race results), `SaveSystem` (JSON in `user://`), `Settings` (volume/assists), `AudioManager`.
- **Event Manager (state machine):** `COUNTDOWN → RACING → FINISHED`; checkpoints form a directed route graph; position calc = progress (checkpoint index + fractional distance) × lap.
- **Signal-driven UI:** race state emits signals; HUD subscribes. No UI code inside physics.
- **Data-driven events:** each event is a `Resource` (route, opponents, unlock rules, rewards) — adding events requires no new code.

---

## 7. Tools / Features

### Vehicle physics (the core feature)
- `RigidBody3D` chassis + 4 `RayCast3D` wheels: spring/damper suspension with travel limits
- Tire model: lateral force from slip angle (load-sensitive); longitudinal traction capped by friction circle; combined slip so braking kills cornering grip
- Powertrain: engine torque curve, simple automatic gearbox, per-axle drive (FWD/RWD/AWD per car)
- Handbrake: cuts rear grip for initiation
- Surfaces: grip multipliers (tarmac, curb/paint, off-street)
- Fixed 60 Hz physics tick; assists (traction control, mild stability) as post-processing forces

### AI racers
- Racing-line waypoints with per-corner target speeds (curvature-based)
- Same `VehicleController`; steering/throttle/brake computed from lookahead point
- Mild rubber-banding (subtle catch-up/slow-down within bounds)

### Traffic
- Kinematic cars on lane paths (`Path3D`), loop around the district
- Yield when blocked (forward raycast); never intentionally race the player
- Respawn/recycle distant cars to keep counts low

### Night city district
- Grid of city blocks from modular CC0 kits; route-specific checkpoint placement
- Lighting: emissive windows/neon + bloom carry the scene; a handful of omni lights near the player; meshes split per block (avoid the >8-lights-per-mesh flicker); moon directional + ambient; HDRI sky
- Invisible barriers and curb collision at route edges

### Events & progression
- Event `Resource`: route, type (circuit/sprint/time-trial/drift), opponent count, unlock requirement, reward
- Unlock rule: **top 3** finishes unlock the next event; **1st place** unlocks cars
- Time trial available on every route once unlocked

### UI/HUD
- Speedometer + gear, lap/position, race timer, minimap (top-down `SubViewport`), drift score popup
- Menus: main, event select, garage (car + color), pause, results, settings

### Save system
- `user://save.json`, versioned schema (see §10), written on results/settings change

---

## 8. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Engine | Godot 4.7 stable | Matches the factory `godot-base` snapshot (laps run `godot --headless` for verification); Jolt default 3D physics; Forward+ renderer |
| Physics | Jolt (engine default) | Fast, stable rigid bodies; custom car model sits on top |
| Language | GDScript | Right-sized for scope; fastest iteration; all community vehicle references are GDScript |
| Renderer | Forward+ (Vulkan) | Emissive-heavy night look depends on strong glow/lighting; 60 FPS @ 1080p on mid-range GPUs |
| Version control | git | From first commit |

**Assets (all free):**
- Cars: [Grab3D CC0 cars](https://grab3d.com/free-3d-models/car) (~53 game-ready GLB), [Sketchfab filtered to CC0](https://sketchfab.com/tags/jdm) for tuner styles; CC-BY fallback with credits screen
- City: Kenney CC0 city/road kits + [itch.io CC0 city assets](https://itch.io/game-assets/free/tag-3d/tag-city)
- Sky: Poly Haven night HDRIs
- Audio: freesound/sonniss-style free engine loops and music (license-checked per file)

**Study material (read, don't depend on):** [Octodemy custom raycast vehicle series](https://www.youtube.com/playlist?list=PLiRELyH-yJivTRnpjr0nHeGWncLiMmD2D), [kv-vehicle addon](https://katfish-whiskers.itch.io/kv-vehicle-godot) (fallback option B), RacingGodot source.

---

## 9. Security & Configuration

**Security scope:** offline single-player game with no accounts, no network code, no user-generated content sharing. Attack surface is essentially nil. Out of scope: authentication, encryption, anti-cheat, telemetry.

**Configuration management:**
- Settings persisted in `user://save.json` (volume levels, assists toggle, camera options)
- Input map via Godot's built-in `InputMap` (remappable in settings — stretch)
- Display settings (window mode, vsync) via Godot defaults

**Deployment considerations:**
- Export presets: Windows (x86_64) and Linux (x86_64)
- Distribution: zip archive shared directly with friends (no store at MVP)
- `docs/` carries a CREDITS file for CC-BY attributions

---

## 10. Save Data Schema (stands in for API spec — no backend)

```json
{
  "version": 1,
  "settings": {
    "master_volume": 0.8,
    "music_volume": 0.7,
    "sfx_volume": 0.9,
    "assists": true,
    "camera_shake": true
  },
  "progress": {
    "unlocked_events": ["harbor_sprint", "downtown_gp"],
    "unlocked_cars": ["silvia_style", "hatch_drift"],
    "selected_car": "silvia_style",
    "selected_color": 2
  },
  "records": {
    "harbor_sprint": { "best_time_s": 93.24, "best_position": 1 },
    "downtown_gp":   { "best_time_s": 214.70, "best_position": 3 }
  }
}
```

**Input map (default):**

| Action | Keyboard | Gamepad |
|---|---|---|
| accelerate | W / Up | RT |
| brake | S / Down | LT |
| steer | A/D / arrows | Left stick X |
| handbrake | Space | B / Circle |
| look back | C | L1 |
| reset car | R | L3 + R3 |
| pause | Esc | Start |

---

## 11. Success Criteria

**MVP success:** a friend can download the build, drive within 30 seconds, finish an event, and come back tomorrow to unlock the next one — without the developer explaining anything.

**Functional requirements**
- [ ] Car passes the "fun to drive" bar (user playtest verdict) with MW'05-style planted handling
- [ ] All 6–8 events completable start-to-finish vs. AI
- [ ] Unlock ladder functions and persists across restarts
- [ ] Traffic present and dodgeable in all street events
- [ ] Time trials record and display best times
- [ ] Keyboard and gamepad both fully playable
- [ ] Settings (volume, assists) persist

**Quality indicators**
- [ ] 60 FPS at 1080p on GTX 1060-class hardware in the district at night
- [ ] No physics glitches visible in normal driving (no car-through-floor, no suspension explosions after resets)
- [ ] Load time under 10 seconds to menu
- [ ] Zero crash bugs in a 30-minute play session

**User experience goals:** legible HUD at speed; readable night city (contrast, landmarks); AI that feels competitive but beatable; results screens that respect your time.

---

## 12. Implementation Phases

*(No deadline — "build until it's right" was chosen; estimates are effort, not calendar.)*

### Phase 1 — Driving foundation (milestones 1–2)
**Goal:** the car feels great before anything else exists.
**Deliverables:**
- [x] Repo initialized; PRD committed (done at factory onboarding)
- [ ] Walking skeleton (first factory issue): `project.godot` scaffold — folders, input map, physics tick, Forward+ settings — plus the headless test contract of §16 (`tests/run_all.gd` runner) and the GitHub Actions CI workflow that runs it
- [ ] `VehicleController`: suspension, tire model, gearbox, handbrake — with the §16 physics assertions passing
- [ ] Grey-box test ground; chase camera; gamepad input
- [ ] MW'05-style tuning pass
**Validation:** machine gates (§16) pass on every lap; the "fun to drive" verdict and gamepad checks are **operator gates** (human, not laps); kv-vehicle fallback decision made (trigger: 3 failed tuning iterations).

### Phase 2 — World & race systems (milestones 3–4)
**Goal:** the district exists and races happen in it.
**Deliverables:**
- [ ] City district from modular CC0 kits; night lighting; collisions/barriers
- [ ] Traffic on lane paths
- [ ] Checkpoint routes + event `Resource`s (3 circuits, 2 sprints)
- [ ] Race state machine: countdown → racing → finished; positions, laps, timers
- [ ] AI opponents on racing lines
- [ ] Results screen
**Validation:** full race from grid to results against 4 AI with traffic on.

### Phase 3 — Game shell & polish (milestones 5–6)
**Goal:** it becomes a complete game.
**Deliverables:**
- [ ] Menus: main, event select, garage (cars + colors), pause, settings
- [ ] Unlock ladder + save system
- [ ] Time trials on all routes
- [ ] Drift event (stretch)
- [ ] Audio: engine/skid/wind, music, UI sounds
- [ ] Effects: tire smoke, speed effects
- [ ] Performance pass + Windows/Linux export presets
**Validation:** success criteria in §11 all checked; a 30-minute friend-test with no crash and at least one "this is fun" comment.

---

## 13. Future Considerations (post-MVP)

- Local split-screen via `SubViewport`s (moderate; documented path)
- Online multiplayer (large; only after the game merits it)
- Police pursuit events (NFS signature tension; a dedicated AI system)
- Performance parts & tuning garage
- Second district (docks/industrial) and free-roam mode
- Livery editor, photo mode, leaderboards (local first, online later)
- Steam release (achievements, cloud saves)

---

## 14. Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Custom car physics doesn't reach the fun bar** — the highest-probability, highest-impact risk | Project fails its core promise | Milestone gates with explicit user playtest verdicts; study Octodemy series + kv-vehicle source; **hard fallback: switch to kv-vehicle addon after 3 failed tuning iterations** rather than iterating forever |
| 2 | **CC0 tuner car quality gap** — true CC0 JDM-style models are rare | Garage looks cheap; breaks the NFS fantasy | Prefer Grab3D + Sketchfab CC0 filter; accept CC-BY with credits screen; constrain scope to 4 cars; color variants add variety cheaply |
| 3 | **WSL2 gamepad blind spot** — WSLg doesn't expose gamepads, but gamepad support is a day-one requirement | Shipping with broken controls | Validate input via exported Windows builds run natively on the Windows host; keep a per-milestone "controller check" step |
| 4 | **Night-city performance** — many lights and emissive surfaces can tank FPS (documented Godot pitfalls: >8 lights/mesh flicker, omni-light overhead) | Misses the 60 FPS target on mid-range GPUs | Emissive+bloom-first lighting strategy; split meshes per block; few real lights near player; dedicated perf pass in Phase 3; Forward+ renderer chosen deliberately |
| 5 | **Scope creep** — police, online, open world are all "one more feature" temptations | The game never ships | Anti-goals and out-of-scope list in this PRD are the contract; new ideas go to §13, not the backlog |

---

## 15. Appendix

**Key research sources (from the design conversation):**
- Godot downloads: https://godotengine.org/download/archive
- `VehicleBody3D` issues (why we build custom): https://steamcommunity.com/app/404790/discussions/0/601903848320179690/
- Custom raycast vehicle series: https://www.youtube.com/playlist?list=PLiRELyH-yJivTRnpjr0nHeGWncLiMmD2D
- kv-vehicle addon (fallback): https://katfish-whiskers.itch.io/kv-vehicle-godot
- Godot Road Generator: https://github.com/theduckcow/godot-road-generator
- OmniLight3D clustered-lighting docs (8-lights-per-mesh limit): https://docs.godotengine.org/en/4.3/classes/class_omnilight3d.html
- Night-city light flicker case study: https://github.com/godotengine/godot/issues/67508
- CC0 car models: https://grab3d.com/free-3d-models/car · https://opengameart.org/content/cc0-3d-vehicles-and-cars
- CC0 city assets: https://itch.io/game-assets/free/tag-3d/tag-city
- Split-screen reference (future): https://www.gdquest.com/library/split_screen_coop

## 16. Factory Delivery Amendment (2026-11-01)

This project is built by the **pi-dark-factory**: unattended laps take the oldest claimable GitHub issue through plan → implement → verify (CI + black-box scenarios) → review → squash-merge. The PRD sections above remain the product contract; this amendment defines what changes when a machine, not a human pair, does the laps.

### Machine-verifiable acceptance (every lap)

All verification runs headless against the `godot-base` snapshot (Godot 4.7 stable, web export templates, git, Python, Node):

1. **Import-clean gate:** `godot --headless --path . --import` exits 0 — no parse errors, no missing resources, no script compile failures.
2. **Test suite:** `tests/run_all.gd` — a SceneTree-based GDScript runner where each test is a function returning `bool`; the runner prints per-test results and **exits non-zero on any failure** (so CI and scenario probes can gate on the exit code). Tests live in the repo and are visible to the implementer.
3. **Named physics assertions** (added to the suite as the car takes shape): car reaches ≥ N m/s within T seconds on flat tarmac from standstill; stops from V within D metres under full brake; handbrake measurably reduces rear-axle lateral grip (slide initiates); suspension returns to rest without sustained oscillation after a drop; car resets cleanly after a flip; save round-trips (write → load → equal).
4. **Scene boot checks:** the boot/menu scenes instantiate without errors in headless mode (`--quit-after` a few frames, exit 0).
5. **CI workflow:** the first issue ships `.github/workflows/ci.yml` running (1) and (2) on every PR — the factory's merge gate autodetects these checks from the next lap onward.

The black-box scenario probes grow per issue, sized to the currently claimable issue — they start at "project imports clean + `project.godot` present" and accumulate the §16 assertions as laps merge. Scenario files stay outside the repo (verifier-owned, never shown to the implementer).

### Operator checklist (never becomes an issue)

These gates need a human and stay out of the sliced backlog:

- [ ] **Feel verdicts** at milestone gates: "fun to drive" per the MW'05 target; the kv-vehicle fallback tripwire (3 failed tuning iterations) is an operator decision
- [ ] **Gamepad verification** via a native Windows export run on the Windows host (WSLg/instabox have no gamepads)
- [ ] **Exports & distribution:** install Windows/Linux export templates locally, cut release builds, package the share-with-friends zip
- [ ] **Asset license review:** CC0/CC-BY verification per model before it lands; maintain `docs/CREDITS`
- [ ] **Performance validation:** 60 FPS @ 1080p on mid-range hardware (headless CI cannot measure real frame rates)

### Slicing notes

- The first sliced issue is the **walking skeleton**: project scaffold + input map + `tests/run_all.gd` contract + CI workflow — machine-verifiable on day one.
- Subjective bars ("MW'05 feel", "forgiving") are implemented as *tunable parameters with machine-checked ranges* in laps, while the subjective judgement itself happens at operator gates.
- Asset-download issues pin exact URLs and licenses in the issue body; the CREDITS file is part of the deliverable.

### Factory configuration

- Repo: `techafreshh/night-street-racer` (public) · env: **instabox**, snapshot **`godot-base`** · models: **muse-spark-1.3-contributor** on all stages (plan/implement `xhigh`, review/default `high`) — mirrors the proven `jetpack` (Godot) configuration.

---

**Decision log (from the brainstorming conversation):**

| Decision | Choice | Source |
|---|---|---|
| Feel target | NFS street racing | User |
| Ambition | Small complete game | User |
| Multiplayer | None for MVP (AI + time trials) | User |
| Assets | Free / CC0-first | User |
| Handling tuning target | Most Wanted '05 (planted, weighty) | User |
| Schedule | No deadline — quality over speed | User |
| Unlock rule | Top 3 advances; 1st unlocks cars | User |
| Physics approach | Custom raycast suspension (A), kv-vehicle fallback (B), VehicleBody3D rejected (C) | Recommendation, user-approved context |
| Renderer / target | Forward+, 60 FPS @ 1080p mid-range | Builder call |
| Gamepad workflow | Test via native Windows exports | Builder call |
| Physics gate | Playtest verdicts; 3-iteration fallback tripwire | Builder call |
| Events | 3 circuits, 2 sprints, time trials, drift (stretch) | Builder call |
| World | One district, multiple routes, traffic, no police | Builder call |
| Assists | Default ON, toggleable | Builder call |
