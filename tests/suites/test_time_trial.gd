extends RefCounted
## Solo time-trial probes: faster-only best persistence, the mode flag on
## every event asset, and the HUD delta sink. One of the per-area probe
## suites executed in fixed order by tests/run_all.gd; see that file for
## the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"timetrial_saves_best_only_when_faster",
		"timetrial_mode_field_present",
		"timetrial_hud_delta_formats",
	]
	return names

func timetrial_saves_best_only_when_faster() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "time-trial probe starts from defaults")
	ctx.check(TimeTrial.get_best("harbor_sprint") < 0.0, "no best stored for a fresh event")
	ctx.check(TimeTrial.save_best_if_faster("harbor_sprint", 90.0), "first time seeds the best")
	ctx.check(absf(TimeTrial.get_best("harbor_sprint") - 90.0) < 0.001, "seeded best reads back 90.0")
	ctx.check(not TimeTrial.save_best_if_faster("harbor_sprint", 95.0), "slower time never overwrites the best")
	ctx.check(absf(TimeTrial.get_best("harbor_sprint") - 90.0) < 0.001, "record keeps 90.0 after a slower run")
	ctx.check(TimeTrial.save_best_if_faster("harbor_sprint", 85.0), "faster time overwrites the best")
	ctx.check(absf(TimeTrial.get_best("harbor_sprint") - 85.0) < 0.001, "record keeps 85.0 after a faster run")
	var loaded := SaveSystem.load_game()
	var entry: Dictionary = (loaded["records"] as Dictionary).get("harbor_sprint", {})
	ctx.check(absf(float(entry.get("best_time_s", 0.0)) - 85.0) < 0.001, "best_time_s persists to disk")
	ctx.check(int(entry.get("best_position", 0)) == 1, "solo time-trial records best_position 1")
	ctx.check(not TimeTrial.save_best_if_faster("", 80.0), "empty event_id writes nothing")
	ctx.check(not TimeTrial.save_best_if_faster("harbor_sprint", -5.0), "negative time writes nothing")
	ctx.check(not TimeTrial.save_best_if_faster("harbor_sprint", 0.0), "zero time writes nothing")
	ctx.check(absf(TimeTrial.get_best("harbor_sprint") - 85.0) < 0.001, "record keeps 85.0 after invalid writes")
	ctx.check(TimeTrial.get_best("") < 0.0, "empty event_id has no best")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "time-trial probe restores defaults")
	return true

func timetrial_mode_field_present() -> bool:
	var stems: Array[String] = ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]
	for stem in stems:
		var text := FileAccess.get_file_as_string("res://assets/events/%s.tres" % stem)
		ctx.check(text != "", "%s.tres reads for the mode scan" % stem)
		ctx.check(text.contains("mode"), "%s.tres carries a mode field" % stem)
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		ctx.check(ev != null, "%s loads as RaceEvent" % stem)
		if ev == null:
			continue
		ctx.check(RaceEvent.validate(ev), "%s passes RaceEvent.validate()" % stem)
	ctx.check(FileAccess.file_exists("res://scripts/race/time_trial.gd"), "scripts/race/time_trial.gd exists")
	var base := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	ctx.check(base != null, "harbor_sprint loads as the mode baseline")
	if base == null:
		return true
	ctx.check(not RaceEvent.is_time_trial(base), "default race asset is not a time-trial")
	ctx.check(TimeTrial.is_time_trial_mode(&"time_trial"), "time_trial names the solo mode")
	ctx.check(not TimeTrial.is_time_trial_mode(&"race"), "race is not the solo mode")
	var solo := base.duplicate() as RaceEvent
	solo.mode = &"time_trial"
	ctx.check(RaceEvent.validate(solo), "time_trial mode passes RaceEvent.validate()")
	ctx.check(RaceEvent.is_time_trial(solo), "time_trial asset reads as a time-trial")
	var bogus := base.duplicate() as RaceEvent
	bogus.mode = &"bogus"
	ctx.check(not RaceEvent.validate(bogus), "bogus mode fails RaceEvent.validate()")
	return true

func timetrial_hud_delta_formats() -> bool:
	ctx.check(absf(TimeTrial.compute_delta(89.5, 90.0) - -0.5) < 0.001, "delta ahead is negative (89.5 - 90.0)")
	ctx.check(absf(TimeTrial.compute_delta(91.2, 90.0) - 1.2) < 0.001, "delta behind is positive (91.2 - 90.0)")
	ctx.check(TimeTrial.format_delta(-0.5) == "-00:00.500", "ahead delta formats -00:00.500 (got %s)" % TimeTrial.format_delta(-0.5))
	ctx.check(TimeTrial.format_delta(1.2) == "+00:01.200", "behind delta formats +00:01.200 (got %s)" % TimeTrial.format_delta(1.2))
	ctx.check(TimeTrial.format_time(65.5) == "01:05.500", "best formats mm:ss.mmm (got %s)" % TimeTrial.format_time(65.5))
	var packed = load("res://scenes/ui/hud.tscn")
	ctx.check(packed is PackedScene, "hud.tscn loads as PackedScene for the delta probe")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "hud instantiates for the delta probe")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var delta := instance.get_node_or_null("DeltaLabel") as Label
	ctx.check(delta != null, "hud has a DeltaLabel")
	if delta == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	ctx.check(delta.visible == false, "delta label starts hidden with no best")
	ctx.check(instance.has_method("set_delta"), "hud exposes set_delta")
	ctx.check(instance.has_method("clear_delta"), "hud exposes clear_delta")
	instance.call("set_delta", -0.5)
	ctx.check(delta.visible == true, "set_delta shows the label")
	ctx.check(delta.text.begins_with("-"), "ahead delta shows the - sign (got %s)" % delta.text)
	instance.call("set_delta", 1.2)
	ctx.check(delta.visible == true, "behind delta keeps the label shown")
	ctx.check(delta.text.begins_with("+"), "behind delta shows the + sign (got %s)" % delta.text)
	instance.call("clear_delta")
	ctx.check(delta.visible == false, "clear_delta hides the label")
	ctx.check(delta.text == "--:--.---", "clear_delta parks the placeholder (got %s)" % delta.text)
	ctx.tree.root.remove_child(instance)
	instance.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "delta probe restores defaults")
	return true
