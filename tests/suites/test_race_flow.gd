extends RefCounted
## Checkpoint, race, results, HUD, and pause probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_checkpoints_validate_in_order",
		"test_wrong_way_detected",
		"tunes_in_range",
		"four_tunes_distinct",
		"countdown_sequence_3s",
		"lap_counting_increments",
		"positions_sort_by_progress",
		"results_hold_all_finishers",
		"test_results_scene_loads",
		"test_results_applies_unlock_and_best",
		"test_results_retry_goes_to_race",
		"test_results_esc_goes_back",
		"test_car_kit_glb_present",
		"test_car_kit_credits",
		"test_car_scenes_load",
		"hud_subscribes_to_race_signals",
		"progression_string_list_drops_empty",
		"test_progression_drops_empty_unlock_strings",
		"test_save_system_sanitizes_unlock_lists",
		"top3_unlocks_next_event",
		"win_unlocks_car",
		"test_pause_menu_scene",
		"test_pause_toggle_freezes_tree",
		"test_race_scene_boots",
		"test_event_to_garage_flow",
		"test_menu_esc_never_quits",
		"test_garage_esc_goes_back",
	]
	return names

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

func test_checkpoints_validate_in_order() -> bool:
	var dir := DirAccess.open("res://assets/events")
	ctx.check(dir != null, "assets/events directory opens")
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
	ctx.check(stems.size() == 5, "assets/events holds exactly 5 .tres files (got %d)" % stems.size())
	var wanted: Array[String] = ["alley_sprint", "bayline_circuit", "downtown_gp", "harbor_sprint", "neon_loop"]
	for w in wanted:
		ctx.check(stems.has(w), "event resource present: %s" % w)
	for stem in stems:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		ctx.check(ev != null, "%s loads as RaceEvent" % stem)
		if ev == null:
			continue
		ctx.check(ev.route_id == stem, "%s route_id matches stem (got %s)" % [stem, ev.route_id])
		ctx.check(RaceEvent.validate(ev), "%s passes RaceEvent.validate()" % stem)
		ctx.check(ev.checkpoint_radius >= RaceEvent.CHECKPOINT_RADIUS_MIN and ev.checkpoint_radius <= RaceEvent.CHECKPOINT_RADIUS_MAX, "%s radius in range (%.1f)" % [stem, ev.checkpoint_radius])
		if RaceEvent.is_sprint(ev):
			ctx.check(ev.laps == RaceEvent.SPRINT_LAPS, "%s sprint encodes 1 lap (got %d)" % [stem, ev.laps])
		else:
			ctx.check(RaceEvent.is_circuit(ev), "%s non-sprint is a circuit" % stem)
			ctx.check(ev.laps >= RaceEvent.CIRCUIT_LAPS_MIN, "%s circuit encodes 2+ laps (got %d)" % [stem, ev.laps])
		var count := ev.checkpoints.size()
		ctx.check(count >= RaceEvent.CHECKPOINT_COUNT_MIN, "%s has >= 4 gates (got %d)" % [stem, count])
		var last := -1
		for i in count:
			var nxt: int = RaceEvent.next_index(last, ev)
			ctx.check(nxt == i, "%s gate %d is next after %d" % [stem, i, last])
			ctx.check(RaceEvent.is_correct_hit(i, last, ev), "%s gate %d validates in order" % [stem, i])
			ctx.check(not RaceEvent.is_wrong_way(i, last, ev), "%s expected gate %d is not wrong-way" % [stem, i])
			var prev := last
			last = i
			if i == count - 1 and RaceEvent.is_circuit(ev):
				ctx.check(RaceEvent.completes_lap(i, prev, ev), "%s final gate completes the lap" % stem)
		if RaceEvent.is_circuit(ev):
			ctx.check(RaceEvent.next_index(last, ev) == 0, "%s circuit wraps to gate 0" % stem)
		else:
			ctx.check(RaceEvent.next_index(last, ev) == -1, "%s sprint finishes (-1)" % stem)
			ctx.check(not RaceEvent.completes_lap(last, count - 2, ev), "%s sprint finish is not a lap" % stem)
	var gate_packed = load("res://scenes/races/checkpoint.tscn")
	ctx.check(gate_packed is PackedScene, "checkpoint.tscn loads as PackedScene")
	if gate_packed is PackedScene:
		var gate: Node = (gate_packed as PackedScene).instantiate()
		ctx.check(gate != null, "checkpoint gate instantiates")
		if gate != null:
			ctx.check(gate is Checkpoint, "checkpoint root is a Checkpoint")
			ctx.check(gate.has_signal("passed"), "checkpoint exposes passed signal")
			ctx.check(gate.get_node_or_null("CollisionShape3D") != null, "checkpoint has a CollisionShape3D")
			ctx.check(gate.get_node_or_null("MeshInstance3D") != null, "checkpoint has a MeshInstance3D")
			gate.free()
	var routes: Array[String] = ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]
	for stem in routes:
		var packed = load("res://scenes/races/route_%s.tscn" % stem)
		ctx.check(packed is PackedScene, "route_%s.tscn loads as PackedScene" % stem)
		if not (packed is PackedScene):
			continue
		var inst: Node = (packed as PackedScene).instantiate()
		ctx.check(inst != null, "route_%s instantiates" % stem)
		if inst == null:
			continue
		ctx.check(inst is RaceRoute, "route_%s root is a RaceRoute" % stem)
		ctx.tree.root.add_child(inst)
		await ctx.tree.process_frame
		var route := inst as RaceRoute
		if route != null and route.event != null:
			ctx.check(route.gate_count() == route.event.checkpoints.size(), "route_%s spawns one gate per checkpoint (%d)" % [stem, route.gate_count()])
		ctx.tree.root.remove_child(inst)
		inst.free()
	return true

func test_wrong_way_detected() -> bool:
	var ev := load("res://assets/events/downtown_gp.tres") as RaceEvent
	ctx.check(ev != null, "downtown_gp loads for the wrong-way check")
	if ev == null:
		return true
	var count := ev.checkpoints.size()
	ctx.check(count >= 4, "circuit has >= 4 gates (got %d)" % count)
	ctx.check(RaceEvent.is_wrong_way(2, -1, ev), "skipping to gate 2 at start is wrong-way")
	ctx.check(not RaceEvent.is_correct_hit(2, -1, ev), "skipped gate 2 is not a correct hit")
	ctx.check(not RaceEvent.is_wrong_way(0, -1, ev), "expected gate 0 at start is not wrong-way")
	ctx.check(RaceEvent.is_correct_hit(0, -1, ev), "gate 0 at start is a correct hit")
	ctx.check(not RaceEvent.is_wrong_way(0, 0, ev), "duplicate of last gate is not wrong-way")
	ctx.check(not RaceEvent.is_correct_hit(0, 0, ev), "duplicate hit is not a correct hit")
	ctx.check(RaceEvent.is_wrong_way(3, 1, ev), "skipping from gate 1 to gate 3 is wrong-way")
	ctx.check(RaceEvent.is_wrong_way(0, 2, ev), "going backward from gate 2 to gate 0 is wrong-way")
	ctx.check(not RaceEvent.is_wrong_way(2, 1, ev), "expected gate 2 after gate 1 is not wrong-way")
	ctx.check(not RaceEvent.is_wrong_way(0, count - 1, ev), "lap wrap to gate 0 is not wrong-way")
	ctx.check(not RaceEvent.is_wrong_way(-1, 1, ev), "sentinel hit is not wrong-way")
	ctx.check(not RaceEvent.is_wrong_way(count, 1, ev), "out-of-range hit is not wrong-way")
	var sprint := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	ctx.check(sprint != null, "harbor_sprint loads for the wrong-way check")
	if sprint != null:
		ctx.check(RaceEvent.is_wrong_way(3, 0, sprint), "sprint skip from gate 0 to gate 3 is wrong-way")
		ctx.check(not RaceEvent.is_wrong_way(1, 0, sprint), "sprint expected gate 1 is not wrong-way")
	var car := Vector3(0, 1, 0)
	var nxt := Vector3(10, 1, 0)
	ctx.check(not RaceEvent.is_moving_wrong_way(Vector3(5, 0, 0), car, nxt), "driving toward the next gate is not wrong-way")
	ctx.check(RaceEvent.is_moving_wrong_way(Vector3(-5, 0, 0), car, nxt), "driving away from the next gate is wrong-way")
	ctx.check(not RaceEvent.is_moving_wrong_way(Vector3.ZERO, car, nxt), "standing still is not wrong-way")
	return true

