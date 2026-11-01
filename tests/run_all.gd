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
		"test_main_menu_scene",
		"test_vehicle_scene_loads",
		"test_accel_reaches_25ms_in_8s",
		"test_brake_20ms_within_30m",
		"test_handbrake_reduces_rear_grip",
		"test_assists_reduce_slip_when_on",
		"test_suspension_settles_after_drop",
		"test_reset_after_flip",
		"test_reverse_latch_needs_standstill_in_first",
		"test_reverse_latch_fields_and_throttle_unlatch",
		"test_field_driven_ignores_reset_key",
		"test_steer_turns_at_speed",
		"test_test_ground_loads",
		"test_player_input_bridge",
		"test_export_presets_present",
		"test_export_presets_targets",
		"test_tune_values_in_range",
		"test_cornering_g_envelope_0_8_to_1_4g",
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
