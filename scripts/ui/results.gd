class_name ResultsUI
extends Node
## Post-race results screen: lists places 1-5 with times, highlights the
## player row, celebrates fresh NEW UNLOCK / NEW BEST banners, and offers
## Next/Retry/Menu navigation. Pulls the in-memory GameState.last_result
## handoff in _ready and falls back to a fixed 5-row mock when it is
## missing or invalid, so standalone headless boots always reach
## RESULTS_READY places=5. Unlocks flow through GameState.apply_result
## (Progression ladder + SaveSystem + cache refresh); best times flow
## through SaveSystem records. Safe to boot alone: every lookup is
## guarded and disk calls never error. Prints RESULTS_READY on ready.

## Fixed fallback: player P3 on harbor_sprint, deterministic times.
const MOCK_EVENT := "harbor_sprint"
const MOCK_PLAYER := "player"
const MOCK_TIMES: Array[float] = [85.2, 87.1, 88.2, 91.0, 95.5]
const MOCK_RACERS: Array[String] = ["ai_1", "ai_2", "player", "ai_3", "ai_4"]

var _event_id := ""
var _places: Array = []
var _player_racer := "player"
var _results_list: VBoxContainer
var _unlock_banner: Label
var _best_banner: Label


func _ready() -> void:
	_results_list = find_child("ResultsList", true, false) as VBoxContainer
	_unlock_banner = find_child("UnlockBanner", true, false) as Label
	_best_banner = find_child("BestBanner", true, false) as Label
	if _unlock_banner != null:
		_unlock_banner.visible = false
	if _best_banner != null:
		_best_banner.visible = false
	_resolve_result()
	_render_places()
	_apply_progression()
	_wire_buttons()
	print("RESULTS_READY places=%d" % _places.size())


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		get_tree().quit()


## Race clock in seconds; results show zero-padded mm:ss.mmm.
func _format_time(seconds: float) -> String:
	var t := maxf(seconds, 0.0)
	var minutes := int(t / 60.0)
	var secs := int(t) % 60
	var millis := int(roundf((t - floorf(t)) * 1000.0))
	if millis >= 1000:
		millis = 999
	return "%02d:%02d.%03d" % [minutes, secs, millis]


## Read the GameState.last_result handoff; accept it only when event_id is
## a non-empty String and places holds 1+ valid {racer, time_s, place}
## rows. Sorts by place, clamps times >= 0, and keeps the first 5 rows.
## Anything missing or invalid falls back to the fixed mock.
func _resolve_result() -> void:
	var fallback := _mock_result()
	var gs := get_node_or_null("/root/GameState")
	if gs == null:
		_apply_dict(fallback)
		return
	var raw: Variant = gs.get("last_result")
	if not (raw is Dictionary):
		_apply_dict(fallback)
		return
	var data := raw as Dictionary
	var event_id: Variant = data.get("event_id", "")
	if not (event_id is String) or (event_id as String).is_empty():
		_apply_dict(fallback)
		return
	var places: Variant = data.get("places", [])
	if not (places is Array) or (places as Array).is_empty():
		_apply_dict(fallback)
		return
	var rows: Array = []
	for entry in (places as Array):
		if not (entry is Dictionary):
			_apply_dict(fallback)
			return
		var row := entry as Dictionary
		var racer: Variant = row.get("racer", "")
		var time_s: Variant = row.get("time_s", -1.0)
		var place: Variant = row.get("place", 0)
		if not (racer is String) or (racer as String).is_empty():
			_apply_dict(fallback)
			return
		if not (time_s is int or time_s is float):
			_apply_dict(fallback)
			return
		if not (place is int or place is float):
			_apply_dict(fallback)
			return
		rows.append({
			"racer": str(racer),
			"time_s": maxf(float(time_s), 0.0),
			"place": int(place),
		})
	if rows.is_empty():
		_apply_dict(fallback)
		return
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a["place"]) < int(b["place"]))
	while rows.size() > 5:
		rows.pop_back()
	var player: Variant = data.get("player_racer", MOCK_PLAYER)
	_event_id = str(event_id)
	_places = rows
	_player_racer = str(player) if (player is String) and not (player as String).is_empty() else MOCK_PLAYER


## Fixed deterministic mock: player P3 on harbor_sprint, 5 rows.
func _mock_result() -> Dictionary:
	var rows: Array = []
	for i in 5:
		rows.append({
			"racer": MOCK_RACERS[i],
			"time_s": MOCK_TIMES[i],
			"place": i + 1,
		})
	return {"event_id": MOCK_EVENT, "places": rows, "player_racer": MOCK_PLAYER}