func tunes_in_range() -> bool:
	var names: Array[String] = ["default_tune", "sport_tune", "drift_tune", "drag_tune"]
	for n: String in names:
		var tune := load("res://assets/cars/tunes/%s.tres" % n) as CarTune
		ctx.check(tune != null, "%s loads as CarTune" % n)
		if tune == null:
			continue
		ctx.check(CarTune.validate(tune), "%s passes CarTune.validate()" % n)
		ctx.check(tune.engine_torque >= CarTune.ENGINE_TORQUE_MIN and tune.engine_torque <= CarTune.ENGINE_TORQUE_MAX, "%s torque in range (%.1f Nm)" % [n, tune.engine_torque])
		ctx.check(tune.gear_ratios.size() >= CarTune.GEAR_COUNT_MIN and tune.gear_ratios.size() <= CarTune.GEAR_COUNT_MAX, "%s has 4-6 ratios (got %d)" % [n, tune.gear_ratios.size()])
		for i in tune.gear_ratios.size():
			var ratio: float = tune.gear_ratios[i]
			ctx.check(ratio >= CarTune.GEAR_RATIO_MIN and ratio <= CarTune.GEAR_RATIO_MAX, "%s ratio %d in range (%.2f)" % [n, i, ratio])
			if i > 0:
				ctx.check(tune.gear_ratios[i - 1] > ratio, "%s ratios strictly decreasing at %d (%.2f > %.2f)" % [n, i, tune.gear_ratios[i - 1], ratio])
		ctx.check(tune.final_drive >= CarTune.FINAL_DRIVE_MIN and tune.final_drive <= CarTune.FINAL_DRIVE_MAX, "%s final drive in range (%.2f)" % [n, tune.final_drive])
		ctx.check(tune.tire_grip_front >= CarTune.TIRE_GRIP_MIN and tune.tire_grip_front <= CarTune.TIRE_GRIP_MAX, "%s front grip in range (%.2f)" % [n, tune.tire_grip_front])
		ctx.check(tune.tire_grip_rear >= CarTune.TIRE_GRIP_MIN and tune.tire_grip_rear <= CarTune.TIRE_GRIP_MAX, "%s rear grip in range (%.2f)" % [n, tune.tire_grip_rear])
		ctx.check(tune.roll_stiffness_front >= CarTune.ROLL_STIFFNESS_MIN and tune.roll_stiffness_front <= CarTune.ROLL_STIFFNESS_MAX, "%s front roll stiffness in range (%.0f)" % [n, tune.roll_stiffness_front])
		ctx.check(tune.roll_stiffness_rear >= CarTune.ROLL_STIFFNESS_MIN and tune.roll_stiffness_rear <= CarTune.ROLL_STIFFNESS_MAX, "%s rear roll stiffness in range (%.0f)" % [n, tune.roll_stiffness_rear])
		ctx.check(tune.downforce_coefficient >= CarTune.DOWNFORCE_MIN and tune.downforce_coefficient <= CarTune.DOWNFORCE_MAX, "%s downforce in range (%.2f)" % [n, tune.downforce_coefficient])
		ctx.check(tune.drivetrain >= CarTune.DRIVETRAIN_MIN and tune.drivetrain <= CarTune.DRIVETRAIN_MAX, "%s drivetrain in range (got %d)" % [n, tune.drivetrain])
	return true

func four_tunes_distinct() -> bool:
	var names: Array[String] = ["default_tune", "sport_tune", "drift_tune", "drag_tune"]
	var times := {}
	for n: String in names:
		var tune := load("res://assets/cars/tunes/%s.tres" % n) as CarTune
		ctx.check(tune != null, "%s loads as CarTune" % n)
		if tune == null:
			continue
		var probe := VehicleController.new()
		probe.mass = 1200.0
		probe.tune = tune
		probe.apply_tune()
		times[n] = _simulate_zero_to_hundred(probe, tune)
		probe.free()
		ctx.check(float(times[n]) > 0.0 and float(times[n]) < 120.0, "%s reaches 100 km/h (%.2f s)" % [n, float(times[n])])
	for i in names.size():
		for j in range(i + 1, names.size()):
			if not times.has(names[i]) or not times.has(names[j]):
				continue
			var a: float = times[names[i]]
			var b: float = times[names[j]]
			var denom := maxf(a, b)
			ctx.check(denom > 0.0 and absf(a - b) / denom >= 0.03, "%s vs %s differ by >= 3%% (%.2f s vs %.2f s)" % [names[i], names[j], a, b])
	return true

func countdown_sequence_3s() -> bool:
	var ev := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	ctx.check(ev != null, "harbor_sprint loads for the countdown check")
	if ev == null:
		return true
	ctx.check(RaceEvent.validate(ev), "harbor_sprint validates for the countdown check")
	var mgr := RaceEventManager.new()
	ctx.check(mgr != null, "RaceEventManager instantiates standalone")
	if mgr == null:
		return true
	mgr.event = ev
	mgr.autostart = false
	ctx.tree.root.add_child(mgr)
	await ctx.tree.process_frame
	var ticks: Array[int] = []
	var started := [false]
	mgr.countdown_tick.connect(func(seconds_left: int) -> void: ticks.append(seconds_left))
	mgr.race_started.connect(func() -> void: started[0] = true)
	ctx.check(mgr.state == RaceEventManager.State.COUNTDOWN, "fresh manager starts in COUNTDOWN")
	ctx.check(not mgr.can_drive(), "can_drive is false during COUNTDOWN")
	mgr.start_race()
	ctx.check(mgr.state == RaceEventManager.State.COUNTDOWN, "start_race arms COUNTDOWN")
	ctx.check(mgr.total_laps == ev.laps, "total laps come from event (got %d)" % mgr.total_laps)
	ctx.check(mgr.race_time == 0.0, "race clock is zero during COUNTDOWN")
	ctx.check(not mgr.can_drive(), "can_drive stays false during COUNTDOWN")
	var fresh := RaceEventManager.new()
	fresh.event = ev
	fresh.autostart = false
	ctx.tree.root.add_child(fresh)
	await ctx.tree.process_frame
	fresh.start_race()
	var ignored := fresh.register_hit(0)
	ctx.check(ignored == false, "gate hit during COUNTDOWN is ignored")
	ctx.check(fresh.current_lap == 0, "COUNTDOWN hit never counts a lap")
	ctx.check(fresh.wrong_way == false, "COUNTDOWN hit never sets wrong-way")
	ctx.check(fresh.state == RaceEventManager.State.COUNTDOWN, "COUNTDOWN hit keeps COUNTDOWN")
	var ignored_skip := fresh.register_hit(3)
	ctx.check(ignored_skip == false, "skipped gate during COUNTDOWN is ignored")
	ctx.check(fresh.wrong_way == false, "skipped COUNTDOWN hit never sets wrong-way")
	for i in 200:
		await ctx.tree.physics_frame
		if mgr.state == RaceEventManager.State.RACING:
			break
	ctx.check(mgr.state == RaceEventManager.State.RACING, "reaches RACING within 200 physics frames")
	ctx.check(started[0], "race_started emitted at GO")
	ctx.check(ticks.size() == 3, "countdown_tick fired 3 times (got %d)" % ticks.size())
	if ticks.size() == 3:
		ctx.check(ticks[0] == 3, "first tick is 3 (got %d)" % ticks[0])
		ctx.check(ticks[1] == 2, "second tick is 2 (got %d)" % ticks[1])
		ctx.check(ticks[2] == 1, "third tick is 1 (got %d)" % ticks[2])
	else:
		ctx.check(ticks.has(3), "countdown_tick saw 3")
		ctx.check(ticks.has(2), "countdown_tick saw 2")
		ctx.check(ticks.has(1), "countdown_tick saw 1")
	ctx.check(mgr.can_drive(), "can_drive is true in RACING")
	for i in 30:
		await ctx.tree.physics_frame
	ctx.check(mgr.race_time > 0.0, "race clock runs in RACING (%.3f)" % mgr.race_time)
	var t0: float = mgr.race_time
	for i in 30:
		await ctx.tree.physics_frame
	ctx.check(mgr.race_time > t0, "race_time advances while RACING (%.3f > %.3f)" % [mgr.race_time, t0])
	fresh.queue_free()
	mgr.queue_free()
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	return true

