extends RefCounted
## GameState, save-system, and progression probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_gamestate_standalone",
		"test_save_system_roundtrip",
		"save_roundtrip_equal",
		"corrupt_save_yields_defaults",
		"test_gamestate_rejects_nonint_color",
		"test_save_system_drops_unknown_settings_keys",
		"test_save_system_rejects_unknown_settings_keys",
		"test_save_system_partial_settings_merge",
		"test_save_system_drops_unknown_progress_keys",
		"test_save_system_records_per_entry_merge",
		"test_save_system_drops_unknown_top_level_keys",
		"test_save_system_rejects_nonstring_selection",
		"test_gamestate_persists_selection",
		"test_gamestate_coalesces_rapid_writes",
		"test_gamestate_reload_rejects_non_numeric_color",
		"test_gamestate_selected_car_default",
		"settings_persist_across_load",
		"test_gamestate_select_mode_validates",
		"test_gamestate_direct_mode_assignment_guarded",
	]
	return names

func test_gamestate_standalone() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads")
	if script != null:
		var node: Node = script.new()
		ctx.check(node != null, "GameState instantiates standalone")
		ctx.check(node is Node, "GameState is a Node")
		if node != null:
			node.free()
	return true

func test_save_system_roundtrip() -> bool:
	ctx.check(SaveSystem.SAVE_PATH == "user://save.json", "save path is user://save.json")
	ctx.check(SaveSystem.SAVE_VERSION == 1, "save schema version is 1")
	var blank := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(blank), "default_data passes SaveSystem.validate()")
	ctx.check(int((blank["progress"] as Dictionary).get("selected_color")) == 0, "default selected_color is int 0")
	var bool_version := SaveSystem.default_data()
	bool_version["version"] = true
	ctx.check(not SaveSystem.validate(bool_version), "bool version fails SaveSystem.validate()")
	var string_version := SaveSystem.default_data()
	string_version["version"] = "1"
	ctx.check(not SaveSystem.validate(string_version), "String version fails SaveSystem.validate()")
	var float_version := SaveSystem.default_data()
	float_version["version"] = 1.0
	ctx.check(not SaveSystem.validate(float_version), "float version fails SaveSystem.validate()")
	var missing_version := SaveSystem.default_data()
	missing_version.erase("version")
	ctx.check(not SaveSystem.validate(missing_version), "missing version fails SaveSystem.validate()")
	var wrong_version := SaveSystem.default_data()
	wrong_version["version"] = 2
	ctx.check(not SaveSystem.validate(wrong_version), "version 2 fails SaveSystem.validate()")
	var int_version := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(int_version), "int version passes SaveSystem.validate()")
	var float_color := SaveSystem.default_data()
	(float_color["progress"] as Dictionary)["selected_color"] = 2.0
	ctx.check(SaveSystem.validate(float_color), "float selected_color validates as JSON round-trip equivalent")
	var bad_color := SaveSystem.default_data()
	(bad_color["progress"] as Dictionary)["selected_color"] = "red"
	ctx.check(not SaveSystem.validate(bad_color), "String selected_color fails SaveSystem.validate()")
	var missing_color := SaveSystem.default_data()
	(missing_color["progress"] as Dictionary).erase("selected_color")
	ctx.check(not SaveSystem.validate(missing_color), "missing selected_color fails SaveSystem.validate()")
	var unlock_defaults := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(unlock_defaults), "default empty unlock lists validate")
	var unlock_good := SaveSystem.default_data()
	(unlock_good["progress"] as Dictionary)["unlocked_events"] = ["harbor_sprint"]
	(unlock_good["progress"] as Dictionary)["unlocked_cars"] = ["coupe"]
	ctx.check(SaveSystem.validate(unlock_good), "populated unlock lists validate")
	var unlock_missing_events := SaveSystem.default_data()
	(unlock_missing_events["progress"] as Dictionary).erase("unlocked_events")
	ctx.check(not SaveSystem.validate(unlock_missing_events), "missing unlocked_events fails SaveSystem.validate()")
	var unlock_missing_cars := SaveSystem.default_data()
	(unlock_missing_cars["progress"] as Dictionary).erase("unlocked_cars")
	ctx.check(not SaveSystem.validate(unlock_missing_cars), "missing unlocked_cars fails SaveSystem.validate()")
	var unlock_string := SaveSystem.default_data()
	(unlock_string["progress"] as Dictionary)["unlocked_events"] = "harbor_sprint"
	ctx.check(not SaveSystem.validate(unlock_string), "String unlocked_events fails SaveSystem.validate()")
	var unlock_dict := SaveSystem.default_data()
	(unlock_dict["progress"] as Dictionary)["unlocked_cars"] = {}
	ctx.check(not SaveSystem.validate(unlock_dict), "Dictionary unlocked_cars fails SaveSystem.validate()")
	var unlock_int_entry := SaveSystem.default_data()
	(unlock_int_entry["progress"] as Dictionary)["unlocked_events"] = ["harbor_sprint", 42]
	ctx.check(not SaveSystem.validate(unlock_int_entry), "int unlock entry fails SaveSystem.validate()")
	var unlock_empty_entry := SaveSystem.default_data()
	(unlock_empty_entry["progress"] as Dictionary)["unlocked_cars"] = [""]
	ctx.check(not SaveSystem.validate(unlock_empty_entry), "empty-String unlock entry fails SaveSystem.validate()")
	var stringname_car := SaveSystem.default_data()
	(stringname_car["progress"] as Dictionary)["selected_car"] = &"hatch"
	ctx.check(SaveSystem.validate(stringname_car), "StringName selected_car validates")
	var stringname_event := SaveSystem.default_data()
	(stringname_event["progress"] as Dictionary)["current_event"] = &"neon_loop"
	ctx.check(SaveSystem.validate(stringname_event), "StringName current_event validates")
	var unlock_stringname := SaveSystem.default_data()
	(unlock_stringname["progress"] as Dictionary)["unlocked_events"] = [&"harbor_sprint"]
	(unlock_stringname["progress"] as Dictionary)["unlocked_cars"] = [&"coupe"]
	ctx.check(SaveSystem.validate(unlock_stringname), "StringName unlock entries validate")
	var unlock_mixed := SaveSystem.default_data()
	(unlock_mixed["progress"] as Dictionary)["unlocked_events"] = ["harbor_sprint", &"downtown_gp"]
	(unlock_mixed["progress"] as Dictionary)["unlocked_cars"] = ["coupe", &"hatch"]
	ctx.check(SaveSystem.validate(unlock_mixed), "mixed String/StringName unlock entries validate")
	var unlock_empty_stringname := SaveSystem.default_data()
	(unlock_empty_stringname["progress"] as Dictionary)["unlocked_cars"] = [&""]
	ctx.check(not SaveSystem.validate(unlock_empty_stringname), "empty-StringName unlock entry fails SaveSystem.validate()")
	var default_settings := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(default_settings), "default settings validate")
	var bad_volume := SaveSystem.default_data()
	(bad_volume["settings"] as Dictionary)["master_volume"] = "loud"
	ctx.check(not SaveSystem.validate(bad_volume), "String master_volume fails SaveSystem.validate()")
	var missing_volume := SaveSystem.default_data()
	(missing_volume["settings"] as Dictionary).erase("sfx_volume")
	ctx.check(not SaveSystem.validate(missing_volume), "missing sfx_volume fails SaveSystem.validate()")
	var loud_volume := SaveSystem.default_data()
	(loud_volume["settings"] as Dictionary)["master_volume"] = 2.0
	ctx.check(not SaveSystem.validate(loud_volume), "out-of-range master_volume fails SaveSystem.validate()")
	var int_volume := SaveSystem.default_data()
	(int_volume["settings"] as Dictionary)["master_volume"] = 1
	ctx.check(SaveSystem.validate(int_volume), "int master_volume validates as JSON round-trip equivalent")
	var bad_assists := SaveSystem.default_data()
	(bad_assists["settings"] as Dictionary)["assists"] = 1
	ctx.check(not SaveSystem.validate(bad_assists), "non-bool assists fails SaveSystem.validate()")
	var default_records := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(default_records), "default empty records validate")
	var good_records := SaveSystem.default_data()
	(good_records["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1}
	ctx.check(SaveSystem.validate(good_records), "well-formed records entry validates")
	var float_position := SaveSystem.default_data()
	(float_position["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1.0}
	ctx.check(SaveSystem.validate(float_position), "whole-float best_position validates as JSON round-trip equivalent")
	var frac_position := SaveSystem.default_data()
	(frac_position["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1.5}
	ctx.check(not SaveSystem.validate(frac_position), "fractional best_position fails SaveSystem.validate()")
	var string_entry := SaveSystem.default_data()
	(string_entry["records"] as Dictionary)["harbor_sprint"] = "fast"
	ctx.check(not SaveSystem.validate(string_entry), "String records entry fails SaveSystem.validate()")
	var bad_time := SaveSystem.default_data()
	(bad_time["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": "fast", "best_position": 1}
	ctx.check(not SaveSystem.validate(bad_time), "String best_time_s fails SaveSystem.validate()")
	var empty_entry := SaveSystem.default_data()
	(empty_entry["records"] as Dictionary)["harbor_sprint"] = {}
	ctx.check(not SaveSystem.validate(empty_entry), "empty records entry fails SaveSystem.validate()")
	var color_trip := SaveSystem.default_data()
	(color_trip["progress"] as Dictionary)["selected_color"] = 2
	ctx.check(SaveSystem.save_game(color_trip), "save_game writes a non-default int selected_color")
	var color_loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(color_loaded), "non-default int selected_color loads back valid")
	ctx.check(int((color_loaded["progress"] as Dictionary).get("selected_color")) == 2, "roundtrip keeps selected_color")
	var records_trip := SaveSystem.default_data()
	(records_trip["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1}
	ctx.check(SaveSystem.save_game(records_trip), "save_game writes well-formed records")
	var records_loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(records_loaded), "well-formed records load back valid")
	var loaded_entry: Dictionary = (records_loaded["records"] as Dictionary).get("harbor_sprint", {})
	ctx.check(float(loaded_entry.get("best_time_s", 0.0)) == 93.24, "roundtrip keeps best_time_s")
	ctx.check(int(loaded_entry.get("best_position", 0)) == 1, "roundtrip keeps best_position")
	var data := SaveSystem.default_data()
	var progress: Dictionary = data["progress"]
	progress["selected_car"] = "hatch"
	progress["current_event"] = "neon_loop"
	ctx.check(SaveSystem.save_game(data), "save_game writes a non-default dict")
	var loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(loaded), "written save loads back valid")
	var loaded_progress: Dictionary = loaded["progress"]
	ctx.check(str(loaded_progress.get("selected_car")) == "hatch", "roundtrip keeps selected_car")
	ctx.check(str(loaded_progress.get("current_event")) == "neon_loop", "roundtrip keeps current_event")
	ctx.check(int(loaded.get("version")) == SaveSystem.SAVE_VERSION, "roundtrip keeps version")
	var future := SaveSystem.default_data()
	future["version"] = SaveSystem.SAVE_VERSION + 1
	(future["progress"] as Dictionary)["selected_car"] = "coupe"
	(future["progress"] as Dictionary)["current_event"] = "neon_loop"
	ctx.check(SaveSystem.save_game(future), "save_game writes a future-version doc")
	var future_loaded := SaveSystem.load_game()
	ctx.check(int(future_loaded.get("version")) == SaveSystem.SAVE_VERSION + 1, "future version survives load")
	ctx.check(not SaveSystem.validate(future_loaded), "future version fails SaveSystem.validate()")
	ctx.check(str((future_loaded["progress"] as Dictionary).get("selected_car")) == "coupe", "future version keeps selected_car")
	ctx.check(str((future_loaded["progress"] as Dictionary).get("current_event")) == "neon_loop", "future version keeps current_event")
	ctx.check(SaveSystem.save_game(future_loaded), "save_game rewrites the loaded future doc")
	var future_reloaded := SaveSystem.load_game()
	ctx.check(int(future_reloaded.get("version")) == SaveSystem.SAVE_VERSION + 1, "future version survives load-save-load")
	ctx.check(str((future_reloaded["progress"] as Dictionary).get("selected_car")) == "coupe", "re-saved future doc keeps selected_car")
	ctx.check(str((future_reloaded["progress"] as Dictionary).get("current_event")) == "neon_loop", "re-saved future doc keeps current_event")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "future-version probe restores defaults")
	var corrupt := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(corrupt != null, "save path opens for the corruption probe")
	if corrupt != null:
		corrupt.store_string("{not valid json!!!")
		corrupt.close()
	var fallback := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(fallback), "corrupt file falls back to valid defaults")
	var fallback_progress: Dictionary = fallback["progress"]
	ctx.check(str(fallback_progress.get("selected_car")) == "", "corrupt fallback resets selected_car")
	ctx.check(str(fallback_progress.get("current_event")) == "", "corrupt fallback resets current_event")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "save restores defaults after the probe")
	return true

func save_roundtrip_equal() -> bool:
	ctx.check(SaveSystem.SAVE_PATH == "user://save.json", "save path is user://save.json")
	ctx.check(SaveSystem.SCHEMA_VERSION == 1, "save schema version is 1")
	ctx.check(SaveSystem.SAVE_VERSION == 1, "save version is 1")
	var data := SaveSystem.default_data()
	var progress: Dictionary = data["progress"]
	progress["selected_car"] = "hatch"
	progress["current_event"] = "neon_loop"
	(data["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1}
	ctx.check(SaveSystem.save_game(data), "save_game writes a non-default doc")
	var loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(loaded), "written save loads back valid")
	var loaded_progress: Dictionary = loaded["progress"]
	ctx.check(str(loaded_progress.get("selected_car")) == "hatch", "roundtrip keeps selected_car")
	ctx.check(str(loaded_progress.get("current_event")) == "neon_loop", "roundtrip keeps current_event")
	ctx.check(int(loaded.get("version")) == 1, "roundtrip keeps version")
	var entry: Dictionary = (loaded["records"] as Dictionary).get("harbor_sprint", {})
	ctx.check(float(entry.get("best_time_s", 0.0)) == 93.24, "roundtrip keeps best_time_s")
	ctx.check(int(entry.get("best_position", 0)) == 1, "roundtrip keeps best_position")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "roundtrip probe restores defaults")
	return true

func corrupt_save_yields_defaults() -> bool:
	if FileAccess.file_exists(SaveSystem.SAVE_PATH):
		DirAccess.remove_absolute(SaveSystem.SAVE_PATH)
	var missing := SaveSystem.load_game()
	var defaults := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(missing), "missing file falls back to valid defaults")
	ctx.check(SaveSystem.validate(defaults), "default_data passes validate")
	ctx.check(int(missing.get("version")) == int(defaults.get("version")), "missing fallback keeps version")
	ctx.check(str((missing["progress"] as Dictionary).get("selected_car")) == "", "missing fallback resets selected_car")
	ctx.check(str((missing["progress"] as Dictionary).get("current_event")) == "", "missing fallback resets current_event")
	var corrupt := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(corrupt != null, "save path opens for the corruption probe")
	if corrupt != null:
		corrupt.store_string("{not valid json!!!")
		corrupt.close()
	var fallback := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(fallback), "corrupt file falls back to valid defaults")
	var fallback_progress: Dictionary = fallback["progress"]
	ctx.check(str(fallback_progress.get("selected_car")) == "", "corrupt fallback resets selected_car")
	ctx.check(str(fallback_progress.get("current_event")) == "", "corrupt fallback resets current_event")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "corrupt probe restores defaults")
	return true

