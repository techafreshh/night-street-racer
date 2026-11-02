class_name SaveSystem
extends RefCounted
## Versioned JSON persistence for GameState (PRD sections 7 and 10).
## Pure-static, scene-free helper (like CarTune.validate() and
## RaceEvent.next_index()): reads/writes a single versioned document at
## user://save.json so car/event selection survives restarts. Missing or
## corrupt files are not errors: load_game() falls back to default_data().
## Never raises: save_game() returns false when the write fails.

## Save document location (PRD section 7): SAVE_PATH="user://save.json".
const SAVE_PATH := "user://save.json"
## Save schema version; unknown future versions load leniently (PRD section 10).
const SAVE_VERSION := 1
## Schema version alias: SCHEMA_VERSION=1 mirrors SAVE_VERSION (issue #20 file scan).
const SCHEMA_VERSION := 1

## Fun range: 0.0 - 1.0 normalized volume level.
const VOLUME_MIN := 0.0
const VOLUME_MAX := 1.0
## Fun range: best_time_s must be a positive number of seconds.
const BEST_TIME_MIN := 0.0
## Fun range: best_position placement starts at 1 (the win).
const BEST_POSITION_MIN := 1
## Fun range: best_drift_score starts at 1 point (whole points only).
const BEST_DRIFT_SCORE_MIN := 1


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


## Strict shape check: version must be strictly int and equal SAVE_VERSION
## (bool/float/String rejected; lenient float handling lives in
## load_game(), not here), the progress
## selected_car/current_event keys must be String or StringName (StringName
## covers in-memory GameState selections; JSON parses to String),
## selected_color must be
## numeric (int or float; float covers JSON round-trip coercion), and
## unlocked_events/unlocked_cars must each be present as an Array holding
## only non-empty String/StringName entries (empty arrays are valid defaults). Settings must
## hold exactly the five default_data() keys with the three volumes numeric
## within VOLUME_MIN/VOLUME_MAX and assists/camera_shake strictly bool;
## unknown settings keys are rejected (lenient dropping still lives in
## load_game(), not here). Records may
## be empty; each entry key must be a non-empty String holding a non-empty
## Dictionary whose present best_time_s/best_position/best_drift_score keys are
## numeric-positive / int-or-whole-float-positive (whole float covers JSON
## round-trip coercion:
## Godot parses every JSON number as float, so a saved best_position 1 loads
## back as 1.0 and strict `is int` would fail a valid round-trip; integrality
## is still enforced), with unknown per-entry keys ignored.
## Lenient future-version merging lives in load_game(), not here.
static func validate(data: Dictionary) -> bool:
	var version: Variant = data.get("version", -1)
	if not (version is int):
		return false
	if version != SAVE_VERSION:
		return false
	var settings: Variant = data.get("settings")
	if not (settings is Dictionary):
		return false
	var settings_dict: Dictionary = settings
	for key: String in ["master_volume", "music_volume", "sfx_volume", "assists", "camera_shake"]:
		if not settings_dict.has(key):
			return false
	for key: Variant in settings_dict.keys():
		if not (key in ["master_volume", "music_volume", "sfx_volume", "assists", "camera_shake"]):
			return false
	for key: String in ["master_volume", "music_volume", "sfx_volume"]:
		var volume: Variant = settings_dict.get(key)
		if not (volume is int or volume is float):
			return false
		var level := float(volume)
		if level < VOLUME_MIN or level > VOLUME_MAX:
			return false
	for key: String in ["assists", "camera_shake"]:
		if not ((settings_dict.get(key)) is bool):
			return false
	var records: Variant = data.get("records")
	if not (records is Dictionary):
		return false
	for key: Variant in (records as Dictionary).keys():
		if not (key is String):
			return false
		if (key as String).is_empty():
			return false
		var entry: Variant = (records as Dictionary)[key]
		if not (entry is Dictionary):
			return false
		if (entry as Dictionary).is_empty():
			return false
		if (entry as Dictionary).has("best_time_s"):
			var best_time: Variant = (entry as Dictionary)["best_time_s"]
			if not (best_time is int or best_time is float):
				return false
			if float(best_time) <= BEST_TIME_MIN:
				return false
		if (entry as Dictionary).has("best_position"):
			var best_position: Variant = (entry as Dictionary)["best_position"]
			if not (best_position is int or best_position is float):
				return false
			if float(best_position) < float(BEST_POSITION_MIN):
				return false
			if floor(float(best_position)) != float(best_position):
				return false
		if (entry as Dictionary).has("best_drift_score"):
			var best_drift: Variant = (entry as Dictionary)["best_drift_score"]
			if not (best_drift is int or best_drift is float):
				return false
			if float(best_drift) < float(BEST_DRIFT_SCORE_MIN):
				return false
			if floor(float(best_drift)) != float(best_drift):
				return false
	var progress: Variant = data.get("progress")
	if not (progress is Dictionary):
		return false
	if not ((progress as Dictionary).get("selected_car") is String or (progress as Dictionary).get("selected_car") is StringName):
		return false
	if not ((progress as Dictionary).get("current_event") is String or (progress as Dictionary).get("current_event") is StringName):
		return false
	var color: Variant = (progress as Dictionary).get("selected_color")
	if not (color is int or color is float):
		return false
	for key: String in ["unlocked_events", "unlocked_cars"]:
		var unlocks: Variant = (progress as Dictionary).get(key)
		if not (unlocks is Array):
			return false
		for entry: Variant in (unlocks as Array):
			if not (entry is String or entry is StringName):
				return false
			if str(entry).is_empty():
				return false
	return true


