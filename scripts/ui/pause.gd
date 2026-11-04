class_name PauseMenu
extends CanvasLayer
## Standalone pause overlay for race scenes: toggles get_tree().paused on
## the shared pause/ui_cancel action, prints PAUSED/RESUMED so headless
## boots can gate on it, and offers Resume/Restart/Settings/Quit. Runs with
## PROCESS_MODE_ALWAYS (set both in the .tscn and in _ready) so input and
## button callbacks still fire while the tree is paused; everything else
## keeps INHERIT so physics and clocks freeze. Safe to boot alone: every
## lookup is guarded and _ready prints nothing.

var _paused := false
var _was_pressed := false
var _event_frame := -1


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = false
	_resync_input_state()
	var resume := _btn("ResumeButton")
	if resume != null:
		resume.pressed.connect(_on_resume)
	var restart := _btn("RestartButton")
	if restart != null:
		restart.pressed.connect(_on_restart)
	var settings := _btn("SettingsButton")
	if settings != null:
		settings.pressed.connect(_on_settings)
	var quit_btn := _btn("QuitButton")
	if quit_btn != null:
		quit_btn.pressed.connect(_on_quit)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).echo:
		return
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		_event_frame = Engine.get_process_frames()
		toggle_pause()
		_resync_input_state()


## Edge poll for programmatic injection (Input.action_press sets state with
## no event to dispatch): toggles once per rising edge. Shares the frame
## guard with the event path so one press never toggles twice.
func _process(_delta: float) -> void:
	var pressed := Input.is_action_pressed("pause") or Input.is_action_pressed("ui_cancel")
	if pressed and not _was_pressed:
		if _event_frame != Engine.get_process_frames():
			toggle_pause()
	_was_pressed = pressed


func toggle_pause() -> void:
	if _paused:
		_resume()
	else:
		_pause()


func is_paused() -> bool:
	return _paused


func _pause() -> void:
	_paused = true
	var tree := get_tree()
	if tree != null:
		tree.paused = true
	visible = true
	print("PAUSED")
	var resume := _btn("ResumeButton")
	if resume != null:
		resume.grab_focus()


func _resume() -> void:
	_paused = false
	var tree := get_tree()
	if tree != null:
		tree.paused = false
	visible = false
	print("RESUMED")


func _on_resume() -> void:
	_play_click()
	if _paused:
		_resume()


func _on_restart() -> void:
	_play_click()
	var parent := get_parent()
	if parent != null and parent.has_method("restart_race"):
		parent.call("restart_race")
	else:
		var tree := get_tree()
		if tree != null:
			tree.reload_current_scene()
	if _paused:
		_resume()


func _on_quit() -> void:
	_play_click()
	_paused = false
	var tree := get_tree()
	if tree != null:
		tree.paused = false
	visible = false
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/main_menu.tscn")


## Route to settings mid-race: unpause first (same idiom as _on_quit),
## then change scene so the settings screen boots unpaused.
func _on_settings() -> void:
	_play_click()
	_paused = false
	var tree := get_tree()
	if tree != null:
		tree.paused = false
	visible = false
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/settings.tscn")


## Guarded UI click: no-op headless or when the mixer is absent.
func _play_click() -> void:
	var am := get_node_or_null("/root/AudioManager")
	if am != null and am.has_method("play_click"):
		am.call("play_click")


func _btn(button_name: String) -> BaseButton:
	return find_child(button_name, true, false) as BaseButton


## Seed the edge poll from the live action state so a press that started
## before _ready does not read as a fresh rising edge on the first frame.
func _resync_input_state() -> void:
	_was_pressed = Input.is_action_pressed("pause") or Input.is_action_pressed("ui_cancel")