func test_gamestate_rejects_nonint_color() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the color coercion probe")
	if script == null:
		return true
	var bad_bool := SaveSystem.default_data()
	(bad_bool["progress"] as Dictionary)["selected_color"] = true
	ctx.check(SaveSystem.save_game(bad_bool), "save_game writes bool selected_color probe")
	var probe_bool = script.new()
	probe_bool.reload_from_disk()
	ctx.check(int(probe_bool.get("selected_color")) == 0, "bool selected_color reloads to the safe default")
	probe_bool.free()
	var bad_string := SaveSystem.default_data()
	(bad_string["progress"] as Dictionary)["selected_color"] = "2"
	ctx.check(SaveSystem.save_game(bad_string), "save_game writes String selected_color probe")
	var probe_string = script.new()
	probe_string.reload_from_disk()
	ctx.check(int(probe_string.get("selected_color")) == 0, "String selected_color reloads to the safe default")
	probe_string.free()
	var good_float := SaveSystem.default_data()
	(good_float["progress"] as Dictionary)["selected_color"] = 2.0
	ctx.check(SaveSystem.save_game(good_float), "save_game writes float selected_color probe")
	var probe_float = script.new()
	probe_float.reload_from_disk()
	ctx.check(int(probe_float.get("selected_color")) == 2, "float selected_color still loads")
	probe_float.free()
	var good_int := SaveSystem.default_data()
	(good_int["progress"] as Dictionary)["selected_color"] = 2
	ctx.check(SaveSystem.save_game(good_int), "save_game writes int selected_color probe")
	var probe_int = script.new()
	probe_int.reload_from_disk()
	ctx.check(int(probe_int.get("selected_color")) == 2, "int selected_color still loads")
	probe_int.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "color coercion probe restores defaults")
	return true

