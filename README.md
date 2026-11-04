<img src="icon.svg" alt="Night Street Racer icon" width="96" />

# Night Street Racer

A single-player night-city street racer built with Godot 4.7: tuner cars, a neon-lit district, AI rivals plus ambient traffic, six events plus time trials and a drift event, all saved locally.

## Why this game exists

Driving feel is the product. The car model targets planted, Most Wanted '05-style handling — weighty grip with slides earned through technique — wrapped in a small complete game: menus → event select → garage → race → results → unlock progression.

## Quickstart

Prerequisites: Godot 4.7.2 (see `.github/workflows/ci.yml`), Windows or Linux.

```bash
git clone <repo-url> night-street-racer
cd night-street-racer
godot --headless --path . --import
```

Then open the project in the Godot editor and press Play. The main scene is `scenes/ui/main_menu.tscn`.

Optional headless smoke test (verifies boot, no window):

```bash
godot --headless --path . scenes/ui/main_menu.tscn --quit-after 60
```

Exported builds use the runnable presets in `export_presets.cfg` (export templates required):

- Windows → `build/windows/night-street-racer.exe`
- Linux → `build/linux/night-street-racer.x86_64`

> [!NOTE]
> Headless commands verify the project imports and boots. Playing the game needs the editor or an exported build with a display.

## Usage

The menu flow is: **main menu → event select → garage → race → results**.

- **Main menu:** Race, Garage, Settings, Quit.
- **Event select:** one button per event in `MenuUI.EVENT_PATHS` order. The `ModeButton` toggles the run mode between `Race` (rivals) and `Time Trial` (solo, no rivals) via `GameState.select_mode()`; the choice is memory-only and resets to Race on re-entry.
- **Garage:** pick one of four cars and one of four paint colors (`Color0`–`Color3`) on a rotating 3D turntable preview. Press Start to load `scenes/races/race_<event>.tscn` for the selected event (falls back to `race_harbor_sprint.tscn`).
- **Race:** `3-2-1-GO` countdown → racing → finished. The pause overlay (pause action) offers Resume, Restart, Settings, and Quit. The HUD shows speed, gear, lap/position (`P<pos>/<total> LAP <lap>/<laps>`), race timer, delta, a minimap, and a drift-score popup.

### Controls

Keyboard and Xbox-style gamepad are both supported (`project.godot` `[input]` map):

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate | W / Up | Right trigger |
| Brake | S / Down | Left trigger |
| Steer | A / D or Left / Right | Left stick / D-pad |
| Handbrake | Space | B |
| Look back | C | Left shoulder |
| Reset car | R | Stick click (L3/R3) |
| Pause | Esc | Start |

## Events, cars, and progression

### Events

Six events defined in `assets/events/*.tres`, unlocked in a chained ladder (`unlock_req`):

| Event | Type | Laps | Rivals | Unlocked by |
|---|---|---|---|---|
| `harbor_sprint` | Sprint | 1 | 3 | Open from the start |
| `downtown_gp` | Circuit | 3 | 5 | `harbor_sprint` |
| `neon_loop` | Circuit | 2 | 4 | `downtown_gp` |
| `bayline_circuit` | Circuit | 2 | 4 | `neon_loop` |
| `alley_sprint` | Sprint | 1 | 3 | `bayline_circuit` |
| `drift_park` | Drift (judged run) | 1 | 3 | `alley_sprint` |

### Cars

Four tuner cars from the `GarageUI` catalog (`scripts/ui/garage.gd`):

| Car | Character | Tune | Drivetrain tag |
|---|---|---|---|
| Sedan | Balanced all-rounder | `assets/cars/tunes/default_tune.tres` | RWD |
| Coupe | High-grip corner carver | `assets/cars/tunes/sport_tune.tres` | FWD |
| Hatch | Tail-happy drift setup | `assets/cars/tunes/drift_tune.tres` | RWD |
| AWD | Top-end straight-line pull | `assets/cars/tunes/drag_tune.tres` | AWD |

The drivetrain tag shown in the garage comes from `GarageUI.mode_label()` (0 FWD, 1 RWD, 2 AWD).

### Progression

`Progression.apply_result()` (`scripts/game/progression.gd`):

- Finishing in the **top 3** records the event, which opens the next rung of the ladder.
- **Winning** also grants a car: `harbor_sprint` → coupe, `downtown_gp` → hatch, `neon_loop` and later → AWD.
- The **sedan is always unlocked**.
- The results screen shows a best banner only when a time-trial time or drift score is actually beaten.

## Configuration

There are no ports, secrets, or network endpoints — this is an offline single-player game with no network code. All state lives in one versioned JSON document:

- **Save file:** `user://save.json`, schema version `1` (`SaveSystem.SAVE_PATH`, `SaveSystem.SAVE_VERSION`).
- **Display/physics** (`project.godot`): 1280×720 with `canvas_items` stretch, Jolt physics at 60 Hz ticks, Forward+ renderer.

The Settings screen exposes exactly five options (owned by the `Settings` autoload, persisted to the save file):

| Setting | Default |
|---|---|
| Master volume | 0.8 |
| Music volume | 0.7 |
| SFX volume | 0.9 |
| Assists | On |
| Camera shake | On |

Debug-only FX override (not gameplay configuration): setting the `FX_FORCE_SLIP=1` environment variable or passing `--fx-force-slip` after `--` forces tire-slip effects on (`scripts/fx/vehicle_fx.gd`). It exists for tests, not for players.

## Project map

```text
project.godot            App name, main scene, input map, display/physics, autoloads
scenes/ui/               Main menu, event select, garage, HUD, pause, results, settings
scenes/city/             Night district, test ground, traffic paths
scenes/races/            One race scene per event (race_<event>.tscn) plus routes
scenes/vehicles/         Player cars (sedan/coupe/hatch/awd), AI and traffic cars
scripts/game/            GameState, Settings, SaveSystem, Progression
scripts/race/            RaceEvent data, event manager (countdown → racing → finished)
scripts/vehicles/        Car physics, tunes, assists
scripts/ai/ scripts/traffic/  Opponent inputs, racing lines, ambient traffic
scripts/city/ scripts/fx/     District builder, tire smoke, skid marks, lights
scripts/ui/              Menu, garage, HUD, pause, results, settings controllers
assets/cars/city/audio/  Tunes, procedural CC0 stand-in meshes, generated audio
tests/run_all.gd         Headless suite runner (see Testing)
tools/make_*.py          Generators for the procedural stand-in assets
docs/CREDITS             Asset references and credits
export_presets.cfg       Runnable Windows and Linux export presets
.github/workflows/ci.yml Import check, scene boot checks, test run
```

## Testing

Run the full headless suite (non-zero exit on failure):

```bash
godot --headless --path . --script res://tests/run_all.gd
```

CI additionally boots the main menu, the city scenes, every tuner car, the garage, and settings headless with `--quit-after`.

## Limitations and roadmap

Single-player offline only. Out of scope by design (per the PRD): online multiplayer, local split-screen, police pursuits, car damage, upgrade parts / tuning shops, livery editor (color variants only), open-world free roam, additional districts, and mobile or web exports.

Other honest caveats:

- All car and city meshes are tiny procedural CC0 stand-ins generated by `tools/` — placeholders with the right silhouette, not final art. See `docs/CREDITS` for the references they emulate.
- There is no `LICENSE` file in the tree, so this README makes no license claim; asset questions are answered by `docs/CREDITS`.