## Read-boundary unlock-list sanitizer (mirrors Progression._string_list
## without the cross-class dependency): non-Array yields the empty default,
## otherwise keep non-empty Strings, fold non-empty StringNames to String,
## and drop everything else in order without deduping.
static func _sanitized_unlock_list(v: Variant) -> Array:
	var out: Array = []
	if not (v is Array):
		return out
	for item: Variant in (v as Array):
		if item is String:
			if (item as String).is_empty():
				continue
			out.append(item)
		elif item is StringName:
			var folded := String(item)
			if folded.is_empty():
				continue
			out.append(folded)
	return out


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
## The settings overlay is allow-listed to the default_data() settings keys;
## unknown settings keys are discarded. The progress overlay is allow-listed
## to the default_data() progress keys; unknown progress keys are discarded.
## Unknown top-level keys are discarded on load and never re-saved (known
## keys still merge leniently over defaults; version stamp behavior unchanged).
## The unlock lists progress.unlocked_events/progress.unlocked_cars are
## sanitized to non-empty Strings (non-Arrays reset to empty) so the loaded
## document satisfies validate().
## Records merge per-entry onto the default empty table: each raw entry is
## checked against the validate() predicates and corrupt entries are
## discarded while valid entries are sanitized to
## best_time_s/best_position/best_drift_score only; unknown per-entry keys
## are discarded and note-only entries are dropped.
## A numeric future version carries through as int so validate() still
## detects the mismatch; a missing, non-numeric, equal, or older version
## normalizes to SAVE_VERSION.
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
		var merged_settings: Dictionary = merged["settings"]
		var saved_settings: Dictionary = raw["settings"]
		for key: Variant in saved_settings.keys():
			if merged_settings.has(key):
				merged_settings[key] = saved_settings[key]
	if raw.get("progress") is Dictionary:
		var progress: Dictionary = merged["progress"]
		var saved_progress: Dictionary = raw["progress"]
		for key: Variant in saved_progress.keys():
			if progress.has(key):
				if key == "unlocked_events" or key == "unlocked_cars":
					progress[key] = _sanitized_unlock_list(saved_progress[key])
				else:
					progress[key] = saved_progress[key]
	if raw.get("records") is Dictionary:
		var merged_records: Dictionary = merged["records"]
		var saved_records: Dictionary = raw["records"]
		for key: Variant in saved_records.keys():
			if not (key is String):
				continue
			if (key as String).is_empty():
				continue
			var entry: Variant = saved_records[key]
			if not (entry is Dictionary):
				continue
			if (entry as Dictionary).is_empty():
				continue
			var record: Dictionary = entry
			if record.has("best_time_s"):
				var best_time: Variant = record["best_time_s"]
				if not (best_time is int or best_time is float):
					continue
				if float(best_time) <= BEST_TIME_MIN:
					continue
			if record.has("best_position"):
				var best_position: Variant = record["best_position"]
				if not (best_position is int or best_position is float):
					continue
				if float(best_position) < float(BEST_POSITION_MIN):
					continue
				if floor(float(best_position)) != float(best_position):
					continue
			if record.has("best_drift_score"):
				var best_drift: Variant = record["best_drift_score"]
				if not (best_drift is int or best_drift is float):
					continue
				if float(best_drift) < float(BEST_DRIFT_SCORE_MIN):
					continue
				if floor(float(best_drift)) != float(best_drift):
					continue
			var sanitized := {}
			if record.has("best_time_s"):
				sanitized["best_time_s"] = record["best_time_s"]
			if record.has("best_position"):
				sanitized["best_position"] = record["best_position"]
			if record.has("best_drift_score"):
				sanitized["best_drift_score"] = record["best_drift_score"]
			if sanitized.is_empty():
				continue
			merged_records[key] = sanitized
	var raw_version: Variant = raw.get("version", SAVE_VERSION)
	if (raw_version is int or raw_version is float) and int(raw_version) > SAVE_VERSION:
		merged["version"] = int(raw_version)
	else:
		merged["version"] = SAVE_VERSION
	return merged