func test_save_system_drops_unknown_settings_keys() -> bool:
	var defaults := SaveSystem.default_data()
	var default_settings: Dictionary = defaults["settings"]
	var raw := {
		"version": SaveSystem.SAVE_VERSION,
		"settings": {"master_volume": 0.3, "music_volume": 0.7, "bogus_key": 123, " aimbot": true},
		"progress": (defaults["progress"] as Dictionary).duplicate(true),
		"records": {},
	}
	var probe := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(probe != null, "save path opens for the unknown settings probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	var loaded_settings: Dictionary = loaded["settings"]
	ctx.check(absf(float(loaded_settings.get("master_volume", -1.0)) - 0.3) < 0.001, "unknown-settings merge keeps the saved master_volume")
	ctx.check(loaded_settings.get("music_volume") == default_settings.get("music_volume"), "unknown-settings merge keeps known music_volume")
	for key: String in ["sfx_volume", "assists", "camera_shake"]:
		ctx.check(loaded_settings.get(key) == default_settings.get(key), "unknown-settings merge fills default %s" % key)
	ctx.check(not loaded_settings.has("bogus_key"), "unknown settings key bogus_key is dropped")
	ctx.check(not loaded_settings.has(" aimbot"), "unknown settings key with space is dropped")
	ctx.check(SaveSystem.validate(loaded), "unknown settings keys load back valid")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "unknown settings probe restores defaults")
	return true

