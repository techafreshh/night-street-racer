extends SceneTree
## Headless test contract runner. Run with:
##   godot --headless --path . --script res://tests/run_all.gd
## Every test returns bool and ends `return true`; the dispatcher treats any
## non-true return as failure (a runtime abort hands back a default value),
## prints PASS/FAIL per test, prints ALL TESTS PASSED only when nothing
## failed, and quits non-zero on failure so CI gates on the exit code.
## Never use bare assert() here: a failed assert aborts before quit() runs
## and hangs CI until its own timeout.

var passed := 0
var failed := 0
var _current_ok := true

func _initialize() -> void:
	var tests: Array[String] = [
		"test_project_name",
		"test_physics_ticks",
		"test_renderer_method",
		"test_physics_engine_3d",
		"test_autoload_gamestate",
		"test_input_actions",
		"test_gamestate_standalone",
		"test_main_menu_scene",
	]
	for t: String in tests:
		_run_test(t)
	print("Results: %d passed, %d failed" % [passed, failed])
	if failed == 0:
		print("ALL TESTS PASSED")
	quit(1 if failed > 0 else 0)

func _run_test(test_name: String) -> void:
	_current_ok = true
	var result = call(test_name)
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