func lap_counting_increments() -> bool:
	var ev := load("res://assets/events/downtown_gp.tres") as RaceEvent
	ctx.check(ev != null, "downtown_gp loads for the lap check")
	if ev == null:
		return true
	ctx.check(RaceEvent.validate(ev), "downtown_gp validates for the lap check")
	ctx.check(RaceEvent.is_circuit(ev), "downtown_gp is a circuit")
	var count := ev.checkpoints.size()
	ctx.check(count >= 4, "circuit has >= 4 gates (got %d)" % count)
	var mgr := RaceEventManager.new()
	ctx.check(mgr != null, "RaceEventManager instantiates for the lap check")
	if mgr == null:
		return true
	mgr.event = ev
	mgr.autostart = false
	ctx.tree.root.add_child(mgr)
	await ctx.tree.process_frame
	var laps: Array[int] = []
	var finished := [false]
	mgr.lap_completed.connect(func(lap_number: int) -> void: laps.append(lap_number))
	mgr.race_finished.connect(func() -> void: finished[0] = true)
	mgr.start_race()
	for i in 300:
		await ctx.tree.physics_frame
		if mgr.state == RaceEventManager.State.RACING:
			break
	ctx.check(mgr.state == RaceEventManager.State.RACING, "manager reaches RACING before lap hits")
	ctx.check(mgr.total_laps == ev.laps, "total laps match event (got %d)" % mgr.total_laps)
	var last := -1
	for i in count:
		var nxt: int = RaceEvent.next_index(last, ev)
		ctx.check(nxt == i, "lap 1 gate %d is next after %d" % [i, last])
		var ok := mgr.register_hit(nxt)
		ctx.check(ok, "lap 1 gate %d validates in order" % nxt)
		last = nxt
	ctx.check(mgr.current_lap == 1, "in-order gates increment to lap 1 (got %d)" % mgr.current_lap)
	ctx.check(laps.has(1), "lap_completed emitted for lap 1")
	ctx.check(mgr.state == RaceEventManager.State.RACING, "mid-race stays RACING after lap 1")
	ctx.check(not finished[0], "race_finished not emitted mid-race")
	for lap in range(1, ev.laps):
		for i in count:
			var want: int = RaceEvent.next_index(last, ev)
			var good := mgr.register_hit(want)
			ctx.check(good, "lap %d gate %d validates" % [lap + 1, want])
			last = want
		ctx.check(mgr.current_lap == lap + 1, "lap counter reaches %d (got %d)" % [lap + 1, mgr.current_lap])
		ctx.check(laps.has(lap + 1), "lap_completed emitted for lap %d" % (lap + 1))
	ctx.check(mgr.state == RaceEventManager.State.FINISHED, "final lap reaches FINISHED")
	ctx.check(finished[0], "race_finished emitted on the final lap")
	ctx.check(mgr.current_lap == ev.laps, "lap counter stops at total laps (%d)" % mgr.current_lap)
	ctx.check(not mgr.can_drive(), "can_drive is false after FINISHED")
	var tail := mgr.register_hit(0)
	ctx.check(tail == false, "gate hit after FINISHED is ignored")
	ctx.check(mgr.current_lap == ev.laps, "post-finish hit never counts a lap")
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	var saved_lap := mgr.current_lap
	var saved_time: float = mgr.race_time
	var saved_state := mgr.state
	car.reset_vehicle()
	for i in 60:
		await ctx.tree.physics_frame
	ctx.check(is_instance_valid(car), "car survives reset_vehicle during a finished race")
	ctx.check(mgr.state == saved_state, "car reset keeps race state valid")
	ctx.check(mgr.current_lap == saved_lap, "car reset keeps lap count valid (%d)" % mgr.current_lap)
	ctx.check(absf(mgr.race_time - saved_time) < 0.001, "car reset keeps race clock valid (%.3f)" % mgr.race_time)
	await ctx._despawn_car()
	mgr.queue_free()
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	return true

func positions_sort_by_progress() -> bool:
	var sprint := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	ctx.check(sprint != null, "harbor_sprint loads for the positions check")
	if sprint == null:
		return true
	var circuit := load("res://assets/events/downtown_gp.tres") as RaceEvent
	ctx.check(circuit != null, "downtown_gp loads for the positions check")
	if circuit == null:
		return true
	var total_s := sprint.checkpoints.size()
	var total_c := circuit.checkpoints.size()
	ctx.check(total_s >= 4, "sprint has >= 4 gates (got %d)" % total_s)
	ctx.check(total_c >= 4, "circuit has >= 4 gates (got %d)" % total_c)
	var lap_top := RacePositions.progress(0, total_c - 1, 0.9, total_c)
	var lap_next := RacePositions.progress(1, 0, 0.0, total_c)
	ctx.check(lap_next > lap_top, "lap beats idx (%.2f > %.2f)" % [lap_next, lap_top])
	var near := RacePositions.progress(0, 1, 0.9, total_c)
	var ahead := RacePositions.progress(0, 2, 0.0, total_c)
	ctx.check(ahead > near, "idx beats frac (%.2f > %.2f)" % [ahead, near])
	ctx.check(RacePositions.progress(0, 1, -0.5, total_c) == RacePositions.progress(0, 1, 0.0, total_c), "frac clamps low")
	ctx.check(RacePositions.progress(0, 1, 2.0, total_c) == RacePositions.progress(0, 1, 1.0, total_c), "frac clamps high")
	ctx.check(RacePositions.progress(0, -1, 0.5, total_c) < RacePositions.progress(0, 0, 0.0, total_c), "start sentinel stays below gate 0")
	var prev := Vector3(0, 1, 0)
	var nxt := Vector3(10, 1, 0)
	ctx.check(absf(RacePositions.fraction_to_next(Vector3(5, 1, 0), prev, nxt) - 0.5) < 0.001, "mid-segment projects to 0.5")
	ctx.check(absf(RacePositions.fraction_to_next(prev, prev, nxt) - 0.0) < 0.001, "segment start projects to 0.0")
	ctx.check(absf(RacePositions.fraction_to_next(Vector3(20, 5, 3), prev, nxt) - 1.0) < 0.001, "past-segment clamps to 1.0")
	ctx.check(RacePositions.fraction_to_next(Vector3(5, 99, -3), prev, prev) == 0.0, "degenerate segment yields 0.0")
	var sprint_mid := RacePositions.progress(0, total_s - 2, 1.0, total_s)
	var sprint_done := RacePositions.progress(0, total_s - 1, 1.0, total_s)
	ctx.check(sprint_done > sprint_mid, "sprint finish outranks mid-race (%.2f > %.2f)" % [sprint_done, sprint_mid])
	var entries: Array = [
		{"id": "leader", "progress": RacePositions.progress(1, 0, 0.2, total_c)},
		{"id": "mid", "progress": RacePositions.progress(0, 3, 0.9, total_c)},
		{"id": "back", "progress": RacePositions.progress(0, -1, 0.0, total_c)},
	]
	var order := RacePositions.standings_for(entries)
	ctx.check(order.size() == 3, "standings hold 3 racers (got %d)" % order.size())
	if order.size() == 3:
		ctx.check(str((order[0] as Dictionary)["id"]) == "leader", "leader tops standings")
		ctx.check(str((order[1] as Dictionary)["id"]) == "mid", "mid holds second")
		ctx.check(str((order[2] as Dictionary)["id"]) == "back", "start sentinel sinks to last")
	ctx.check(str((entries[0] as Dictionary)["id"]) == "leader", "standings input keeps order")
	ctx.check(str((entries[2] as Dictionary)["id"]) == "back", "standings input not mutated")
	var tie: Array = [{"id": "a", "progress": 5.0}, {"id": "b", "progress": 5.0}, {"id": "c", "progress": 6.0}]
	var tied := RacePositions.standings_for(tie)
	ctx.check(str((tied[0] as Dictionary)["id"]) == "c", "higher progress wins the tie group")
	ctx.check(str((tied[1] as Dictionary)["id"]) == "a", "tie keeps first-recorded order")
	ctx.check(str((tied[2] as Dictionary)["id"]) == "b", "tie sinks the later entry")
	var messy: Array = [{"id": "good", "progress": 10.0}, {"id": "broken"}]
	var ranked := RacePositions.standings_for(messy)
	ctx.check(str((ranked[0] as Dictionary)["id"]) == "good", "scored entry outranks malformed one")
	ctx.check(str((ranked[1] as Dictionary)["id"]) == "broken", "malformed entry sinks without crashing")
	return true

func results_hold_all_finishers() -> bool:
	var table := RacePositions.new()
	ctx.check(table != null, "RacePositions instantiates standalone")
	if table == null:
		return true
	table.record_finish("ai_2", 95.5)
	table.record_finish("player", 88.2)
	table.record_finish("ai_1", 91.0)
	table.record_finish("ai_3", 102.7)
	ctx.check(table.size() == 4, "results hold 4 finishers (got %d)" % table.size())
	var ordered := table.ordered_results()
	ctx.check(ordered.size() == 4, "ordered results hold 4 rows (got %d)" % ordered.size())
	if ordered.size() == 4:
		ctx.check(str((ordered[0] as Dictionary)["racer"]) == "player", "fastest finisher is player")
		ctx.check(str((ordered[1] as Dictionary)["racer"]) == "ai_1", "second finisher is ai_1")
		ctx.check(str((ordered[2] as Dictionary)["racer"]) == "ai_2", "third finisher is ai_2")
		ctx.check(str((ordered[3] as Dictionary)["racer"]) == "ai_3", "slowest finisher is ai_3")
		ctx.check(int((ordered[0] as Dictionary)["place"]) == 1, "winner takes place 1")
		ctx.check(int((ordered[1] as Dictionary)["place"]) == 2, "runner-up takes place 2")
		ctx.check(int((ordered[2] as Dictionary)["place"]) == 3, "third takes place 3")
		ctx.check(int((ordered[3] as Dictionary)["place"]) == 4, "last takes place 4")
		ctx.check(absf(float((ordered[0] as Dictionary)["time_s"]) - 88.2) < 0.001, "winner time kept (%.2f)" % float((ordered[0] as Dictionary)["time_s"]))
	ctx.check(table.place_of("player") == 1, "place_of matches the winner")
	ctx.check(table.place_of("ai_1") == 2, "place_of matches second")
	ctx.check(table.place_of("ai_2") == 3, "place_of matches third")
	ctx.check(table.place_of("ai_3") == 4, "place_of matches last")
	var dup := table.record_finish("player", 70.0)
	ctx.check(dup == 1, "duplicate keeps the existing place (got %d)" % dup)
	ctx.check(table.size() == 4, "duplicate never adds a row")
	ctx.check(absf(float(((table.ordered_results()[0]) as Dictionary)["time_s"]) - 88.2) < 0.001, "duplicate keeps the first time")
	var bad := table.record_finish("ghost", -5.0)
	ctx.check(bad == 0, "negative time is ignored (got %d)" % bad)
	ctx.check(table.size() == 4, "negative time never adds a row")
	ctx.check(table.place_of("ghost") == 0, "ignored racer has no place")
	table.record_finish("", 50.0)
	ctx.check(table.size() == 4, "empty id never adds a row")
	table.clear()
	ctx.check(table.size() == 0, "clear empties the table")
	ctx.check(table.ordered_results().is_empty(), "ordered results empty after clear")
	ctx.check(table.place_of("player") == 0, "no place survives clear")
	return true

