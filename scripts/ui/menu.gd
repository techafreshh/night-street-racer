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
	"res://assets/events/drift_park.tres",
]


## Save-backed lock rule: delegates to the Progression ladder so podiums
## open later events after restart.
static func is_unlocked(ev: RaceEvent) -> bool:
	return Progression.is_event_unlocked(ev)


func _ready() -> void:
	print("MENU_READY")
	_start_menu_music()
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


## Wires the event-select BackButton to _on_back, the ModeButton to the
## race/time-trial run-mode toggle, plus initial focus on the first unlocked
## Event_* button (fallback BackButton). The toggle defaults to race on every
## entry and only touches the memory-only GameState current_mode selector.
func _wire_event_select() -> void:
	var back := _btn("BackButton")
	if back != null:
		back.pressed.connect(_on_back)
	_reset_mode_to_race()
	_refresh_mode_ui()
	var mode := _btn("ModeButton")
	if mode != null:
		mode.pressed.connect(_on_mode_toggle)
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


## Default the run-mode toggle to race every time event select builds, via
## the guarded GameState typed writer; memory-only, never persisted.
func _reset_mode_to_race() -> void:
	var gs = get_node_or_null("/root/GameState")
	if gs != null and gs.has_method("select_mode"):
		gs.call("select_mode", "race")


## Reflect the memory-only run mode on the ModeButton + InfoLabel so the
## player sees rivals+traffic (race) vs solo best-chasing (time trial).
func _refresh_mode_ui() -> void:
	var time_trial := false
	var gs = get_node_or_null("/root/GameState")
	if gs != null and gs.has_method("is_time_trial_mode"):
		time_trial = bool(gs.call("is_time_trial_mode"))
	var mode := _btn("ModeButton")
	if mode != null:
		(mode as Button).text = "Mode: Time Trial" if time_trial else "Mode: Race"
	var info := _info()
	if info != null:
		if time_trial:
			info.text = "Time Trial: solo run, chase your best"
		else:
			info.text = "Race: rivals + traffic"


## Flip the memory-only run-mode selector and mirror it on the button/label.
func _on_mode_toggle() -> void:
	_play_click()
	var gs = get_node_or_null("/root/GameState")
	if gs != null and gs.has_method("is_time_trial_mode") and gs.has_method("select_mode"):
		if bool(gs.call("is_time_trial_mode")):
			gs.call("select_mode", "race")
		else:
			gs.call("select_mode", "time_trial")
	_refresh_mode_ui()


func _on_race() -> void:
	_play_click()
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/event_select.tscn")


func _on_garage() -> void:
	_play_click()
	var gs = get_node_or_null("/root/GameState")
	if gs != null:
		var selected := &""
		if gs.has_method("get_selected_car"):
			selected = StringName(gs.call("get_selected_car"))
		if selected == &"":
			var fallback := ""
			if gs.has_method("get_default_car"):
				fallback = String(gs.call("get_default_car"))
			if gs.has_method("select_car"):
				gs.call("select_car", fallback)
		var current := &""
		if gs.has_method("get_selected_car"):
			current = StringName(gs.call("get_selected_car"))
		print("CAR_SELECTED %s" % current)
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/garage.tscn")


func _on_settings() -> void:
	_play_click()
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/settings.tscn")


func _on_quit() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.quit()


## Guarded UI click plus menu-music (re)start: no-ops headless or when
## the mixer singleton is absent, mirroring the _resolve guards above.
func _play_click() -> void:
	var am := get_node_or_null("/root/AudioManager")
	if am != null and am.has_method("play_click"):
		am.call("play_click")


func _start_menu_music() -> void:
	var am := get_node_or_null("/root/AudioManager")
	if am != null and am.has_method("start_menu_music"):
		am.call("start_menu_music")


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
	# One disk read per save domain for the whole grid (issue #168): every
	# button below evaluates lock state and BEST tags from these snapshots
	# instead of re-reading the save file per button.
	var unlocked := Progression.unlocked_events()
	var bests := TimeTrial.all_bests()
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
		_add_event_button(grid, ev, Progression.is_unlocked_with(ev, unlocked), float(bests.get(ev.route_id, -1.0)))
	if not is_instance_valid(grid) or grid.is_queued_for_deletion():
		return
	_wire_event_select()
	print("EVENT_GRID_READY")


## Compatibility shim: the grid now builds async off _ready; direct calls
## fan out to the async builder and never block on asset I/O themselves.
func _build_event_grid() -> void:
	_build_event_grid_async()


## Spawn one Button for ev: "Event_<route_id>", disabled and focus-skipped
## when locked, wired to _on_event_chosen when open. Drift runs carry a
## DRIFT tag; unlocked rows with a stored best carry its BEST tag. Pure
## button builder (issue #168): lock state and best arrive precomputed from
## the grid builder's single save snapshot, so this function performs no
## disk I/O.
func _add_event_button(grid: GridContainer, ev: RaceEvent, unlocked: bool, best: float) -> void:
	var btn := Button.new()
	btn.name = "Event_%s" % ev.route_id
	btn.custom_minimum_size = Vector2(320, 48)
	btn.text = "%s (%d laps, %d rivals)" % [ev.route_id, ev.laps, ev.opponents]
	if RaceEvent.is_drift(ev):
		btn.text += "  DRIFT"
	if best > 0.0:
		btn.text += "  BEST %s" % TimeTrial.format_time(best)
	if unlocked:
		btn.pressed.connect(_on_event_chosen.bind(ev.route_id))
	else:
		btn.text += " 🔒 Locked"
		btn.disabled = true
		btn.focus_mode = Control.FOCUS_NONE
	grid.add_child(btn)


func _on_event_chosen(route_id: String) -> void:
	_play_click()
	var path := "res://assets/events/%s.tres" % route_id
	var chosen := load(path) as RaceEvent if ResourceLoader.exists(path) else null
	if chosen == null or not Progression.is_event_unlocked(chosen):
		return
	var gs = get_node_or_null("/root/GameState")
	if gs != null:
		if gs.has_method("select_event"):
			gs.call("select_event", route_id)
		print("EVENT_SELECTED %s" % route_id)
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/garage.tscn")
