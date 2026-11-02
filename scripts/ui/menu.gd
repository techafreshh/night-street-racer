class_name MenuUI
extends Node
## Shared controller for the main menu and the event-select grid.
## menu_mode 0 boots the Race/Garage/Settings/Quit column; menu_mode 1
## builds one Button per RaceEvent resource with placeholder lock display
## (unlocked iff unlock_req is empty; real ladder lands in issue #19).
## Prints MENU_READY so headless boots can gate on it. Navigation uses the
## built-in ui_* focus actions, so keyboard and gamepad both work.

## 0 = main menu, 1 = event select.
@export var menu_mode: int = 0

## Hardcoded event list (no DirAccess scan) so exported builds agree.
const EVENT_PATHS: Array[String] = [
	"res://assets/events/harbor_sprint.tres",
	"res://assets/events/downtown_gp.tres",
	"res://assets/events/neon_loop.tres",
	"res://assets/events/bayline_circuit.tres",
	"res://assets/events/alley_sprint.tres",
]


## Save-backed lock rule: delegates to the Progression ladder so podiums
## open later events after restart.
static func is_unlocked(ev: RaceEvent) -> bool:
	return Progression.is_event_unlocked(ev)


func _ready() -> void:
	print("MENU_READY")
	if menu_mode == 1:
		print("EVENT_SELECT_READY")
		_build_event_grid_async()
	else:
		_wire_main_mode()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		if menu_mode == 1:
			_on_back()
		# menu_mode 0 is the top level: Esc is a no-op so a composed race
		# scene keeps Esc for pausing; the QuitButton stays the sole way out.


func _btn(button_name: String) -> BaseButton:
	return find_child(button_name, true, false) as BaseButton


func _info() -> Label:
	return find_child("InfoLabel", true, false) as Label


func _wire_main_mode() -> void:
	var race := _btn("RaceButton")
	if race != null:
		race.pressed.connect(_on_race)
	var garage := _btn("GarageButton")
	if garage != null:
		garage.pressed.connect(_on_garage)
	var settings := _btn("SettingsButton")
	if settings != null:
		settings.pressed.connect(_on_settings)
	var quit_btn := _btn("QuitButton")
	if quit_btn != null:
		quit_btn.pressed.connect(_on_quit)
	if race != null:
		race.grab_focus()


func _wire_select_mode() -> void:
	var back := _btn("BackButton")
	if back != null:
		back.pressed.connect(_on_back)
	# Focus the first playable event so keyboard/gamepad can start at once.
	var grid := find_child("EventGrid", true, false)
	if grid != null:
		for child in grid.get_children():
			var btn := child as BaseButton
			if btn != null and not btn.disabled:
				btn.grab_focus()
				return
	if back != null:
		back.grab_focus()


func _on_race() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/event_select.tscn")


func _on_garage() -> void:
	var gs = get_node_or_null("/root/GameState")
	if gs != null:
		if StringName(gs.get("selected_car")) == &"":
			gs.select_car(String(gs.get("DEFAULT_CAR")))
		print("CAR_SELECTED %s" % StringName(gs.get("selected_car")))
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/garage.tscn")


func _on_settings() -> void:
	var info := _info()
	if info != null:
		info.text = "Settings available in a later lap"


func _on_quit() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.quit()


func _on_back() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/main_menu.tscn")


## Async grid build: issues one threaded request per EVENT_PATHS entry so
## _ready returns without parsing resources, then awaits completion off the
## critical path. Falls back to a single-asset synchronous load() only when
## a threaded load fails or times out; _on_event_chosen keeps its own
## user-gesture load(). Emits EVENT_GRID_READY once the grid is complete.
func _build_event_grid_async() -> void:
	var grid := find_child("EventGrid", true, false) as GridContainer
	if grid == null:
		return
	for path in EVENT_PATHS:
		ResourceLoader.load_threaded_request(path)
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
		for path in EVENT_PATHS:
			var state := ResourceLoader.load_threaded_get_status(path)
			if state != ResourceLoader.THREAD_LOAD_LOADED and state != ResourceLoader.THREAD_LOAD_FAILED and state != ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
				pending = true
				break
		if not pending:
			break
	for path in EVENT_PATHS:
		if not is_instance_valid(grid) or grid.is_queued_for_deletion():
			return
		var ev: RaceEvent = null
		if ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_LOADED:
			ev = ResourceLoader.load_threaded_get(path) as RaceEvent
		if ev == null:
			# Fallback for a failed, invalid, or timed-out threaded load.
			ev = load(path) as RaceEvent
		if ev == null:
			continue
		if not RaceEvent.validate(ev):
			push_warning("MenuUI: skipping invalid event %s" % path)
			continue
		_add_event_button(grid, ev)
	if not is_instance_valid(grid) or grid.is_queued_for_deletion():
		return
	_wire_select_mode()
	print("EVENT_GRID_READY")


## Compatibility shim: the grid now builds async off _ready; direct calls
## fan out to the async builder and never block on asset I/O themselves.
func _build_event_grid() -> void:
	_build_event_grid_async()


## Spawn one Button for ev: "Event_<route_id>", disabled and focus-skipped
## when locked, wired to _on_event_chosen when open.
func _add_event_button(grid: GridContainer, ev: RaceEvent) -> void:
	var btn := Button.new()
	btn.name = "Event_%s" % ev.route_id
	btn.custom_minimum_size = Vector2(320, 48)
	var unlocked := MenuUI.is_unlocked(ev)
	btn.text = "%s (%d laps, %d rivals)" % [ev.route_id, ev.laps, ev.opponents]
	if unlocked:
		btn.pressed.connect(_on_event_chosen.bind(ev.route_id))
	else:
		btn.text += " 🔒 Locked"
		btn.disabled = true
		btn.focus_mode = Control.FOCUS_NONE
	grid.add_child(btn)


func _on_event_chosen(route_id: String) -> void:
	var path := "res://assets/events/%s.tres" % route_id
	var chosen := load(path) as RaceEvent if ResourceLoader.exists(path) else null
	if chosen == null or not Progression.is_event_unlocked(chosen):
		return
	var gs = get_node_or_null("/root/GameState")
	if gs != null:
		gs.select_event(route_id)
		print("EVENT_SELECTED %s" % route_id)
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/garage.tscn")