func test_save_system_rejects_unknown_settings_keys() -> bool:
	var clean := SaveSystem.default_data()
	ctx.check(SaveSystem.validate(clean), "default settings validate")
	var bogus := SaveSystem.default_data()
	(bogus["settings"] as Dictionary)["bogus_key"] = 123
	ctx.check(not SaveSystem.validate(bogus), "extra settings key bogus_key fails SaveSystem.validate()")
	var spaced := SaveSystem.default_data()
	(spaced["settings"] as Dictionary)[" aimbot"] = true
	ctx.check(not SaveSystem.validate(spaced), "extra settings key with space fails SaveSystem.validate()")
	return true

func test_save_system_partial_settings_merge() -> bool:
	var defaults := SaveSystem.default_data()
	var default_settings: Dictionary = defaults["settings"]
	var raw := {
		"version": SaveSystem.SAVE_VERSION,
		"settings": {"master_volume": 0.3},
		"progress": (defaults["progress"] as Dictionary).duplicate(true),
		"records": {},
	}
	var probe := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(probe != null, "save path opens for the partial settings probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(loaded), "partial settings load back valid")
	var loaded_settings: Dictionary = loaded["settings"]
	ctx.check(absf(float(loaded_settings.get("master_volume", -1.0)) - 0.3) < 0.001, "partial merge keeps the saved master_volume")
	for key: String in ["music_volume", "sfx_volume", "assists", "camera_shake"]:
		ctx.check(loaded_settings.get(key) == default_settings.get(key), "partial merge fills default %s" % key)
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "partial settings probe restores defaults")
	return true

func test_save_system_drops_unknown_progress_keys() -> bool:
	var defaults := SaveSystem.default_data()
	var default_progress: Dictionary = defaults["progress"]
	var dirty_progress: Dictionary = (defaults["progress"] as Dictionary).duplicate(true)
	dirty_progress["selected_car"] = "hatch"
	dirty_progress["current_event"] = "neon_loop"
	dirty_progress["bogus_key"] = 123
	dirty_progress[" aimbot"] = true
	var raw := {
		"version": SaveSystem.SAVE_VERSION,
		"settings": (defaults["settings"] as Dictionary).duplicate(true),
		"progress": dirty_progress,
		"records": {},
	}
	var probe := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(probe != null, "save path opens for the unknown progress probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	var loaded_progress: Dictionary = loaded["progress"]
	ctx.check(str(loaded_progress.get("selected_car")) == "hatch", "unknown-progress merge keeps the saved selected_car")
	ctx.check(str(loaded_progress.get("current_event")) == "neon_loop", "unknown-progress merge keeps the saved current_event")
	for key: String in ["unlocked_events", "unlocked_cars", "selected_color"]:
		ctx.check(loaded_progress.get(key) == default_progress.get(key), "unknown-progress merge fills default %s" % key)
	ctx.check(not loaded_progress.has("bogus_key"), "unknown progress key bogus_key is dropped")
	ctx.check(not loaded_progress.has(" aimbot"), "unknown progress key with space is dropped")
	ctx.check(SaveSystem.validate(loaded), "unknown progress keys load back valid")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "unknown progress probe restores defaults")
	return true

