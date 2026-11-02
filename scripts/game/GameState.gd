extends Node
## Cross-cutting game state (autoload singleton). Stub for later laps:
## tracks the selected event and car without owning any scene or UI.
## Loads standalone (no _ready dependencies) so headless tests can
## instantiate it without entering the scene tree.
## Selection persists across restarts via SaveSystem (user://save.json):
## _ready() loads the last saved selection, the selected_car/selected_color/
## current_event setters mark the selection dirty and persist once per frame
## (plus on flush()/exit) instead of writing per assignment, and
## select_event()/select_car()/select_color() are the typed writer APIs
## (menu.gd uses select_event, garage.gd uses select_car/select_color).
## Disk failures are silent no-ops so standalone instances never error
## headless.

## Canonical default car id (owner of assets/cars/tunes/default_tune.tres,
## the car_sedan.tscn tune); used to fill selected_car when empty.
const DEFAULT_CAR: StringName = &"sedan"

## Run-mode handles live in RaceEvent (RaceEvent.MODE_RACE /
## RaceEvent.MODE_TIME_TRIAL); the closed allow-list for select_mode().

## True while bulk-loading from disk so the setters skip write-back.
var _loading := false
## True while a coalesced write-back is scheduled but not yet flushed.
var _persist_pending := false

var selected_car: StringName = &"":
	set(value):
		if _loading:
			selected_car = value
			return
		if selected_car == value:
			return
		selected_car = value
		_request_persist()
	get:
		return selected_car

var selected_color: int = 0:
	set(value):
		if _loading:
			selected_color = value
			return
		if selected_color == value:
			return
		selected_color = value
		_request_persist()
	get:
		return selected_color

var current_event: StringName = &"":
	set(value):
		if _loading:
			current_event = value
			return
		if current_event == value:
			return
		current_event = value
		_request_persist()
	get:
		return current_event

## Read-only unlock cache, refreshed by reload_from_disk; never written
## by _persist (only Progression.apply_result writes the unlocked lists).
var unlocked_events: Array = []
var unlocked_cars: Array = []

## Runtime-only run-mode selector (RaceEvent.MODE_RACE /
## RaceEvent.MODE_TIME_TRIAL): never persisted to user://save.json, so
## _persist/reload leave it untouched.
## Direct assignment is guarded: only the two canonical handles stick,
## anything else is ignored with no persist side effect.
## Untyped so non-String/StringName writes reach the setter and are
## ignored instead of erroring on a typed-var assignment.
var current_mode = RaceEvent.MODE_RACE:
	set(value):
		if not (value is String or value is StringName):
			return
		var mode := StringName(value)
		if not is_valid_mode(mode):
			return
		if current_mode == mode:
			return
		current_mode = mode
	get:
		return current_mode


func _ready() -> void:
	reload_from_disk()


## Typed writer: record the chosen event and persist it.
func select_event(route_id: String) -> void:
	current_event = StringName(route_id)


## Allow-list guard for the run-mode selector (same allow-list as
## RaceEvent.validate()): true only for RaceEvent.MODE_RACE and
## RaceEvent.MODE_TIME_TRIAL.
static func is_valid_mode(m: StringName) -> bool:
	return m == RaceEvent.MODE_RACE or m == RaceEvent.MODE_TIME_TRIAL


## True when the in-memory run mode names the solo time-trial mode.
func is_time_trial_mode() -> bool:
	return current_mode == RaceEvent.MODE_TIME_TRIAL


## Typed writer: record the run mode (RaceEvent.MODE_RACE or
## RaceEvent.MODE_TIME_TRIAL) in memory only.
## Funnels through the guarded current_mode setter, so unknown values
## (bogus, empty, wrong case, whitespace) are ignored: the last valid
## mode is kept with no persist side effect.
func select_mode(m: String) -> void:
	current_mode = StringName(m)


## Typed writer: record the chosen car and persist it.
func select_car(car_id: String) -> void:
	selected_car = StringName(car_id)


## Typed writer: record the chosen paint index and persist it.
func select_color(color_idx: int) -> void:
	selected_color = color_idx


## In-memory post-race handoff for the results screen (issue #22): never
## written to user://save.json, so the save schema is untouched. Reads live
## here; the race sets it before changing to scenes/ui/results.tscn and the
## results screen duplicates it back out on read.
var last_result: Dictionary = {}


## Typed writer: store a duplicate of the result dict for the results screen.
func set_last_result(result: Dictionary) -> void:
	last_result = result.duplicate(true)


## Typed writer: drop the handoff so the next boot falls back to the mock.
func clear_last_result() -> void:
	last_result = {}


## Thin wrapper: record a result through the ladder, then refresh the cache.
func apply_result(event_id: String, place: int) -> Dictionary:
	var result := Progression.apply_result(event_id, place)
	reload_from_disk()
	return result


## Re-read user://save.json into both vars. Missing or corrupt files fall
## back to defaults without erroring, non-numeric selected_color falls back
## to 0, and write-back stays suppressed.
func reload_from_disk() -> void:
	_persist_pending = false
	_loading = true
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	var raw_car: Variant = progress.get("selected_car", &"")
	if raw_car is String or raw_car is StringName:
		selected_car = StringName(raw_car)
	else:
		selected_car = &""
	var raw_color: Variant = progress.get("selected_color", 0)
	if raw_color is int or raw_color is float:
		selected_color = int(raw_color)
	else:
		selected_color = 0
	var raw_event: Variant = progress.get("current_event", &"")
	if raw_event is String or raw_event is StringName:
		current_event = StringName(raw_event)
	else:
		current_event = &""
	unlocked_events = Progression._string_list(progress.get("unlocked_events", []))
	unlocked_cars = Progression._string_list(progress.get("unlocked_cars", []))
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


## Mark the selection dirty and schedule exactly one deferred write-back,
## no matter how many setters fire in the same frame. No-op while
## bulk-loading and when a write is already scheduled.
func _request_persist() -> void:
	if _loading:
		return
	if _persist_pending:
		return
	_persist_pending = true
	call_deferred("_deferred_persist")


## Deferred write-back target: clears the pending flag first so a stranded
## call after an explicit flush() is a no-op.
func _deferred_persist() -> void:
	if not _persist_pending:
		return
	_persist_pending = false
	_persist()


## Synchronous read-your-writes: durably store the pending selection now.
## Clears the pending flag first so a stranded deferred call afterwards is
## a no-op; a second flush without new writes writes nothing.
func flush() -> void:
	if not _persist_pending:
		return
	_persist_pending = false
	_persist()


func _exit_tree() -> void:
	flush()
