extends SceneTree
## Headless test contract runner. Run with:
##   godot --headless --path . --script res://tests/run_all.gd
## Every test returns bool and ends `return true`; the dispatcher treats any
## non-true return as failure (a runtime abort hands back a default value),
## prints PASS/FAIL per test, prints ALL TESTS PASSED only when nothing
## failed, and quits non-zero so CI gates on the exit code.
## Never use bare assert() here: a failed assert aborts before quit() runs
## and hangs CI until its own timeout.
## Physics tests drive the real vehicle scene through real InputMap actions
## (Input.action_press("accelerate") etc.) and await physics frames; each
## test spawns its own car on a shared tarmac slab and tears it down with
## frame drains so no car or stuck input leaks into the next test.

var passed := 0
var failed := 0
var _current_ok := true
var _ground: StaticBody3D = null
var _car: VehicleController = null

func _initialize() -> void:
	await _run_all()

func _run_all() -> void:
	await process_frame
	_make_ground()
	var tests: Array[String] = [
		"test_project_name",
		"test_application_icon_configured",
		"test_physics_ticks",
		"test_renderer_method",
		"test_physics_engine_3d",
		"test_autoload_gamestate",
		"test_input_actions",
		"test_gamestate_standalone",
		"test_save_system_roundtrip",
		"test_gamestate_rejects_nonint_color",
		"test_save_system_partial_settings_merge",
		"test_save_system_rejects_nonstring_selection",
		"test_gamestate_persists_selection",
		"test_gamestate_selected_car_default",
		"test_main_menu_scene",
		"test_menu_buttons",
		"test_garage_writes_selected_car",
		"test_gamestate_typed_writers",
		"test_garage_writes_via_typed_api",
		"test_garage_scene_loads",
		"test_garage_car_grid",
		"test_garage_color_persists",
		"test_event_select_grid",
		"test_event_press_writes_current_event",
		"test_event_select_grid_skips_invalid",
		"test_vehicle_scene_loads",
		"test_accel_reaches_25ms_in_8s",
		"test_coast_upshifts_without_throttle",
		"test_drive_force_uses_current_tick_rpm",
		"test_redline_fuel_cut",
		"test_over_rev_cap",
		"test_limiter_order_repairs_inversion",
		"test_limiter_defaults_ordered",
		"test_brake_20ms_within_30m",
		"test_handbrake_reduces_rear_grip",
		"test_assists_reduce_slip_when_on",
		"test_suspension_settles_after_drop",
		"test_reset_after_flip",
		"test_reset_clears_overpass",
		"test_reverse_latch_needs_standstill_in_first",
		"test_reverse_latch_fields_and_throttle_unlatch",
		"test_reverse_rpm_signed",
		"test_reverse_rpm_idle_positive",
		"test_field_driven_ignores_reset_key",
		"test_steer_turns_at_speed",
		"test_test_ground_loads",
		"test_district_loads",
		"test_player_input_bridge",
		"test_export_presets_present",
		"test_export_presets_targets",
		"test_tune_values_in_range",
		"test_cornering_g_envelope_0_8_to_1_4g",
		"test_light_budget_max_8_omnis_per_mesh",
		"test_central_roads_not_coplanar",
		"test_city_kit_glb_present",
		"test_city_kit_credits",
		"test_district_night_uses_kit",
		"traffic_yields_when_blocked",
		"traffic_loops_without_error",
		"ai_completes_loop_without_offroad",
		"rubber_band_within_bounds",
		"race_four_ai_finish",
		"test_checkpoints_validate_in_order",
		"test_wrong_way_detected",
		"tunes_in_range",
		"four_tunes_distinct",
		"countdown_sequence_3s",
		"lap_counting_increments",
		"positions_sort_by_progress",
		"results_hold_all_finishers",
		"test_car_kit_glb_present",
		"test_car_kit_credits",
		"test_car_scenes_load",
		"hud_subscribes_to_race_signals",
	]
	for t: String in tests:
		await _run_test(t)
	_release_inputs()
	if is_instance_valid(_ground):
		_ground.queue_free()
		_ground = null
	print("Results: %d passed, %d failed" % [passed, failed])
	if failed == 0:
		print("ALL TESTS PASSED")
	quit(1 if failed > 0 else 0)

func _run_test(test_name: String) -> void:
	_current_ok = true
	var result = await call(test_name)
	if _current_ok and result == true:
		passed += 1
		print("PASS %s" % test_name)
	else:
		failed += 1
		push_error("FAIL %s" % test_name)

func check(condition: bool, label: String) -> void:
	if not condition:
		_current_ok = false
		push_error("FAIL detail: %s" % label)

func _make_ground() -> void:
	_ground = StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1000, 1, 1000)
	shape.shape = box
	_ground.add_child(shape)
	_ground.position = Vector3(0, -0.5, 0)
	root.add_child(_ground)

func _release_inputs() -> void:
	for action in ["accelerate", "brake", "steer_left", "steer_right", "handbrake", "reset_car"]:
		Input.action_release(action)

func _spawn_car(pos: Vector3, car_basis: Basis = Basis()) -> VehicleController:
	_release_inputs()
	if is_instance_valid(_car):
		_car.queue_free()
		_car = null
		await process_frame
		await physics_frame
	var packed := load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	_car = packed.instantiate() as VehicleController
	root.add_child(_car)
	_car.global_transform = Transform3D(car_basis, pos)
	return _car

func _despawn_car() -> void:
	_release_inputs()
	if is_instance_valid(_car):
		_car.queue_free()
		_car = null
		await process_frame
		await physics_frame

func _yaw_of(car: VehicleController) -> float:
	var fwd := -car.global_transform.basis.z
	return atan2(-fwd.x, -fwd.z)

func test_project_name() -> bool:
	check(ProjectSettings.get_setting("application/config/name") == "Night Street Racer", "project name is Night Street Racer")
	return true

func test_application_icon_configured() -> bool:
	var path := str(ProjectSettings.get_setting("application/config/icon"))
	check(path != "", "application icon setting is configured")
	check(path.ends_with(".svg"), "application icon is an SVG (got %s)" % path)
	check(ResourceLoader.exists(path), "application icon resource exists: %s" % path)
	var icon := load(path) as Texture2D
	check(icon != null, "application icon loads as Texture2D")
	if icon != null:
		check(icon.get_width() > 0, "application icon width > 0 (got %d)" % icon.get_width())
		check(icon.get_height() > 0, "application icon height > 0 (got %d)" % icon.get_height())
	return true

func test_physics_ticks() -> bool:
	check(ProjectSettings.get_setting("physics/common/physics_ticks_per_second") == 60, "physics ticks are 60")
	return true

func test_renderer_method() -> bool:
	check(ProjectSettings.get_setting("rendering/renderer/rendering_method") == "forward_plus", "renderer is forward_plus")
	return true

func test_physics_engine_3d() -> bool:
	check(ProjectSettings.get_setting("physics/3d/physics_engine") == "Jolt Physics", "3D engine is Jolt Physics")
	return true

func test_autoload_gamestate() -> bool:
	check(ProjectSettings.has_setting("autoload/GameState"), "autoload/GameState is registered")
	check(str(ProjectSettings.get_setting("autoload/GameState")).begins_with("*"), "GameState autoload is enabled")
	return true

func test_input_actions() -> bool:
	var actions: Array[String] = ["accelerate", "brake", "steer_left", "steer_right", "handbrake", "look_back", "reset_car", "pause"]
	for action: String in actions:
		check(InputMap.has_action(action), "input action exists: %s" % action)
		check(absf(InputMap.action_get_deadzone(action) - 0.2) < 0.001, "deadzone 0.2: %s" % action)
	check(InputMap.action_get_events("accelerate").size() >= 3, "accelerate has key + pad events")
	return true

func test_gamestate_standalone() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	check(script != null, "GameState.gd loads")
	if script != null:
		var node: Node = script.new()
		check(node != null, "GameState instantiates standalone")
		check(node is Node, "GameState is a Node")
		if node != null:
			node.free()
	return true