func test_results_scene_loads() -> bool:
	var packed = load("res://scenes/ui/results.tscn")
	ctx.check(packed is PackedScene, "results.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "results instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "Results", "root node is Results")
	ctx.check(instance.get_script() != null, "results root carries the Results script")
	ctx.check(instance.find_child("ResultsList", true, false) is VBoxContainer, "results has a ResultsList")
	var unlock := instance.find_child("UnlockBanner", true, false) as Label
	ctx.check(unlock != null, "results has an UnlockBanner")
	if unlock != null:
		ctx.check(unlock.visible == false, "UnlockBanner starts hidden")
	var best := instance.find_child("BestBanner", true, false) as Label
	ctx.check(best != null, "results has a BestBanner")
	if best != null:
		ctx.check(best.visible == false, "BestBanner starts hidden")
	for bname in ["NextButton", "RetryButton", "MenuButton"]:
		var btn := instance.find_child(bname, true, false) as BaseButton
		ctx.check(btn != null, "results has %s" % bname)
	var src := FileAccess.get_file_as_string("res://scripts/ui/results.gd")
	ctx.check(src.contains("RESULTS_READY"), "results script prints RESULTS_READY")
	ctx.check(src.contains("last_result"), "results script reads the last_result handoff")
	for banned in ["_physics_process", "apply_force", "apply_central_force", "linear_velocity", "angular_velocity", "RayCast", "PhysicsDirectBodyState3D"]:
		ctx.check(not src.contains(banned), "results script carries no %s" % banned)
	instance.free()
	return true

func test_results_applies_unlock_and_best() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "results probe starts from defaults")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for results probe")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for results probe")
	if gs == null:
		return true
	ctx.check(gs.has_method("set_last_result"), "GameState exposes set_last_result")
	ctx.check(gs.has_method("clear_last_result"), "GameState exposes clear_last_result")
	var mock := {
		"event_id": "harbor_sprint",
		"player_racer": "player",
		"places": [
			{"racer": "player", "time_s": 88.2, "place": 1},
			{"racer": "ai_1", "time_s": 91.0, "place": 2},
			{"racer": "ai_2", "time_s": 95.5, "place": 3},
			{"racer": "ai_3", "time_s": 102.7, "place": 4},
			{"racer": "ai_4", "time_s": 105.3, "place": 5},
		],
	}
	gs.call("set_last_result", mock)
	var packed = load("res://scenes/ui/results.tscn")
	ctx.check(packed is PackedScene, "results.tscn loads as PackedScene for the unlock probe")
	if not (packed is PackedScene):
		gs.call("clear_last_result")
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var grid := instance.find_child("ResultsList", true, false) as VBoxContainer
	ctx.check(grid != null, "results probe has a ResultsList")
	if grid != null:
		ctx.check(grid.get_child_count() == 5, "results list holds 5 rows (got %d)" % grid.get_child_count())
		var player_rows := 0
		for child in grid.get_children():
			var row := child as Label
			ctx.check(row != null, "results row %s is a Label" % str(child.name))
			if row != null and row.text.contains("player"):
				player_rows += 1
				ctx.check(row.text.begins_with("▶ "), "player row carries the highlight marker")
				ctx.check(row.text.contains("01:28.200"), "player row formats mm:ss.mmm (got %s)" % row.text)
		ctx.check(player_rows == 1, "exactly one player row is highlighted (got %d)" % player_rows)
	ctx.check((gs.get("unlocked_events") as Array).has("harbor_sprint"), "P1 records harbor_sprint in unlocked_events")
	ctx.check((gs.get("unlocked_cars") as Array).has("coupe"), "P1 win grants coupe in unlocked_cars")
	var loaded := SaveSystem.load_game()
	var progress: Dictionary = loaded["progress"]
	ctx.check((progress.get("unlocked_events", []) as Array).has("harbor_sprint"), "P1 persists harbor_sprint to disk")
	ctx.check((progress.get("unlocked_cars", []) as Array).has("coupe"), "P1 persists coupe to disk")
	var records: Dictionary = loaded["records"]
	ctx.check(records.has("harbor_sprint"), "records hold a harbor_sprint entry")
	if records.has("harbor_sprint"):
		var entry: Dictionary = records["harbor_sprint"]
		ctx.check(absf(float(entry.get("best_time_s", 0.0)) - 88.2) < 0.001, "records keep the winning time")
		ctx.check(int(entry.get("best_position", 0)) == 1, "records keep the winning place")
	var unlock := instance.find_child("UnlockBanner", true, false) as Label
	ctx.check(unlock != null and unlock.visible == true, "UnlockBanner shows on a fresh unlock")
	if unlock != null:
		ctx.check(unlock.text.contains("NEW UNLOCK"), "UnlockBanner carries the NEW UNLOCK token")
	var best := instance.find_child("BestBanner", true, false) as Label
	ctx.check(best != null and best.visible == true, "BestBanner shows on a fresh best")
	if best != null:
		ctx.check(best.text.contains("NEW BEST"), "BestBanner carries the NEW BEST token")
		ctx.check(best.text.contains("01:28.200"), "BestBanner formats mm:ss.mmm (got %s)" % best.text)
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	gs.call("clear_last_result")
	ctx.check((gs.get("last_result") as Dictionary).is_empty(), "clear_last_result empties the handoff")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "results probe restores defaults")
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func test_results_retry_goes_to_race() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/ui/results.gd")
	ctx.check(src != "", "results.gd source loads for the retry probe")
	var start := src.find("func _on_retry")
	ctx.check(start >= 0, "results.gd keeps an _on_retry handler")
	var body := ""
	if start >= 0:
		var rest := src.substr(start)
		var next := rest.find("\nfunc ", 1)
		body = rest.substr(0, next) if next >= 0 else rest
	ctx.check(body.contains("race_"), "retry targets a race_ scene")
	ctx.check(not body.contains("results.tscn"), "retry no longer reloads results.tscn")
	ctx.check(body.contains("ResourceLoader.exists"), "retry guards the race path with ResourceLoader.exists")
	ctx.check(body.contains("race_harbor_sprint.tscn"), "retry falls back to race_harbor_sprint.tscn")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "retry probe starts from defaults")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for the retry probe")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for the retry probe")
	if gs == null:
		return true
	ctx.check(gs.has_method("set_last_result"), "GameState exposes set_last_result for the retry probe")
	var mock := {
		"event_id": "harbor_sprint",
		"player_racer": "player",
		"places": [
			{"racer": "player", "time_s": 88.2, "place": 1},
			{"racer": "ai_1", "time_s": 91.0, "place": 2},
			{"racer": "ai_2", "time_s": 95.5, "place": 3},
			{"racer": "ai_3", "time_s": 102.7, "place": 4},
			{"racer": "ai_4", "time_s": 105.3, "place": 5},
		],
	}
	gs.call("set_last_result", mock)
	var packed = load("res://scenes/ui/results.tscn")
	ctx.check(packed is PackedScene, "results.tscn loads as PackedScene for the retry probe")
	if not (packed is PackedScene):
		gs.call("clear_last_result")
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.check(is_instance_valid(instance), "results instance stays valid until retry navigation")
	var retry := instance.find_child("RetryButton", true, false) as BaseButton
	ctx.check(retry != null, "results has a RetryButton for the retry probe")
	if retry != null:
		retry.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var swapped := ctx.tree.current_scene
		ctx.check(swapped != null and swapped != instance, "retry leaves Results")
		ctx.check(swapped != null and String(swapped.get("scene_file_path")).contains("race_harbor_sprint"), "retry re-races harbor_sprint (got %s)" % String(swapped.get("scene_file_path")) if swapped != null else "retry re-races harbor_sprint")
		ctx.check(swapped != null and swapped.get_node_or_null("EventManager") != null, "retry lands on a race scene holding EventManager")
		ctx.check(swapped != null and swapped.get_node_or_null("Route") != null, "retry lands on a race scene holding Route")
		if swapped != null and swapped != instance and is_instance_valid(swapped):
			if swapped.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(swapped)
			swapped.free()
			await ctx.tree.process_frame
	if is_instance_valid(instance):
		if instance.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(instance)
		instance.free()
		await ctx.tree.process_frame
	var fallback_inst: Node = packed.instantiate()
	ctx.tree.root.add_child(fallback_inst)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	fallback_inst.set("_event_id", "no_such_event")
	var fallback_retry := fallback_inst.find_child("RetryButton", true, false) as BaseButton
	ctx.check(fallback_retry != null, "results keeps a RetryButton for the fallback probe")
	if fallback_retry != null:
		fallback_retry.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var fallback_swapped := ctx.tree.current_scene
		ctx.check(fallback_swapped != null and fallback_swapped != fallback_inst, "fallback retry leaves Results")
		ctx.check(fallback_swapped != null and String(fallback_swapped.get("scene_file_path")).contains("race_harbor_sprint"), "unknown event falls back to race_harbor_sprint")
		if fallback_swapped != null and fallback_swapped != fallback_inst and is_instance_valid(fallback_swapped):
			if fallback_swapped.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(fallback_swapped)
			fallback_swapped.free()
			await ctx.tree.process_frame
	if is_instance_valid(fallback_inst):
		if fallback_inst.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(fallback_inst)
		fallback_inst.free()
		await ctx.tree.process_frame
	gs.call("clear_last_result")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "retry probe restores defaults")
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func test_results_esc_goes_back() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/ui/results.gd")
	ctx.check(src != "", "results.gd source loads for the Esc probe")
	var start := src.find("func _unhandled_input")
	ctx.check(start >= 0, "results.gd keeps an _unhandled_input handler")
	var body := ""
	if start >= 0:
		var rest := src.substr(start)
		var next := rest.find("\nfunc ", 1)
		body = rest.substr(0, next) if next >= 0 else rest
	ctx.check(not body.contains("quit"), "results Esc path never quits")
	ctx.check(body.contains("_on_menu"), "results Esc routes through _on_menu")
	ctx.check(body.contains("pause"), "results Esc still triggers on pause")
	ctx.check(body.contains("ui_cancel"), "results Esc still triggers on ui_cancel")
	ctx.check(not src.contains("quit"), "results.gd holds no quit() anywhere")
	ctx.check(not src.contains("get_tree().quit()"), "results.gd holds no get_tree().quit()")
	ctx.check(not src.contains("tree.quit()"), "results.gd holds no tree.quit()")
	ctx.check(src.contains("main_menu.tscn"), "results Esc target stays main_menu.tscn")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "results Esc probe starts from defaults")
	for action_name in [&"pause", &"ui_cancel"]:
		var packed = load("res://scenes/ui/results.tscn")
		ctx.check(packed is PackedScene, "results.tscn loads as PackedScene for the Esc probe")
		if not (packed is PackedScene):
			continue
		var instance: Node = packed.instantiate()
		ctx.tree.root.add_child(instance)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(is_instance_valid(instance), "results instance stays valid until %s navigation" % String(action_name))
		var ev := InputEventAction.new()
		ev.action = action_name
		ev.pressed = true
		instance.call("_unhandled_input", ev)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var swapped := ctx.tree.current_scene
		ctx.check(swapped != null and swapped != instance, "results %s leaves Results" % String(action_name))
		ctx.check(swapped != null and swapped.find_child("RaceButton", true, false) != null, "results %s navigates home to a scene holding RaceButton" % String(action_name))
		if swapped != null and swapped != instance and is_instance_valid(swapped):
			if swapped.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(swapped)
			swapped.free()
			await ctx.tree.process_frame
		if is_instance_valid(instance):
			if instance.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(instance)
			instance.free()
			await ctx.tree.process_frame
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "results Esc probe restores defaults")
	return true