func _apply_dict(data: Dictionary) -> void:
	_event_id = str(data.get("event_id", MOCK_EVENT))
	_places = (data.get("places", []) as Array).duplicate(true)
	_player_racer = str(data.get("player_racer", MOCK_PLAYER))


## One Label per place into ResultsList ("P1  player  01:28.200"); the
## player row gets a marker prefix and a distinct font color. Never errors
## on a missing ResultsList.
func _render_places() -> void:
	if _results_list == null:
		return
	for child in _results_list.get_children():
		_results_list.remove_child(child)
		child.free()
	for row in _places:
		var entry := row as Dictionary
		var place := int(entry.get("place", 0))
		var racer := str(entry.get("racer", ""))
		var time_s := float(entry.get("time_s", 0.0))
		var label := Label.new()
		var is_player := racer == _player_racer
		var prefix := "▶ " if is_player else ""
		label.text = "%sP%d  %s  %s" % [prefix, place, racer, _format_time(time_s)]
		if is_player:
			label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.2, 1.0))
		_results_list.add_child(label)


## Record the podium through the GameState wrapper and refresh the best
## time through SaveSystem records. UnlockBanner shows only fresh earns
## ("NEW UNLOCK: ..."); BestBanner shows only on improvement. Every disk
## call is guarded so headless boots with defaults still pass.
func _apply_progression() -> void:
	if _event_id.is_empty() or _places.is_empty():
		return
	var player_place := 0
	var player_time := 0.0
	for row in _places:
		var entry := row as Dictionary
		if str(entry.get("racer", "")) == _player_racer:
			player_place = int(entry.get("place", 0))
			player_time = maxf(float(entry.get("time_s", 0.0)), 0.0)
			break
	if player_place <= 0:
		return
	var gs := get_node_or_null("/root/GameState")
	if gs != null and gs.has_method("apply_result"):
		var snap: Variant = gs.call("apply_result", _event_id, player_place)
		if snap is Dictionary:
			_show_unlock(snap as Dictionary)
	_compare_best(player_time, player_place)


func _show_unlock(snap: Dictionary) -> void:
	if _unlock_banner == null:
		return
	var tokens: Array[String] = []
	if str(snap.get("event_unlocked", "")) != "":
		tokens.append(str(snap.get("event_unlocked")))
	if str(snap.get("car_unlocked", "")) != "":
		tokens.append(str(snap.get("car_unlocked")))
	if tokens.is_empty():
		return
	_unlock_banner.text = "NEW UNLOCK: %s" % " + ".join(tokens)
	_unlock_banner.visible = true


## Compare the player time against the stored records entry and persist
## the improvement; BestBanner shows only when the time is beaten or no
## record exists yet.
func _compare_best(player_time: float, player_place: int) -> void:
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return
	var table := records as Dictionary
	var improved := false
	if not table.has(_event_id):
		improved = true
	else:
		var entry: Variant = table[_event_id]
		if entry is Dictionary and (entry as Dictionary).has("best_time_s"):
			var stored: Variant = (entry as Dictionary)["best_time_s"]
			if stored is int or stored is float:
				improved = player_time < float(stored)
			else:
				improved = true
		else:
			improved = true
	if not improved:
		return
	table[_event_id] = {"best_time_s": player_time, "best_position": player_place}
	data["records"] = table
	if not SaveSystem.save_game(data):
		return
	if _best_banner != null:
		_best_banner.text = "NEW BEST: %s" % _format_time(player_time)
		_best_banner.visible = true


func _btn(button_name: String) -> BaseButton:
	return find_child(button_name, true, false) as BaseButton


func _wire_buttons() -> void:
	var next_btn := _btn("NextButton")
	if next_btn != null:
		next_btn.pressed.connect(_on_next)
	var retry := _btn("RetryButton")
	if retry != null:
		retry.pressed.connect(_on_retry)
	var menu_btn := _btn("MenuButton")
	if menu_btn != null:
		menu_btn.pressed.connect(_on_menu)
	# Focus the first enabled button so keyboard/gamepad can start at once.
	for button_name in ["NextButton", "RetryButton", "MenuButton"]:
		var btn := _btn(button_name)
		if btn != null and not btn.disabled:
			btn.grab_focus()
			return


func _on_next() -> void:
	var gs := get_node_or_null("/root/GameState")
	var next_event := Progression.next_event_after(_event_id)
	if gs != null and next_event != "" and gs.has_method("select_event"):
		gs.call("select_event", next_event)
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/event_select.tscn")


func _on_retry() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/results.tscn")


func _on_menu() -> void:
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/main_menu.tscn")
