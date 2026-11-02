extends RefCounted
## Project, physics, input-map, and export-preset probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_project_name",
		"test_application_icon_configured",
		"test_physics_ticks",
		"test_renderer_method",
		"test_physics_engine_3d",
		"test_autoload_gamestate",
		"test_input_actions",
		"input_map_has_all_actions",
	]
	return names

func test_project_name() -> bool:
	ctx.check(ProjectSettings.get_setting("application/config/name") == "Night Street Racer", "project name is Night Street Racer")
	return true

func test_application_icon_configured() -> bool:
	var path := str(ProjectSettings.get_setting("application/config/icon"))
	ctx.check(path != "", "application icon setting is configured")
	ctx.check(path.ends_with(".svg"), "application icon is an SVG (got %s)" % path)
	ctx.check(ResourceLoader.exists(path), "application icon resource exists: %s" % path)
	var icon := load(path) as Texture2D
	ctx.check(icon != null, "application icon loads as Texture2D")
	if icon != null:
		ctx.check(icon.get_width() > 0, "application icon width > 0 (got %d)" % icon.get_width())
		ctx.check(icon.get_height() > 0, "application icon height > 0 (got %d)" % icon.get_height())
	return true

func test_physics_ticks() -> bool:
	ctx.check(ProjectSettings.get_setting("physics/common/physics_ticks_per_second") == 60, "physics ticks are 60")
	return true

func test_renderer_method() -> bool:
	ctx.check(ProjectSettings.get_setting("rendering/renderer/rendering_method") == "forward_plus", "renderer is forward_plus")
	return true

func test_physics_engine_3d() -> bool:
	ctx.check(ProjectSettings.get_setting("physics/3d/physics_engine") == "Jolt Physics", "3D engine is Jolt Physics")
	return true

func test_autoload_gamestate() -> bool:
	ctx.check(ProjectSettings.has_setting("autoload/GameState"), "autoload/GameState is registered")
	ctx.check(str(ProjectSettings.get_setting("autoload/GameState")).begins_with("*"), "GameState autoload is enabled")
	return true

func test_input_actions() -> bool:
	var actions: Array[String] = ["accelerate", "brake", "steer_left", "steer_right", "handbrake", "look_back", "reset_car", "pause"]
	for action: String in actions:
		ctx.check(InputMap.has_action(action), "input action exists: %s" % action)
		ctx.check(absf(InputMap.action_get_deadzone(action) - 0.2) < 0.001, "deadzone 0.2: %s" % action)
	ctx.check(InputMap.action_get_events("accelerate").size() >= 3, "accelerate has key + pad events")
	return true
func input_map_has_all_actions() -> bool:
	var actions: Array[String] = ["accelerate", "brake", "steer_left", "steer_right", "handbrake", "look_back", "reset_car", "pause"]
	for action: String in actions:
		ctx.check(InputMap.has_action(action), "map has action: %s" % action)
		if not InputMap.has_action(action):
			continue
		ctx.check(absf(InputMap.action_get_deadzone(action) - 0.2) < 0.001, "map deadzone 0.2: %s" % action)
		var has_key := false
		var has_pad := false
		for ev in InputMap.action_get_events(action):
			if ev is InputEventKey:
				has_key = true
			elif ev is InputEventJoypadMotion or ev is InputEventJoypadButton:
				has_pad = true
		ctx.check(has_key, "map %s has a keyboard binding" % action)
		ctx.check(has_pad, "map %s has a joypad binding" % action)
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	var top := 0.0
	for i in 10 * 60:
		await ctx.tree.physics_frame
		top = maxf(top, car.speed_ms)
		if car.speed_ms >= 10.0:
			break
	ctx.check(top >= 10.0, "accelerate drives the car (top %.2f m/s)" % top)
	Input.action_release("accelerate")
	Input.action_press("brake")
	for i in 6 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms < 0.5:
			break
	ctx.check(car.speed_ms < 0.5, "brake stops the car (final %.2f m/s)" % car.speed_ms)
	Input.action_release("brake")
	Input.action_press("accelerate")
	for i in 10 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms >= 10.0:
			break
	ctx.check(car.speed_ms >= 10.0, "rolling for the steer check (%.2f m/s)" % car.speed_ms)
	Input.action_release("accelerate")
	Input.action_press("steer_right")
	var total := 0.0
	var prev := ctx._yaw_of(car)
	for i in 2 * 60:
		await ctx.tree.physics_frame
		var yaw := ctx._yaw_of(car)
		total += wrapf(yaw - prev, -PI, PI)
		prev = yaw
	Input.action_release("steer_right")
	ctx.check(absf(total) > deg_to_rad(15.0), "steer turns heading > 15 deg in 2 s (%.1f deg)" % rad_to_deg(total))
	var full := VehicleController.compute_lateral_force(0.3, 3000.0, 1.0, 12000.0, 1.0, 1.0)
	var held := VehicleController.compute_lateral_force(0.3, 3000.0, 1.0, 12000.0, 1.0, car.handbrake_grip_factor)
	ctx.check(absf(full) > 1.0, "handbrake baseline grip nonzero (%.1f N)" % full)
	ctx.check(held / full < 0.6, "handbrake cuts rear lateral grip (ratio %.3f)" % (held / full))
	var hb_speed := car.speed_ms
	Input.action_press("handbrake")
	for i in 60:
		await ctx.tree.physics_frame
	Input.action_release("handbrake")
	ctx.check(car.speed_ms < hb_speed, "handbrake scrubs speed (%.2f -> %.2f m/s)" % [hb_speed, car.speed_ms])
	var cam := car.get_node_or_null("ChaseCamera") as Camera3D
	ctx.check(cam != null, "spawned car carries a ChaseCamera for the look-back check")
	if cam != null:
		for i in 5:
			await ctx.tree.process_frame
		var fwd0 := -car.global_transform.basis.z
		ctx.check((cam.global_position - car.global_position).dot(fwd0) < 0.0, "camera trails behind the car by default")
		Input.action_press("look_back")
		for i in 5:
			await ctx.tree.process_frame
		var fwd1 := -car.global_transform.basis.z
		ctx.check((cam.global_position - car.global_position).dot(fwd1) > 0.0, "camera swings ahead while look_back is held")
		Input.action_release("look_back")
		for i in 5:
			await ctx.tree.process_frame
		var fwd2 := -car.global_transform.basis.z
		ctx.check((cam.global_position - car.global_position).dot(fwd2) < 0.0, "camera snaps back behind on release")
	await ctx._despawn_car()
	return true