func test_car_kit_glb_present() -> bool:
	var stems: Array[String] = ["coupe", "hatch", "sedan", "awd"]
	var base := DirAccess.open("res://assets/cars")
	ctx.check(base != null, "assets/cars directory opens")
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
	ctx.check(with_glb == 4, "assets/cars holds 4 subfolders each with a .glb (got %d)" % with_glb)
	for stem in stems:
		ctx.check(DirAccess.open("res://assets/cars/%s" % stem) != null, "car folder exists: %s" % stem)
		var path := "res://assets/cars/%s/%s.glb" % [stem, stem]
		ctx.check(FileAccess.file_exists(path), "car body vendored: %s" % path)
		var packed = load(path)
		ctx.check(packed is PackedScene, "car %s loads as PackedScene" % stem)
		if packed is PackedScene:
			var inst: Node = (packed as PackedScene).instantiate()
			ctx.check(inst != null, "car %s instantiates" % stem)
			if inst != null:
				inst.free()
	return true

func test_car_kit_credits() -> bool:
	ctx.check(FileAccess.file_exists("res://docs/CREDITS"), "docs/CREDITS exists")
	var text := ""
	if FileAccess.file_exists("res://docs/CREDITS"):
		text = FileAccess.get_file_as_string("res://docs/CREDITS")
	ctx.check(text.contains("Sketchfab"), "CREDITS names Sketchfab")
	ctx.check(text.contains("Grab3D"), "CREDITS names Grab3D")
	ctx.check(text.contains("CC0"), "CREDITS records the CC0 license")
	ctx.check(text.contains("No third-party file is vendored"), "CREDITS states no third-party file is vendored")
	var stems: Array[String] = ["coupe", "hatch", "sedan", "awd"]
	for stem in stems:
		ctx.check(text.contains("car_" + stem) or text.contains("/" + stem + "/"), "CREDITS covers car_" + stem)
	ctx.check(text.contains("https://sketchfab.com/3d-models/free-concept-car-006-public-domain-cc0-a4e19bb6e6394c4a95d4319ef7d265ba"), "CREDITS pins the coupe URL")
	ctx.check(text.contains("https://sketchfab.com/3d-models/lowpoly-car-05d3cd418d334b55b4dc3f92a67bcb8c"), "CREDITS pins the hatch URL")
	ctx.check(text.contains("https://sketchfab.com/3d-models/free-low-poly-vehicles-pack-cb7640039e7a40679a53be705ebff50e"), "CREDITS pins the sedan URL")
	ctx.check(text.contains("https://grab3d.com/free-3d-models/car/"), "CREDITS pins the awd URL")
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
		ctx.check(packed is PackedScene, "car_%s.tscn loads as PackedScene" % stem)
		if not (packed is PackedScene):
			continue
		var inst := (packed as PackedScene).instantiate() as VehicleController
		ctx.check(inst != null, "car_%s instantiates a VehicleController" % stem)
		if inst == null:
			continue
		var rays := 0
		for child in inst.get_children():
			if child is RayCast3D:
				rays += 1
		ctx.check(rays == 4, "car_%s has exactly 4 RayCast3D wheels (got %d)" % [stem, rays])
		for wname in wheels.keys():
			var ray := inst.get_node_or_null(str(wname)) as RayCast3D
			ctx.check(ray != null, "car_%s keeps %s" % [stem, str(wname)])
			if ray != null:
				ctx.check(ray.position == wheels[wname], "car_%s %s at the rig position" % [stem, str(wname)])
				ctx.check(ray.target_position == Vector3(0, -0.65, 0), "car_%s %s keeps the 0.65 m ray" % [stem, str(wname)])
		var col := inst.get_node_or_null("CollisionShape3D") as CollisionShape3D
		ctx.check(col != null, "car_%s keeps its CollisionShape3D" % stem)
		if col != null:
			ctx.check(col.position == Vector3(0, 0.25, 0), "car_%s collision rides at y 0.25" % stem)
			var box := col.shape as BoxShape3D
			ctx.check(box != null and box.size == Vector3(1.8, 0.5, 4.2), "car_%s collision spans 1.8 x 0.5 x 4.2" % stem)
		ctx.check(inst.get_node_or_null("Body") != null, "car_%s instances its Body" % stem)
		var paint := inst.get_node_or_null("CarPaint")
		ctx.check(paint != null, "car_%s has a CarPaint child" % stem)
		if paint != null:
			ctx.check(paint.get("color_index") != null, "car_%s CarPaint exposes a color_index" % stem)
			ctx.check(int(paint.get("color_index")) == int(paints[stem]), "car_%s color_index matches (got %d)" % [stem, int(paint.get("color_index"))])
			ctx.check(CarPaint.COLORS.size() >= 3, "car_%s palette holds >= 3 variants (got %d)" % [stem, CarPaint.COLORS.size()])
		ctx.check(inst.tune != null, "car_%s has a non-null tune" % stem)
		if inst.tune != null:
			ctx.check(CarTune.validate(inst.tune), "car_%s tune passes CarTune.validate()" % stem)
			ctx.check(inst.tune.resource_path == str(tunes[stem]), "car_%s uses %s" % [stem, str(tunes[stem])])
		ctx.check(int(inst.drive_mode) == int(modes[stem]), "car_%s drive_mode matches (got %d)" % [stem, int(inst.drive_mode)])
		ctx.tree.root.add_child(inst)
		inst.global_transform = Transform3D(Basis(), Vector3(0, 0.9, 0))
		for i in 60:
			await ctx.tree.physics_frame
		ctx.check(is_instance_valid(inst), "car_%s survives 60 physics frames" % stem)
		if is_instance_valid(inst):
			var up: Vector3 = inst.global_transform.basis.y
			ctx.check(up.y > 0.5, "car_%s stays upright on the slab (up.y %.3f)" % [stem, up.y])
			ctx.check(inst.global_position.y > 0.0 and inst.global_position.y < 2.0, "car_%s parks at sane height (y %.2f)" % [stem, inst.global_position.y])
			ctx.tree.root.remove_child(inst)
			inst.queue_free()
			await ctx.tree.process_frame
			await ctx.tree.physics_frame
	return true

