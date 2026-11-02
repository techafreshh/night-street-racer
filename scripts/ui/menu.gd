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


## Placeholder lock rule: only events with no prerequisite are open.
static func is_unlocked(ev: RaceEvent) -> bool:
	return ev != null and ev.unlock_req == &""


func _ready() -> void:
	print("MENU_READY")
	if menu_mode == 1:
		print("EVENT_SELECT_READY")
		_build_event_grid()
		_wire_select_mode()
	else:
		_wire_main_mode()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		get_tree().quit()


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
	var info := _info()
	if info != null:
		info.text = "Garage available in a later lap"
	var gs = get_node_or_null("/root/GameState")
	if gs != null:
		if StringName(gs.get("selected_car")) == &"":
			gs.select_car(String(gs.get("DEFAULT_CAR")))
		print("CAR_SELECTED %s" % StringName(gs.get("selected_car")))


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


## Spawn one Button per EVENT_PATHS entry: "Event_<route_id>", disabled and
## focus-skipped when locked, wired to _on_event_chosen when open.
func _build_event_grid() -> void:
	var grid := find_child("EventGrid", true, false) as GridContainer
	if grid == null:
		return
	for path in EVENT_PATHS:
		var ev := load(path) as RaceEvent
		if ev == null:
			continue
		if not RaceEvent.validate(ev):
			push_warning("MenuUI: skipping invalid event %s" % path)
			continue
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
	var gs = get_node_or_null("/root/GameState")
	if gs != null:
		gs.select_event(route_id)
		print("EVENT_SELECTED %s" % route_id)