func test_save_system_roundtrip() -> bool:
	check(SaveSystem.SAVE_PATH == "user://save.json", "save path is user://save.json")
	check(SaveSystem.SAVE_VERSION == 1, "save schema version is 1")
	var blank := SaveSystem.default_data()
	check(SaveSystem.validate(blank), "default_data passes SaveSystem.validate()")
	check(int((blank["progress"] as Dictionary).get("selected_color")) == 0, "default selected_color is int 0")
	var float_color := SaveSystem.default_data()
	(float_color["progress"] as Dictionary)["selected_color"] = 2.0
	check(SaveSystem.validate(float_color), "float selected_color validates as JSON round-trip equivalent")
	var bad_color := SaveSystem.default_data()
	(bad_color["progress"] as Dictionary)["selected_color"] = "red"
	check(not SaveSystem.validate(bad_color), "String selected_color fails SaveSystem.validate()")
	var missing_color := SaveSystem.default_data()
	(missing_color["progress"] as Dictionary).erase("selected_color")
	check(not SaveSystem.validate(missing_color), "missing selected_color fails SaveSystem.validate()")
	var default_settings := SaveSystem.default_data()
	check(SaveSystem.validate(default_settings), "default settings validate")
	var bad_volume := SaveSystem.default_data()
	(bad_volume["settings"] as Dictionary)["master_volume"] = "loud"
	check(not SaveSystem.validate(bad_volume), "String master_volume fails SaveSystem.validate()")
	var missing_volume := SaveSystem.default_data()
	(missing_volume["settings"] as Dictionary).erase("sfx_volume")
	check(not SaveSystem.validate(missing_volume), "missing sfx_volume fails SaveSystem.validate()")
	var loud_volume := SaveSystem.default_data()
	(loud_volume["settings"] as Dictionary)["master_volume"] = 2.0
	check(not SaveSystem.validate(loud_volume), "out-of-range master_volume fails SaveSystem.validate()")
	var int_volume := SaveSystem.default_data()
	(int_volume["settings"] as Dictionary)["master_volume"] = 1
	check(SaveSystem.validate(int_volume), "int master_volume validates as JSON round-trip equivalent")
	var bad_assists := SaveSystem.default_data()
	(bad_assists["settings"] as Dictionary)["assists"] = 1
	check(not SaveSystem.validate(bad_assists), "non-bool assists fails SaveSystem.validate()")
	var default_records := SaveSystem.default_data()
	check(SaveSystem.validate(default_records), "default empty records validate")
	var good_records := SaveSystem.default_data()
	(good_records["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1}
	check(SaveSystem.validate(good_records), "well-formed records entry validates")
	var float_position := SaveSystem.default_data()
	(float_position["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1.0}
	check(SaveSystem.validate(float_position), "whole-float best_position validates as JSON round-trip equivalent")
	var frac_position := SaveSystem.default_data()
	(frac_position["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1.5}
	check(not SaveSystem.validate(frac_position), "fractional best_position fails SaveSystem.validate()")
	var string_entry := SaveSystem.default_data()
	(string_entry["records"] as Dictionary)["harbor_sprint"] = "fast"
	check(not SaveSystem.validate(string_entry), "String records entry fails SaveSystem.validate()")
	var bad_time := SaveSystem.default_data()
	(bad_time["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": "fast", "best_position": 1}
	check(not SaveSystem.validate(bad_time), "String best_time_s fails SaveSystem.validate()")
	var empty_entry := SaveSystem.default_data()
	(empty_entry["records"] as Dictionary)["harbor_sprint"] = {}
	check(not SaveSystem.validate(empty_entry), "empty records entry fails SaveSystem.validate()")
	var color_trip := SaveSystem.default_data()
	(color_trip["progress"] as Dictionary)["selected_color"] = 2
	check(SaveSystem.save_game(color_trip), "save_game writes a non-default int selected_color")
	var color_loaded := SaveSystem.load_game()
	check(SaveSystem.validate(color_loaded), "non-default int selected_color loads back valid")
	check(int((color_loaded["progress"] as Dictionary).get("selected_color")) == 2, "roundtrip keeps selected_color")
	var records_trip := SaveSystem.default_data()
	(records_trip["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 93.24, "best_position": 1}
	check(SaveSystem.save_game(records_trip), "save_game writes well-formed records")
	var records_loaded := SaveSystem.load_game()
	check(SaveSystem.validate(records_loaded), "well-formed records load back valid")
	var loaded_entry: Dictionary = (records_loaded["records"] as Dictionary).get("harbor_sprint", {})
	check(float(loaded_entry.get("best_time_s", 0.0)) == 93.24, "roundtrip keeps best_time_s")
	check(int(loaded_entry.get("best_position", 0)) == 1, "roundtrip keeps best_position")
	var data := SaveSystem.default_data()
	var progress: Dictionary = data["progress"]
	progress["selected_car"] = "hatch"
	progress["current_event"] = "neon_loop"
	check(SaveSystem.save_game(data), "save_game writes a non-default dict")
	var loaded := SaveSystem.load_game()
	check(SaveSystem.validate(loaded), "written save loads back valid")
	var loaded_progress: Dictionary = loaded["progress"]
	check(str(loaded_progress.get("selected_car")) == "hatch", "roundtrip keeps selected_car")
	check(str(loaded_progress.get("current_event")) == "neon_loop", "roundtrip keeps current_event")
	check(int(loaded.get("version")) == SaveSystem.SAVE_VERSION, "roundtrip keeps version")
	var future := SaveSystem.default_data()
	future["version"] = SaveSystem.SAVE_VERSION + 1
	(future["progress"] as Dictionary)["selected_car"] = "coupe"
	(future["progress"] as Dictionary)["current_event"] = "neon_loop"
	check(SaveSystem.save_game(future), "save_game writes a future-version doc")
	var future_loaded := SaveSystem.load_game()
	check(int(future_loaded.get("version")) == SaveSystem.SAVE_VERSION + 1, "future version survives load")
	check(not SaveSystem.validate(future_loaded), "future version fails SaveSystem.validate()")
	check(str((future_loaded["progress"] as Dictionary).get("selected_car")) == "coupe", "future version keeps selected_car")
	check(str((future_loaded["progress"] as Dictionary).get("current_event")) == "neon_loop", "future version keeps current_event")
	check(SaveSystem.save_game(SaveSystem.default_data()), "future-version probe restores defaults")
	var corrupt := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	check(corrupt != null, "save path opens for the corruption probe")
	if corrupt != null:
		corrupt.store_string("{not valid json!!!")
		corrupt.close()
	var fallback := SaveSystem.load_game()
	check(SaveSystem.validate(fallback), "corrupt file falls back to valid defaults")
	var fallback_progress: Dictionary = fallback["progress"]
	check(str(fallback_progress.get("selected_car")) == "", "corrupt fallback resets selected_car")
	check(str(fallback_progress.get("current_event")) == "", "corrupt fallback resets current_event")
	check(SaveSystem.save_game(SaveSystem.default_data()), "save restores defaults after the probe")
	return true

func test_gamestate_rejects_nonint_color() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	check(script != null, "GameState.gd loads for the color coercion probe")
	if script == null:
		return true
	var bad_bool := SaveSystem.default_data()
	(bad_bool["progress"] as Dictionary)["selected_color"] = true
	check(SaveSystem.save_game(bad_bool), "save_game writes bool selected_color probe")
	var probe_bool = script.new()
	probe_bool.reload_from_disk()
	check(int(probe_bool.get("selected_color")) == 0, "bool selected_color reloads to the safe default")
	probe_bool.free()
	var bad_string := SaveSystem.default_data()
	(bad_string["progress"] as Dictionary)["selected_color"] = "2"
	check(SaveSystem.save_game(bad_string), "save_game writes String selected_color probe")
	var probe_string = script.new()
	probe_string.reload_from_disk()
	check(int(probe_string.get("selected_color")) == 0, "String selected_color reloads to the safe default")
	probe_string.free()
	var good_float := SaveSystem.default_data()
	(good_float["progress"] as Dictionary)["selected_color"] = 2.0
	check(SaveSystem.save_game(good_float), "save_game writes float selected_color probe")
	var probe_float = script.new()
	probe_float.reload_from_disk()
	check(int(probe_float.get("selected_color")) == 2, "float selected_color still loads")
	probe_float.free()
	var good_int := SaveSystem.default_data()
	(good_int["progress"] as Dictionary)["selected_color"] = 2
	check(SaveSystem.save_game(good_int), "save_game writes int selected_color probe")
	var probe_int = script.new()
	probe_int.reload_from_disk()
	check(int(probe_int.get("selected_color")) == 2, "int selected_color still loads")
	probe_int.free()
	check(SaveSystem.save_game(SaveSystem.default_data()), "color coercion probe restores defaults")
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
	check(probe != null, "save path opens for the partial settings probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	check(SaveSystem.validate(loaded), "partial settings load back valid")
	var loaded_settings: Dictionary = loaded["settings"]
	check(absf(float(loaded_settings.get("master_volume", -1.0)) - 0.3) < 0.001, "partial merge keeps the saved master_volume")
	for key: String in ["music_volume", "sfx_volume", "assists", "camera_shake"]:
		check(loaded_settings.get(key) == default_settings.get(key), "partial merge fills default %s" % key)
	check(SaveSystem.save_game(SaveSystem.default_data()), "partial settings probe restores defaults")
	return true

func test_save_system_rejects_nonstring_selection() -> bool:
	var bad := SaveSystem.default_data()
	(bad["progress"] as Dictionary)["selected_car"] = 42
	(bad["progress"] as Dictionary)["current_event"] = true
	check(SaveSystem.save_game(bad), "save_game writes wrong-typed selection probe")
	var loaded := SaveSystem.load_game()
	var loaded_progress: Dictionary = loaded["progress"]
	var loaded_car: Variant = loaded_progress.get("selected_car")
	var loaded_event: Variant = loaded_progress.get("current_event")
	check(not (loaded_car is String), "wrong-typed selected_car loads uncoerced")
	check(typeof(loaded_car) != TYPE_STRING, "wrong-typed selected_car keeps its disk type")
	check(not (loaded_event is String), "wrong-typed current_event loads uncoerced")
	check(not SaveSystem.validate(loaded), "wrong-typed selection fails SaveSystem.validate()")
	var bad_dict := SaveSystem.default_data()
	(bad_dict["progress"] as Dictionary)["selected_car"] = "hatch"
	(bad_dict["progress"] as Dictionary)["current_event"] = {"route": "neon_loop"}
	check(SaveSystem.save_game(bad_dict), "save_game writes dict current_event probe")
	var loaded_dict := SaveSystem.load_game()
	var loaded_dict_event: Variant = (loaded_dict["progress"] as Dictionary).get("current_event")
	check(not (loaded_dict_event is String), "dict current_event loads uncoerced")
	check(not SaveSystem.validate(loaded_dict), "dict current_event fails SaveSystem.validate()")
	var script = load("res://scripts/game/GameState.gd")
	check(script != null, "GameState.gd loads for the coercion probe")
	if script != null:
		var node = script.new()
		check(node != null, "GameState instantiates standalone for the coercion probe")
		if node != null:
			node.reload_from_disk()
			check(StringName(node.get("selected_car")) == &"hatch", "valid selected_car still loads via reload_from_disk")
			check(StringName(node.get("current_event")) == &"", "dict current_event reloads to the safe default")
			node.free()
	check(SaveSystem.save_game(bad), "save_game rewrites the int/bool probe")
	if script != null:
		var probe = script.new()
		if probe != null:
			probe.reload_from_disk()
			check(StringName(probe.get("selected_car")) == &"", "int selected_car reloads to the safe default, not &\"42\"")
			check(StringName(probe.get("current_event")) == &"", "bool current_event reloads to the safe default")
			probe.free()
	var good := SaveSystem.default_data()
	(good["progress"] as Dictionary)["selected_car"] = "hatch"
	(good["progress"] as Dictionary)["current_event"] = "neon_loop"
	check(SaveSystem.save_game(good), "save_game writes valid String selection")
	var good_loaded := SaveSystem.load_game()
	check(SaveSystem.validate(good_loaded), "valid String selection still validates")
	check(str((good_loaded["progress"] as Dictionary).get("selected_car")) == "hatch", "valid selected_car round-trips byte-identical")
	check(str((good_loaded["progress"] as Dictionary).get("current_event")) == "neon_loop", "valid current_event round-trips byte-identical")
	check(SaveSystem.save_game(SaveSystem.default_data()), "coercion probe restores defaults")
	return true

func test_gamestate_persists_selection() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	check(script != null, "GameState.gd loads for the persistence probe")
	if script == null:
		return true
	check(SaveSystem.save_game(SaveSystem.default_data()), "persistence probe starts from defaults")
	var first = script.new()
	check(first != null, "first GameState instantiates standalone")
	if first == null:
		return true
	first.select_car("hatch")
	first.select_event("neon_loop")
	var second = script.new()
	check(second != null, "second GameState instantiates standalone")
	if second == null:
		first.free()
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	second.reload_from_disk()
	check(StringName(second.get("selected_car")) == &"hatch", "fresh instance observes saved selected_car")
	check(StringName(second.get("current_event")) == &"neon_loop", "fresh instance observes saved current_event")
	first.free()
	second.free()
	check(SaveSystem.save_game(SaveSystem.default_data()), "persistence probe restores defaults")
	return true

func test_gamestate_selected_car_default() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	check(script != null, "GameState.gd loads")
	if script == null:
		return true
	check(script.get("DEFAULT_CAR") == &"sedan", "DEFAULT_CAR is sedan")
	var node: Node = script.new()
	check(node != null, "GameState instantiates standalone")
	if node == null:
		return true
	check("selected_car" in node, "GameState exposes selected_car")
	check(StringName(node.get("selected_car")) == &"", "selected_car starts empty")
	node.set("selected_car", node.get("DEFAULT_CAR"))
	check(StringName(node.get("selected_car")) == &"sedan", "default fills selected_car with sedan")
	node.free()
	var car_packed = load("res://scenes/vehicles/car_sedan.tscn")
	check(car_packed is PackedScene, "default car scene car_sedan.tscn loads")
	return true

func test_garage_writes_selected_car() -> bool:
	var gs: Node = root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		check(gs_script != null, "GameState.gd loads for garage wiring")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		root.add_child(gs)
		mounted = true
	check(gs != null, "GameState singleton is reachable")
	if gs == null:
		return true
	var prev_car := StringName(gs.get("selected_car"))
	gs.set("selected_car", &"")
	var packed = load("res://scenes/ui/main_menu.tscn")
	check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		gs.set("selected_car", prev_car)
		if mounted:
			root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	root.add_child(instance)
	await process_frame
	await process_frame
	var garage := instance.find_child("GarageButton", true, false) as BaseButton
	check(garage != null, "main menu has GarageButton")
	if garage != null:
		garage.pressed.emit()
		await process_frame
		await process_frame
		check(StringName(gs.get("selected_car")) == &"sedan", "fresh Garage press fills selected_car with sedan")
		var live := current_scene
		check(live != null and live != instance, "Garage press leaves MainMenu")
		check(live != null and (live.name == "Garage" or live.find_child("CarGrid", true, false) != null), "Garage press navigates to the garage scene")
		if live != null and live != instance:
			var sedan_btn := live.find_child("Car_sedan", true, false) as BaseButton
			check(sedan_btn != null, "garage has Car_sedan")
			if sedan_btn != null:
				gs.select_car("hatch")
				sedan_btn.pressed.emit()
				await process_frame
				await process_frame
				check(StringName(gs.get("selected_car")) == &"sedan", "pressing Car_sedan writes selected_car")
			var back := live.find_child("BackButton", true, false) as BaseButton
			check(back != null, "garage has a BackButton")
			if back != null:
				back.pressed.emit()
				await process_frame
				await process_frame
				var home := current_scene
				check(home != null and (home.name == "MainMenu" or home.find_child("RaceButton", true, false) != null), "garage BackButton returns to MainMenu")
		gs.select_car("hatch")
		garage.pressed.emit()
		await process_frame
		await process_frame
		check(StringName(gs.get("selected_car")) == &"hatch", "Garage never clobbers a pre-set car")
		var again := current_scene
		check(again != null and (again.name == "Garage" or again.find_child("CarGrid", true, false) != null), "repeat Garage press still navigates to the garage")
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	check(src.contains("selected_car"), "menu.gd wires selected_car")
	check(src.contains("CAR_SELECTED"), "menu.gd prints the CAR_SELECTED token")
	var swapped := current_scene
	if swapped != null and swapped != instance and is_instance_valid(swapped):
		if swapped.get_parent() == root:
			root.remove_child(swapped)
		swapped.free()
		await process_frame
	root.remove_child(instance)
	instance.free()
	await process_frame
	gs.set("selected_car", prev_car)
	if mounted:
		root.remove_child(gs)
		gs.free()
		await process_frame
	return true

func test_gamestate_typed_writers() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	check(script != null, "GameState.gd loads for typed writers")
	if script == null:
		return true
	check(StringName(script.get("DEFAULT_CAR")) == &"sedan", "DEFAULT_CAR is sedan")
	check(SaveSystem.save_game(SaveSystem.default_data()), "typed-writer probe starts from defaults")
	var node = script.new()
	check(node != null, "GameState instantiates standalone for typed writers")
	if node == null:
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	check(node.has_method("select_car"), "GameState exposes select_car")
	check(node.has_method("select_event"), "GameState exposes select_event")
	node.select_car("hatch")
	check(StringName(node.get("selected_car")) == &"hatch", "select_car writes selected_car")
	node.select_event("neon_loop")
	check(StringName(node.get("current_event")) == &"neon_loop", "select_event writes current_event")
	node.free()
	check(SaveSystem.save_game(SaveSystem.default_data()), "typed-writer probe restores defaults")
	var car_packed = load("res://scenes/vehicles/car_sedan.tscn")
	check(car_packed is PackedScene, "default car scene car_sedan.tscn loads")
	return true

func test_garage_writes_via_typed_api() -> bool:
	var gs: Node = root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		check(gs_script != null, "GameState.gd loads for typed garage wiring")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		root.add_child(gs)
		mounted = true
	check(gs != null, "GameState singleton is reachable for typed garage probe")
	if gs == null:
		return true
	var prev_car := StringName(gs.get("selected_car"))
	gs.set("selected_car", &"")
	var packed = load("res://scenes/ui/main_menu.tscn")
	check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		gs.set("selected_car", prev_car)
		if mounted:
			root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	root.add_child(instance)
	await process_frame
	await process_frame
	var garage := instance.find_child("GarageButton", true, false) as BaseButton
	check(garage != null, "main menu has GarageButton")
	if garage != null:
		garage.pressed.emit()
		await process_frame
		await process_frame
		check(StringName(gs.get("selected_car")) == &"sedan", "fresh Garage press fills selected_car with sedan")
		var live := current_scene
		check(live != null and live != instance, "Garage press leaves MainMenu")
		check(live != null and (live.name == "Garage" or live.find_child("CarGrid", true, false) != null), "Garage press navigates to the garage scene")
		gs.set("selected_car", &"hatch")
		garage.pressed.emit()
		await process_frame
		await process_frame
		check(StringName(gs.get("selected_car")) == &"hatch", "Garage never clobbers a pre-set car")
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	check(src.contains("select_car"), "menu.gd routes the garage writer through select_car")
	check(src.contains("select_event"), "menu.gd routes the event writer through select_event")
	check(src.contains("CAR_SELECTED"), "menu.gd prints the CAR_SELECTED token")
	check(not src.contains("gs.set(\"selected_car\""), "menu.gd has no untyped selected_car writer")
	check(not src.contains("gs.set(\"current_event\""), "menu.gd has no untyped current_event writer")
	var navigated := current_scene
	if navigated != null and navigated != instance and is_instance_valid(navigated):
		if navigated.get_parent() == root:
			root.remove_child(navigated)
		navigated.free()
		await process_frame
	root.remove_child(instance)
	instance.free()
	await process_frame
	gs.set("selected_car", prev_car)
	if mounted:
		root.remove_child(gs)
		gs.free()
		await process_frame
	return true

func test_garage_scene_loads() -> bool:
	var packed = load("res://scenes/ui/garage.tscn")
	check(packed is PackedScene, "garage.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "garage instantiates")
	if instance == null:
		return true
	check(instance.name == "Garage", "root node is Garage")
	var preview := instance.find_child("CarPreview", true, false)
	check(preview is SubViewport, "CarPreview is a SubViewport")
	var swatches := instance.find_child("ColorSwatches", true, false)
	check(swatches != null, "garage has ColorSwatches")
	if swatches != null:
		var buttons := 0
		for child in swatches.get_children():
			if child is BaseButton:
				buttons += 1
		check(buttons >= 4, "ColorSwatches holds >= 4 Buttons (got %d)" % buttons)
		for i in 4:
			check(swatches.get_node_or_null("Color%d" % i) is BaseButton, "ColorSwatches has Color%d" % i)
	check(instance.find_child("CarGrid", true, false) is GridContainer, "garage has a CarGrid")
	check(instance.find_child("CarInfo", true, false) is Label, "garage has a CarInfo label")
	check(instance.find_child("BackButton", true, false) is BaseButton, "garage has a BackButton")
	var src := FileAccess.get_file_as_string("res://scripts/ui/garage.gd")
	check(src.contains("GARAGE_READY"), "garage script prints GARAGE_READY")
	check(src.contains("select_car"), "garage script routes car writes through select_car")
	check(src.contains("select_color"), "garage script routes color writes through select_color")
	check(src.contains("CAR_SELECTED"), "garage script prints the CAR_SELECTED token")
	check(src.contains("COLOR_SELECTED"), "garage script prints the COLOR_SELECTED token")
	check(not src.contains("gs.set(\"selected_car\""), "garage script has no untyped selected_car writer")
	check(not src.contains("gs.set(\"selected_color\""), "garage script has no untyped selected_color writer")
	for banned in ["_physics_process", "apply_force", "apply_central_force", "linear_velocity", "angular_velocity", "RayCast", "PhysicsDirectBodyState3D"]:
		check(not src.contains(banned), "garage script carries no %s" % banned)
	instance.free()
	return true

func test_garage_car_grid() -> bool:
	check(SaveSystem.save_game(SaveSystem.default_data()), "garage grid probe starts from defaults")
	var gs: Node = root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		check(gs_script != null, "GameState.gd loads for garage grid")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		root.add_child(gs)
		mounted = true
	check(gs != null, "GameState singleton is reachable for garage grid")
	if gs == null:
		return true
	check(GarageUI.is_car_unlocked("sedan"), "sedan is always unlocked")
	check(not GarageUI.is_car_unlocked("coupe"), "coupe is locked with an empty unlock list")
	check(not GarageUI.is_car_unlocked("hatch"), "hatch is locked with an empty unlock list")
	check(not GarageUI.is_car_unlocked("awd"), "awd is locked with an empty unlock list")
	var unlock_data := SaveSystem.load_game()
	var unlock_progress: Dictionary = unlock_data["progress"]
	unlock_progress["unlocked_cars"] = ["coupe"]
	unlock_data["progress"] = unlock_progress
	check(SaveSystem.save_game(unlock_data), "unlock probe grants coupe")
	check(GarageUI.is_car_unlocked("coupe"), "unlocked_cars opens coupe")
	check(not GarageUI.is_car_unlocked("hatch"), "hatch stays locked without a grant")
	check(SaveSystem.save_game(SaveSystem.default_data()), "unlock probe restores defaults")
	gs.set("selected_car", &"")
	gs.set("selected_color", 0)
	var packed = load("res://scenes/ui/garage.tscn")
	check(packed is PackedScene, "garage.tscn loads as PackedScene")
	if not (packed is PackedScene):
		if mounted:
			root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	root.add_child(instance)
	await process_frame
	await process_frame
	var grid := instance.find_child("CarGrid", true, false) as GridContainer
	check(grid != null, "garage has a CarGrid")
	if grid == null:
		root.remove_child(instance)
		instance.free()
		if mounted:
			root.remove_child(gs)
			gs.free()
		return true
	check(grid.get_child_count() == 4, "grid holds 4 car buttons (got %d)" % grid.get_child_count())
	var stems: Array[String] = ["sedan", "coupe", "hatch", "awd"]
	var names := {"sedan": "Sedan", "coupe": "Coupe", "hatch": "Hatch", "awd": "AWD"}
	for stem in stems:
		var btn := instance.find_child("Car_" + stem, true, false) as BaseButton
		check(btn != null, "grid has a button for %s" % stem)
		if btn == null:
			continue
		check((btn as Button).text.contains(str(names[stem])), "button text names %s" % stem)
	var sedan := instance.find_child("Car_sedan", true, false) as BaseButton
	check(sedan != null, "grid has Car_sedan")
	if sedan != null:
		check(sedan.disabled == false, "sedan stays enabled")
		check(sedan.focus_mode != Control.FOCUS_NONE, "sedan stays focusable")
	for stem in ["coupe", "hatch", "awd"]:
		var locked := instance.find_child("Car_" + stem, true, false) as BaseButton
		check(locked != null, "grid has Car_%s" % stem)
		if locked != null:
			check(locked.disabled, "%s is locked while not unlocked" % stem)
			check(locked.focus_mode == Control.FOCUS_NONE, "%s skips focus while locked" % stem)
	if sedan != null:
		sedan.pressed.emit()
		await process_frame
		await process_frame
		check(StringName(gs.get("selected_car")) == &"sedan", "pressing Car_sedan writes selected_car")
	var info := instance.find_child("CarInfo", true, false) as Label
	check(info != null and info.text.contains("Sedan"), "CarInfo names the picked car")
	if info != null:
		check(info.text.contains("Nm"), "CarInfo shows the live torque stat")
	root.remove_child(instance)
	instance.free()
	await process_frame
	check(SaveSystem.save_game(SaveSystem.default_data()), "garage grid probe restores defaults")
	if mounted:
		root.remove_child(gs)
		gs.free()
		await process_frame
	return true

func test_garage_color_persists() -> bool:
	check(SaveSystem.save_game(SaveSystem.default_data()), "color probe starts from defaults")
	var gs: Node = root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		check(gs_script != null, "GameState.gd loads for color probe")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		root.add_child(gs)
		mounted = true
	check(gs != null, "GameState singleton is reachable for color probe")
	if gs == null:
		return true
	check(gs.has_method("select_color"), "GameState exposes select_color")
	gs.set("selected_car", &"sedan")
	gs.set("selected_color", 0)
	var packed = load("res://scenes/ui/garage.tscn")
	check(packed is PackedScene, "garage.tscn loads as PackedScene")
	if not (packed is PackedScene):
		if mounted:
			root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	root.add_child(instance)
	await process_frame
	await process_frame
	var swatch := instance.find_child("Color2", true, false) as BaseButton
	check(swatch != null, "swatches have Color2")
	if swatch == null:
		root.remove_child(instance)
		instance.free()
		if mounted:
			root.remove_child(gs)
			gs.free()
		return true
	swatch.pressed.emit()
	await process_frame
	await process_frame
	check(int(gs.get("selected_color")) == 2, "swatch press writes selected_color")
	gs.reload_from_disk()
	check(int(gs.get("selected_color")) == 2, "selected_color survives reload_from_disk")
	var preview := instance.find_child("CarPreview", true, false) as SubViewport
	check(preview != null, "garage keeps its CarPreview")
	var painted := -1
	if preview != null:
		var pivot := preview.get_node_or_null("PreviewPivot") as Node3D
		check(pivot != null, "CarPreview hosts a PreviewPivot")
		if pivot != null:
			for child in pivot.get_children():
				var paint := (child as Node).get_node_or_null("CarPaint")
				if paint != null:
					painted = int(paint.get("color_index"))
	check(painted == 2, "preview CarPaint.color_index matches the swatch (got %d)" % painted)
	root.remove_child(instance)
	instance.free()
	await process_frame
	check(SaveSystem.save_game(SaveSystem.default_data()), "color probe restores defaults")
	if mounted:
		root.remove_child(gs)
		gs.free()
		await process_frame
	return true

func test_main_menu_scene() -> bool:
	var packed = load("res://scenes/ui/main_menu.tscn")
	check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if packed is PackedScene:
		var instance: Node = packed.instantiate()
		check(instance != null, "main_menu instantiates")
		if instance != null:
			check(instance.name == "MainMenu", "root node is MainMenu")
			instance.free()
	return true

func test_menu_buttons() -> bool:
	var packed = load("res://scenes/ui/main_menu.tscn")
	check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "main menu instantiates")
	if instance == null:
		return true
	check(instance.name == "MainMenu", "root node is MainMenu")
	root.add_child(instance)
	await process_frame
	await process_frame
	for bname in ["RaceButton", "GarageButton", "SettingsButton"]:
		var btn := instance.find_child(bname, true, false) as BaseButton
		check(btn != null, "main menu has %s" % bname)
		if btn != null:
			check(btn.focus_mode != Control.FOCUS_NONE, "%s is focus-enabled for keyboard/gamepad" % bname)
	var quit_btn := instance.find_child("QuitButton", true, false) as BaseButton
	check(quit_btn != null, "main menu has QuitButton")
	var focus_owner := instance.get_viewport().gui_get_focus_owner()
	check(focus_owner != null, "a menu button holds keyboard/gamepad focus")
	var race := instance.find_child("RaceButton", true, false) as BaseButton
	if race != null:
		race.pressed.emit()
		await process_frame
		await process_frame
		check(is_instance_valid(race), "pressing Race does not error")
		var swapped := current_scene
		if swapped != null and swapped != instance:
			root.remove_child(swapped)
			swapped.free()
		await process_frame
	var garage := instance.find_child("GarageButton", true, false) as BaseButton
	if garage != null:
		garage.pressed.emit()
		await process_frame
		await process_frame
		check(is_instance_valid(garage), "pressing Garage does not error")
		var garaged := current_scene
		check(garaged != null and garaged != instance, "Garage press leaves MainMenu")
		check(garaged != null and (garaged.name == "Garage" or garaged.find_child("CarGrid", true, false) != null), "Garage press navigates to the garage scene")
		if garaged != null and garaged != instance:
			root.remove_child(garaged)
			garaged.free()
		await process_frame
	root.remove_child(instance)
	instance.free()
	await process_frame
	return true

func test_event_select_grid() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	check(packed is PackedScene, "event_select.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "event select instantiates")
	if instance == null:
		return true
	check(instance.name == "EventSelect", "root node is EventSelect")
	root.add_child(instance)
	await process_frame
	await process_frame
	var grid := instance.find_child("EventGrid", true, false) as GridContainer
	check(grid != null, "event select has an EventGrid")
	if grid == null:
		root.remove_child(instance)
		instance.free()
		return true
	check(grid.get_child_count() >= 5, "grid holds >= 5 event buttons (got %d)" % grid.get_child_count())
	var enabled := 0
	for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		check(ev != null, "%s loads as RaceEvent" % stem)
		var btn := instance.find_child("Event_" + stem, true, false) as BaseButton
		check(btn != null, "grid has a button for %s" % stem)
		if btn == null:
			continue
		check((btn as Button).text.contains(stem), "button text names %s" % stem)
		var should_lock := ev == null or not MenuUI.is_unlocked(ev)
		check(btn.disabled == should_lock, "%s disabled matches lock state" % stem)
		if not btn.disabled:
			enabled += 1
			check(btn.focus_mode != Control.FOCUS_NONE, "%s stays focusable" % stem)
	check(enabled >= 1, "at least one event is unlocked (got %d)" % enabled)
	var back := instance.find_child("BackButton", true, false) as BaseButton
	check(back != null, "event select has a BackButton")
	root.remove_child(instance)
	instance.free()
	await process_frame
	return true

func test_event_press_writes_current_event() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	check(packed is PackedScene, "event_select.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "event select instantiates for press test")
	if instance == null:
		return true
	root.add_child(instance)
	await process_frame
	await process_frame
	var gs: Node = root.get_node_or_null("GameState")
	check(gs != null, "GameState singleton is reachable for event press")
	if gs == null:
		root.remove_child(instance)
		instance.free()
		return true
	var resolved := &""
	for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		if ev != null and MenuUI.is_unlocked(ev):
			resolved = StringName(stem)
			break
	check(resolved != &"", "at least one event is unlocked for press test")
	if resolved == &"":
		root.remove_child(instance)
		instance.free()
		return true
	var btn := instance.find_child("Event_" + String(resolved), true, false) as BaseButton
	check(btn != null, "grid has Event_%s button" % String(resolved))
	if btn == null:
		root.remove_child(instance)
		instance.free()
		return true
	check(btn.disabled == false, "%s button is unlocked for press test" % String(resolved))
	var prev := StringName(gs.get("current_event"))
	btn.pressed.emit()
	await process_frame
	await process_frame
	check(StringName(gs.get("current_event")) == resolved, "pressing %s writes current_event" % String(resolved))
	gs.set("current_event", prev)
	root.remove_child(instance)
	instance.free()
	await process_frame
	var detached := MenuUI.new()
	check(detached != null, "detached MenuUI instantiates")
	if detached != null:
		root.add_child(detached)
		await process_frame
		await process_frame
		gs.set("current_event", &"")
		detached._on_event_chosen(String(resolved))
		await process_frame
		check(StringName(gs.get("current_event")) == resolved, "detached _on_event_chosen writes current_event %s" % String(resolved))
		gs.set("current_event", prev)
		root.remove_child(detached)
		detached.free()
		await process_frame
	return true

func test_event_select_grid_skips_invalid() -> bool:
	var base := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	check(base != null, "harbor_sprint loads as the filter baseline")
	if base == null:
		return true
	check(RaceEvent.validate(base), "filter baseline passes RaceEvent.validate()")
	var bad_laps := base.duplicate() as RaceEvent
	bad_laps.laps = 99
	check(not RaceEvent.validate(bad_laps), "laps=99 fails RaceEvent.validate()")
	var bad_gates := base.duplicate() as RaceEvent
	bad_gates.checkpoints = PackedVector3Array([Vector3(0, 1, 0), Vector3(10, 1, 0)])
	check(not RaceEvent.validate(bad_gates), "fewer than 4 gates fails RaceEvent.validate()")
	var bad_radius := base.duplicate() as RaceEvent
	bad_radius.checkpoint_radius = 99.0
	check(not RaceEvent.validate(bad_radius), "out-of-range radius fails RaceEvent.validate()")
	var packed = load("res://scenes/ui/event_select.tscn")
	check(packed is PackedScene, "event_select.tscn loads for the filter check")
	if not (packed is PackedScene):
		return true
	var select: Node = packed.instantiate()
	root.add_child(select)
	await process_frame
	await process_frame
	var grid := select.find_child("EventGrid", true, false) as GridContainer
	check(grid != null, "event select has an EventGrid for the filter check")
	if grid == null:
		root.remove_child(select)
		select.free()
		return true
	var expected := 0
	for path in MenuUI.EVENT_PATHS:
		var asset := load(path) as RaceEvent
		if asset != null and RaceEvent.validate(asset):
			expected += 1
	check(expected >= 5, "all 5 shipped events pass RaceEvent.validate() (got %d)" % expected)
	check(grid.get_child_count() == expected, "grid holds only validated events (%d vs %d)" % [grid.get_child_count(), expected])
	for child in grid.get_children():
		var btn := child as Button
		check(btn != null, "grid child %s is a Button" % str(child.name))
		if btn == null:
			continue
		var stem := str(btn.name).trim_prefix("Event_")
		check(stem != str(btn.name), "grid button name carries an Event_ stem (%s)" % str(btn.name))
		var backed := load("res://assets/events/%s.tres" % stem) as RaceEvent
		check(backed != null, "grid button %s backs a RaceEvent asset" % stem)
		if backed != null:
			check(RaceEvent.validate(backed), "grid button %s backs a validated event" % stem)
	check(select.find_child("Event_bogus_event", true, false) == null, "no button exists for a synthetic invalid stem")
	root.remove_child(select)
	select.free()
	await process_frame
	return true

func test_vehicle_scene_loads() -> bool:
	var packed = load("res://scenes/vehicles/vehicle_base.tscn")
	check(packed is PackedScene, "vehicle_base.tscn loads as PackedScene")
	if packed is PackedScene:
		var instance: Node = packed.instantiate()
		check(instance != null, "vehicle instantiates")
		if instance != null:
			check(instance.name == "VehicleController", "root node is VehicleController")
			check(instance.has_method("reset_vehicle"), "vehicle exposes reset_vehicle")
			var rays := 0
			for child in instance.get_children():
				if child is RayCast3D:
					rays += 1
			check(rays == 4, "vehicle has exactly 4 RayCast3D wheels, got %d" % rays)
			instance.free()
	return true

func test_accel_reaches_25ms_in_8s() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	var top := 0.0
	for i in 8 * 60:
		await physics_frame
		top = maxf(top, car.speed_ms)
		if car.speed_ms >= 25.0:
			break
	check(top >= 25.0, "reaches 25 m/s within 8 s (top %.2f)" % top)
	check(car.current_gear >= 3, "automatic gearbox shifts to gear >= 3 (gear %d)" % car.current_gear)
	check(car.engine_rpm >= 800.0 and car.engine_rpm <= 7000.0, "engine rpm stays within limits (%.0f)" % car.engine_rpm)
	await _despawn_car()
	return true

func test_coast_upshifts_without_throttle() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.current_gear = 1
	car.linear_velocity = Vector3(0, 0, -20)
	for i in 30:
		await physics_frame
	check(car.input_throttle == 0.0, "coasting applies zero throttle")
	check(car.current_gear >= 2, "coasting at redline upshifts without throttle (gear %d)" % car.current_gear)
	check(car.engine_rpm <= car.shift_up_rpm, "coasting upshift drops rpm to the taller ratio (%.0f)" % car.engine_rpm)
	await _despawn_car()
	return true

func test_drive_force_uses_current_tick_rpm() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	for i in 60:
		await physics_frame
	check(absf(car.engine_rpm - 800.0) < 200.0, "idle settles near 800 rpm (%.0f)" % car.engine_rpm)
	car.input_throttle = 0.3
	car.linear_velocity = Vector3(0, 0, -11.0)
	car.angular_velocity = Vector3.ZERO
	var fwd_before := -car.global_transform.basis.z
	var speed_before := car.linear_velocity.dot(fwd_before)
	await physics_frame
	var fwd_after := -car.global_transform.basis.z
	var speed_after := car.linear_velocity.dot(fwd_after)
	var gain := speed_after - speed_before
	check(car.engine_rpm >= 3500.0 and car.engine_rpm <= 4500.0, "rpm is this tick's readout (~3970, got %.0f)" % car.engine_rpm)
	check(gain > 0.033, "single-tick gain reflects fresh torque (gain %.4f)" % gain)
	await _despawn_car()
	return true

func test_redline_fuel_cut() -> bool:
	var packed = load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	check(packed != null, "vehicle scene loads for redline fuel-cut check")
	if packed == null:
		return true
	var inst := packed.instantiate() as VehicleController
	check(inst != null, "vehicle instantiates for redline fuel-cut check")
	if inst == null:
		return true
	var full: float = inst.engine_max_torque
	var t3000 := inst._sample_torque(3000.0)
	check(absf(t3000 - full) < 0.001, "torque at 3000 rpm is full (%.2f vs %.2f)" % [t3000, full])
	var t6500 := inst._sample_torque(6500.0)
	check(absf(t6500 - 0.6 * full) < 0.001, "torque at 6500 rpm is 0.6x (%.2f)" % t6500)
	var tnear := inst._sample_torque(inst.redline_rpm - 100.0)
	check(tnear > 0.0, "torque just below redline stays positive (%.2f)" % tnear)
	check(tnear < t6500, "torque tapers below the 6500 value near redline (%.2f vs %.2f)" % [tnear, t6500])
	check(inst._sample_torque(inst.redline_rpm) == 0.0, "torque is exactly 0.0 at redline")
	check(inst._sample_torque(8000.0) == 0.0, "torque stays 0.0 above redline")
	inst.free()
	return true

func test_over_rev_cap() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.current_gear = 1
	car.linear_velocity = Vector3(0, 0, -25)
	var peak := 0.0
	var saw_cut := false
	for i in 30:
		await physics_frame
		peak = maxf(peak, car.engine_rpm)
		if car.fuel_cut:
			saw_cut = true
	check(peak <= car.max_engine_rpm, "over-rev transient never exceeds the cap (peak %.0f vs cap %.0f)" % [peak, car.max_engine_rpm])
	check(saw_cut, "fuel_cut raises while over redline")
	check(car.current_gear >= 2, "over-rev still upshifts via the coast path (gear %d)" % car.current_gear)
	check(car.engine_rpm <= car.shift_up_rpm, "upshift drops rpm to the taller ratio (%.0f)" % car.engine_rpm)
	await _despawn_car()
	return true

func test_limiter_order_repairs_inversion() -> bool:
	var inverted := VehicleController.resolve_limiter_order(7000.0, 6800.0, 6000.0)
	check(inverted[2] == 6000.0, "repair keeps the absolute cap authoritative (%.0f)" % inverted[2])
	check(inverted[1] == 6000.0, "repair clamps redline to the cap (%.0f)" % inverted[1])
	check(inverted[0] == 6000.0, "repair clamps shift_up to the repaired redline (%.0f)" % inverted[0])
	var ordered := VehicleController.resolve_limiter_order(5500.0, 6800.0, 7200.0)
	check(ordered[0] == 5500.0 and ordered[1] == 6800.0 and ordered[2] == 7200.0, "repair is a no-op for ordered values")
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.max_engine_rpm = 6000.0
	car.redline_rpm = 6800.0
	car.shift_up_rpm = 7000.0
	car.current_gear = 1
	car.linear_velocity = Vector3(0, 0, -25)
	var peak := 0.0
	var saw_cut := false
	for i in 30:
		await physics_frame
		peak = maxf(peak, car.engine_rpm)
		if car.fuel_cut:
			saw_cut = true
	check(car.shift_up_rpm <= car.redline_rpm, "inversion self-repairs shift_up <= redline (%.0f <= %.0f)" % [car.shift_up_rpm, car.redline_rpm])
	check(car.redline_rpm <= car.max_engine_rpm, "inversion self-repairs redline <= cap (%.0f <= %.0f)" % [car.redline_rpm, car.max_engine_rpm])
	check(peak <= car.max_engine_rpm, "repaired readout never exceeds the cap (peak %.0f vs cap %.0f)" % [peak, car.max_engine_rpm])
	check(saw_cut, "fuel_cut stays reachable after repair")
	check(car._sample_torque(car.redline_rpm) == 0.0, "torque zeroes at the repaired redline")
	await _despawn_car()
	return true

func test_limiter_defaults_ordered() -> bool:
	var packed = load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	check(packed != null, "vehicle scene loads for limiter default check")
	if packed == null:
		return true
	var inst := packed.instantiate() as VehicleController
	check(inst != null, "vehicle instantiates for limiter default check")
	if inst == null:
		return true
	check(inst.shift_up_rpm <= inst.redline_rpm, "default shift_up <= redline (%.0f <= %.0f)" % [inst.shift_up_rpm, inst.redline_rpm])
	check(inst.redline_rpm <= inst.max_engine_rpm, "default redline <= cap (%.0f <= %.0f)" % [inst.redline_rpm, inst.max_engine_rpm])
	inst.free()
	return true

func test_brake_20ms_within_30m() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	for i in 10 * 60:
		await physics_frame
		if car.speed_ms >= 20.0:
			break
	check(car.speed_ms >= 20.0, "reaches 20 m/s before braking (%.2f)" % car.speed_ms)
	Input.action_release("accelerate")
	var start: Vector3 = car.global_position
	Input.action_press("brake")
	var dist := 0.0
	for i in 6 * 60:
		await physics_frame
		var p: Vector3 = car.global_position
		dist = Vector2(p.x - start.x, p.z - start.z).length()
		if car.speed_ms < 0.5:
			break
	check(car.speed_ms < 0.5, "stops from 20 m/s (final %.2f)" % car.speed_ms)
	check(dist <= 30.0, "stops within 30 m (travelled %.2f m)" % dist)
	await _despawn_car()
	return true

func test_handbrake_reduces_rear_grip() -> bool:
	var probe := await _spawn_car(Vector3(0, 0.9, 0))
	var hb_factor: float = probe.handbrake_grip_factor
	var full := VehicleController.compute_lateral_force(0.3, 3000.0, 1.0, 12000.0, 1.0, 1.0)
	var held := VehicleController.compute_lateral_force(0.3, 3000.0, 1.0, 12000.0, 1.0, hb_factor)
	check(absf(full) > 1.0, "baseline rear lateral grip is nonzero (%.1f N)" % full)
	check(held / full < 0.6, "handbrake cuts rear lateral grip (ratio %.3f)" % (held / full))
	var base_yaw := await _steer_yaw_run(false)
	var hb_yaw := await _steer_yaw_run(true)
	check(absf(base_yaw) > 0.05, "baseline steers at speed (yaw %.2f rad)" % base_yaw)
	check(absf(hb_yaw) >= 1.5 * absf(base_yaw), "handbrake yaws >= 1.5x baseline (hb %.2f vs base %.2f rad)" % [hb_yaw, base_yaw])
	await _despawn_car()
	return true

func _steer_yaw_run(handbrake: bool) -> float:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	for i in 10 * 60:
		await physics_frame
		if car.speed_ms >= 12.0:
			break
	Input.action_release("accelerate")
	Input.action_press("steer_right")
	if handbrake:
		Input.action_press("handbrake")
	var total := 0.0
	var prev := _yaw_of(car)
	for i in 60:
		await physics_frame
		var yaw := _yaw_of(car)
		total += wrapf(yaw - prev, -PI, PI)
		prev = yaw
	_release_inputs()
	return total

func test_assists_reduce_slip_when_on() -> bool:
	var steer := 0.8
	var speed := 20.0
	var raw_slip := 0.25
	var steer_off := VehicleAssists.correct_steer(steer, speed, false)
	check(steer_off == steer, "assists off leaves steer unchanged (%.4f)" % steer_off)
	var steer_on := VehicleAssists.correct_steer(steer, speed, true)
	check(absf(steer_on) < absf(steer_off), "assists on reduces steer response (on %.4f vs off %.4f)" % [steer_on, steer_off])
	check(signf(steer_on) == signf(steer_off), "assists preserve steer direction")
	var slip_off := VehicleAssists.damp_slip(raw_slip, false)
	check(slip_off == raw_slip, "assists off leaves slip unchanged (%.4f)" % slip_off)
	var slip_on := VehicleAssists.damp_slip(raw_slip, true)
	check(absf(slip_on) < absf(slip_off), "assists on reduces slip angle (on %.4f vs off %.4f)" % [slip_on, slip_off])
	var assists_node := VehicleAssists.new()
	check(assists_node.assists_enabled == true, "assists default ON")
	assists_node.free()
	var packed = load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	check(packed != null, "vehicle scene loads for assists/camera wiring check")
	if packed != null:
		var inst := packed.instantiate() as VehicleController
		check(inst != null, "vehicle instantiates for wiring check")
		if inst != null:
			check(inst.assists_enabled == true, "controller assists default ON")
			var cam := inst.get_node_or_null("ChaseCamera")
			check(cam != null and cam is Camera3D, "ChaseCamera child present on vehicle")
			if cam is Camera3D:
				check((cam as Camera3D).current == true, "ChaseCamera is current")
			check(inst.get_node_or_null("Assists") != null, "Assists child present on vehicle")
			inst.free()
	return true

func test_suspension_settles_after_drop() -> bool:
	var car := await _spawn_car(Vector3(0, 1.2, 0))
	var heights: Array[float] = []
	for i in 4 * 60:
		await physics_frame
		heights.append(car.global_position.y)
	var tail := heights.slice(heights.size() - 60)
	var mn := 1000.0
	var mx := -1000.0
	var sum := 0.0
	for h in tail:
		mn = minf(mn, h)
		mx = maxf(mx, h)
		sum += h
	var avg := sum / float(tail.size())
	check(mx - mn < 0.03, "suspension settles: last-1 s height range < 0.03 m (%.4f)" % (mx - mn))
	var bounces := 0
	for i in range(1, heights.size() - 1):
		if heights[i] > heights[i - 1] and heights[i] >= heights[i + 1] and heights[i] > avg + 0.03:
			bounces += 1
	check(bounces <= 1, "suspension bounces at most once (%d)" % bounces)
	await _despawn_car()
	return true

func test_reset_after_flip() -> bool:
	var flip := Basis(Vector3(1, 0, 0), PI)
	var car := await _spawn_car(Vector3(0, 0.7, 0), flip)
	for i in 60:
		await physics_frame
	Input.action_press("reset_car")
	for i in 90:
		await physics_frame
	Input.action_release("reset_car")
	var up: Vector3 = car.global_transform.basis.y
	check(up.y > 0.9, "manual reset restores upright (up.y %.3f)" % up.y)
	check(car.linear_velocity.length() < 1.0, "manual reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	check(car.global_position.y > 0.3 and car.global_position.y < 2.0, "manual reset parks at sane height (y %.2f)" % car.global_position.y)
	car = await _spawn_car(Vector3(0, 0.7, 0), flip)
	for i in 3 * 60:
		await physics_frame
	var up2: Vector3 = car.global_transform.basis.y
	check(up2.y > 0.9, "inverted car self-rights without input (up.y %.3f)" % up2.y)
	check(car.linear_velocity.length() < 1.0, "auto reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	await _despawn_car()
	return true

func test_reset_clears_overpass() -> bool:
	var base := Vector3(1.0, 1.7, -2.0)
	var cands := VehicleController.reset_candidates(base)
	check(cands.size() == 25, "reset spiral has 25 candidates (got %d)" % cands.size())
	if cands.size() == 25:
		check(cands[0] == base, "first reset candidate is the flip point")
		var same_y := true
		var ordered := true
		var prev := -1.0
		for c in cands:
			if c.y != base.y:
				same_y = false
			var r := Vector2(c.x - base.x, c.z - base.z).length()
			if r < prev - 0.001:
				ordered = false
			prev = r
		check(same_y, "all reset candidates share base height")
		check(ordered, "reset spiral radii are non-decreasing")
	var probe := VehicleController.reset_probe_shape() as BoxShape3D
	check(probe != null and probe.size == Vector3(2.0, 2.0, 4.4), "reset probe covers the car footprint plus margin")
	var flip := Basis(Vector3(1, 0, 0), PI)
	var car := await _spawn_car(Vector3(0, 0.7, 0), flip)
	var deck := StaticBody3D.new()
	var dshape := CollisionShape3D.new()
	var dbox := BoxShape3D.new()
	dbox.size = Vector3(5, 0.5, 5)
	dshape.shape = dbox
	deck.add_child(dshape)
	deck.position = Vector3(0, 2.0, 0)
	root.add_child(deck)
	await physics_frame
	for i in 60:
		await physics_frame
	Input.action_press("reset_car")
	for i in 90:
		await physics_frame
	Input.action_release("reset_car")
	var up: Vector3 = car.global_transform.basis.y
	check(up.y > 0.9, "overpass reset restores upright (up.y %.3f)" % up.y)
	check(car.linear_velocity.length() < 1.0, "overpass reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	var p: Vector3 = car.global_position
	var flat := Vector2(p.x - 0.0, p.z - 0.0).length()
	check(flat >= 2.5, "overpass reset sidesteps from under the deck (%.2f m)" % flat)
	var inside := p.x > -3.5 and p.x < 3.5 and p.y > 0.75 and p.y < 3.25 and p.z > -4.7 and p.z < 4.7
	check(not inside, "overpass reset parks outside the deck (%.2f, %.2f, %.2f)" % [p.x, p.y, p.z])
	deck.queue_free()
	await _despawn_car()
	return true

func test_reverse_latch_needs_standstill_in_first() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	for i in 12 * 60:
		await physics_frame
		if car.speed_ms >= 25.0:
			break
	check(car.speed_ms >= 25.0, "reaches 25 m/s before latch test (%.2f)" % car.speed_ms)
	check(car.current_gear >= 3, "gear >= 3 at speed (gear %d)" % car.current_gear)
	Input.action_release("accelerate")
	Input.action_press("brake")
	for i in 6 * 60:
		await physics_frame
		if car.speed_ms <= 0.8:
			break
		check(car.speed_ms > -0.5, "braking at speed never reverses (%.2f)" % car.speed_ms)
	for i in 6 * 60:
		await physics_frame
		if car.speed_ms < -1.0 and car.current_gear == 1:
			break
	check(car.speed_ms < -1.0, "continued brake hold backs up (%.2f)" % car.speed_ms)
	check(car.current_gear == 1, "latched in 1st gear (gear %d)" % car.current_gear)
	await _despawn_car()
	return true

func test_reverse_latch_fields_and_throttle_unlatch() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 1.0
	for i in 3 * 60:
		await physics_frame
		if car.speed_ms < -1.0:
			break
	check(car.speed_ms < -1.0, "field-driven brake hold latches reverse (%.2f)" % car.speed_ms)
	car.input_brake = 0.0
	car.input_throttle = 1.0
	for i in 3 * 60:
		await physics_frame
		if car.speed_ms > 1.0:
			break
	check(car.speed_ms > 1.0, "throttle unlatches to forward drive (%.2f)" % car.speed_ms)
	await _despawn_car()
	return true

func test_reverse_rpm_signed() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 1.0
	for i in 8 * 60:
		await physics_frame
		if car.speed_ms < -2.0:
			break
	check(car.speed_ms < -1.0, "field-driven brake hold latches reverse (%.2f)" % car.speed_ms)
	var reverse_speed: float = car.speed_ms
	var reverse_rpm: float = car.engine_rpm
	check(reverse_rpm < 0.0, "reverse reports negative rpm (%.0f at %.2f m/s)" % [reverse_rpm, reverse_speed])
	check(car.current_gear == 1, "reverse rpm sign keeps 1st gear (gear %d)" % car.current_gear)
	car.input_brake = 0.0
	car.input_throttle = 1.0
	var forward_rpm := 0.0
	var forward_speed := 0.0
	for i in 8 * 60:
		await physics_frame
		if car.speed_ms > 2.0:
			forward_rpm = car.engine_rpm
			forward_speed = car.speed_ms
			if absf(forward_speed) >= absf(reverse_speed) - 0.5:
				break
	check(forward_speed > 2.0, "throttle unlatches to forward drive (%.2f)" % forward_speed)
	check(forward_rpm > 0.0, "forward reports positive rpm (%.0f at %.2f m/s)" % [forward_rpm, forward_speed])
	check(reverse_rpm != forward_rpm, "forward/reverse rpm differ by sign (%.0f vs %.0f)" % [reverse_rpm, forward_rpm])
	check(signf(reverse_rpm) != signf(forward_rpm), "forward/reverse rpm signs oppose (%.0f vs %.0f)" % [reverse_rpm, forward_rpm])
	await _despawn_car()
	return true

func test_reverse_rpm_idle_positive() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.linear_velocity = Vector3.ZERO
	var lo := 1e9
	var hi := -1e9
	for i in 30:
		await physics_frame
		lo = minf(lo, car.engine_rpm)
		hi = maxf(hi, car.engine_rpm)
	check(lo > 0.0, "standstill rpm stays positive (min %.0f)" % lo)
	check(absf(car.engine_rpm - 800.0) < 1.0, "standstill rpm rests at idle (%.0f)" % car.engine_rpm)
	check(hi - lo < 1.0, "standstill rpm stable, no flicker (range %.2f)" % (hi - lo))
	await _despawn_car()
	return true

func test_field_driven_ignores_reset_key() -> bool:
	var flip := Basis(Vector3(1, 0, 0), PI)
	var car := await _spawn_car(Vector3(0, 0.7, 0), flip)
	car.use_player_input = false
	for i in 20:
		await physics_frame
	Input.action_press("reset_car")
	for i in 20:
		await physics_frame
	var up: Vector3 = car.global_transform.basis.y
	check(up.y < 0.3, "field-driven car ignores reset_car key (up.y %.3f)" % up.y)
	Input.action_release("reset_car")
	car.reset_vehicle()
	for i in 60:
		await physics_frame
	var up2: Vector3 = car.global_transform.basis.y
	check(up2.y > 0.9, "reset_vehicle() still uprights field-driven car (up.y %.3f)" % up2.y)
	check(car.linear_velocity.length() < 1.0, "API reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	check(car.global_position.y > 0.3 and car.global_position.y < 2.0, "API reset parks at sane height (y %.2f)" % car.global_position.y)
	await _despawn_car()
	return true

func test_test_ground_loads() -> bool:
	var packed = load("res://scenes/city/test_ground.tscn")
	check(packed is PackedScene, "test_ground.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "test ground instantiates")
	if instance == null:
		return true
	check(instance.name == "TestGround", "root node is TestGround")
	var car: VehicleController = null
	for child in instance.get_children():
		if child is VehicleController:
			car = child
	check(car != null, "test ground spawns one VehicleController")
	if car != null:
		check(car.use_player_input == false, "spawned car is field-driven (use_player_input == false)")
		check(car.get_node_or_null("PlayerInput") != null, "spawned car has a PlayerInput bridge child")
	var ground: StaticBody3D = instance.get_node_or_null("Ground") as StaticBody3D
	check(ground != null, "test ground has a Ground StaticBody3D")
	if ground != null:
		var span := 0.0
		for child in ground.get_children():
			if child is CollisionShape3D:
				var box := (child as CollisionShape3D).shape as BoxShape3D
				if box != null:
					span = maxf(span, minf(box.size.x, box.size.z))
		check(span >= 400.0, "ground collision spans >= 400 m (%.1f)" % span)
	var walls := 0
	var walled_shapes := 0
	var lights := 0
	for child in instance.get_children():
		if child is DirectionalLight3D:
			lights += 1
		if child is StaticBody3D and str(child.name).begins_with("Wall"):
			walls += 1
			var has_shape := false
			var has_mesh := false
			for grandchild in child.get_children():
				if grandchild is CollisionShape3D:
					has_shape = true
				if grandchild is MeshInstance3D:
					has_mesh = true
			if has_shape and not has_mesh:
				walled_shapes += 1
	check(walls >= 4, "test ground has >= 4 barrier walls (%d)" % walls)
	check(walled_shapes >= 4, "walls are invisible (mesh-less) with collision (%d)" % walled_shapes)
	check(lights >= 1, "test ground has a DirectionalLight3D")
	instance.free()
	return true

func test_district_loads() -> bool:
	var packed = load("res://scenes/city/district.tscn")
	check(packed is PackedScene, "district.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "district instantiates")
	if instance == null:
		return true
	check(instance.name == "District", "district root node is District")
	var block_packed = load("res://scenes/city/block.tscn")
	check(block_packed is PackedScene, "block.tscn loads as PackedScene")
	var block_inst: Node = null
	if block_packed is PackedScene:
		block_inst = (block_packed as PackedScene).instantiate()
		check(block_inst != null, "block prefab instantiates")
		if block_inst != null:
			check(block_inst.name == "Block", "block prefab root node is Block")
	var statics := instance.find_children("*", "StaticBody3D", true, false)
	var blocks := 0
	var roads := 0
	var walls := 0
	var walled_shapes := 0
	var layers_ok := true
	var block_dims_ok := true
	var road_dims_ok := true
	for body in statics:
		var rigid := body as StaticBody3D
		if rigid == null:
			continue
		if rigid.collision_layer != 1:
			layers_ok = false
		var bname := str(rigid.name)
		if bname.begins_with("Block_"):
			blocks += 1
			var measured := false
			for child in rigid.get_children():
				if child is CollisionShape3D:
					var box := (child as CollisionShape3D).shape as BoxShape3D
					if box != null and absf(box.size.x - 60.0) < 0.001 and absf(box.size.z - 60.0) < 0.001:
						measured = true
			if not measured:
				block_dims_ok = false
		elif bname.begins_with("Road_"):
			roads += 1
			var road_measured := false
			for child in rigid.get_children():
				if child is CollisionShape3D:
					var rbox := (child as CollisionShape3D).shape as BoxShape3D
					if rbox != null and absf(minf(rbox.size.x, rbox.size.z) - 8.0) < 0.001:
						road_measured = true
			if not road_measured:
				road_dims_ok = false
		elif bname.begins_with("Wall"):
			walls += 1
			var has_shape := false
			var has_mesh := false
			for grandchild in rigid.get_children():
				if grandchild is CollisionShape3D:
					has_shape = true
				if grandchild is MeshInstance3D:
					has_mesh = true
			if has_shape and not has_mesh:
				walled_shapes += 1
	check(statics.size() >= 16, "district has >= 16 StaticBody3D colliders (%d)" % statics.size())
	check(blocks >= 16, "district has >= 16 block colliders (%d)" % blocks)
	check(roads >= 10, "district has >= 10 road strips (%d)" % roads)
	check(walls >= 4, "district has >= 4 edge walls (%d)" % walls)
	check(walled_shapes >= 4, "edge walls are invisible (mesh-less) with collision (%d)" % walled_shapes)
	check(layers_ok, "every district StaticBody3D uses collision_layer 1")
	check(block_dims_ok, "block collision shapes measure 60 m")
	check(road_dims_ok, "road collision shapes measure 8 m wide")
	var lights := instance.find_children("*", "DirectionalLight3D", true, false)
	check(lights.size() >= 1, "district has a DirectionalLight3D")
	var spawn := instance.get_node_or_null("SpawnPoint")
	check(spawn != null and spawn is Marker3D, "district has a SpawnPoint Marker3D")
	if block_inst != null:
		block_inst.free()
	instance.free()
	return true

func test_player_input_bridge() -> bool:
	var packed = load("res://scenes/city/test_ground.tscn") as PackedScene
	check(packed != null, "test_ground.tscn loads for the bridge test")
	if packed == null:
		return true
	if is_instance_valid(_ground):
		_ground.queue_free()
		_ground = null
		await process_frame
		await physics_frame
	var instance: Node = packed.instantiate()
	root.add_child(instance)
	await process_frame
	await physics_frame
	check(not is_instance_valid(_ground), "bridge test runs on exclusive scene ground (shared slab removed)")
	check(instance.get_node_or_null("Ground") != null, "scene instance provides the single Ground plane")
	var car: VehicleController = null
	for child in instance.get_children():
		if child is VehicleController:
			car = child
	check(car != null, "bridge test finds the spawned VehicleController")
	if car == null:
		instance.queue_free()
		await process_frame
		await physics_frame
		_make_ground()
		return true
	Input.action_press("accelerate")
	for i in 30:
		await physics_frame
	check(car.input_throttle > 0.5, "bridge copies accelerate into input_throttle (%.2f)" % car.input_throttle)
	_release_inputs()
	for i in 5:
		await physics_frame
	Input.action_press("reset_car")
	for i in 10:
		await physics_frame
	check(car.input_reset == true, "bridge copies reset_car into input_reset")
	Input.action_release("reset_car")
	for i in 10:
		await physics_frame
	check(car.input_reset == false, "bridge releases reset level when reset_car released")
	var flip := Basis(Vector3(1, 0, 0), PI)
	var pos: Vector3 = car.global_position
	car.global_transform = Transform3D(flip, Vector3(pos.x, 0.7, pos.z))
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	await physics_frame
	Input.action_press("reset_car")
	for i in 15:
		await physics_frame
	var up: Vector3 = car.global_transform.basis.y
	check(up.y > 0.9, "bridge reset restores upright (up.y %.3f)" % up.y)
	Input.action_release("reset_car")
	for i in 90:
		await physics_frame
	check(car.linear_velocity.length() < 1.0, "bridge reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	check(car.global_position.y > 0.3 and car.global_position.y < 2.0, "bridge reset parks at sane height (y %.2f)" % car.global_position.y)
	_release_inputs()
	instance.queue_free()
	await process_frame
	await physics_frame
	_make_ground()
	return true

func test_light_budget_max_8_omnis_per_mesh() -> bool:
	var packed = load("res://scenes/city/district_night.tscn")
	check(packed is PackedScene, "district_night.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "district night instantiates")
	if instance == null:
		return true
	check(instance.name == "DistrictNight", "district night root node is DistrictNight")
	root.add_child(instance)
	await process_frame
	var envs := instance.find_children("*", "WorldEnvironment", true, false)
	check(envs.size() == 1, "scene contains exactly one WorldEnvironment (%d)" % envs.size())
	if envs.size() == 1:
		var env: Environment = (envs[0] as WorldEnvironment).environment
		check(env != null, "WorldEnvironment has an Environment")
		if env != null:
			check(env.glow_enabled == true, "night environment has glow enabled")
			check(env.sky != null, "night environment has a sky")
			if env.sky != null and env.sky.sky_material is PanoramaSkyMaterial:
				var pano := (env.sky.sky_material as PanoramaSkyMaterial).panorama
				check(pano != null, "panorama sky texture is set")
			else:
				check(false, "night sky uses a PanoramaSkyMaterial")
	check(ResourceLoader.exists("res://assets/city/night_sky.hdr"), "night_sky.hdr is vendored")
	var suns := instance.find_children("*", "DirectionalLight3D", true, false)
	check(suns.size() == 1, "scene contains exactly one DirectionalLight3D (%d)" % suns.size())
	var omnis := instance.find_children("*", "OmniLight3D", true, false)
	check(omnis.size() <= 8, "scene total omnis stay in budget (%d)" % omnis.size())
	var meshes := instance.find_children("*", "MeshInstance3D", true, false)
	check(meshes.size() > 0, "district night has meshes (%d)" % meshes.size())
	var emissive := 0
	for node in meshes:
		var mi := node as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var mat: Material = mi.mesh.surface_get_material(i)
			if mat == null:
				mat = mi.get_surface_override_material(i)
			if mat is StandardMaterial3D and (mat as StandardMaterial3D).emission_enabled:
				emissive += 1
	check(emissive >= 1, "at least one emissive StandardMaterial3D dresses the scene (%d meshes)" % emissive)
	var worst := 0
	var worst_name := ""
	for node in meshes:
		var mi := node as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		var aabb: AABB = mi.mesh.get_aabb()
		var center: Vector3 = mi.global_transform * aabb.get_center()
		var radius: float = aabb.size.length() * 0.5
		var count := 0
		for light in omnis:
			var omni := light as OmniLight3D
			if omni == null:
				continue
			if omni.global_position.distance_to(center) <= omni.omni_range + radius:
				count += 1
		if count > worst:
			worst = count
			worst_name = str(mi.name)
		check(count <= 8, "mesh %s sees %d omnis (budget 8)" % [str(mi.name), count])
	check(worst <= 8, "worst mesh sees %d omnis (%s)" % [worst, worst_name])
	root.remove_child(instance)
	instance.free()
	return true

func test_central_roads_not_coplanar() -> bool:
	var scenes: Array[String] = [
		"res://scenes/city/district.tscn",
		"res://scenes/city/district_night.tscn",
	]
	for scene_path in scenes:
		var packed = load(scene_path)
		check(packed is PackedScene, "%s loads as PackedScene" % scene_path)
		if not (packed is PackedScene):
			continue
		var instance: Node = (packed as PackedScene).instantiate()
		check(instance != null, "%s instantiates" % scene_path)
		if instance == null:
			continue
		root.add_child(instance)
		await process_frame
		var ns_body := instance.get_node_or_null("Road_NS_2")
		var ew_body := instance.get_node_or_null("Road_EW_2")
		check(ns_body != null, "%s has Road_NS_2" % scene_path)
		check(ew_body != null, "%s has Road_EW_2" % scene_path)
		if ns_body == null or ew_body == null:
			root.remove_child(instance)
			instance.free()
			continue
		var ns_mesh := ns_body.get_node_or_null("MeshInstance3D") as MeshInstance3D
		var ew_mesh := ew_body.get_node_or_null("MeshInstance3D") as MeshInstance3D
		var ns_col := ns_body.get_node_or_null("CollisionShape3D") as CollisionShape3D
		var ew_col := ew_body.get_node_or_null("CollisionShape3D") as CollisionShape3D
		check(ns_mesh != null, "%s Road_NS_2 has a MeshInstance3D" % scene_path)
		check(ew_mesh != null, "%s Road_EW_2 has a MeshInstance3D" % scene_path)
		check(ns_col != null, "%s Road_NS_2 has a CollisionShape3D" % scene_path)
		check(ew_col != null, "%s Road_EW_2 has a CollisionShape3D" % scene_path)
		if ns_mesh == null or ew_mesh == null or ns_col == null or ew_col == null:
			root.remove_child(instance)
			instance.free()
			continue
		var ns_box := ns_mesh.mesh as BoxMesh
		var ew_box := ew_mesh.mesh as BoxMesh
		check(ns_box != null, "%s Road_NS_2 mesh is a BoxMesh" % scene_path)
		check(ew_box != null, "%s Road_EW_2 mesh is a BoxMesh" % scene_path)
		if ns_box == null or ew_box == null:
			root.remove_child(instance)
			instance.free()
			continue
		var ns_parent_y: float = (ns_body as Node3D).position.y
		var ew_parent_y: float = (ew_body as Node3D).position.y
		var ns_top: float = ns_parent_y + ns_mesh.position.y + ns_box.size.y * 0.5
		var ew_top: float = ew_parent_y + ew_mesh.position.y + ew_box.size.y * 0.5
		check(ns_top >= -0.01 and ns_top <= 0.05, "%s NS top at datum (%.3f)" % [scene_path, ns_top])
		check(ew_top >= -0.01 and ew_top <= 0.05, "%s EW top near datum (%.3f)" % [scene_path, ew_top])
		var lip: float = ew_top - ns_top
		check(absf(lip - 0.02) <= 0.005, "%s EW lip +0.02 over NS (gap %.4f)" % [scene_path, lip])
		check(absf(ns_col.position.y - ns_mesh.position.y) < 0.001, "%s NS collision matches mesh (%.4f vs %.4f)" % [scene_path, ns_col.position.y, ns_mesh.position.y])
		check(absf(ew_col.position.y - ew_mesh.position.y) < 0.001, "%s EW collision matches mesh (%.4f vs %.4f)" % [scene_path, ew_col.position.y, ew_mesh.position.y])
		root.remove_child(instance)
		instance.free()
	return true

func test_steer_turns_at_speed() -> bool:
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 1.0
	for i in 10 * 60:
		await physics_frame
		if car.speed_ms >= 10.0:
			break
	check(car.speed_ms >= 10.0, "reaches 10 m/s for the steer test (%.2f)" % car.speed_ms)
	car.input_throttle = 0.3
	car.input_steer = 1.0
	var total := 0.0
	var prev := _yaw_of(car)
	for i in 2 * 60:
		await physics_frame
		var yaw := _yaw_of(car)
		total += wrapf(yaw - prev, -PI, PI)
		prev = yaw
	var up: Vector3 = car.global_transform.basis.y
	check(absf(total) > deg_to_rad(20.0), "full steer turns heading > 20 deg in 2 s (%.1f deg)" % rad_to_deg(total))
	check(up.y > 0.5, "car stays upright while turning (up.y %.3f)" % up.y)
	await _despawn_car()
	return true

func test_export_presets_present() -> bool:
	var cfg := ConfigFile.new()
	check(cfg.load("res://export_presets.cfg") == OK, "export_presets.cfg parses in the engine ConfigFile")
	var pairs: Array[String] = []
	for s: String in cfg.get_sections():
		if s.begins_with("preset.") and s.get_slice_count(".") == 2:
			pairs.append("%s|%s" % [str(cfg.get_value(s, "name", "")), str(cfg.get_value(s, "platform", ""))])
	check(pairs.has("Windows Desktop|Windows Desktop"), "Windows Desktop preset on platform Windows Desktop exists")
	check(pairs.has("Linux|Linux"), "Linux preset on platform Linux exists")
	return true

func test_export_presets_targets() -> bool:
	var cfg := ConfigFile.new()
	check(cfg.load("res://export_presets.cfg") == OK, "export_presets.cfg loads for target checks")
	var wanted := {"Windows Desktop": ".exe", "Linux": ".x86_64"}
	var seen: Array[String] = []
	for s: String in cfg.get_sections():
		if not (s.begins_with("preset.") and s.get_slice_count(".") == 2):
			continue
		var preset_name := str(cfg.get_value(s, "name", ""))
		if not wanted.has(preset_name):
			continue
		seen.append(preset_name)
		var path := str(cfg.get_value(s, "export_path", ""))
		check(path.begins_with("build/"), "%s exports under build/ (got %s)" % [preset_name, path])
		check(path.ends_with(str(wanted[preset_name])), "%s export path ends with %s (got %s)" % [preset_name, str(wanted[preset_name]), path])
		check(str(cfg.get_value(s + ".options", "binary_format/architecture", "")) == "x86_64", "%s targets x86_64" % preset_name)
		check(cfg.get_value(s, "encrypt_pck", true) == false, "%s leaves pck unencrypted" % preset_name)
		check(cfg.get_value(s, "dedicated_server", true) == false, "%s is not a dedicated-server preset" % preset_name)
	check(seen.has("Windows Desktop"), "Windows Desktop preset present for target checks")
	check(seen.has("Linux"), "Linux preset present for target checks")
	return true

func test_tune_values_in_range() -> bool:
	var names: Array[String] = ["default_tune", "sport_tune", "drift_tune", "drag_tune"]
	for n: String in names:
		var tune := load("res://assets/cars/tunes/%s.tres" % n) as CarTune
		check(tune != null, "%s loads as CarTune" % n)
		if tune == null:
			continue
		check(CarTune.validate(tune), "%s passes CarTune.validate()" % n)
		check(tune.engine_torque >= CarTune.ENGINE_TORQUE_MIN and tune.engine_torque <= CarTune.ENGINE_TORQUE_MAX, "%s torque in range (%.1f Nm)" % [n, tune.engine_torque])
		check(tune.gear_ratios.size() >= CarTune.GEAR_COUNT_MIN and tune.gear_ratios.size() <= CarTune.GEAR_COUNT_MAX, "%s has 4-6 ratios (got %d)" % [n, tune.gear_ratios.size()])
		for i in tune.gear_ratios.size():
			var ratio: float = tune.gear_ratios[i]
			check(ratio >= CarTune.GEAR_RATIO_MIN and ratio <= CarTune.GEAR_RATIO_MAX, "%s ratio %d in range (%.2f)" % [n, i, ratio])
			if i > 0:
				check(tune.gear_ratios[i - 1] > ratio, "%s ratios strictly decreasing at %d (%.2f > %.2f)" % [n, i, tune.gear_ratios[i - 1], ratio])
		check(tune.final_drive >= CarTune.FINAL_DRIVE_MIN and tune.final_drive <= CarTune.FINAL_DRIVE_MAX, "%s final drive in range (%.2f)" % [n, tune.final_drive])
		check(tune.tire_grip_front >= CarTune.TIRE_GRIP_MIN and tune.tire_grip_front <= CarTune.TIRE_GRIP_MAX, "%s front grip in range (%.2f)" % [n, tune.tire_grip_front])
		check(tune.tire_grip_rear >= CarTune.TIRE_GRIP_MIN and tune.tire_grip_rear <= CarTune.TIRE_GRIP_MAX, "%s rear grip in range (%.2f)" % [n, tune.tire_grip_rear])
		check(tune.roll_stiffness_front >= CarTune.ROLL_STIFFNESS_MIN and tune.roll_stiffness_front <= CarTune.ROLL_STIFFNESS_MAX, "%s front roll stiffness in range (%.0f)" % [n, tune.roll_stiffness_front])
		check(tune.roll_stiffness_rear >= CarTune.ROLL_STIFFNESS_MIN and tune.roll_stiffness_rear <= CarTune.ROLL_STIFFNESS_MAX, "%s rear roll stiffness in range (%.0f)" % [n, tune.roll_stiffness_rear])
		check(tune.downforce_coefficient >= CarTune.DOWNFORCE_MIN and tune.downforce_coefficient <= CarTune.DOWNFORCE_MAX, "%s downforce in range (%.2f)" % [n, tune.downforce_coefficient])
	return true

func test_cornering_g_envelope_0_8_to_1_4g() -> bool:
	# Steady-state cornering g via the production friction-cap path: a large
	# slip angle saturates compute_lateral_force so its return equals the cap
	# (grip x load). Summed caps over 4 wheels divided by vehicle weight in g
	# equals the mean axle grip, grounding the check in real tire math.
	var tune := load("res://assets/cars/tunes/default_tune.tres") as CarTune
	check(tune != null, "default tune loads for cornering envelope")
	if tune == null:
		return true
	check(CarTune.validate(tune), "default tune validates for cornering envelope")
	var wheel_load := 1200.0 * 9.81 / 4.0
	var cap_front := absf(VehicleController.compute_lateral_force(1.0, wheel_load, tune.tire_grip_front, 12000.0, 1.0, 1.0))
	var cap_rear := absf(VehicleController.compute_lateral_force(1.0, wheel_load, tune.tire_grip_rear, 12000.0, 1.0, 1.0))
	var weight := 1200.0 * 9.81
	var total := 2.0 * cap_front + 2.0 * cap_rear
	var cornering_g := total / weight
	var mean_grip := (tune.tire_grip_front + tune.tire_grip_rear) * 0.5
	check(tune.tire_grip_front >= 0.8 and tune.tire_grip_front <= 1.4, "front axle grip in 0.8-1.4 g (%.2f)" % tune.tire_grip_front)
	check(tune.tire_grip_rear >= 0.8 and tune.tire_grip_rear <= 1.4, "rear axle grip in 0.8-1.4 g (%.2f)" % tune.tire_grip_rear)
	check(absf(cornering_g - mean_grip) < 0.05, "envelope matches mean grip (%.3f g vs %.3f)" % [cornering_g, mean_grip])
	check(cornering_g >= 0.8 and cornering_g <= 1.4, "cornering g envelope 0.8-1.4 g (%.3f g)" % cornering_g)
	return true

func test_city_kit_glb_present() -> bool:
	var dir := DirAccess.open("res://assets/city")
	check(dir != null, "assets/city directory opens")
	if dir == null:
		return true
	var glbs: Array[String] = []
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if not dir.current_is_dir() and entry.ends_with(".glb"):
			glbs.append(entry)
		entry = dir.get_next()
	dir.list_dir_end()
	check(glbs.size() >= 5, "assets/city holds >= 5 kit .glb files (got %d)" % glbs.size())
	for g in glbs:
		var packed = load("res://assets/city/%s" % g)
		check(packed is PackedScene, "kit %s loads as PackedScene" % g)
		if packed is PackedScene:
			var inst: Node = (packed as PackedScene).instantiate()
			check(inst != null, "kit %s instantiates" % g)
			if inst != null:
				inst.free()
	return true

func test_city_kit_credits() -> bool:
	check(FileAccess.file_exists("res://docs/CREDITS"), "docs/CREDITS exists")
	var text := ""
	if FileAccess.file_exists("res://docs/CREDITS"):
		text = FileAccess.get_file_as_string("res://docs/CREDITS")
	check(text.contains("Kenney"), "CREDITS names Kenney")
	check(text.contains("Poly Haven"), "CREDITS names Poly Haven")
	check(text.contains("https://kenney.nl/assets/category:3D"), "CREDITS pins the Kenney 3D URL")
	check(text.contains("https://polyhaven.com/hdris"), "CREDITS pins the Poly Haven HDRIs URL")
	check(text.contains("CC0"), "CREDITS records the CC0 license")
	return true

func test_district_night_uses_kit() -> bool:
	var packed = load("res://scenes/city/district_night.tscn")
	check(packed is PackedScene, "district_night.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "district night instantiates for the kit check")
	if instance == null:
		return true
	root.add_child(instance)
	await process_frame
	var names: Array[String] = []
	for child in instance.get_children():
		names.append(str(child.name))
	var has_tower := false
	var has_shop := false
	var has_lamp := false
	var has_neon := false
	var has_barrier := false
	var has_prop := false
	for n in names:
		if n.begins_with("Kit_Tower"):
			has_tower = true
		if n.begins_with("Kit_Shop"):
			has_shop = true
		if n.begins_with("Kit_Lamp"):
			has_lamp = true
		if n.begins_with("Kit_Neon"):
			has_neon = true
		if n.begins_with("Kit_Barrier"):
			has_barrier = true
		if n.begins_with("Kit_Prop"):
			has_prop = true
	check(has_tower, "night district instances tower kit buildings")
	check(has_shop, "night district instances shop kit buildings")
	check(has_lamp, "night district instances streetlamp kits")
	check(has_neon, "night district instances neon-sign kits")
	check(has_barrier, "night district instances barrier kits along the route edges")
	check(has_prop, "night district instances street-prop kits")
	for wall_name in ["WallN", "WallS", "WallE", "WallW"]:
		var wall := instance.get_node_or_null(wall_name) as StaticBody3D
		check(wall != null, "%s edge wall exists" % wall_name)
		if wall == null:
			continue
		check(wall.collision_layer == 1, "%s keeps collision_layer 1" % wall_name)
		check(wall.get_node_or_null("CollisionShape3D") != null, "%s keeps its CollisionShape3D" % wall_name)
		var stripe := wall.get_node_or_null("BarrierStripe") as MeshInstance3D
		check(stripe != null, "%s has a visible BarrierStripe mesh child" % wall_name)
		if stripe != null:
			check(stripe.mesh != null, "%s BarrierStripe mesh is set" % wall_name)
	var envs := instance.find_children("*", "WorldEnvironment", true, false)
	check(envs.size() == 1, "kit pass keeps exactly one WorldEnvironment (%d)" % envs.size())
	var suns := instance.find_children("*", "DirectionalLight3D", true, false)
	check(suns.size() == 1, "kit pass keeps exactly one DirectionalLight3D (%d)" % suns.size())
	var omnis := instance.find_children("*", "OmniLight3D", true, false)
	check(omnis.size() <= 8, "kit pass adds no lights: omnis stay in budget (%d)" % omnis.size())
	root.remove_child(instance)
	instance.free()
	return true

func traffic_yields_when_blocked() -> bool:
	var lane := Path3D.new()
	lane.name = "YieldTestLane"
	var curve := Curve3D.new()
	curve.add_point(Vector3(0, 0.6, 0))
	curve.add_point(Vector3(0, 0.6, -100))
	lane.curve = curve
	root.add_child(lane)
	await process_frame
	await physics_frame
	var packed := load("res://scenes/vehicles/traffic_car.tscn") as PackedScene
	check(packed != null, "traffic car scene loads for the yield test")
	if packed == null:
		lane.queue_free()
		await process_frame
		await physics_frame
		return true
	var car := packed.instantiate() as TrafficCar
	check(car != null, "traffic car instantiates for the yield test")
	if car == null:
		lane.queue_free()
		await process_frame
		await physics_frame
		return true
	root.add_child(car)
	car.setup(lane, 0.0, 9.0)
	for i in 90:
		await physics_frame
	check(car.speed_ms > 0.8 * 9.0, "traffic reaches cruise unblocked (%.2f)" % car.speed_ms)
	var blocker := StaticBody3D.new()
	blocker.name = "YieldTestBlocker"
	var bshape := CollisionShape3D.new()
	var bbox := BoxShape3D.new()
	bbox.size = Vector3(2, 2, 2)
	bshape.shape = bbox
	blocker.add_child(bshape)
	var fwd := -car.global_transform.basis.z
	var bp: Vector3 = car.global_position
	blocker.position = Vector3(bp.x, 1.0, bp.z) + fwd * 6.0
	root.add_child(blocker)
	for i in 90:
		await physics_frame
	check(car.speed_ms < 0.2 * 9.0, "traffic stops when blocked (%.2f)" % car.speed_ms)
	blocker.queue_free()
	await process_frame
	for i in 120:
		await physics_frame
		if car.speed_ms > 0.5 * 9.0:
			break
	check(car.speed_ms > 0.5 * 9.0, "traffic recovers when cleared (%.2f)" % car.speed_ms)
	car.queue_free()
	lane.queue_free()
	await process_frame
	await physics_frame
	return true

func ai_completes_loop_without_offroad() -> bool:
	var line := load("res://assets/city/test_line.tres") as RacingLine
	check(line != null, "test_line.tres loads as RacingLine")
	if line == null:
		return true
	check(line.points.size() == 20, "test oval has 20 waypoints (got %d)" % line.points.size())
	var speeds := line.target_speeds()
	check(speeds.size() == 20, "baked speeds cover all waypoints (got %d)" % speeds.size())
	var lo := 1e9
	var hi := -1e9
	for s in speeds:
		lo = minf(lo, s)
		hi = maxf(hi, s)
	check(lo >= 8.0 and hi <= 28.0, "baked speeds within [8, 28] (lo %.2f hi %.2f)" % [lo, hi])
	check(lo < hi, "corner minimum slower than straight maximum (%.2f < %.2f)" % [lo, hi])
	_release_inputs()
	if is_instance_valid(_car):
		_car.queue_free()
		_car = null
		await process_frame
		await physics_frame
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	check(packed != null, "ai_car.tscn loads as PackedScene")
	if packed == null:
		return true
	_car = packed.instantiate() as VehicleController
	check(_car != null, "AI car instantiates as VehicleController")
	if _car == null:
		return true
	check(_car.use_player_input == false, "AI car is field-driven")
	var brain := _car.get_node_or_null("AIRacerInput")
	check(brain != null, "AI car has an AIRacerInput child")
	root.add_child(_car)
	_car.global_transform = line.start_pose()
	for i in 5:
		await physics_frame
	var max_dev := 0.0
	var laps := 0
	for i in 5400:
		await physics_frame
		if not is_instance_valid(_car):
			break
		max_dev = maxf(max_dev, line.distance_to_center(_car.global_position))
		if brain != null and is_instance_valid(brain):
			laps = int(brain.get("laps_completed"))
			if laps >= 1:
				break
	check(laps >= 1, "AI completes one full loop (laps %d)" % laps)
	check(max_dev <= 4.5, "AI stays on road, max deviation <= 4.5 m (%.2f)" % max_dev)
	var up := Vector3.UP
	if is_instance_valid(_car):
		up = _car.global_transform.basis.y
	check(up.y > 0.5, "AI car stays upright (up.y %.3f)" % up.y)
	await _despawn_car()
	return true

func traffic_loops_without_error() -> bool:
	var packed := load("res://scenes/city/traffic_paths.tscn") as PackedScene
	check(packed != null, "traffic paths prefab loads for the loop test")
	if packed == null:
		return true
	var paths: Node = packed.instantiate()
	check(paths != null, "traffic paths instantiate for the loop test")
	if paths == null:
		return true
	root.add_child(paths)
	await process_frame
	await physics_frame
	var lane := paths.get_node_or_null("LaneLoop0") as Path3D
	check(lane != null and lane.curve != null, "LaneLoop0 provides a lane curve")
	if lane == null or lane.curve == null:
		paths.queue_free()
		await process_frame
		await physics_frame
		return true
	var length := lane.curve.get_baked_length()
	check(length > 100.0, "LaneLoop0 baked length exceeds 100 m (%.1f)" % length)
	var car_packed := load("res://scenes/vehicles/traffic_car.tscn") as PackedScene
	check(car_packed != null, "traffic car scene loads for the loop test")
	if car_packed == null:
		paths.queue_free()
		await process_frame
		await physics_frame
		return true
	var car := car_packed.instantiate() as TrafficCar
	check(car != null, "loop car instantiates")
	if car == null:
		paths.queue_free()
		await process_frame
		await physics_frame
		return true
	paths.add_child(car)
	car.setup(lane, length - 20.0, 9.0)
	var wrapped := false
	var prev := car.progress
	for i in 300:
		await physics_frame
		if not is_instance_valid(car):
			break
		if car.progress < prev:
			wrapped = true
		prev = car.progress
	check(is_instance_valid(car), "loop car survives 300 physics frames")
	if is_instance_valid(car):
		check(car.progress >= 0.0 and car.progress < length, "progress stays in [0, length) (%.2f / %.1f)" % [car.progress, length])
		check(wrapped, "loop car wraps past the closed-loop seam")
		var p: Vector3 = car.global_position
		check(absf(p.x) <= 140.0 and absf(p.z) <= 140.0, "loop car stays inside the district (%.1f, %.1f)" % [p.x, p.z])
		check(p.y > 0.0 and p.y < 5.0, "loop car holds lane height (y %.2f)" % p.y)
	paths.queue_free()
	await process_frame
	await physics_frame
	return true

func rubber_band_within_bounds() -> bool:
	var line := load("res://assets/city/test_line.tres") as RacingLine
	check(line != null, "test_line.tres loads for the rubber-band check")
	if line == null:
		return true
	check(RubberBand.compute_aid(0.0, 3.0) == 0.0, "zero gap yields zero aid")
	check(RubberBand.compute_aid(1000.0, 3.0) == 3.0, "huge deficit clamps to +max_aid_s")
	check(RubberBand.compute_aid(-1000.0, 3.0) == -3.0, "huge surplus clamps to -max_aid_s")
	var toggle := RubberBand.new()
	toggle.enabled = false
	check(toggle.aid_for(50.0) == 0.0, "disabled band yields zero aid")
	toggle.enabled = true
	check(toggle.aid_for(50.0) > 0.0, "enabled band aids a 50 m deficit")
	check(toggle.aid_for(50.0) <= 3.0, "enabled aid respects max_aid_s")
	toggle.free()
	var sweep_ok := true
	var g := -500.0
	while g <= 500.0:
		if absf(RubberBand.compute_aid(g, 3.0)) > 3.0 + 0.001:
			sweep_ok = false
		g += 5.0
	check(sweep_ok, "gap sweep stays within +/- max_aid_s")
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	check(packed != null, "ai_car.tscn loads for the rubber-band run")
	if packed == null:
		return true
	_release_inputs()
	if is_instance_valid(_car):
		_car.queue_free()
		_car = null
		await process_frame
		await physics_frame
	var total := line.track_length()
	# Rolling two-car duel, both starting on the opening straight with a 20 m
	# arc deficit: the chaser's proportional aid (1.6 m/s at 20 m) closes the
	# gap while both cars show their top speed on the straights ahead.
	var lead_s := 30.0
	var chase_s := 10.0
	var lead_p := line.point_at_arc(lead_s)
	var lead_d := line.point_at_arc(lead_s + 5.0) - lead_p
	lead_d.y = 0.0
	lead_d = lead_d.normalized()
	_car = packed.instantiate() as VehicleController
	check(_car != null, "band leader instantiates")
	if _car == null:
		return true
	root.add_child(_car)
	_car.global_transform = Transform3D(Basis(Vector3.UP, atan2(-lead_d.x, -lead_d.z)), lead_p + Vector3(0, 0.9, 0))
	_car.linear_velocity = lead_d * 18.0
	_car.add_to_group("racers")
	var band := _car.get_node_or_null("RubberBand")
	check(band != null, "AI car carries a RubberBand child")
	var chaser := packed.instantiate() as VehicleController
	root.add_child(chaser)
	var chase_p := line.point_at_arc(chase_s)
	var chase_d := line.point_at_arc(chase_s + 5.0) - chase_p
	chase_d.y = 0.0
	chase_d = chase_d.normalized()
	chaser.global_transform = Transform3D(Basis(Vector3.UP, atan2(-chase_d.x, -chase_d.z)), chase_p + Vector3(0, 0.9, 0))
	chaser.linear_velocity = chase_d * 18.0
	chaser.add_to_group("racers")
	var gap0 := fposmod(line.arc_of(_car.global_position) - line.arc_of(chaser.global_position), total)
	check(absf(gap0 - 20.0) < 1.0, "duel starts with a 20 m deficit (%.1f m)" % gap0)
	var leader_top := 0.0
	var chaser_top := 0.0
	for i in 500:
		await physics_frame
		if not is_instance_valid(_car) or not is_instance_valid(chaser):
			break
		leader_top = maxf(leader_top, _car.speed_ms)
		chaser_top = maxf(chaser_top, chaser.speed_ms)
	var gap1 := gap0
	if is_instance_valid(_car) and is_instance_valid(chaser):
		gap1 = fposmod(line.arc_of(_car.global_position) - line.arc_of(chaser.global_position), total)
	check(gap1 < gap0 - 5.0, "aided chaser closes the gap (%.1f m -> %.1f m)" % [gap0, gap1])
	var delta := absf(leader_top - line.max_speed) / line.max_speed
	check(delta <= 0.12, "leader max speed within 12%% of line top (%.2f m/s, delta %.1f%%)" % [leader_top, delta * 100.0])
	var chaser_delta := absf(chaser_top - line.max_speed) / line.max_speed
	check(chaser_delta <= 0.12, "aided chaser max speed within 12%% of line top (%.2f m/s, delta %.1f%%)" % [chaser_top, chaser_delta * 100.0])
	if is_instance_valid(chaser):
		chaser.queue_free()
		await process_frame
		await physics_frame
	await _despawn_car()
	return true

func race_four_ai_finish() -> bool:
	var line := load("res://assets/city/test_line.tres") as RacingLine
	check(line != null, "test_line.tres loads for the four-AI finish")
	if line == null:
		return true
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	check(packed != null, "ai_car.tscn loads for the four-AI finish")
	if packed == null:
		return true
	_release_inputs()
	if is_instance_valid(_car):
		_car.queue_free()
		_car = null
		await process_frame
		await physics_frame
	var backs: Array[float] = [0.0, 8.0, 16.0, 24.0]
	var sides: Array[float] = [0.0, -2.0, 2.0, 0.0]
	var total := line.track_length()
	var grid: Array[VehicleController] = []
	for i in 4:
		var c := packed.instantiate() as VehicleController
		root.add_child(c)
		# Stagger along arc length so every car starts on the loop.
		var gs := fposmod(-backs[i], total)
		var gp := line.point_at_arc(gs)
		var gd := line.point_at_arc(gs + 5.0) - gp
		gd.y = 0.0
		gd = gd.normalized()
		var gside := gd.cross(Vector3.UP).normalized()
		c.global_transform = Transform3D(Basis(Vector3.UP, atan2(-gd.x, -gd.z)), gp + Vector3(0, 0.9, 0) + gside * sides[i])
		c.add_to_group("racers")
		grid.append(c)
		if i == 0:
			_car = c
	var start_arcs: Array[float] = []
	for c in grid:
		start_arcs.append(line.arc_of(c.global_position))
	for i in 300:
		await physics_frame
	for i in grid.size():
		var c := grid[i]
		if not is_instance_valid(c):
			check(false, "AI car %d survives 300 physics frames" % i)
			continue
		var up: Vector3 = c.global_transform.basis.y
		check(up.y > 0.5, "AI car %d stays upright (up.y %.3f)" % [i, up.y])
		var advanced := fposmod(line.arc_of(c.global_position) - start_arcs[i], total)
		check(advanced > 5.0, "AI car %d advances from the grid (%.1f m)" % [i, advanced])
	print("AI_FINISHED")
	for c in grid:
		if is_instance_valid(c) and c != _car:
			c.queue_free()
	await _despawn_car()
	return true

func test_checkpoints_validate_in_order() -> bool:
	var dir := DirAccess.open("res://assets/events")
	check(dir != null, "assets/events directory opens")
	if dir == null:
		return true
	var stems: Array[String] = []
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if not dir.current_is_dir() and entry.ends_with(".tres"):
			stems.append(entry.get_basename())
		entry = dir.get_next()
	dir.list_dir_end()
	stems.sort()
	check(stems.size() == 5, "assets/events holds exactly 5 .tres files (got %d)" % stems.size())
	var wanted: Array[String] = ["alley_sprint", "bayline_circuit", "downtown_gp", "harbor_sprint", "neon_loop"]
	for w in wanted:
		check(stems.has(w), "event resource present: %s" % w)
	for stem in stems:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		check(ev != null, "%s loads as RaceEvent" % stem)
		if ev == null:
			continue
		check(ev.route_id == stem, "%s route_id matches stem (got %s)" % [stem, ev.route_id])
		check(RaceEvent.validate(ev), "%s passes RaceEvent.validate()" % stem)
		check(ev.checkpoint_radius >= RaceEvent.CHECKPOINT_RADIUS_MIN and ev.checkpoint_radius <= RaceEvent.CHECKPOINT_RADIUS_MAX, "%s radius in range (%.1f)" % [stem, ev.checkpoint_radius])
		if RaceEvent.is_sprint(ev):
			check(ev.laps == RaceEvent.SPRINT_LAPS, "%s sprint encodes 1 lap (got %d)" % [stem, ev.laps])
		else:
			check(RaceEvent.is_circuit(ev), "%s non-sprint is a circuit" % stem)
			check(ev.laps >= RaceEvent.CIRCUIT_LAPS_MIN, "%s circuit encodes 2+ laps (got %d)" % [stem, ev.laps])
		var count := ev.checkpoints.size()
		check(count >= RaceEvent.CHECKPOINT_COUNT_MIN, "%s has >= 4 gates (got %d)" % [stem, count])
		var last := -1
		for i in count:
			var nxt: int = RaceEvent.next_index(last, ev)
			check(nxt == i, "%s gate %d is next after %d" % [stem, i, last])
			check(RaceEvent.is_correct_hit(i, last, ev), "%s gate %d validates in order" % [stem, i])
			check(not RaceEvent.is_wrong_way(i, last, ev), "%s expected gate %d is not wrong-way" % [stem, i])
			var prev := last
			last = i
			if i == count - 1 and RaceEvent.is_circuit(ev):
				check(RaceEvent.completes_lap(i, prev, ev), "%s final gate completes the lap" % stem)
		if RaceEvent.is_circuit(ev):
			check(RaceEvent.next_index(last, ev) == 0, "%s circuit wraps to gate 0" % stem)
		else:
			check(RaceEvent.next_index(last, ev) == -1, "%s sprint finishes (-1)" % stem)
			check(not RaceEvent.completes_lap(last, count - 2, ev), "%s sprint finish is not a lap" % stem)
	var gate_packed = load("res://scenes/races/checkpoint.tscn")
	check(gate_packed is PackedScene, "checkpoint.tscn loads as PackedScene")
	if gate_packed is PackedScene:
		var gate: Node = (gate_packed as PackedScene).instantiate()
		check(gate != null, "checkpoint gate instantiates")
		if gate != null:
			check(gate is Checkpoint, "checkpoint root is a Checkpoint")
			check(gate.has_signal("passed"), "checkpoint exposes passed signal")
			check(gate.get_node_or_null("CollisionShape3D") != null, "checkpoint has a CollisionShape3D")
			check(gate.get_node_or_null("MeshInstance3D") != null, "checkpoint has a MeshInstance3D")
			gate.free()
	var routes: Array[String] = ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]
	for stem in routes:
		var packed = load("res://scenes/races/route_%s.tscn" % stem)
		check(packed is PackedScene, "route_%s.tscn loads as PackedScene" % stem)
		if not (packed is PackedScene):
			continue
		var inst: Node = (packed as PackedScene).instantiate()
		check(inst != null, "route_%s instantiates" % stem)
		if inst == null:
			continue
		check(inst is RaceRoute, "route_%s root is a RaceRoute" % stem)
		root.add_child(inst)
		await process_frame
		var route := inst as RaceRoute
		if route != null and route.event != null:
			check(route.gate_count() == route.event.checkpoints.size(), "route_%s spawns one gate per checkpoint (%d)" % [stem, route.gate_count()])
		root.remove_child(inst)
		inst.free()
	return true

func test_wrong_way_detected() -> bool:
	var ev := load("res://assets/events/downtown_gp.tres") as RaceEvent
	check(ev != null, "downtown_gp loads for the wrong-way check")
	if ev == null:
		return true
	var count := ev.checkpoints.size()
	check(count >= 4, "circuit has >= 4 gates (got %d)" % count)
	check(RaceEvent.is_wrong_way(2, -1, ev), "skipping to gate 2 at start is wrong-way")
	check(not RaceEvent.is_correct_hit(2, -1, ev), "skipped gate 2 is not a correct hit")
	check(not RaceEvent.is_wrong_way(0, -1, ev), "expected gate 0 at start is not wrong-way")
	check(RaceEvent.is_correct_hit(0, -1, ev), "gate 0 at start is a correct hit")
	check(not RaceEvent.is_wrong_way(0, 0, ev), "duplicate of last gate is not wrong-way")
	check(not RaceEvent.is_correct_hit(0, 0, ev), "duplicate hit is not a correct hit")
	check(RaceEvent.is_wrong_way(3, 1, ev), "skipping from gate 1 to gate 3 is wrong-way")
	check(RaceEvent.is_wrong_way(0, 2, ev), "going backward from gate 2 to gate 0 is wrong-way")
	check(not RaceEvent.is_wrong_way(2, 1, ev), "expected gate 2 after gate 1 is not wrong-way")
	check(not RaceEvent.is_wrong_way(0, count - 1, ev), "lap wrap to gate 0 is not wrong-way")
	check(not RaceEvent.is_wrong_way(-1, 1, ev), "sentinel hit is not wrong-way")
	check(not RaceEvent.is_wrong_way(count, 1, ev), "out-of-range hit is not wrong-way")
	var sprint := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	check(sprint != null, "harbor_sprint loads for the wrong-way check")
	if sprint != null:
		check(RaceEvent.is_wrong_way(3, 0, sprint), "sprint skip from gate 0 to gate 3 is wrong-way")
		check(not RaceEvent.is_wrong_way(1, 0, sprint), "sprint expected gate 1 is not wrong-way")
	var car := Vector3(0, 1, 0)
	var nxt := Vector3(10, 1, 0)
	check(not RaceEvent.is_moving_wrong_way(Vector3(5, 0, 0), car, nxt), "driving toward the next gate is not wrong-way")
	check(RaceEvent.is_moving_wrong_way(Vector3(-5, 0, 0), car, nxt), "driving away from the next gate is wrong-way")
	check(not RaceEvent.is_moving_wrong_way(Vector3.ZERO, car, nxt), "standing still is not wrong-way")
	return true

func tunes_in_range() -> bool:
	var names: Array[String] = ["default_tune", "sport_tune", "drift_tune", "drag_tune"]
	for n: String in names:
		var tune := load("res://assets/cars/tunes/%s.tres" % n) as CarTune
		check(tune != null, "%s loads as CarTune" % n)
		if tune == null:
			continue
		check(CarTune.validate(tune), "%s passes CarTune.validate()" % n)
		check(tune.engine_torque >= CarTune.ENGINE_TORQUE_MIN and tune.engine_torque <= CarTune.ENGINE_TORQUE_MAX, "%s torque in range (%.1f Nm)" % [n, tune.engine_torque])
		check(tune.gear_ratios.size() >= CarTune.GEAR_COUNT_MIN and tune.gear_ratios.size() <= CarTune.GEAR_COUNT_MAX, "%s has 4-6 ratios (got %d)" % [n, tune.gear_ratios.size()])
		for i in tune.gear_ratios.size():
			var ratio: float = tune.gear_ratios[i]
			check(ratio >= CarTune.GEAR_RATIO_MIN and ratio <= CarTune.GEAR_RATIO_MAX, "%s ratio %d in range (%.2f)" % [n, i, ratio])
			if i > 0:
				check(tune.gear_ratios[i - 1] > ratio, "%s ratios strictly decreasing at %d (%.2f > %.2f)" % [n, i, tune.gear_ratios[i - 1], ratio])
		check(tune.final_drive >= CarTune.FINAL_DRIVE_MIN and tune.final_drive <= CarTune.FINAL_DRIVE_MAX, "%s final drive in range (%.2f)" % [n, tune.final_drive])
		check(tune.tire_grip_front >= CarTune.TIRE_GRIP_MIN and tune.tire_grip_front <= CarTune.TIRE_GRIP_MAX, "%s front grip in range (%.2f)" % [n, tune.tire_grip_front])
		check(tune.tire_grip_rear >= CarTune.TIRE_GRIP_MIN and tune.tire_grip_rear <= CarTune.TIRE_GRIP_MAX, "%s rear grip in range (%.2f)" % [n, tune.tire_grip_rear])
		check(tune.roll_stiffness_front >= CarTune.ROLL_STIFFNESS_MIN and tune.roll_stiffness_front <= CarTune.ROLL_STIFFNESS_MAX, "%s front roll stiffness in range (%.0f)" % [n, tune.roll_stiffness_front])
		check(tune.roll_stiffness_rear >= CarTune.ROLL_STIFFNESS_MIN and tune.roll_stiffness_rear <= CarTune.ROLL_STIFFNESS_MAX, "%s rear roll stiffness in range (%.0f)" % [n, tune.roll_stiffness_rear])
		check(tune.downforce_coefficient >= CarTune.DOWNFORCE_MIN and tune.downforce_coefficient <= CarTune.DOWNFORCE_MAX, "%s downforce in range (%.2f)" % [n, tune.downforce_coefficient])
		check(tune.drivetrain >= CarTune.DRIVETRAIN_MIN and tune.drivetrain <= CarTune.DRIVETRAIN_MAX, "%s drivetrain in range (got %d)" % [n, tune.drivetrain])
	return true

func four_tunes_distinct() -> bool:
	var names: Array[String] = ["default_tune", "sport_tune", "drift_tune", "drag_tune"]
	var times := {}
	for n: String in names:
		var tune := load("res://assets/cars/tunes/%s.tres" % n) as CarTune
		check(tune != null, "%s loads as CarTune" % n)
		if tune == null:
			continue
		var probe := VehicleController.new()
		probe.mass = 1200.0
		probe.tune = tune
		probe.apply_tune()
		times[n] = _simulate_zero_to_hundred(probe, tune)
		probe.free()
		check(float(times[n]) > 0.0 and float(times[n]) < 120.0, "%s reaches 100 km/h (%.2f s)" % [n, float(times[n])])
	for i in names.size():
		for j in range(i + 1, names.size()):
			if not times.has(names[i]) or not times.has(names[j]):
				continue
			var a: float = times[names[i]]
			var b: float = times[names[j]]
			var denom := maxf(a, b)
			check(denom > 0.0 and absf(a - b) / denom >= 0.03, "%s vs %s differ by >= 3%% (%.2f s vs %.2f s)" % [names[i], names[j], a, b])
	return true

func _simulate_zero_to_hundred(probe: VehicleController, tune: CarTune) -> float:
	# Headless 0-100 km/h personality sim: full throttle at 60 Hz, upshifts at
	# 5500 rpm, drive force from the tune's torque curve capped by
	# driven-axle traction, minus the controller's drag and rolling terms.
	var speed := 0.0
	var time := 0.0
	var gear := 1
	var dt := 1.0 / 60.0
	var count := probe.gear_ratios.size()
	var mean_grip := (tune.tire_grip_front + tune.tire_grip_rear) * 0.5
	var static_load := probe.mass * 9.81 / 4.0
	var traction := float(probe._driven_wheel_count()) * mean_grip * static_load
	while speed < 27.78 and time < 120.0:
		var ratio: float = probe.gear_ratios[clampi(gear - 1, 0, count - 1)]
		var rpm := clampf(maxf(800.0, absf(speed) / (TAU * probe.wheel_radius) * ratio * probe.final_drive * 60.0), 800.0, probe.max_engine_rpm)
		if rpm >= 5500.0 and gear < count:
			gear += 1
			ratio = probe.gear_ratios[clampi(gear - 1, 0, count - 1)]
			rpm = clampf(maxf(800.0, absf(speed) / (TAU * probe.wheel_radius) * ratio * probe.final_drive * 60.0), 800.0, probe.max_engine_rpm)
		var force := probe._sample_torque(rpm) * ratio * probe.final_drive / probe.wheel_radius
		force = minf(force, traction) - (probe.drag_linear * speed + probe.drag_quadratic * speed * speed)
		if speed > 0.1:
			force -= probe.rolling_resistance
		speed += force / probe.mass * dt
		time += dt
	return time

func countdown_sequence_3s() -> bool:
	var ev := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	check(ev != null, "harbor_sprint loads for the countdown check")
	if ev == null:
		return true
	check(RaceEvent.validate(ev), "harbor_sprint validates for the countdown check")
	var mgr := RaceEventManager.new()
	check(mgr != null, "RaceEventManager instantiates standalone")
	if mgr == null:
		return true
	mgr.event = ev
	mgr.autostart = false
	root.add_child(mgr)
	await process_frame
	var ticks: Array[int] = []
	var started := [false]
	mgr.countdown_tick.connect(func(seconds_left: int) -> void: ticks.append(seconds_left))
	mgr.race_started.connect(func() -> void: started[0] = true)
	check(mgr.state == RaceEventManager.State.COUNTDOWN, "fresh manager starts in COUNTDOWN")
	check(not mgr.can_drive(), "can_drive is false during COUNTDOWN")
	mgr.start_race()
	check(mgr.state == RaceEventManager.State.COUNTDOWN, "start_race arms COUNTDOWN")
	check(mgr.total_laps == ev.laps, "total laps come from event (got %d)" % mgr.total_laps)
	check(mgr.race_time == 0.0, "race clock is zero during COUNTDOWN")
	check(not mgr.can_drive(), "can_drive stays false during COUNTDOWN")
	var fresh := RaceEventManager.new()
	fresh.event = ev
	fresh.autostart = false
	root.add_child(fresh)
	await process_frame
	fresh.start_race()
	var ignored := fresh.register_hit(0)
	check(ignored == false, "gate hit during COUNTDOWN is ignored")
	check(fresh.current_lap == 0, "COUNTDOWN hit never counts a lap")
	check(fresh.wrong_way == false, "COUNTDOWN hit never sets wrong-way")
	check(fresh.state == RaceEventManager.State.COUNTDOWN, "COUNTDOWN hit keeps COUNTDOWN")
	var ignored_skip := fresh.register_hit(3)
	check(ignored_skip == false, "skipped gate during COUNTDOWN is ignored")
	check(fresh.wrong_way == false, "skipped COUNTDOWN hit never sets wrong-way")
	for i in 200:
		await physics_frame
		if mgr.state == RaceEventManager.State.RACING:
			break
	check(mgr.state == RaceEventManager.State.RACING, "reaches RACING within 200 physics frames")
	check(started[0], "race_started emitted at GO")
	check(ticks.size() == 3, "countdown_tick fired 3 times (got %d)" % ticks.size())
	if ticks.size() == 3:
		check(ticks[0] == 3, "first tick is 3 (got %d)" % ticks[0])
		check(ticks[1] == 2, "second tick is 2 (got %d)" % ticks[1])
		check(ticks[2] == 1, "third tick is 1 (got %d)" % ticks[2])
	else:
		check(ticks.has(3), "countdown_tick saw 3")
		check(ticks.has(2), "countdown_tick saw 2")
		check(ticks.has(1), "countdown_tick saw 1")
	check(mgr.can_drive(), "can_drive is true in RACING")
	for i in 30:
		await physics_frame
	check(mgr.race_time > 0.0, "race clock runs in RACING (%.3f)" % mgr.race_time)
	var t0: float = mgr.race_time
	for i in 30:
		await physics_frame
	check(mgr.race_time > t0, "race_time advances while RACING (%.3f > %.3f)" % [mgr.race_time, t0])
	fresh.queue_free()
	mgr.queue_free()
	await process_frame
	await physics_frame
	return true

func lap_counting_increments() -> bool:
	var ev := load("res://assets/events/downtown_gp.tres") as RaceEvent
	check(ev != null, "downtown_gp loads for the lap check")
	if ev == null:
		return true
	check(RaceEvent.validate(ev), "downtown_gp validates for the lap check")
	check(RaceEvent.is_circuit(ev), "downtown_gp is a circuit")
	var count := ev.checkpoints.size()
	check(count >= 4, "circuit has >= 4 gates (got %d)" % count)
	var mgr := RaceEventManager.new()
	check(mgr != null, "RaceEventManager instantiates for the lap check")
	if mgr == null:
		return true
	mgr.event = ev
	mgr.autostart = false
	root.add_child(mgr)
	await process_frame
	var laps: Array[int] = []
	var finished := [false]
	mgr.lap_completed.connect(func(lap_number: int) -> void: laps.append(lap_number))
	mgr.race_finished.connect(func() -> void: finished[0] = true)
	mgr.start_race()
	for i in 300:
		await physics_frame
		if mgr.state == RaceEventManager.State.RACING:
			break
	check(mgr.state == RaceEventManager.State.RACING, "manager reaches RACING before lap hits")
	check(mgr.total_laps == ev.laps, "total laps match event (got %d)" % mgr.total_laps)
	var last := -1
	for i in count:
		var nxt: int = RaceEvent.next_index(last, ev)
		check(nxt == i, "lap 1 gate %d is next after %d" % [i, last])
		var ok := mgr.register_hit(nxt)
		check(ok, "lap 1 gate %d validates in order" % nxt)
		last = nxt
	check(mgr.current_lap == 1, "in-order gates increment to lap 1 (got %d)" % mgr.current_lap)
	check(laps.has(1), "lap_completed emitted for lap 1")
	check(mgr.state == RaceEventManager.State.RACING, "mid-race stays RACING after lap 1")
	check(not finished[0], "race_finished not emitted mid-race")
	for lap in range(1, ev.laps):
		for i in count:
			var want: int = RaceEvent.next_index(last, ev)
			var good := mgr.register_hit(want)
			check(good, "lap %d gate %d validates" % [lap + 1, want])
			last = want
		check(mgr.current_lap == lap + 1, "lap counter reaches %d (got %d)" % [lap + 1, mgr.current_lap])
		check(laps.has(lap + 1), "lap_completed emitted for lap %d" % (lap + 1))
	check(mgr.state == RaceEventManager.State.FINISHED, "final lap reaches FINISHED")
	check(finished[0], "race_finished emitted on the final lap")
	check(mgr.current_lap == ev.laps, "lap counter stops at total laps (%d)" % mgr.current_lap)
	check(not mgr.can_drive(), "can_drive is false after FINISHED")
	var tail := mgr.register_hit(0)
	check(tail == false, "gate hit after FINISHED is ignored")
	check(mgr.current_lap == ev.laps, "post-finish hit never counts a lap")
	var car := await _spawn_car(Vector3(0, 0.9, 0))
	var saved_lap := mgr.current_lap
	var saved_time: float = mgr.race_time
	var saved_state := mgr.state
	car.reset_vehicle()
	for i in 60:
		await physics_frame
	check(is_instance_valid(car), "car survives reset_vehicle during a finished race")
	check(mgr.state == saved_state, "car reset keeps race state valid")
	check(mgr.current_lap == saved_lap, "car reset keeps lap count valid (%d)" % mgr.current_lap)
	check(absf(mgr.race_time - saved_time) < 0.001, "car reset keeps race clock valid (%.3f)" % mgr.race_time)
	await _despawn_car()
	mgr.queue_free()
	await process_frame
	await physics_frame
	return true

func positions_sort_by_progress() -> bool:
	var sprint := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	check(sprint != null, "harbor_sprint loads for the positions check")
	if sprint == null:
		return true
	var circuit := load("res://assets/events/downtown_gp.tres") as RaceEvent
	check(circuit != null, "downtown_gp loads for the positions check")
	if circuit == null:
		return true
	var total_s := sprint.checkpoints.size()
	var total_c := circuit.checkpoints.size()
	check(total_s >= 4, "sprint has >= 4 gates (got %d)" % total_s)
	check(total_c >= 4, "circuit has >= 4 gates (got %d)" % total_c)
	var lap_top := RacePositions.progress(0, total_c - 1, 0.9, total_c)
	var lap_next := RacePositions.progress(1, 0, 0.0, total_c)
	check(lap_next > lap_top, "lap beats idx (%.2f > %.2f)" % [lap_next, lap_top])
	var near := RacePositions.progress(0, 1, 0.9, total_c)
	var ahead := RacePositions.progress(0, 2, 0.0, total_c)
	check(ahead > near, "idx beats frac (%.2f > %.2f)" % [ahead, near])
	check(RacePositions.progress(0, 1, -0.5, total_c) == RacePositions.progress(0, 1, 0.0, total_c), "frac clamps low")
	check(RacePositions.progress(0, 1, 2.0, total_c) == RacePositions.progress(0, 1, 1.0, total_c), "frac clamps high")
	check(RacePositions.progress(0, -1, 0.5, total_c) < RacePositions.progress(0, 0, 0.0, total_c), "start sentinel stays below gate 0")
	var prev := Vector3(0, 1, 0)
	var nxt := Vector3(10, 1, 0)
	check(absf(RacePositions.fraction_to_next(Vector3(5, 1, 0), prev, nxt) - 0.5) < 0.001, "mid-segment projects to 0.5")
	check(absf(RacePositions.fraction_to_next(prev, prev, nxt) - 0.0) < 0.001, "segment start projects to 0.0")
	check(absf(RacePositions.fraction_to_next(Vector3(20, 5, 3), prev, nxt) - 1.0) < 0.001, "past-segment clamps to 1.0")
	check(RacePositions.fraction_to_next(Vector3(5, 99, -3), prev, prev) == 0.0, "degenerate segment yields 0.0")
	var sprint_mid := RacePositions.progress(0, total_s - 2, 1.0, total_s)
	var sprint_done := RacePositions.progress(0, total_s - 1, 1.0, total_s)
	check(sprint_done > sprint_mid, "sprint finish outranks mid-race (%.2f > %.2f)" % [sprint_done, sprint_mid])
	var entries: Array = [
		{"id": "leader", "progress": RacePositions.progress(1, 0, 0.2, total_c)},
		{"id": "mid", "progress": RacePositions.progress(0, 3, 0.9, total_c)},
		{"id": "back", "progress": RacePositions.progress(0, -1, 0.0, total_c)},
	]
	var order := RacePositions.standings_for(entries)
	check(order.size() == 3, "standings hold 3 racers (got %d)" % order.size())
	if order.size() == 3:
		check(str((order[0] as Dictionary)["id"]) == "leader", "leader tops standings")
		check(str((order[1] as Dictionary)["id"]) == "mid", "mid holds second")
		check(str((order[2] as Dictionary)["id"]) == "back", "start sentinel sinks to last")
	check(str((entries[0] as Dictionary)["id"]) == "leader", "standings input keeps order")
	check(str((entries[2] as Dictionary)["id"]) == "back", "standings input not mutated")
	var tie: Array = [{"id": "a", "progress": 5.0}, {"id": "b", "progress": 5.0}, {"id": "c", "progress": 6.0}]
	var tied := RacePositions.standings_for(tie)
	check(str((tied[0] as Dictionary)["id"]) == "c", "higher progress wins the tie group")
	check(str((tied[1] as Dictionary)["id"]) == "a", "tie keeps first-recorded order")
	check(str((tied[2] as Dictionary)["id"]) == "b", "tie sinks the later entry")
	var messy: Array = [{"id": "good", "progress": 10.0}, {"id": "broken"}]
	var ranked := RacePositions.standings_for(messy)
	check(str((ranked[0] as Dictionary)["id"]) == "good", "scored entry outranks malformed one")
	check(str((ranked[1] as Dictionary)["id"]) == "broken", "malformed entry sinks without crashing")
	return true

func results_hold_all_finishers() -> bool:
	var table := RacePositions.new()
	check(table != null, "RacePositions instantiates standalone")
	if table == null:
		return true
	table.record_finish("ai_2", 95.5)
	table.record_finish("player", 88.2)
	table.record_finish("ai_1", 91.0)
	table.record_finish("ai_3", 102.7)
	check(table.size() == 4, "results hold 4 finishers (got %d)" % table.size())
	var ordered := table.ordered_results()
	check(ordered.size() == 4, "ordered results hold 4 rows (got %d)" % ordered.size())
	if ordered.size() == 4:
		check(str((ordered[0] as Dictionary)["racer"]) == "player", "fastest finisher is player")
		check(str((ordered[1] as Dictionary)["racer"]) == "ai_1", "second finisher is ai_1")
		check(str((ordered[2] as Dictionary)["racer"]) == "ai_2", "third finisher is ai_2")
		check(str((ordered[3] as Dictionary)["racer"]) == "ai_3", "slowest finisher is ai_3")
		check(int((ordered[0] as Dictionary)["place"]) == 1, "winner takes place 1")
		check(int((ordered[1] as Dictionary)["place"]) == 2, "runner-up takes place 2")
		check(int((ordered[2] as Dictionary)["place"]) == 3, "third takes place 3")
		check(int((ordered[3] as Dictionary)["place"]) == 4, "last takes place 4")
		check(absf(float((ordered[0] as Dictionary)["time_s"]) - 88.2) < 0.001, "winner time kept (%.2f)" % float((ordered[0] as Dictionary)["time_s"]))
	check(table.place_of("player") == 1, "place_of matches the winner")
	check(table.place_of("ai_1") == 2, "place_of matches second")
	check(table.place_of("ai_2") == 3, "place_of matches third")
	check(table.place_of("ai_3") == 4, "place_of matches last")
	var dup := table.record_finish("player", 70.0)
	check(dup == 1, "duplicate keeps the existing place (got %d)" % dup)
	check(table.size() == 4, "duplicate never adds a row")
	check(absf(float(((table.ordered_results()[0]) as Dictionary)["time_s"]) - 88.2) < 0.001, "duplicate keeps the first time")
	var bad := table.record_finish("ghost", -5.0)
	check(bad == 0, "negative time is ignored (got %d)" % bad)
	check(table.size() == 4, "negative time never adds a row")
	check(table.place_of("ghost") == 0, "ignored racer has no place")
	table.record_finish("", 50.0)
	check(table.size() == 4, "empty id never adds a row")
	table.clear()
	check(table.size() == 0, "clear empties the table")
	check(table.ordered_results().is_empty(), "ordered results empty after clear")
	check(table.place_of("player") == 0, "no place survives clear")
	return true

func test_car_kit_glb_present() -> bool:
	var stems: Array[String] = ["coupe", "hatch", "sedan", "awd"]
	var base := DirAccess.open("res://assets/cars")
	check(base != null, "assets/cars directory opens")
	if base == null:
		return true
	var with_glb := 0
	base.list_dir_begin()
	var entry := base.get_next()
	while entry != "":
		if base.current_is_dir() and not entry.begins_with("."):
			if FileAccess.file_exists("res://assets/cars/%s/%s.glb" % [entry, entry]):
				with_glb += 1
		entry = base.get_next()
	base.list_dir_end()
	check(with_glb == 4, "assets/cars holds 4 subfolders each with a .glb (got %d)" % with_glb)
	for stem in stems:
		check(DirAccess.open("res://assets/cars/%s" % stem) != null, "car folder exists: %s" % stem)
		var path := "res://assets/cars/%s/%s.glb" % [stem, stem]
		check(FileAccess.file_exists(path), "car body vendored: %s" % path)
		var packed = load(path)
		check(packed is PackedScene, "car %s loads as PackedScene" % stem)
		if packed is PackedScene:
			var inst: Node = (packed as PackedScene).instantiate()
			check(inst != null, "car %s instantiates" % stem)
			if inst != null:
				inst.free()
	return true

func test_car_kit_credits() -> bool:
	check(FileAccess.file_exists("res://docs/CREDITS"), "docs/CREDITS exists")
	var text := ""
	if FileAccess.file_exists("res://docs/CREDITS"):
		text = FileAccess.get_file_as_string("res://docs/CREDITS")
	check(text.contains("Sketchfab"), "CREDITS names Sketchfab")
	check(text.contains("Grab3D"), "CREDITS names Grab3D")
	check(text.contains("CC0"), "CREDITS records the CC0 license")
	check(text.contains("No third-party file is vendored"), "CREDITS states no third-party file is vendored")
	var stems: Array[String] = ["coupe", "hatch", "sedan", "awd"]
	for stem in stems:
		check(text.contains("car_" + stem) or text.contains("/" + stem + "/"), "CREDITS covers car_" + stem)
	check(text.contains("https://sketchfab.com/3d-models/free-concept-car-006-public-domain-cc0-a4e19bb6e6394c4a95d4319ef7d265ba"), "CREDITS pins the coupe URL")
	check(text.contains("https://sketchfab.com/3d-models/lowpoly-car-05d3cd418d334b55b4dc3f92a67bcb8c"), "CREDITS pins the hatch URL")
	check(text.contains("https://sketchfab.com/3d-models/free-low-poly-vehicles-pack-cb7640039e7a40679a53be705ebff50e"), "CREDITS pins the sedan URL")
	check(text.contains("https://grab3d.com/free-3d-models/car/"), "CREDITS pins the awd URL")
	return true

func test_car_scenes_load() -> bool:
	var stems: Array[String] = ["coupe", "hatch", "sedan", "awd"]
	var tunes := {
		"coupe": "res://assets/cars/tunes/sport_tune.tres",
		"hatch": "res://assets/cars/tunes/drift_tune.tres",
		"sedan": "res://assets/cars/tunes/default_tune.tres",
		"awd": "res://assets/cars/tunes/drag_tune.tres",
	}
	var modes := {
		"coupe": VehicleController.DriveMode.FWD,
		"hatch": VehicleController.DriveMode.RWD,
		"sedan": VehicleController.DriveMode.RWD,
		"awd": VehicleController.DriveMode.AWD,
	}
	var paints := {
		"coupe": 0,
		"hatch": 1,
		"sedan": 2,
		"awd": 3,
	}
	var wheels := {
		"WheelFL": Vector3(-0.85, 0, -1.35),
		"WheelFR": Vector3(0.85, 0, -1.35),
		"WheelRL": Vector3(-0.85, 0, 1.35),
		"WheelRR": Vector3(0.85, 0, 1.35),
	}
	for stem in stems:
		var path := "res://scenes/vehicles/car_%s.tscn" % stem
		var packed = load(path)
		check(packed is PackedScene, "car_%s.tscn loads as PackedScene" % stem)
		if not (packed is PackedScene):
			continue
		var inst := (packed as PackedScene).instantiate() as VehicleController
		check(inst != null, "car_%s instantiates a VehicleController" % stem)
		if inst == null:
			continue
		var rays := 0
		for child in inst.get_children():
			if child is RayCast3D:
				rays += 1
		check(rays == 4, "car_%s has exactly 4 RayCast3D wheels (got %d)" % [stem, rays])
		for wname in wheels.keys():
			var ray := inst.get_node_or_null(str(wname)) as RayCast3D
			check(ray != null, "car_%s keeps %s" % [stem, str(wname)])
			if ray != null:
				check(ray.position == wheels[wname], "car_%s %s at the rig position" % [stem, str(wname)])
				check(ray.target_position == Vector3(0, -0.65, 0), "car_%s %s keeps the 0.65 m ray" % [stem, str(wname)])
		var col := inst.get_node_or_null("CollisionShape3D") as CollisionShape3D
		check(col != null, "car_%s keeps its CollisionShape3D" % stem)
		if col != null:
			check(col.position == Vector3(0, 0.25, 0), "car_%s collision rides at y 0.25" % stem)
			var box := col.shape as BoxShape3D
			check(box != null and box.size == Vector3(1.8, 0.5, 4.2), "car_%s collision spans 1.8 x 0.5 x 4.2" % stem)
		check(inst.get_node_or_null("Body") != null, "car_%s instances its Body" % stem)
		var paint := inst.get_node_or_null("CarPaint")
		check(paint != null, "car_%s has a CarPaint child" % stem)
		if paint != null:
			check(paint.get("color_index") != null, "car_%s CarPaint exposes a color_index" % stem)
			check(int(paint.get("color_index")) == int(paints[stem]), "car_%s color_index matches (got %d)" % [stem, int(paint.get("color_index"))])
			check(CarPaint.COLORS.size() >= 3, "car_%s palette holds >= 3 variants (got %d)" % [stem, CarPaint.COLORS.size()])
		check(inst.tune != null, "car_%s has a non-null tune" % stem)
		if inst.tune != null:
			check(CarTune.validate(inst.tune), "car_%s tune passes CarTune.validate()" % stem)
			check(inst.tune.resource_path == str(tunes[stem]), "car_%s uses %s" % [stem, str(tunes[stem])])
		check(int(inst.drive_mode) == int(modes[stem]), "car_%s drive_mode matches (got %d)" % [stem, int(inst.drive_mode)])
		root.add_child(inst)
		inst.global_transform = Transform3D(Basis(), Vector3(0, 0.9, 0))
		for i in 60:
			await physics_frame
		check(is_instance_valid(inst), "car_%s survives 60 physics frames" % stem)
		if is_instance_valid(inst):
			var up: Vector3 = inst.global_transform.basis.y
			check(up.y > 0.5, "car_%s stays upright on the slab (up.y %.3f)" % [stem, up.y])
			check(inst.global_position.y > 0.0 and inst.global_position.y < 2.0, "car_%s parks at sane height (y %.2f)" % [stem, inst.global_position.y])
			root.remove_child(inst)
			inst.queue_free()
			await process_frame
			await physics_frame
	return true

func hud_subscribes_to_race_signals() -> bool:
	var packed = load("res://scenes/ui/hud.tscn")
	check(packed is PackedScene, "hud.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	check(instance != null, "hud instantiates")
	if instance == null:
		return true
	check(instance.get_script() != null, "hud root carries the HUD script")
	for label_name in ["SpeedLabel", "GearLabel", "PositionLabel", "TimerLabel", "DriftPopup", "Minimap"]:
		check(instance.get_node_or_null(label_name) != null, "hud has %s" % label_name)
	check(instance.get_node_or_null("Minimap/SubViewport") is SubViewport, "minimap hosts a SubViewport")
	var drift := instance.get_node_or_null("DriftPopup") as Label
	check(drift != null and drift.visible == false, "drift popup starts hidden")
	root.add_child(instance)
	await process_frame
	await process_frame
	check(instance.has_method("set_speed"), "hud exposes set_speed")
	check(instance.has_method("set_gear"), "hud exposes set_gear")
	check(instance.has_method("set_lap_position"), "hud exposes set_lap_position")
	check(instance.has_method("set_race_time"), "hud exposes set_race_time")
	check(instance.has_method("show_drift"), "hud exposes show_drift")
	instance.call("set_speed", 20.0)
	check((instance.get_node_or_null("SpeedLabel") as Label).text == "72 km/h", "speed formats m/s to km/h")
	instance.call("set_gear", 3, false)
	check((instance.get_node_or_null("GearLabel") as Label).text == "3", "gear shows the gear number")
	instance.call("set_gear", 2, true)
	check((instance.get_node_or_null("GearLabel") as Label).text == "R", "gear shows R while reversing")
	instance.call("set_lap_position", 2, 4, 2, 3)
	check((instance.get_node_or_null("PositionLabel") as Label).text == "P2/4  LAP 2/3", "position/lap formats P2/4 LAP 2/3")
	instance.call("set_race_time", 65.5)
	check((instance.get_node_or_null("TimerLabel") as Label).text == "01:05.500", "timer formats mm:ss.mmm")
	instance.call("show_drift", 250)
	check((instance.get_node_or_null("DriftPopup") as Label).text == "DRIFT +250", "drift popup shows the score")
	check((instance.get_node_or_null("DriftPopup") as Label).visible == true, "drift popup shows on score")
	instance.call("set_minimap_player", Vector2(0.5, 0.5))
	var dot := instance.get_node_or_null("Minimap/SubViewport/PlayerDot") as ColorRect
	check(dot != null and absf(dot.position.x - 97.0) < 0.5 and absf(dot.position.y - 97.0) < 0.5, "player marker centers at 0.5,0.5")
	instance.call("set_minimap_checkpoints", [Vector2(0, 0), Vector2(1, 1)])
	var layer := instance.get_node_or_null("Minimap/SubViewport/CheckpointLayer")
	check(layer != null and layer.get_child_count() == 2, "checkpoint markers spawn from pushed points")
	var src := FileAccess.get_file_as_string("res://scripts/ui/hud.gd")
	check(src.contains("connect"), "hud script subscribes via connect")
	check(src.contains("HUD_READY"), "hud script prints HUD_READY")
	for banned in ["_physics_process", "apply_force", "apply_central_force", "linear_velocity", "angular_velocity", "RayCast", "PhysicsDirectBodyState3D"]:
		check(not src.contains(banned), "hud script carries no %s" % banned)
	root.remove_child(instance)
	instance.free()
	return true