func hud_subscribes_to_race_signals() -> bool:
	var packed = load("res://scenes/ui/hud.tscn")
	ctx.check(packed is PackedScene, "hud.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "hud instantiates")
	if instance == null:
		return true
	ctx.check(instance.get_script() != null, "hud root carries the HUD script")
	for label_name in ["SpeedLabel", "GearLabel", "PositionLabel", "TimerLabel", "DriftPopup", "Minimap"]:
		ctx.check(instance.get_node_or_null(label_name) != null, "hud has %s" % label_name)
	ctx.check(instance.get_node_or_null("Minimap/SubViewport") is SubViewport, "minimap hosts a SubViewport")
	var drift := instance.get_node_or_null("DriftPopup") as Label
	ctx.check(drift != null and drift.visible == false, "drift popup starts hidden")
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.check(instance.has_method("set_speed"), "hud exposes set_speed")
	ctx.check(instance.has_method("set_gear"), "hud exposes set_gear")
	ctx.check(instance.has_method("set_lap_position"), "hud exposes set_lap_position")
	ctx.check(instance.has_method("set_race_time"), "hud exposes set_race_time")
	ctx.check(instance.has_method("show_drift"), "hud exposes show_drift")
	instance.call("set_speed", 20.0)
	ctx.check((instance.get_node_or_null("SpeedLabel") as Label).text == "72 km/h", "speed formats m/s to km/h")
	instance.call("set_gear", 3, false)
	ctx.check((instance.get_node_or_null("GearLabel") as Label).text == "3", "gear shows the gear number")
	instance.call("set_gear", 2, true)
	ctx.check((instance.get_node_or_null("GearLabel") as Label).text == "R", "gear shows R while reversing")
	instance.call("set_lap_position", 2, 4, 2, 3)
	ctx.check((instance.get_node_or_null("PositionLabel") as Label).text == "P2/4  LAP 2/3", "position/lap formats P2/4 LAP 2/3")
	instance.call("set_race_time", 65.5)
	ctx.check((instance.get_node_or_null("TimerLabel") as Label).text == "01:05.500", "timer formats mm:ss.mmm")
	instance.call("show_drift", 250)
	ctx.check((instance.get_node_or_null("DriftPopup") as Label).text == "DRIFT +250", "drift popup shows the score")
	ctx.check((instance.get_node_or_null("DriftPopup") as Label).visible == true, "drift popup shows on score")
	instance.call("set_minimap_player", Vector2(0.5, 0.5))
	var dot := instance.get_node_or_null("Minimap/SubViewport/PlayerDot") as ColorRect
	ctx.check(dot != null and absf(dot.position.x - 97.0) < 0.5 and absf(dot.position.y - 97.0) < 0.5, "player marker centers at 0.5,0.5")
	instance.call("set_minimap_checkpoints", [Vector2(0, 0), Vector2(1, 1)])
	var layer := instance.get_node_or_null("Minimap/SubViewport/CheckpointLayer")
	ctx.check(layer != null and layer.get_child_count() == 2, "checkpoint markers spawn from pushed points")
	var src := FileAccess.get_file_as_string("res://scripts/ui/hud.gd")
	ctx.check(src.contains("connect"), "hud script subscribes via connect")
	ctx.check(src.contains("HUD_READY"), "hud script prints HUD_READY")
	for banned in ["_physics_process", "apply_force", "apply_central_force", "linear_velocity", "angular_velocity", "RayCast", "PhysicsDirectBodyState3D"]:
		ctx.check(not src.contains(banned), "hud script carries no %s" % banned)
	ctx.tree.root.remove_child(instance)
	instance.free()
	return true

func progression_string_list_drops_empty() -> bool:
	var cleaned := Progression._string_list(["harbor_sprint", "", 42, &"", &"downtown_gp"])
	ctx.check(cleaned == (["harbor_sprint", "downtown_gp"] as Array[String]), "empty String and StringName entries are dropped in order")
	ctx.check(Progression._string_list("harbor_sprint").is_empty(), "non-Array yields empty")
	var seeded := SaveSystem.default_data()
	(seeded["progress"] as Dictionary)["unlocked_events"] = ["harbor_sprint", ""]
	ctx.check(SaveSystem.save_game(seeded), "save_game writes the empty-entry seed doc")
	Progression.apply_result("downtown_gp", 3)
	var reloaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(reloaded), "apply_result load-modify-save from an empty-entry seed re-saves valid")
	ctx.check(not ((reloaded["progress"] as Dictionary).get("unlocked_events", []) as Array).has(""), "re-saved unlocked_events holds no empty String")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "empty-entry probe restores defaults")
	return true

func test_progression_drops_empty_unlock_strings() -> bool:
	var events := Progression._string_list(["", "harbor_sprint", "", &"", &"downtown_gp"])
	ctx.check(events == (["harbor_sprint", "downtown_gp"] as Array[String]), "empty String and empty StringName entries are dropped in order")
	var cars := Progression._string_list(["", "coupe", &""])
	ctx.check(cars == (["coupe"] as Array[String]), "empty car entries are dropped, valid car survives")
	var seeded := SaveSystem.default_data()
	(seeded["progress"] as Dictionary)["unlocked_events"] = ["", "harbor_sprint", "", &""]
	(seeded["progress"] as Dictionary)["unlocked_cars"] = ["", "coupe", &""]
	ctx.check(SaveSystem.save_game(seeded), "empty-unlock probe writes the corrupt seed doc")
	var snap := Progression.apply_result("downtown_gp", 3)
	ctx.check(not (snap.get("unlocked_events", []) as Array).has(""), "apply_result snapshot holds no empty event entry")
	ctx.check(not (snap.get("unlocked_cars", []) as Array).has(""), "apply_result snapshot holds no empty car entry")
	ctx.check((snap.get("unlocked_events", []) as Array).has("harbor_sprint"), "seeded harbor_sprint survives apply_result")
	ctx.check((snap.get("unlocked_cars", []) as Array).has("coupe"), "seeded coupe survives apply_result")
	var reloaded := SaveSystem.load_game()
	ctx.check(SaveSystem.validate(reloaded), "healed re-saved document passes SaveSystem.validate()")
	ctx.check(not ((reloaded["progress"] as Dictionary).get("unlocked_events", []) as Array).has(""), "re-saved unlocked_events holds no empty String")
	ctx.check(not ((reloaded["progress"] as Dictionary).get("unlocked_cars", []) as Array).has(""), "re-saved unlocked_cars holds no empty String")
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the empty-entry cache check")
	if script != null:
		var probe = script.new()
		probe.reload_from_disk()
		ctx.check(not (probe.get("unlocked_events") as Array).has(""), "fresh GameState cache holds no empty event entry")
		ctx.check(not (probe.get("unlocked_cars") as Array).has(""), "fresh GameState cache holds no empty car entry")
		ctx.check((probe.get("unlocked_events") as Array).has("harbor_sprint"), "fresh GameState cache keeps harbor_sprint")
		probe.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "empty-unlock probe restores defaults")
	return true

func test_save_system_sanitizes_unlock_lists() -> bool:
	var defaults := SaveSystem.default_data()
	var raw := {
		"version": SaveSystem.SAVE_VERSION,
		"settings": (defaults["settings"] as Dictionary).duplicate(true),
		"progress": (defaults["progress"] as Dictionary).duplicate(true),
		"records": {},
	}
	(raw["progress"] as Dictionary)["unlocked_events"] = ["harbor_sprint", "", 42, {"event": true}, null, "downtown_gp"]
	(raw["progress"] as Dictionary)["unlocked_cars"] = "coupe"
	var probe := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
	ctx.check(probe != null, "save path opens for the dirty unlock probe")
	if probe != null:
		probe.store_string(JSON.stringify(raw))
		probe.close()
	var loaded := SaveSystem.load_game()
	var events: Array = (loaded["progress"] as Dictionary).get("unlocked_events", [])
	var cars: Array = (loaded["progress"] as Dictionary).get("unlocked_cars", [])
	ctx.check(events == ["harbor_sprint", "downtown_gp"], "dirty unlock events load back cleaned in order")
	ctx.check(not events.has(""), "empty unlock entry is dropped on load")
	ctx.check(not events.has(42), "non-String unlock entry is dropped on load")
	ctx.check(cars == [], "non-Array unlock value loads as empty")
	ctx.check(SaveSystem.validate(loaded), "dirty unlocks load back valid")
	ctx.check(SaveSystem.save_game(loaded), "save_game rewrites the doc after unlock sanitization")
	var reloaded := SaveSystem.load_game()
	var reloaded_events: Array = (reloaded["progress"] as Dictionary).get("unlocked_events", [])
	var reloaded_cars: Array = (reloaded["progress"] as Dictionary).get("unlocked_cars", [])
	ctx.check(SaveSystem.validate(reloaded), "reloaded doc with cleaned unlocks still validates")
	ctx.check(reloaded_events == ["harbor_sprint", "downtown_gp"], "cleaned unlock events survive load-save-load")
	ctx.check(reloaded_cars == [], "cleaned non-Array unlock stays empty after load-save-load")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "dirty unlock probe restores defaults")
	return true

