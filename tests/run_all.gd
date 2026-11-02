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

const TestContext = preload("res://tests/support/test_context.gd")
const SuiteConfig = preload("res://tests/suites/test_config.gd")
const SuiteSave = preload("res://tests/suites/test_save.gd")
const SuiteGarage = preload("res://tests/suites/test_garage.gd")
const SuiteMenuEvent = preload("res://tests/suites/test_menu_event.gd")
const SuiteVehicle = preload("res://tests/suites/test_vehicle.gd")
const SuiteWorld = preload("res://tests/suites/test_world.gd")
const SuiteTrafficAI = preload("res://tests/suites/test_traffic_ai.gd")
const SuiteRaceFlow = preload("res://tests/suites/test_race_flow.gd")
const SuiteTimeTrial = preload("res://tests/suites/test_time_trial.gd")
const SuiteDrift = preload("res://tests/suites/test_drift.gd")

var passed := 0
var failed := 0
var ctx = null

func _initialize() -> void:
	await _run_all()

func _run_all() -> void:
	await process_frame
	ctx = TestContext.new(self)
	ctx._make_ground()
	var suites: Array = [
		SuiteConfig.new(ctx),
		SuiteSave.new(ctx),
		SuiteGarage.new(ctx),
		SuiteMenuEvent.new(ctx),
		SuiteVehicle.new(ctx),
		SuiteWorld.new(ctx),
		SuiteTrafficAI.new(ctx),
		SuiteRaceFlow.new(ctx),
		SuiteTimeTrial.new(ctx),
		SuiteDrift.new(ctx),
	]
	for suite in suites:
		for t: String in suite.get_test_names():
			await _run_test(suite, t)
	ctx._despawn_car()
	ctx._release_inputs()
	if is_instance_valid(ctx.ground):
		ctx.ground.free()
		ctx.ground = null
	await process_frame
	await process_frame
	await physics_frame
	print("Results: %d passed, %d failed" % [passed, failed])
	if failed == 0:
		print("ALL TESTS PASSED")
	quit(1 if failed > 0 else 0)

func _run_test(suite: RefCounted, test_name: String) -> void:
	ctx._current_ok = true
	var result = await suite.call(test_name)
	if ctx._current_ok and result == true:
		passed += 1
		print("PASS %s" % test_name)
	else:
		failed += 1
		push_error("FAIL %s" % test_name)
