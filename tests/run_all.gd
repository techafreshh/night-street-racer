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
		"test_suspension_settles_after_drop",
		"test_reset_after_flip",
		"test_steer_turns_at_speed",
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