func top3_unlocks_next_event() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "unlock probe starts from defaults")
	var p3 := Progression.apply_result("harbor_sprint", 3)
	ctx.check(str(p3.get("event_unlocked", "")) == "downtown_gp", "P3 on harbor opens downtown_gp")
	ctx.check((p3.get("unlocked_events", []) as Array).has("harbor_sprint"), "snapshot records the completed harbor_sprint")
	ctx.check(str(p3.get("car_unlocked", "")) == "", "P3 grants no car")
	ctx.check(not (p3.get("unlocked_cars", []) as Array).has("coupe"), "P3 adds no car entry")
	var ev := load("res://assets/events/downtown_gp.tres") as RaceEvent
	ctx.check(ev != null, "downtown_gp loads as RaceEvent")
	if ev != null:
		ctx.check(MenuUI.is_unlocked(ev), "freshly opened downtown_gp reads unlocked in the menu")
		ctx.check(Progression.is_event_unlocked(ev), "freshly opened downtown_gp reads unlocked in Progression")
	var locked := load("res://assets/events/neon_loop.tres") as RaceEvent
	ctx.check(locked != null, "neon_loop loads as RaceEvent")
	if locked != null:
		ctx.check(not MenuUI.is_unlocked(locked), "neon_loop stays locked after one podium")
	var noop := Progression.apply_result("harbor_sprint", 5)
	ctx.check(str(noop.get("event_unlocked", "")) == "", "P5 unlocks no event")
	ctx.check(str(noop.get("car_unlocked", "")) == "", "P5 grants no car")
	ctx.check((noop.get("unlocked_events", []) as Array) == (p3.get("unlocked_events", []) as Array), "P5 changes nothing")
	var unknown := Progression.apply_result("bogus_event", 1)
	ctx.check(str(unknown.get("event_unlocked", "")) == "", "unknown event unlocks nothing")
	ctx.check(str(unknown.get("car_unlocked", "")) == "", "unknown event grants no car")
	var last := Progression.apply_result("alley_sprint", 1)
	ctx.check(str(last.get("event_unlocked", "")) == "", "final rung P1 opens no next event")
	ctx.check(str(last.get("car_unlocked", "")) != "", "final rung P1 still grants a car")
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for restart persistence")
	if script != null:
		var probe = script.new()
		probe.reload_from_disk()
		ctx.check((probe.get("unlocked_events") as Array).has("harbor_sprint"), "fresh instance observes saved unlocked_events")
		ctx.check((probe.get("unlocked_cars") as Array).size() >= 1, "fresh instance observes saved unlocked_cars")
		probe.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "unlock probe restores defaults")
	return true

func win_unlocks_car() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "car probe starts from defaults")
	var stems: Array[String] = []
	for path in MenuUI.EVENT_PATHS:
		stems.append(String(path.get_file().get_basename()))
	ctx.check(stems == Progression.LADDER, "Progression.LADDER mirrors MenuUI.EVENT_PATHS")
	for i in Progression.LADDER.size():
		var asset := load("res://assets/events/%s.tres" % Progression.LADDER[i]) as RaceEvent
		ctx.check(asset != null, "%s loads as RaceEvent" % Progression.LADDER[i])
		if asset == null:
			continue
		if i == 0:
			ctx.check(asset.unlock_req == &"", "first rung %s has no prerequisite" % Progression.LADDER[i])
		else:
			ctx.check(asset.unlock_req == StringName(Progression.LADDER[i - 1]), "%s unlock_req points at %s" % [Progression.LADDER[i], Progression.LADDER[i - 1]])
		ctx.check(Progression.mapped_car(Progression.LADDER[i]) != "", "rung %s maps a reward car" % Progression.LADDER[i])
	ctx.check(Progression.mapped_car("bogus_event") == "", "unknown event maps no car")
	ctx.check(Progression.next_event_after("alley_sprint") == "", "final rung has no next event")
	ctx.check(Progression.next_event_after("bogus_event") == "", "unknown event has no next event")
	var win := Progression.apply_result("harbor_sprint", 1)
	ctx.check((win.get("unlocked_cars", []) as Array).has("coupe"), "P1 on harbor grants coupe")
	ctx.check(str(win.get("car_unlocked", "")) == "coupe", "snapshot names coupe")
	ctx.check(str(win.get("event_unlocked", "")) == "downtown_gp", "P1 also opens the next event")
	ctx.check(GarageUI.is_car_unlocked("coupe"), "garage opens coupe after the win")
	ctx.check(not GarageUI.is_car_unlocked("hatch"), "hatch stays locked after one win")
	ctx.check(GarageUI.is_car_unlocked("sedan"), "sedan stays open")
	var p3 := Progression.apply_result("downtown_gp", 3)
	ctx.check(str(p3.get("event_unlocked", "")) == "neon_loop", "P3 on downtown opens neon_loop")
	ctx.check(str(p3.get("car_unlocked", "")) == "", "P3 adds no car")
	var again := Progression.apply_result("harbor_sprint", 1)
	var cars := again.get("unlocked_cars", []) as Array
	var count := 0
	for c in cars:
		if str(c) == "coupe":
			count += 1
	ctx.check(count == 1, "repeated P1 adds no duplicate coupe (count %d)" % count)
	ctx.check(str(again.get("car_unlocked", "")) == "", "repeat P1 reports no fresh car")
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for the wrapper check")
	if script != null:
		var gs = script.new()
		var wrapped: Dictionary = gs.apply_result("neon_loop", 1)
		ctx.check((wrapped.get("unlocked_cars", []) as Array).has("awd"), "wrapper P1 on neon grants awd")
		ctx.check((gs.get("unlocked_cars") as Array).has("awd"), "wrapper refreshes the unlocked_cars cache")
		ctx.check((gs.get("unlocked_events") as Array).has("neon_loop"), "wrapper refreshes the unlocked_events cache")
		var bayline := load("res://assets/events/bayline_circuit.tres") as RaceEvent
		ctx.check(bayline != null, "bayline_circuit loads as RaceEvent")
		if bayline != null:
			ctx.check(MenuUI.is_unlocked(bayline), "wrapper P1 on neon opens bayline in the menu")
		gs.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "car probe restores defaults")
	return true

func test_pause_menu_scene() -> bool:
	var packed = load("res://scenes/ui/pause_menu.tscn")
	ctx.check(packed is PackedScene, "pause_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "pause menu instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "PauseMenu", "root node is PauseMenu")
	ctx.check(instance.get_script() != null, "pause root carries the Pause script")
	ctx.check(instance.process_mode == Node.PROCESS_MODE_ALWAYS, "pause root runs with PROCESS_MODE_ALWAYS")
	ctx.check((instance as CanvasLayer).visible == false, "pause menu starts hidden")
	for bname in ["ResumeButton", "RestartButton", "QuitButton"]:
		var btn := instance.find_child(bname, true, false) as BaseButton
		ctx.check(btn != null, "pause menu has %s" % bname)
		if btn != null:
			ctx.check(btn.custom_minimum_size == Vector2(320, 48), "%s keeps the 320x48 contract" % bname)
	var src := FileAccess.get_file_as_string("res://scripts/ui/pause.gd")
	ctx.check(src.contains("PAUSED"), "pause script prints PAUSED")
	ctx.check(src.contains("RESUMED"), "pause script prints RESUMED")
	ctx.check(src.contains("get_tree().paused"), "pause script toggles get_tree().paused")
	ctx.check(src.contains("restart_race"), "pause script restarts through restart_race")
	ctx.check(src.contains("main_menu.tscn"), "pause script quits to the main menu")
	for banned in ["_physics_process", "apply_force", "apply_central_force", "linear_velocity", "angular_velocity", "RayCast", "PhysicsDirectBodyState3D"]:
		ctx.check(not src.contains(banned), "pause script carries no %s" % banned)
	instance.free()
	return true

func test_pause_toggle_freezes_tree() -> bool:
	var packed = load("res://scenes/ui/pause_menu.tscn")
	ctx.check(packed is PackedScene, "pause_menu.tscn loads as PackedScene for the toggle probe")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "pause menu instantiates for the toggle probe")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var tree := instance.get_tree()
	ctx.check(tree != null, "pause menu is in the tree for the toggle probe")
	if tree == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	ctx.check(tree.paused == false, "tree starts unpaused")
	ctx.check((instance as CanvasLayer).visible == false, "pause menu starts hidden in the tree")
	var first := InputEventAction.new()
	first.action = &"pause"
	first.pressed = true
	instance.call("_unhandled_input", first)
	ctx.check(tree.paused == true, "first pause press pauses the tree")
	ctx.check((instance as CanvasLayer).visible == true, "pause menu shows while paused")
	var second := InputEventAction.new()
	second.action = &"pause"
	second.pressed = true
	instance.call("_unhandled_input", second)
	ctx.check(tree.paused == false, "second pause press resumes the tree")
	ctx.check((instance as CanvasLayer).visible == false, "pause menu hides on resume")
	tree.paused = false
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	return true