func test_save_system_records_per_entry_merge() -> bool:
	var defaults := SaveSystem.default_data()
	var raw := {
		"version": SaveSystem.SAVE_VERSION,
		"settings": (defaults["settings"] as Dictionary).duplicate(true),
		"progress": (defaults["progress"] as Dictionary).duplicate(true),
		"records": {
			"harbor_sprint": {"best_time_s": 93.24, "best_position": 1, "note": "pb"},
			"note_only": {"note": "pb"},
			"string_entry": "fast",
			"empty_entry": {},
			"bad_time_type": {"best_time_s": "fast", "best_position": 1},
			"frac_position": {"best_time_s": 90.0, "best_position": 1.5},
			"zero_time": {"best_time_s": 0.0, "best_position": 2},
			"": {"best_time_s": 80.0, "best_position": 1},
		},
	}
	var probe := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(probe != null, "save path opens for the records per-entry probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(loaded), "mixed records load back valid")
	var records: Dictionary = loaded["records"]
	ctx.check(records.has("harbor_sprint"), "valid records entry survives a dirty load")
	if records.has("harbor_sprint"):
		var entry: Dictionary = records["harbor_sprint"]
		ctx.check(float(entry.get("best_time_s", 0.0)) == 93.24, "per-entry merge keeps best_time_s")
		ctx.check(int(entry.get("best_position", 0)) == 1, "per-entry merge keeps best_position")
		ctx.check(not entry.has("note"), "unknown per-entry key note is dropped")
		ctx.check(entry.size() == 2, "sanitized entry holds only the two known keys")
	ctx.check(not records.has("string_entry"), "corrupt String records entry is dropped")
	ctx.check(not records.has("empty_entry"), "corrupt empty records entry is dropped")
	ctx.check(not records.has("bad_time_type"), "corrupt best_time_s String entry is dropped")
	ctx.check(not records.has("frac_position"), "corrupt fractional best_position entry is dropped")
	ctx.check(not records.has("zero_time"), "corrupt zero best_time_s entry is dropped")
	ctx.check(not records.has(""), "corrupt empty-key records entry is dropped")
	ctx.check(not records.has("note_only"), "note-only records entry is dropped")
	ctx.check(records.size() == 1, "only the valid records entry survives")
	ctx.check(SaveSystem.save_game(loaded), "save_game rewrites the doc after unknown per-entry keys were dropped")
	var reloaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(reloaded), "reloaded doc without unknown per-entry keys still validates")
	var reloaded_records: Dictionary = reloaded["records"]
	ctx.check(reloaded_records.has("harbor_sprint"), "sanitized entry survives load-save-load")
	if reloaded_records.has("harbor_sprint"):
		var reloaded_entry: Dictionary = reloaded_records["harbor_sprint"]
		ctx.check(not reloaded_entry.has("note"), "unknown per-entry key stays dropped after load-save-load")
		ctx.check(reloaded_entry.size() == 2, "re-saved entry still holds only the two known keys")
		ctx.check(float(reloaded_entry.get("best_time_s", 0.0)) == 93.24, "re-saved entry keeps best_time_s")
		ctx.check(int(reloaded_entry.get("best_position", 0)) == 1, "re-saved entry keeps best_position")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "records per-entry probe restores defaults")
	return true

func test_save_system_drops_unknown_top_level_keys() -> bool:
	var defaults := SaveSystem.default_data()
	var default_settings: Dictionary = defaults["settings"]
	var raw := {
		"version": SaveSystem.SAVE_VERSION,
		"settings": {"master_volume": 0.3},
		"progress": (defaults["progress"] as Dictionary).duplicate(true),
		"records": {},
		"achievements_seen": true,
		"garage_v2": {"spots": 3},
		"extra_list": [1, 2, 3],
		"extra_note": "hello",
	}
	(raw["progress"] as Dictionary)["selected_car"] = "hatch"
	var probe := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(probe != null, "save path opens for the unknown top-level probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	ctx.check(not loaded.has("achievements_seen"), "unknown scalar key achievements_seen is dropped")
	ctx.check(not loaded.has("garage_v2"), "unknown Dictionary key garage_v2 is dropped")
	ctx.check(not loaded.has("extra_list"), "unknown Array key extra_list is dropped")
	ctx.check(not loaded.has("extra_note"), "unknown String key extra_note is dropped")
	ctx.check(loaded.size() == 4, "only the four default_data() top-level keys survive")
	var loaded_settings: Dictionary = loaded["settings"]
	ctx.check(absf(float(loaded_settings.get("master_volume", -1.0)) - 0.3) < 0.001, "known saved master_volume kept alongside unknown keys")
	for key: String in ["music_volume", "sfx_volume", "assists", "camera_shake"]:
		ctx.check(loaded_settings.get(key) == default_settings.get(key), "missing setting fills default %s alongside unknown keys" % key)
	ctx.check(str((loaded["progress"] as Dictionary).get("selected_car")) == "hatch", "known selected_car kept alongside unknown keys")
	ctx.check(SaveSystem.validate(loaded), "dropped unknown keys load back valid")
	ctx.check(SaveSystem.save_game(loaded), "save_game rewrites the doc after unknown keys were dropped")
	var reloaded := SaveSystem.load_game()
	ctx.check(not reloaded.has("achievements_seen"), "unknown scalar key stays dropped after load-save-load")
	ctx.check(not reloaded.has("garage_v2"), "unknown Dictionary key stays dropped after load-save-load")
	ctx.check(not reloaded.has("extra_list"), "unknown Array key stays dropped after load-save-load")
	ctx.check(not reloaded.has("extra_note"), "unknown String key stays dropped after load-save-load")
	ctx.check(reloaded.size() == 4, "reloaded doc still holds only the four default_data() top-level keys")
	ctx.check(absf(float((reloaded["settings"] as Dictionary).get("master_volume", -1.0)) - 0.3) < 0.001, "re-saved doc keeps master_volume")
	ctx.check(str((reloaded["progress"] as Dictionary).get("selected_car")) == "hatch", "re-saved doc keeps selected_car")
	ctx.check(SaveSystem.validate(reloaded), "reloaded doc without unknown keys still validates")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "unknown top-level probe restores defaults")
	return true

