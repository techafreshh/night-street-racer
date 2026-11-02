class_name SaveSystem
extends RefCounted
## Versioned JSON persistence for GameState (PRD sections 7 and 10).
## Pure-static, scene-free helper (like CarTune.validate() and
## RaceEvent.next_index()): reads/writes a single versioned document at
## user://save.json so car/event selection survives restarts. Missing or
## corrupt files are not errors: load_game() falls back to default_data().
## Never raises: save_game() returns false when the write fails.

## Save document location (PRD section 7).
const SAVE_PATH := "user://save.json"
## Save schema version; unknown future versions load leniently (PRD section 10).
const SAVE_VERSION := 1


## PRD section 10-shaped defaults: version + settings + progress + records.
## Only progress.selected_car / progress.current_event are authoritative
## this lap; settings / unlocked_* / records round-trip opaquely for later laps.
static func default_data() -> Dictionary:
	return {
		"version": SAVE_VERSION,
		"settings": {
			"master_volume": 0.8,
			"music_volume": 0.7,
			"sfx_volume": 0.9,
			"assists": true,
			"camera_shake": true,
		},
		"progress": {
			"unlocked_events": [],
			"unlocked_cars": [],
			"selected_car": "",
			"selected_color": 0,
			"current_event": "",
		},
		"records": {},
	}


## Strict shape check: version must equal SAVE_VERSION, the progress
## selected_car/current_event keys must be strings and selected_color must be
## numeric (int or float; float covers JSON round-trip coercion).
## Lenient future-version merging lives in load_game(), not here.
static func validate(data: Dictionary) -> bool:
	if int(data.get("version", -1)) != SAVE_VERSION:
		return false
	if not (data.get("settings") is Dictionary):
		return false
	if not (data.get("records") is Dictionary):
		return false
	var progress: Variant = data.get("progress")
	if not (progress is Dictionary):
		return false
	if not ((progress as Dictionary).get("selected_car") is String):
		return false
	if not ((progress as Dictionary).get("current_event") is String):
		return false
	var color: Variant = (progress as Dictionary).get("selected_color")
	if not (color is int or color is float):
		return false
	return true


## Write the save document. Returns false (never raises) when the file
## cannot be opened. StringName values serialize as JSON strings.
static func save_game(data: Dictionary) -> bool:
	var text := JSON.stringify(data)
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(text)
	file.close()
	return true


## Read the save document. Missing, unreadable, or corrupt files fall back
## to default_data(); valid documents merge leniently over the defaults so
## unknown future versions (and partial files) still apply their known keys.
static func load_game() -> Dictionary:
	var fallback := default_data()
	if not FileAccess.file_exists(SAVE_PATH):
		return fallback
	var text := FileAccess.get_file_as_string(SAVE_PATH)
	if text == "":
		return fallback
	var json := JSON.new()
	if json.parse(text) != OK:
		return fallback
	var parsed: Variant = json.get_data()
	if not (parsed is Dictionary):
		return fallback
	var merged := default_data()
	var raw: Dictionary = parsed
	if raw.get("settings") is Dictionary:
		merged["settings"] = raw["settings"]
	if raw.get("progress") is Dictionary:
		var progress: Dictionary = merged["progress"]
		var saved_progress: Dictionary = raw["progress"]
		for key: Variant in saved_progress.keys():
			if key == "selected_car" or key == "current_event":
				progress[key] = str(saved_progress[key])
			else:
				progress[key] = saved_progress[key]
	if raw.get("records") is Dictionary:
		merged["records"] = raw["records"]
	merged["version"] = SAVE_VERSION
	return merged