func test_race_scene_boots() -> bool:
	var stems: Array[String] = ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]
	for stem in stems:
		var packed = load("res://scenes/races/race_%s.tscn" % stem)
		ctx.check(packed is PackedScene, "race_%s.tscn loads as PackedScene" % stem)
		if not (packed is PackedScene):
			continue
		var instance: Node = packed.instantiate()
		ctx.check(instance != null, "race_%s instantiates" % stem)
		if instance == null:
			continue
		ctx.tree.root.add_child(instance)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var manager := instance.get_node_or_null("EventManager")
		ctx.check(manager != null, "race_%s has an EventManager" % stem)
		if manager != null:
			ctx.check(int(manager.get("state")) == 0, "race_%s manager starts in COUNTDOWN" % stem)
		ctx.check(instance.get_node_or_null("Route") != null, "race_%s has a Route" % stem)
		ctx.check(instance.get_node_or_null("HUD") != null, "race_%s has a HUD" % stem)
		ctx.check(instance.get_node_or_null("PauseMenu") != null, "race_%s has a PauseMenu" % stem)
		ctx.check(instance.has_method("restart_race"), "race_%s exposes restart_race" % stem)
		for _i in 60:
			await ctx.tree.process_frame
		ctx.tree.root.remove_child(instance)
		instance.free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
	var src := FileAccess.get_file_as_string("res://scripts/race/race.gd")
	ctx.check(src.contains("RACE_READY"), "race script prints RACE_READY")
	ctx.check(src.contains("restart_race"), "race script exposes restart_race")
	ctx.check(src.contains("set_last_result"), "race script hands the result to GameState")
	ctx.check(src.contains("results.tscn"), "race script finishes into results.tscn")
	return true

func test_event_to_garage_flow() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads as PackedScene for the flow probe")
	if not (packed is PackedScene):
		return true
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	ctx.check(gs != null, "GameState singleton is reachable for the flow probe")
	if gs == null:
		return true
	var resolved := &""
	for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		if ev != null and MenuUI.is_unlocked(ev):
			resolved = StringName(stem)
			break
	ctx.check(resolved != &"", "at least one event is unlocked for the flow probe")
	if resolved == &"":
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "event select instantiates for the flow probe")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var btn := instance.find_child("Event_" + String(resolved), true, false) as BaseButton
	ctx.check(btn != null, "flow probe has Event_%s button" % String(resolved))
	if btn == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	var prev := StringName(gs.get("current_event"))
	btn.pressed.emit()
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.check(StringName(gs.get("current_event")) == resolved, "event press writes current_event")
	var swapped := ctx.tree.current_scene
	ctx.check(swapped != null and swapped != instance, "event press leaves EventSelect")
	ctx.check(swapped != null and (swapped.name == "Garage" or swapped.find_child("CarGrid", true, false) != null), "event press navigates to the garage scene")
	var garage_grid := swapped.find_child("CarGrid", true, false) as GridContainer if swapped != null else null
	for _i in 40:
		if garage_grid != null and is_instance_valid(garage_grid) and garage_grid.get_child_count() >= 4:
			break
		await ctx.tree.process_frame
	if swapped != null and swapped != instance and is_instance_valid(swapped):
		if swapped.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(swapped)
		swapped.free()
		await ctx.tree.process_frame
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	gs.set("current_event", prev)
	await ctx.tree.process_frame
	return true

func test_menu_esc_never_quits() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	ctx.check(src != "", "menu.gd source loads for the Esc probe")
	var start := src.find("func _unhandled_input")
	ctx.check(start >= 0, "menu.gd keeps an _unhandled_input handler")
	var body := ""
	if start >= 0:
		var rest := src.substr(start)
		var next := rest.find("\nfunc ", 1)
		body = rest.substr(0, next) if next >= 0 else rest
	ctx.check(not body.contains("quit"), "menu Esc path never quits")
	ctx.check(body.contains("_on_back"), "event-select Esc routes through _on_back")
	ctx.check(body.contains("menu_mode"), "main-menu Esc stays mode-aware")
	ctx.check(src.contains("func _on_quit"), "QuitButton keeps its _on_quit path")
	ctx.check(src.contains("tree.quit()"), "explicit QuitButton quit path survives")
	var tscn := FileAccess.get_file_as_string("res://scenes/ui/main_menu.tscn")
	ctx.check(tscn != "", "main_menu.tscn source loads for the Hint probe")
	ctx.check(not tscn.contains("Press Esc to quit"), "stale Esc-to-quit Hint is gone")
	ctx.check(tscn.contains("InfoLabel"), "InfoLabel survives the Hint removal")
	var main_packed = load("res://scenes/ui/main_menu.tscn")
	ctx.check(main_packed is PackedScene, "main_menu.tscn loads as PackedScene for the Esc probe")
	if not (main_packed is PackedScene):
		return true
	var main_inst: Node = main_packed.instantiate()
	ctx.check(main_inst != null, "main menu instantiates for the Esc probe")
	if main_inst == null:
		return true
	ctx.tree.root.add_child(main_inst)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var before := ctx.tree.current_scene
	for action_name in [&"pause", &"ui_cancel"]:
		var ev := InputEventAction.new()
		ev.action = action_name
		ev.pressed = true
		main_inst.call("_unhandled_input", ev)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
	ctx.check(is_instance_valid(main_inst), "main-menu Esc keeps the instance alive")
	ctx.check(main_inst.get_parent() == ctx.tree.root, "main-menu Esc keeps the instance in the tree")
	ctx.check(ctx.tree.current_scene == before, "main-menu Esc triggers no navigation")
	ctx.tree.root.remove_child(main_inst)
	main_inst.free()
	await ctx.tree.process_frame
	for action_name in [&"pause", &"ui_cancel"]:
		var sel_packed = load("res://scenes/ui/event_select.tscn")
		ctx.check(sel_packed is PackedScene, "event_select.tscn loads as PackedScene for the Esc probe")
		if not (sel_packed is PackedScene):
			continue
		var sel_inst: Node = sel_packed.instantiate()
		ctx.tree.root.add_child(sel_inst)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var sel_ev := InputEventAction.new()
		sel_ev.action = action_name
		sel_ev.pressed = true
		sel_inst.call("_unhandled_input", sel_ev)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var swapped := ctx.tree.current_scene
		ctx.check(swapped != null and swapped != sel_inst, "event-select %s leaves EventSelect" % String(action_name))
		ctx.check(swapped != null and swapped.find_child("RaceButton", true, false) != null, "event-select %s navigates home to a scene holding RaceButton" % String(action_name))
		if swapped != null and swapped != sel_inst and is_instance_valid(swapped):
			if swapped.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(swapped)
			swapped.free()
			await ctx.tree.process_frame
		if is_instance_valid(sel_inst):
			if sel_inst.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(sel_inst)
			sel_inst.free()
			await ctx.tree.process_frame
	return true

func test_garage_esc_goes_back() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/ui/garage.gd")
	ctx.check(src != "", "garage.gd source loads for the Esc probe")
	var start := src.find("func _unhandled_input")
	ctx.check(start >= 0, "garage.gd keeps an _unhandled_input handler")
	var body := ""
	if start >= 0:
		var rest := src.substr(start)
		var next := rest.find("\nfunc ", 1)
		body = rest.substr(0, next) if next >= 0 else rest
	ctx.check(not body.contains("quit"), "garage Esc path never quits")
	ctx.check(body.contains("_on_back"), "garage Esc routes through _on_back")
	ctx.check(src.contains("main_menu.tscn"), "garage Esc target stays main_menu.tscn")
	for action_name in [&"pause", &"ui_cancel"]:
		var packed = load("res://scenes/ui/garage.tscn")
		ctx.check(packed is PackedScene, "garage.tscn loads as PackedScene for the Esc probe")
		if not (packed is PackedScene):
			continue
		var instance: Node = packed.instantiate()
		ctx.tree.root.add_child(instance)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var ev := InputEventAction.new()
		ev.action = action_name
		ev.pressed = true
		instance.call("_unhandled_input", ev)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		var swapped := ctx.tree.current_scene
		ctx.check(swapped != null and swapped != instance, "garage %s leaves Garage" % String(action_name))
		ctx.check(swapped != null and swapped.find_child("RaceButton", true, false) != null, "garage %s navigates home to a scene holding RaceButton" % String(action_name))
		if swapped != null and swapped != instance and is_instance_valid(swapped):
			if swapped.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(swapped)
			swapped.free()
			await ctx.tree.process_frame
		if is_instance_valid(instance):
			if instance.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(instance)
			instance.free()
			await ctx.tree.process_frame
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "garage Esc probe restores defaults")
	return true
