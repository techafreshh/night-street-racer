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
		"timetrial_race_to_results_keeps_banner",
		"timetrial_single_mode_predicate",
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
	var gs_script = load("res://scripts/game/GameState.gd")
	ctx.check(gs_script != null, "GameState.gd loads for the mode spelling probe")
	if gs_script == null:
		return true
	var gs_node = gs_script.new()
	gs_node.select_mode("time_trial")
	ctx.check(gs_node.is_time_trial_mode(), "time_trial names the solo mode")
	gs_node.select_mode("race")
	ctx.check(not gs_node.is_time_trial_mode(), "race is not the solo mode")
	gs_node.free()
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

func timetrial_race_to_results_keeps_banner() -> bool:
	# End-to-end pin for the race→results handoff: the fresh-best banner
	# must survive the real finish path, which means exactly one writer
	# (results.gd) and a disk-free per-frame delta (cached best in race.gd).
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "banner probe starts from defaults")
	var race_src := FileAccess.get_file_as_string("res://scripts/race/race.gd")
	ctx.check(race_src != "", "race.gd source loads for the single-writer check")
	ctx.check(not race_src.contains("save_best_if_faster"), "race never writes bests (single writer lives in results)")
	var results_src := FileAccess.get_file_as_string("res://scripts/ui/results.gd")
	ctx.check(results_src != "", "results.gd source loads for the single-writer check")
	ctx.check(results_src.contains("save_best_if_faster"), "results owns the best compare-plus-write")
	var proc_start := race_src.find("func _process")
	ctx.check(proc_start >= 0, "race.gd keeps a _process delta push")
	if proc_start >= 0:
		var rest := race_src.substr(proc_start)
		var next := rest.find("\nfunc ", 1)
		var body := rest.substr(0, next) if next >= 0 else rest
		ctx.check(not body.contains("get_best"), "_process never reads disk (uses the cached best)")
		ctx.check(body.contains("_cached_best"), "_process pushes the delta from the cached best")
	ctx.check(race_src.contains("_cached_best = TimeTrial.get_best"), "race caches the best once in _bind_race")
	ctx.check(TimeTrial.get_best("harbor_sprint") < 0.0, "no best stored before the fresh finish")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for the banner probe")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for the banner probe")
	if gs == null:
		return true
	var fresh := {
		"event_id": "harbor_sprint",
		"player_racer": "player",
		"places": [
			{"racer": "player", "time_s": 80.0, "place": 1},
			{"racer": "ai_1", "time_s": 91.0, "place": 2},
			{"racer": "ai_2", "time_s": 95.5, "place": 3},
			{"racer": "ai_3", "time_s": 102.7, "place": 4},
			{"racer": "ai_4", "time_s": 105.3, "place": 5},
		],
	}
	gs.call("set_last_result", fresh)
	var packed = load("res://scenes/ui/results.tscn")
	ctx.check(packed is PackedScene, "results.tscn loads as PackedScene for the banner probe")
	if not (packed is PackedScene):
		gs.call("clear_last_result")
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var first: Node = packed.instantiate()
	ctx.tree.root.add_child(first)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var best := first.find_child("BestBanner", true, false) as Label
	ctx.check(best != null and best.visible == true, "BestBanner shows on the fresh best through the finish handoff")
	if best != null:
		ctx.check(best.text.contains("NEW BEST"), "fresh banner carries the NEW BEST token")
	var stored := SaveSystem.load_game()
	var records: Dictionary = stored.get("records", {})
	ctx.check(records.has("harbor_sprint"), "finish handoff records harbor_sprint")
	if records.has("harbor_sprint"):
		var entry: Dictionary = records["harbor_sprint"]
		ctx.check(absf(float(entry.get("best_time_s", 0.0)) - 80.0) < 0.001, "finish handoff stores 80.0")
	ctx.tree.root.remove_child(first)
	first.free()
	await ctx.tree.process_frame
	var slower := {
		"event_id": "harbor_sprint",
		"player_racer": "player",
		"places": [
			{"racer": "player", "time_s": 95.0, "place": 2},
			{"racer": "ai_1", "time_s": 90.0, "place": 1},
			{"racer": "ai_2", "time_s": 96.0, "place": 3},
			{"racer": "ai_3", "time_s": 102.7, "place": 4},
			{"racer": "ai_4", "time_s": 105.3, "place": 5},
		],
	}
	gs.call("set_last_result", slower)
	var second: Node = packed.instantiate()
	ctx.tree.root.add_child(second)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var stale := second.find_child("BestBanner", true, false) as Label
	ctx.check(stale != null and stale.visible == false, "slower finish through the handoff keeps the banner hidden")
	var kept := SaveSystem.load_game()
	var kept_records: Dictionary = kept.get("records", {})
	if kept_records.has("harbor_sprint"):
		var kept_entry: Dictionary = kept_records["harbor_sprint"]
		ctx.check(absf(float(kept_entry.get("best_time_s", 0.0)) - 80.0) < 0.001, "slower finish keeps 80.0")
	ctx.tree.root.remove_child(second)
	second.free()
	await ctx.tree.process_frame
	gs.call("clear_last_result")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "banner probe restores defaults")
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func timetrial_single_mode_predicate() -> bool:
	# Single-spelling pin: the solo-mode question lives only in
	# GameState.is_time_trial_mode() and race.gd routes through it.
	var race_src := FileAccess.get_file_as_string("res://scripts/race/race.gd")
	ctx.check(race_src != "", "race.gd source loads for the single-spelling check")
	ctx.check(not race_src.contains("TimeTrial.is_time_trial_mode"), "race never calls the TimeTrial static (single spelling)")
	ctx.check(race_src.contains("has_method(\"is_time_trial_mode\")"), "race guards the GameState predicate before calling it")
	ctx.check(race_src.contains("gs.call(\"is_time_trial_mode\")"), "race routes the solo question through the GameState node")
	var tt_src := FileAccess.get_file_as_string("res://scripts/race/time_trial.gd")
	ctx.check(tt_src != "", "time_trial.gd source loads for the single-spelling check")
	ctx.check(not tt_src.contains("is_time_trial_mode"), "time_trial keeps no mode predicate (GameState owns the spelling)")
	var race_script = load("res://scripts/race/race.gd")
	ctx.check(race_script != null, "race.gd loads for the single-spelling probe")
	if race_script == null:
		return true
	var race = race_script.new()
	ctx.tree.root.add_child(race)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var pre: Node = ctx.tree.root.get_node_or_null("GameState")
	if pre == null:
		ctx.check(race._is_time_trial() == false, "race reads non-time-trial with no GameState singleton")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for the single-spelling probe")
		if gs_script == null:
			ctx.tree.root.remove_child(race)
			race.free()
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
		await ctx.tree.process_frame
	ctx.check(gs != null, "GameState singleton is reachable for the single-spelling probe")
	if gs == null:
		ctx.tree.root.remove_child(race)
		race.free()
		return true
	gs.call("select_mode", "race")
	ctx.check(race._is_time_trial() == false, "race default reads non-time-trial through GameState")
	gs.call("select_mode", "time_trial")
	ctx.check(race._is_time_trial() == true, "time_trial selection reads time-trial through race")
	gs.call("select_mode", "race")
	ctx.check(race._is_time_trial() == false, "race selection reads back non-time-trial through race")
	gs.call("select_mode", "race")
	ctx.tree.root.remove_child(race)
	race.free()
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true
