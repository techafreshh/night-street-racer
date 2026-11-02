extends Node
## Cross-cutting game state (autoload singleton). Stub for later laps:
## tracks the selected event and car without owning any scene or UI.
## Loads standalone (no _ready dependencies) so headless tests can
## instantiate it without entering the scene tree.
## Selection persists across restarts via SaveSystem (user://save.json):
## _ready() loads the last saved selection, the selected_car/selected_color/
## current_event setters persist on every change, and select_event()/
## select_car()/select_color() are the typed writer APIs (menu.gd uses
## select_event, garage.gd uses select_car/select_color). Disk failures are silent
## no-ops so standalone instances never error headless.

## Canonical default car id (owner of assets/cars/tunes/default_tune.tres,
## the car_sedan.tscn tune); used to fill selected_car when empty.
const DEFAULT_CAR: StringName = &"sedan"

## True while bulk-loading from disk so the setters skip write-back.
var _loading := false

var selected_car: StringName = &"":
	set(value):
		selected_car = value
		_persist()
	get:
		return selected_car

var selected_color: int = 0:
	set(value):
		selected_color = value
		_persist()
	get:
		return selected_color

var current_event: StringName = &"":
	set(value):
		current_event = value
		_persist()
	get:
		return current_event


func _ready() -> void:
	reload_from_disk()


## Typed writer: record the chosen event and persist it.
func select_event(route_id: String) -> void:
	current_event = StringName(route_id)


## Typed writer: record the chosen car and persist it.
func select_car(car_id: String) -> void:
	selected_car = StringName(car_id)


## Typed writer: record the chosen paint index and persist it.
func select_color(color_idx: int) -> void:
	selected_color = color_idx


## Re-read user://save.json into both vars. Missing or corrupt files fall
## back to defaults without erroring, and write-back stays suppressed.
func reload_from_disk() -> void:
	_loading = true
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	selected_car = StringName(str(progress.get("selected_car", &"")))
	selected_color = int(progress.get("selected_color", 0))
	current_event = StringName(str(progress.get("current_event", &"")))
	_loading = false


## Merge the live selection into the saved document, keeping settings /
## unlocked_* / records opaque for later laps. Silent no-op on failure.
func _persist() -> void:
	if _loading:
		return
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	progress["selected_car"] = str(selected_car)
	progress["selected_color"] = selected_color
	progress["current_event"] = str(current_event)
	data["progress"] = progress
	SaveSystem.save_game(data)