func test_save_system_rejects_nonstring_selection() -> bool:
	var bad := SaveSystem.default_data()
	(bad["progress"] as Dictionary)["selected_car"] = 42
	(bad["progress"] as Dictionary)["current_event"] = true
	ctx.check(SaveSystem.save_game(bad), "save_game writes wrong-typed selection probe")
	var loaded := SaveSystem.load_game()
	var loaded_progress: Dictionary = loaded["progress"]
	var loaded_car: Variant = loaded_progress.get("selected_car")
	var loaded_event: Variant = loaded_progress.get("current_event")
	ctx.check(not (loaded_car is String), "wrong-typed selected_car loads uncoerced")
	ctx.check(typeof(loaded_car) != TYPE_STRING, "wrong-typed selected_car keeps its disk type")
	ctx.check(not (loaded_event is String), "wrong-typed current_event loads uncoerced")
	ctx.check(not SaveSystem.validate(loaded), "wrong-typed selection fails SaveSystem.validate()")
	var bad_dict := SaveSystem.default_data()
	(bad_dict["progress"] as Dictionary)["selected_car"] = "hatch"
	(bad_dict["progress"] as Dictionary)["current_event"] = {"route": "neon_loop"}
	ctx.check(SaveSystem.save_game(bad_dict), "save_game writes dict current_event probe")
	var loaded_dict := SaveSystem.load_game()
	var loaded_dict_event: Variant = (loaded_dict["progress"] as Dictionary).get("current_event")
	ctx.check(not (loaded_dict_event is String), "dict current_event loads uncoerced")
	ctx.check(not SaveSystem.validate(loaded_dict), "dict current_event fails SaveSystem.validate()")
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the coercion probe")
	if script != null:
		var node = script.new()
		ctx.check(node != null, "GameState instantiates standalone for the coercion probe")
		if node != null:
			node.reload_from_disk()
			ctx.check(StringName(node.get("selected_car")) == &"hatch", "valid selected_car still loads via reload_from_disk")
			ctx.check(StringName(node.get("current_event")) == &"", "dict current_event reloads to the safe default")
			node.free()
	ctx.check(SaveSystem.save_game(bad), "save_game rewrites the int/bool probe")
	if script != null:
		var probe = script.new()
		if probe != null:
			probe.reload_from_disk()
			ctx.check(StringName(probe.get("selected_car")) == &"", "int selected_car reloads to the safe default, not &\"42\"")
			ctx.check(StringName(probe.get("current_event")) == &"", "bool current_event reloads to the safe default")
			probe.free()
	var good := SaveSystem.default_data()
	(good["progress"] as Dictionary)["selected_car"] = "hatch"
	(good["progress"] as Dictionary)["current_event"] = "neon_loop"
	ctx.check(SaveSystem.save_game(good), "save_game writes valid String selection")
	var good_loaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(good_loaded), "valid String selection still validates")
	ctx.check(str((good_loaded["progress"] as Dictionary).get("selected_car")) == "hatch", "valid selected_car round-trips byte-identical")
	ctx.check(str((good_loaded["progress"] as Dictionary).get("current_event")) == "neon_loop", "valid current_event round-trips byte-identical")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "coercion probe restores defaults")
	return true

func test_gamestate_persists_selection() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the persistence probe")
	if script == null:
		return true
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "persistence probe starts from defaults")
	var first = script.new()
	ctx.check(first != null, "first GameState instantiates standalone")
	if first == null:
		return true
	first.select_car("hatch")
	first.select_event("neon_loop")
	first.flush()
	var second = script.new()
	ctx.check(second != null, "second GameState instantiates standalone")
	if second == null:
		first.free()
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	second.reload_from_disk()
	ctx.check(StringName(second.get("selected_car")) == &"hatch", "fresh instance observes saved selected_car")
	ctx.check(StringName(second.get("current_event")) == &"neon_loop", "fresh instance observes saved current_event")
	first.flush()
	second.flush()
	first.free()
	second.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "persistence probe restores defaults")
	return true

func test_gamestate_coalesces_rapid_writes() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the coalescing probe")
	if script == null:
		return true
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "coalescing probe starts from defaults")
	var node = script.new()
	ctx.check(node != null, "GameState instantiates standalone for the coalescing probe")
	if node == null:
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	node.select_car("hatch")
	node.select_color(2)
	node.select_event("neon_loop")
	var before := SaveSystem.load_game()
	var before_progress: Dictionary = before["progress"]
	ctx.check(str(before_progress.get("selected_car")) == "", "three rapid writes schedule no synchronous disk write")
	ctx.check(int(before_progress.get("selected_color")) == 0, "selected_color still default before flush")
	ctx.check(str(before_progress.get("current_event")) == "", "current_event still default before flush")
	node.flush()
	var after := SaveSystem.load_game()
	var after_progress: Dictionary = after["progress"]
	ctx.check(str(after_progress.get("selected_car")) == "hatch", "one flush durably stores selected_car")
	ctx.check(int(after_progress.get("selected_color")) == 2, "one flush durably stores selected_color")
	ctx.check(str(after_progress.get("current_event")) == "neon_loop", "one flush durably stores current_event")
	var before_flush := FileAccess.get_file_as_string(SaveSystem.SAVE_PATH)
	node.flush()
	var after_flush := FileAccess.get_file_as_string(SaveSystem.SAVE_PATH)
	ctx.check(after_flush == before_flush, "repeat flush without new writes writes nothing")
	node.flush()
	node.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "coalescing probe restores defaults")
	return true

