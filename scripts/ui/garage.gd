class_name GarageUI
extends Node
## Garage controller: pick a car and a paint color before racing.
## Builds one Button per catalog entry into CarGrid (names, live tune
## stats, locked cars disabled and unfocusable), shows the current pick on
## a rotating 3D turntable inside the CarPreview SubViewport, and wires
## the four static ColorSwatches buttons to the paint palette. Selection
## persists only through the GameState typed writers select_car() and
## select_color(); the setters drive SaveSystem write-back. Prints
## GARAGE_READY so headless boots can gate on it. Safe to boot alone:
## every lookup is guarded and the turntable skips a missing pivot.

## Hardcoded car catalog (no DirAccess scan) so exported builds agree.
const CAR_IDS: Array[String] = ["sedan", "coupe", "hatch", "awd"]
const CAR_NAMES := {
	"sedan": "Sedan",
	"coupe": "Coupe",
	"hatch": "Hatch",
	"awd": "AWD",
}
const CAR_BLURBS := {
	"sedan": "Balanced all-rounder",
	"coupe": "High-grip corner carver",
	"hatch": "Tail-happy drift setup",
	"awd": "Top-end straight-line pull",
}
const CAR_SCENES := {
	"sedan": "res://scenes/vehicles/car_sedan.tscn",
	"coupe": "res://scenes/vehicles/car_coupe.tscn",
	"hatch": "res://scenes/vehicles/car_hatch.tscn",
	"awd": "res://scenes/vehicles/car_awd.tscn",
}
const CAR_TUNES := {
	"sedan": "res://assets/cars/tunes/default_tune.tres",
	"coupe": "res://assets/cars/tunes/sport_tune.tres",
	"hatch": "res://assets/cars/tunes/drift_tune.tres",
	"awd": "res://assets/cars/tunes/drag_tune.tres",
}

## Turntable speed for the 3D preview, radians per second around Y.
const TURNTABLE_SPEED := 0.8

var _current_car := &"sedan"
var _current_color := 0
var _pivot: Node3D = null
var _tunes: Dictionary = {}


## Placeholder lock rule: the default car is always open; the rest unlock
## via SaveSystem progress.unlocked_cars (empty list means sedan only).
static func is_car_unlocked(car_id: String) -> bool:
	if StringName(car_id) == StringName("sedan"):
		return true
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	var unlocked := Progression._string_list(progress.get("unlocked_cars", []))
	return unlocked.has(car_id)


## Drive-mode suffix for the stat line (0 FWD, 1 RWD, 2 AWD).
static func mode_label(drivetrain: int) -> String:
	match drivetrain:
		0:
			return "FWD"
		2:
			return "AWD"
		_:
			return "RWD"


func _ready() -> void:
	print("GARAGE_READY")
	_resolve_selection()
	_build_swatches()
	_wire_back()
	_wire_start()
	_build_car_grid_async()


func _process(delta: float) -> void:
	if _pivot == null or not is_instance_valid(_pivot):
		return
	_pivot.rotate_y(TURNTABLE_SPEED * delta)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		get_tree().quit()


func _game_state() -> Node:
	return get_node_or_null("/root/GameState")


## Initial pick: GameState selection when it names a catalog car and a
## valid palette slot, else the default car and color 0.
func _resolve_selection() -> void:
	var gs := _game_state()
	var car := &"sedan"
	var color := 0
	if gs != null:
		var saved := StringName(gs.get("selected_car"))
		if CAR_IDS.has(String(saved)):
			car = saved
		elif StringName(gs.get("DEFAULT_CAR")) != &"" and CAR_IDS.has(String(StringName(gs.get("DEFAULT_CAR")))):
			car = StringName(gs.get("DEFAULT_CAR"))
		color = int(gs.get("selected_color"))
	_current_car = car
	_current_color = posmod(color, CarPaint.COLORS.size())


## Async grid build: issues one threaded request per CAR_TUNES entry so
## _ready returns without parsing resources, then awaits completion off the
## critical path. Falls back to a single-asset synchronous load() only when
## a threaded load fails or times out. Emits GARAGE_GRID_READY once the
## grid is complete.
func _build_car_grid_async() -> void:
	var grid := find_child("CarGrid", true, false) as GridContainer
	if grid == null:
		return
	for car_id in CAR_IDS:
		ResourceLoader.load_threaded_request(str(CAR_TUNES[car_id]))
	var tree := get_tree()
	if tree == null:
		return
	for _i in range(30):
		await tree.process_frame
		if not is_instance_valid(grid) or grid.is_queued_for_deletion():
			return
		tree = get_tree()
		if tree == null:
			return
		var pending := false
		for car_id in CAR_IDS:
			var state := ResourceLoader.load_threaded_get_status(str(CAR_TUNES[car_id]))
			if state != ResourceLoader.THREAD_LOAD_LOADED and state != ResourceLoader.THREAD_LOAD_FAILED and state != ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
				pending = true
				break
		if not pending:
			break
	for car_id in CAR_IDS:
		if not is_instance_valid(grid) or grid.is_queued_for_deletion():
			return
		var tune: CarTune = null
		if ResourceLoader.load_threaded_get_status(str(CAR_TUNES[car_id])) == ResourceLoader.THREAD_LOAD_LOADED:
			tune = ResourceLoader.load_threaded_get(str(CAR_TUNES[car_id])) as CarTune
		if tune == null:
			# Fallback for a failed, invalid, or timed-out threaded load.
			tune = load(str(CAR_TUNES[car_id])) as CarTune
		if tune == null:
			continue
		if not CarTune.validate(tune):
			push_warning("GarageUI: skipping invalid tune %s" % str(CAR_TUNES[car_id]))
			continue
		_tunes[car_id] = tune
		_add_car_button(grid, car_id, tune)
	if not is_instance_valid(grid) or grid.is_queued_for_deletion():
		return
	_show_car(_current_car)
	_focus_first()
	print("GARAGE_GRID_READY")


