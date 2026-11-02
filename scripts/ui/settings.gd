class_name SettingsUI
extends Node
## Settings screen controller: master/music/sfx sliders plus assists and
## camera-shake toggles. Seeds every widget from /root/Settings (falling
## back to SaveSystem.load_game() when the autoload is absent headless),
## pushes widget changes straight into the Settings typed setters so they
## apply immediately and persist, and routes BackButton to the main menu.
## Prints SETTINGS_READY so headless boots can gate on it. Safe to boot
## alone: every lookup is guarded.

## Slider name, settings key, and fallback level for each volume row.
const SLIDERS: Array = [
	["MasterSlider", "master_volume", 0.8],
	["MusicSlider", "music_volume", 0.7],
	["SfxSlider", "sfx_volume", 0.9],
]
## Toggle name, settings key, and fallback flag for each switch row.
const TOGGLES: Array = [
	["AssistsToggle", "assists", true],
	["CameraShakeToggle", "camera_shake", true],
]


func _ready() -> void:
	print("SETTINGS_READY")
	_seed_widgets()
	_wire_widgets()
	_wire_back()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		_on_back()


func _settings() -> Node:
	return get_node_or_null("/root/Settings")


func _slider(slider_name: String) -> HSlider:
	return find_child(slider_name, true, false) as HSlider


func _toggle(toggle_name: String) -> CheckButton:
	return find_child(toggle_name, true, false) as CheckButton


## Live value for key: the Settings autoload when present, otherwise the
## on-disk settings block (or fallback when that is missing too).
func _initial_value(key: String, fallback: Variant) -> Variant:
	var settings := _settings()
	if settings != null:
		return settings.get(key)
	var disk: Dictionary = SaveSystem.load_game().get("settings", {})
	return disk.get(key, fallback)


## Seed sliders/toggles before wiring signals so seeding emits nothing.
func _seed_widgets() -> void:
	for entry in SLIDERS:
		var slider := _slider(str(entry[0]))
		if slider == null:
			continue
		var raw: Variant = _initial_value(str(entry[1]), entry[2])
		if raw is int or raw is float:
			slider.value = clampf(float(raw), 0.0, 1.0)
		else:
			slider.value = float(entry[2])
	for entry in TOGGLES:
		var toggle := _toggle(str(entry[0]))
		if toggle == null:
			continue
		var flag: Variant = _initial_value(str(entry[1]), entry[2])
		if flag is bool:
			toggle.button_pressed = flag
		else:
			toggle.button_pressed = bool(entry[2])


func _wire_widgets() -> void:
	for entry in SLIDERS:
		_wire_slider(str(entry[0]), str(entry[1]))
	for entry in TOGGLES:
		_wire_toggle(str(entry[0]), str(entry[1]))


func _wire_slider(slider_name: String, key: String) -> void:
	var slider := _slider(slider_name)
	if slider == null:
		return
	slider.value_changed.connect(_on_slider_changed.bind(key))


func _wire_toggle(toggle_name: String, key: String) -> void:
	var toggle := _toggle(toggle_name)
	if toggle == null:
		return
	toggle.toggled.connect(_on_toggle_changed.bind(key))


func _on_slider_changed(value: float, key: String) -> void:
	var settings := _settings()
	if settings != null:
		settings.set(key, value)
		return
	_persist_disk_volume(key, value)


func _on_toggle_changed(button_pressed: bool, key: String) -> void:
	var settings := _settings()
	if settings != null:
		settings.set(key, button_pressed)
		return
	_persist_disk_flag(key, button_pressed)


## Autoload-absent fallback: write the single key straight into the
## on-disk settings block, keeping progress/records opaque.
func _persist_disk_volume(key: String, value: float) -> void:
	var data := SaveSystem.load_game()
	var settings: Dictionary = data.get("settings", {})
	settings[key] = clampf(value, SaveSystem.VOLUME_MIN, SaveSystem.VOLUME_MAX)
	data["settings"] = settings
	SaveSystem.save_game(data)


func _persist_disk_flag(key: String, flag: bool) -> void:
	var data := SaveSystem.load_game()
	var settings: Dictionary = data.get("settings", {})
	settings[key] = flag
	data["settings"] = settings
	SaveSystem.save_game(data)


func _wire_back() -> void:
	var back := find_child("BackButton", true, false) as BaseButton
	if back != null:
		back.pressed.connect(_on_back)


func _on_back() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/main_menu.tscn")