func test_gamestate_reload_rejects_non_numeric_color() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the non-numeric color probe")
	if script == null:
		return true
	var bad_word := SaveSystem.default_data()
	(bad_word["progress"] as Dictionary)["selected_color"] = "red"
	ctx.check(SaveSystem.save_game(bad_word), "save_game writes String selected_color probe")
	var probe_word = script.new()
	probe_word.reload_from_disk()
	ctx.check(int(probe_word.get("selected_color")) == 0, "String selected_color reloads as default 0")
	probe_word.free()
	var bad_numeric := SaveSystem.default_data()
	(bad_numeric["progress"] as Dictionary)["selected_color"] = "2"
	ctx.check(SaveSystem.save_game(bad_numeric), "save_game writes numeric String selected_color probe")
	var probe_numeric = script.new()
	probe_numeric.reload_from_disk()
	ctx.check(int(probe_numeric.get("selected_color")) == 0, "numeric String selected_color reloads as default 0")
	probe_numeric.free()
	var bad_bool := SaveSystem.default_data()
	(bad_bool["progress"] as Dictionary)["selected_color"] = true
	ctx.check(SaveSystem.save_game(bad_bool), "save_game writes bool selected_color probe")
	var probe_bool = script.new()
	probe_bool.reload_from_disk()
	ctx.check(int(probe_bool.get("selected_color")) == 0, "bool selected_color reloads as default 0")
	probe_bool.free()
	var bad_null := SaveSystem.default_data()
	(bad_null["progress"] as Dictionary)["selected_color"] = null
	ctx.check(SaveSystem.save_game(bad_null), "save_game writes null selected_color probe")
	var probe_null = script.new()
	probe_null.reload_from_disk()
	ctx.check(int(probe_null.get("selected_color")) == 0, "null selected_color reloads as default 0")
	probe_null.free()
	var missing := SaveSystem.default_data()
	(missing["progress"] as Dictionary).erase("selected_color")
	ctx.check(SaveSystem.save_game(missing), "save_game writes missing selected_color probe")
	var probe_missing = script.new()
	probe_missing.reload_from_disk()
	ctx.check(int(probe_missing.get("selected_color")) == 0, "missing selected_color reloads as default 0")
	probe_missing.free()
	var bad_dict := SaveSystem.default_data()
	(bad_dict["progress"] as Dictionary)["selected_color"] = {}
	ctx.check(SaveSystem.save_game(bad_dict), "save_game writes Dictionary selected_color probe")
	var probe_dict = script.new()
	probe_dict.reload_from_disk()
	ctx.check(int(probe_dict.get("selected_color")) == 0, "Dictionary selected_color reloads as default 0")
	probe_dict.free()
	var good_int := SaveSystem.default_data()
	(good_int["progress"] as Dictionary)["selected_color"] = 2
	ctx.check(SaveSystem.save_game(good_int), "save_game writes int selected_color probe")
	var probe_int = script.new()
	probe_int.reload_from_disk()
	ctx.check(int(probe_int.get("selected_color")) == 2, "int selected_color reloads as 2")
	probe_int.free()
	var good_float := SaveSystem.default_data()
	(good_float["progress"] as Dictionary)["selected_color"] = 2.0
	ctx.check(SaveSystem.save_game(good_float), "save_game writes float selected_color probe")
	var probe_float = script.new()
	probe_float.reload_from_disk()
	ctx.check(int(probe_float.get("selected_color")) == 2, "float selected_color reloads as 2")
	probe_float.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "non-numeric color probe restores defaults")
	return true

func test_gamestate_selected_car_default() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads")
	if script == null:
		return true
	ctx.check(script.get("DEFAULT_CAR") == &"sedan", "DEFAULT_CAR is sedan")
	var node: Node = script.new()
	ctx.check(node != null, "GameState instantiates standalone")
	if node == null:
		return true
	ctx.check("selected_car" in node, "GameState exposes selected_car")
	ctx.check(StringName(node.get("selected_car")) == &"", "selected_car starts empty")
	node.set("selected_car", node.get("DEFAULT_CAR"))
	ctx.check(StringName(node.get("selected_car")) == &"sedan", "default fills selected_car with sedan")
	node.free()
	var car_packed = load("res://scenes/vehicles/car_sedan.tscn")
	ctx.check(car_packed is PackedScene, "default car scene car_sedan.tscn loads")
	return true

func test_gamestate_select_mode_validates() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the mode validation probe")
	if script == null:
		return true
	ctx.check(script.get("MODE_RACE") == &"race", "MODE_RACE is race")
	ctx.check(script.get("MODE_TIME_TRIAL") == &"time_trial", "MODE_TIME_TRIAL is time_trial")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "mode probe starts from defaults")
	var node = script.new()
	ctx.check(node != null, "GameState instantiates standalone for the mode probe")
	if node == null:
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	ctx.check(StringName(node.get("current_mode")) == &"race", "fresh instance defaults to race")
	ctx.check(node.is_time_trial_mode() == false, "race default is not time-trial mode")
	ctx.check(node.is_valid_mode(&"race"), "race passes is_valid_mode")
	ctx.check(node.is_valid_mode(&"time_trial"), "time_trial passes is_valid_mode")
	ctx.check(not node.is_valid_mode(&"bogus"), "bogus fails is_valid_mode")
	ctx.check(not node.is_valid_mode(&""), "empty fails is_valid_mode")
	ctx.check(not node.is_valid_mode(&"RACE"), "wrong case fails is_valid_mode")
	node.select_mode("time_trial")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "valid time_trial selection sticks")
	ctx.check(node.is_time_trial_mode(), "time_trial selection reads as time-trial mode")
	node.select_mode("bogus")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "bogus selection keeps the last valid mode")
	ctx.check(node.is_time_trial_mode(), "bogus selection still reads as time-trial mode")
	node.select_mode("")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "empty selection keeps the last valid mode")
	node.select_mode("RACE")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "wrong-case selection keeps the last valid mode")
	node.select_mode(" time_trial")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "whitespace selection keeps the last valid mode")
	node.select_mode("race")
	ctx.check(StringName(node.get("current_mode")) == &"race", "valid race selection sticks back")
	ctx.check(node.is_time_trial_mode() == false, "race selection is not time-trial mode")
	node.select_mode("bogus")
	ctx.check(StringName(node.get("current_mode")) == &"race", "bogus from race keeps race")
	node.select_mode("time_trial")
	node.flush()
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	ctx.check(not progress.has("current_mode"), "flush writes no current_mode progress key")
	ctx.check(not data.has("current_mode"), "flush writes no top-level current_mode key")
	ctx.check(SaveSystem.validate(data), "doc without a mode key still validates")
	node.reload_from_disk()
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "reload preserves the in-memory mode")
	var fresh = script.new()
	ctx.check(fresh != null, "fresh instance instantiates after a mode run")
	if fresh != null:
		ctx.check(StringName(fresh.get("current_mode")) == &"race", "fresh instance defaults to race after a mode run")
		fresh.free()
	node.flush()
	node.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "mode probe restores defaults")
	return true