## Compatibility shim: the grid now builds async off _ready; direct calls
## fan out to the async builder and never block on asset I/O themselves.
func _build_car_grid() -> void:
	_build_car_grid_async()


## Spawn one Button for car_id: "Car_<id>", wired to _on_car_chosen
## when unlocked, disabled and focus-skipped when locked.
func _add_car_button(grid: GridContainer, car_id: String, tune: CarTune) -> void:
	var btn := Button.new()
	btn.name = "Car_%s" % car_id
	btn.custom_minimum_size = Vector2(320, 48)
	btn.text = "%s (%d Nm, %.2f/%.2f, %s)" % [
		str(CAR_NAMES[car_id]),
		int(tune.engine_torque),
		tune.tire_grip_front,
		tune.tire_grip_rear,
		mode_label(tune.drivetrain),
	]
	var unlocked := GarageUI.is_car_unlocked(car_id)
	if unlocked:
		btn.pressed.connect(_on_car_chosen.bind(car_id))
	else:
		btn.text += " 🔒 Locked"
		btn.disabled = true
		btn.focus_mode = Control.FOCUS_NONE
	grid.add_child(btn)


## Wire the four static Color0..Color3 buttons to _on_color_chosen.
func _build_swatches() -> void:
	var box := find_child("ColorSwatches", true, false)
	if box == null:
		return
	for i in CarPaint.COLORS.size():
		var btn := box.get_node_or_null("Color%d" % i) as BaseButton
		if btn == null:
			continue
		btn.pressed.connect(_on_color_chosen.bind(i))


func _wire_back() -> void:
	var back := find_child("BackButton", true, false) as BaseButton
	if back != null:
		back.pressed.connect(_on_back)


func _wire_start() -> void:
	var start := find_child("StartButton", true, false) as BaseButton
	if start != null:
		start.pressed.connect(_on_start_race)


func _on_start_race() -> void:
	var event_id := "harbor_sprint"
	var gs := _game_state()
	if gs != null:
		var current := StringName(gs.get("current_event"))
		if current != &"":
			event_id = String(current)
	var path := "res://scenes/races/race_%s.tscn" % event_id
	if not ResourceLoader.exists(path):
		path = "res://scenes/races/race_harbor_sprint.tscn"
	print("RACE_START %s" % path.get_file().get_basename())
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file(path)


## Focus the first unlocked car so keyboard/gamepad can start at once.
func _focus_first() -> void:
	var grid := find_child("CarGrid", true, false)
	if grid == null:
		return
	for child in grid.get_children():
		var btn := child as BaseButton
		if btn != null and not btn.disabled:
			btn.grab_focus()
			return


func _on_car_chosen(car_id: String) -> void:
	_current_car = StringName(car_id)
	var gs := _game_state()
	if gs != null:
		gs.select_car(car_id)
		print("CAR_SELECTED %s" % car_id)
	_show_car(_current_car)


func _on_color_chosen(color_idx: int) -> void:
	_current_color = posmod(color_idx, CarPaint.COLORS.size())
	var gs := _game_state()
	if gs != null:
		gs.select_color(_current_color)
		print("COLOR_SELECTED %d" % _current_color)
	_apply_preview_paint()
	_update_info()


func _on_back() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/main_menu.tscn")


## Rebuild the turntable preview: clear the pivot, instance the chosen car
## scene frozen in place, tint it with the current palette slot.
func _show_car(car_id: StringName) -> void:
	_current_car = car_id
	var preview := find_child("CarPreview", true, false) as SubViewport
	if preview == null:
		_update_info()
		return
	_pivot = preview.get_node_or_null("PreviewPivot") as Node3D
	if _pivot == null:
		_update_info()
		return
	for child in _pivot.get_children():
		_pivot.remove_child(child)
		child.free()
	var packed := load(str(CAR_SCENES.get(String(car_id), ""))) as PackedScene
	if packed == null:
		_update_info()
		return
	var inst := packed.instantiate() as VehicleController
	if inst == null:
		_update_info()
		return
	inst.freeze = true
	var paint := inst.get_node_or_null("CarPaint")
	if paint != null:
		paint.set("color_index", _current_color)
	_pivot.add_child(inst)
	inst.position = Vector3.ZERO
	_update_info()


## Re-tint the live preview instance after a swatch press.
func _apply_preview_paint() -> void:
	if _pivot == null or not is_instance_valid(_pivot):
		return
	for child in _pivot.get_children():
		var paint := (child as Node).get_node_or_null("CarPaint")
		if paint != null:
			paint.set("color_index", _current_color)


## Name + blurb + live tune stat line for the current pick.
func _update_info() -> void:
	var info := find_child("CarInfo", true, false) as Label
	if info == null:
		return
	var tune := _tunes.get(String(_current_car)) as CarTune
	if tune == null:
		tune = load(str(CAR_TUNES.get(String(_current_car), ""))) as CarTune
	if tune == null:
		info.text = "%s" % str(CAR_NAMES.get(String(_current_car), String(_current_car)))
		return
	info.text = "%s - %s\n%d Nm · %.2f/%.2f grip · %s" % [
		str(CAR_NAMES.get(String(_current_car), String(_current_car))),
		str(CAR_BLURBS.get(String(_current_car), "")),
		int(tune.engine_torque),
		tune.tire_grip_front,
		tune.tire_grip_rear,
		mode_label(tune.drivetrain),
	]
