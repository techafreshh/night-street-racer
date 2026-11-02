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