func test_gamestate_direct_mode_assignment_guarded() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the direct mode guard probe")
	if script == null:
		return true
	ctx.check(script.get("MODE_RACE") == &"race", "MODE_RACE is race")
	ctx.check(script.get("MODE_TIME_TRIAL") == &"time_trial", "MODE_TIME_TRIAL is time_trial")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "mode guard probe starts from defaults")
	var node = script.new()
	ctx.check(node != null, "GameState instantiates standalone for the mode guard probe")
	if node == null:
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	ctx.check(StringName(node.get("current_mode")) == &"race", "fresh instance defaults to race")
	ctx.check(node.is_time_trial_mode() == false, "race default is not time-trial mode")
	ctx.check(node.is_valid_mode(&"race"), "race passes is_valid_mode")
	ctx.check(node.is_valid_mode(&"time_trial"), "time_trial passes is_valid_mode")
	ctx.check(not node.is_valid_mode(&"bogus"), "bogus fails is_valid_mode")
	ctx.check(not node.is_valid_mode(&""), "empty fails is_valid_mode")
	ctx.check(not node.is_valid_mode(&"RACE"), "wrong case fails is_valid_mode")
	ctx.check(not node.is_valid_mode(&" time_trial"), "whitespace fails is_valid_mode")
	node.select_mode("time_trial")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "valid time_trial selection sticks")
	ctx.check(node.is_time_trial_mode(), "time_trial selection reads as time-trial mode")
	node.select_mode("bogus")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "bogus selection keeps the last valid mode")
	node.select_mode("")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "empty selection keeps the last valid mode")
	node.select_mode("RACE")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "wrong-case selection keeps the last valid mode")
	node.select_mode(" time_trial")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "whitespace selection keeps the last valid mode")
	node.current_mode = &"bogus"
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "direct bogus assignment keeps the last valid mode")
	node.set("current_mode", &"bogus")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "set() bogus keeps the last valid mode")
	node.current_mode = &""
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "direct empty keeps the last valid mode")
	node.current_mode = &"RACE"
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "direct wrong-case keeps the last valid mode")
	node.current_mode = &" time_trial"
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "direct whitespace keeps the last valid mode")
	node.set("current_mode", 42)
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "int set() keeps the last valid mode")
	node.current_mode = 42
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "int direct assignment keeps the last valid mode")
	node.current_mode = &"race"
	ctx.check(StringName(node.get("current_mode")) == &"race", "valid direct race sticks")
	ctx.check(node.is_time_trial_mode() == false, "direct race is not time-trial mode")
	node.set("current_mode", &"time_trial")
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "valid set() time_trial sticks")
	ctx.check(node.is_time_trial_mode(), "set() time_trial reads as time-trial mode")
	node.flush()
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	ctx.check(not progress.has("current_mode"), "flush writes no current_mode progress key")
	ctx.check(not data.has("current_mode"), "flush writes no top-level current_mode key")
	ctx.check(SaveSystem.validate(data), "doc without a mode key still validates")
	node.reload_from_disk()
	ctx.check(StringName(node.get("current_mode")) == &"time_trial", "reload preserves the in-memory mode")
	var fresh = script.new()
	ctx.check(fresh != null, "fresh instance instantiates after a guarded run")
	if fresh != null:
		ctx.check(StringName(fresh.get("current_mode")) == &"race", "fresh instance defaults to race after a guarded run")
		fresh.free()
	node.flush()
	node.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "mode guard probe restores defaults")
	return true


func settings_persist_across_load() -> bool:
	var script = load("res://scripts/game/settings.gd")
	ctx.check(script != null, "settings.gd loads for the persistence probe")
	if script == null:
		return true
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "settings probe starts from defaults")
	var first = script.new()
	ctx.check(first != null, "first Settings instantiates standalone")
	if first == null:
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	first.set("master_volume", 0.3)
	first.set("music_volume", 0.4)
	first.set("sfx_volume", 0.5)
	first.set("assists", false)
	first.set("camera_shake", false)
	first.flush()
	var second = script.new()
	ctx.check(second != null, "second Settings instantiates standalone")
	if second == null:
		first.free()
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	second.reload_from_disk()
	ctx.check(absf(float(second.get("master_volume")) - 0.3) < 0.001, "fresh instance observes saved master_volume")
	ctx.check(absf(float(second.get("music_volume")) - 0.4) < 0.001, "fresh instance observes saved music_volume")
	ctx.check(absf(float(second.get("sfx_volume")) - 0.5) < 0.001, "fresh instance observes saved sfx_volume")
	ctx.check(bool(second.get("assists")) == false, "fresh instance observes saved assists")
	ctx.check(bool(second.get("camera_shake")) == false, "fresh instance observes saved camera_shake")
	first.free()
	second.free()
	var bad := SaveSystem.default_data()
	(bad["settings"] as Dictionary)["master_volume"] = "loud"
	(bad["settings"] as Dictionary)["music_volume"] = 2.0
	(bad["settings"] as Dictionary)["sfx_volume"] = -1.0
	(bad["settings"] as Dictionary)["assists"] = 1
	(bad["settings"] as Dictionary)["camera_shake"] = "yes"
	ctx.check(SaveSystem.save_game(bad), "save_game writes corrupt settings probe")
	var probe = script.new()
	probe.reload_from_disk()
	ctx.check(absf(float(probe.get("master_volume")) - 0.8) < 0.001, "String master_volume reloads to the safe default")
	ctx.check(absf(float(probe.get("music_volume")) - 0.7) < 0.001, "out-of-range music_volume reloads to the safe default")
	ctx.check(absf(float(probe.get("sfx_volume")) - 0.9) < 0.001, "out-of-range sfx_volume reloads to the safe default")
	ctx.check(bool(probe.get("assists")) == true, "non-bool assists reloads to the safe default")
	ctx.check(bool(probe.get("camera_shake")) == true, "non-bool camera_shake reloads to the safe default")
	probe.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "settings probe restores defaults")
	return true
