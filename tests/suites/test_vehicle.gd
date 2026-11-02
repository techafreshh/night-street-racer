extends RefCounted
## Vehicle physics, tuning, and input-bridge probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
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
	]
	return names

func _steer_yaw_run(handbrake: bool) -> float:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	for i in 10 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms >= 12.0:
			break
	Input.action_release("accelerate")
	Input.action_press("steer_right")
	if handbrake:
		Input.action_press("handbrake")
	var total := 0.0
	var prev := ctx._yaw_of(car)
	for i in 60:
		await ctx.tree.physics_frame
		var yaw := ctx._yaw_of(car)
		total += wrapf(yaw - prev, -PI, PI)
		prev = yaw
	ctx._release_inputs()
	return total

func test_vehicle_scene_loads() -> bool:
	var packed = load("res://scenes/vehicles/vehicle_base.tscn")
	ctx.check(packed is PackedScene, "vehicle_base.tscn loads as PackedScene")
	if packed is PackedScene:
		var instance: Node = packed.instantiate()
		ctx.check(instance != null, "vehicle instantiates")
		if instance != null:
			ctx.check(instance.name == "VehicleController", "root node is VehicleController")
			ctx.check(instance.has_method("reset_vehicle"), "vehicle exposes reset_vehicle")
			var rays := 0
			for child in instance.get_children():
				if child is RayCast3D:
					rays += 1
			ctx.check(rays == 4, "vehicle has exactly 4 RayCast3D wheels, got %d" % rays)
			instance.free()
	return true

func test_accel_reaches_25ms_in_8s() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	var top := 0.0
	for i in 8 * 60:
		await ctx.tree.physics_frame
		top = maxf(top, car.speed_ms)
		if car.speed_ms >= 25.0:
			break
	ctx.check(top >= 25.0, "reaches 25 m/s within 8 s (top %.2f)" % top)
	ctx.check(car.current_gear >= 3, "automatic gearbox shifts to gear >= 3 (gear %d)" % car.current_gear)
	ctx.check(car.engine_rpm >= 800.0 and car.engine_rpm <= 7000.0, "engine rpm stays within limits (%.0f)" % car.engine_rpm)
	await ctx._despawn_car()
	return true

func test_coast_upshifts_without_throttle() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.current_gear = 1
	car.linear_velocity = Vector3(0, 0, -20)
	for i in 30:
		await ctx.tree.physics_frame
	ctx.check(car.input_throttle == 0.0, "coasting applies zero throttle")
	ctx.check(car.current_gear >= 2, "coasting at redline upshifts without throttle (gear %d)" % car.current_gear)
	ctx.check(car.engine_rpm <= car.shift_up_rpm, "coasting upshift drops rpm to the taller ratio (%.0f)" % car.engine_rpm)
	await ctx._despawn_car()
	return true

func test_drive_force_uses_current_tick_rpm() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	for i in 60:
		await ctx.tree.physics_frame
	ctx.check(absf(car.engine_rpm - 800.0) < 200.0, "idle settles near 800 rpm (%.0f)" % car.engine_rpm)
	car.input_throttle = 0.3
	car.linear_velocity = Vector3(0, 0, -11.0)
	car.angular_velocity = Vector3.ZERO
	var fwd_before := -car.global_transform.basis.z
	var speed_before := car.linear_velocity.dot(fwd_before)
	await ctx.tree.physics_frame
	var fwd_after := -car.global_transform.basis.z
	var speed_after := car.linear_velocity.dot(fwd_after)
	var gain := speed_after - speed_before
	ctx.check(car.engine_rpm >= 3500.0 and car.engine_rpm <= 4500.0, "rpm is this tick's readout (~3970, got %.0f)" % car.engine_rpm)
	ctx.check(gain > 0.033, "single-tick gain reflects fresh torque (gain %.4f)" % gain)
	await ctx._despawn_car()
	return true

func test_redline_fuel_cut() -> bool:
	var packed = load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	ctx.check(packed != null, "vehicle scene loads for redline fuel-cut check")
	if packed == null:
		return true
	var inst := packed.instantiate() as VehicleController
	ctx.check(inst != null, "vehicle instantiates for redline fuel-cut check")
	if inst == null:
		return true
	var full: float = inst.engine_max_torque
	var t3000 := inst._sample_torque(3000.0)
	ctx.check(absf(t3000 - full) < 0.001, "torque at 3000 rpm is full (%.2f vs %.2f)" % [t3000, full])
	var t6500 := inst._sample_torque(6500.0)
	ctx.check(absf(t6500 - 0.6 * full) < 0.001, "torque at 6500 rpm is 0.6x (%.2f)" % t6500)
	var tnear := inst._sample_torque(inst.redline_rpm - 100.0)
	ctx.check(tnear > 0.0, "torque just below redline stays positive (%.2f)" % tnear)
	ctx.check(tnear < t6500, "torque tapers below the 6500 value near redline (%.2f vs %.2f)" % [tnear, t6500])
	ctx.check(inst._sample_torque(inst.redline_rpm) == 0.0, "torque is exactly 0.0 at redline")
	ctx.check(inst._sample_torque(8000.0) == 0.0, "torque stays 0.0 above redline")
	inst.free()
	return true

func test_over_rev_cap() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.current_gear = 1
	car.linear_velocity = Vector3(0, 0, -25)
	var peak := 0.0
	var saw_cut := false
	for i in 30:
		await ctx.tree.physics_frame
		peak = maxf(peak, car.engine_rpm)
		if car.fuel_cut:
			saw_cut = true
	ctx.check(peak <= car.max_engine_rpm, "over-rev transient never exceeds the cap (peak %.0f vs cap %.0f)" % [peak, car.max_engine_rpm])
	ctx.check(saw_cut, "fuel_cut raises while over redline")
	ctx.check(car.current_gear >= 2, "over-rev still upshifts via the coast path (gear %d)" % car.current_gear)
	ctx.check(car.engine_rpm <= car.shift_up_rpm, "upshift drops rpm to the taller ratio (%.0f)" % car.engine_rpm)
	await ctx._despawn_car()
	return true

func test_limiter_order_repairs_inversion() -> bool:
	var inverted := VehicleController.resolve_limiter_order(7000.0, 6800.0, 6000.0)
	ctx.check(inverted[2] == 6000.0, "repair keeps the absolute cap authoritative (%.0f)" % inverted[2])
	ctx.check(inverted[1] == 6000.0, "repair clamps redline to the cap (%.0f)" % inverted[1])
	ctx.check(inverted[0] == 6000.0, "repair clamps shift_up to the repaired redline (%.0f)" % inverted[0])
	var ordered := VehicleController.resolve_limiter_order(5500.0, 6800.0, 7200.0)
	ctx.check(ordered[0] == 5500.0 and ordered[1] == 6800.0 and ordered[2] == 7200.0, "repair is a no-op for ordered values")
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
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
		await ctx.tree.physics_frame
		peak = maxf(peak, car.engine_rpm)
		if car.fuel_cut:
			saw_cut = true
	ctx.check(car.shift_up_rpm <= car.redline_rpm, "inversion self-repairs shift_up <= redline (%.0f <= %.0f)" % [car.shift_up_rpm, car.redline_rpm])
	ctx.check(car.redline_rpm <= car.max_engine_rpm, "inversion self-repairs redline <= cap (%.0f <= %.0f)" % [car.redline_rpm, car.max_engine_rpm])
	ctx.check(peak <= car.max_engine_rpm, "repaired readout never exceeds the cap (peak %.0f vs cap %.0f)" % [peak, car.max_engine_rpm])
	ctx.check(saw_cut, "fuel_cut stays reachable after repair")
	ctx.check(car._sample_torque(car.redline_rpm) == 0.0, "torque zeroes at the repaired redline")
	await ctx._despawn_car()
	return true

func test_limiter_defaults_ordered() -> bool:
	var packed = load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	ctx.check(packed != null, "vehicle scene loads for limiter default check")
	if packed == null:
		return true
	var inst := packed.instantiate() as VehicleController
	ctx.check(inst != null, "vehicle instantiates for limiter default check")
	if inst == null:
		return true
	ctx.check(inst.shift_up_rpm <= inst.redline_rpm, "default shift_up <= redline (%.0f <= %.0f)" % [inst.shift_up_rpm, inst.redline_rpm])
	ctx.check(inst.redline_rpm <= inst.max_engine_rpm, "default redline <= cap (%.0f <= %.0f)" % [inst.redline_rpm, inst.max_engine_rpm])
	inst.free()
	return true

func test_brake_20ms_within_30m() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	for i in 10 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms >= 20.0:
			break
	ctx.check(car.speed_ms >= 20.0, "reaches 20 m/s before braking (%.2f)" % car.speed_ms)
	Input.action_release("accelerate")
	var start: Vector3 = car.global_position
	Input.action_press("brake")
	var dist := 0.0
	for i in 6 * 60:
		await ctx.tree.physics_frame
		var p: Vector3 = car.global_position
		dist = Vector2(p.x - start.x, p.z - start.z).length()
		if car.speed_ms < 0.5:
			break
	ctx.check(car.speed_ms < 0.5, "stops from 20 m/s (final %.2f)" % car.speed_ms)
	ctx.check(dist <= 30.0, "stops within 30 m (travelled %.2f m)" % dist)
	await ctx._despawn_car()
	return true

func test_handbrake_reduces_rear_grip() -> bool:
	var probe := await ctx._spawn_car(Vector3(0, 0.9, 0))
	var hb_factor: float = probe.handbrake_grip_factor
	var full := VehicleController.compute_lateral_force(0.3, 3000.0, 1.0, 12000.0, 1.0, 1.0)
	var held := VehicleController.compute_lateral_force(0.3, 3000.0, 1.0, 12000.0, 1.0, hb_factor)
	ctx.check(absf(full) > 1.0, "baseline rear lateral grip is nonzero (%.1f N)" % full)
	ctx.check(held / full < 0.6, "handbrake cuts rear lateral grip (ratio %.3f)" % (held / full))
	var base_yaw := await _steer_yaw_run(false)
	var hb_yaw := await _steer_yaw_run(true)
	ctx.check(absf(base_yaw) > 0.05, "baseline steers at speed (yaw %.2f rad)" % base_yaw)
	ctx.check(absf(hb_yaw) >= 1.5 * absf(base_yaw), "handbrake yaws >= 1.5x baseline (hb %.2f vs base %.2f rad)" % [hb_yaw, base_yaw])
	await ctx._despawn_car()
	return true

func test_assists_reduce_slip_when_on() -> bool:
	var steer := 0.8
	var speed := 20.0
	var raw_slip := 0.25
	var steer_off := VehicleAssists.correct_steer(steer, speed, false)
	ctx.check(steer_off == steer, "assists off leaves steer unchanged (%.4f)" % steer_off)
	var steer_on := VehicleAssists.correct_steer(steer, speed, true)
	ctx.check(absf(steer_on) < absf(steer_off), "assists on reduces steer response (on %.4f vs off %.4f)" % [steer_on, steer_off])
	ctx.check(signf(steer_on) == signf(steer_off), "assists preserve steer direction")
	var slip_off := VehicleAssists.damp_slip(raw_slip, false)
	ctx.check(slip_off == raw_slip, "assists off leaves slip unchanged (%.4f)" % slip_off)
	var slip_on := VehicleAssists.damp_slip(raw_slip, true)
	ctx.check(absf(slip_on) < absf(slip_off), "assists on reduces slip angle (on %.4f vs off %.4f)" % [slip_on, slip_off])
	var assists_node := VehicleAssists.new()
	ctx.check(assists_node.assists_enabled == true, "assists default ON")
	assists_node.free()
	var packed = load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	ctx.check(packed != null, "vehicle scene loads for assists/camera wiring check")
	if packed != null:
		var inst := packed.instantiate() as VehicleController
		ctx.check(inst != null, "vehicle instantiates for wiring check")
		if inst != null:
			ctx.check(inst.assists_enabled == true, "controller assists default ON")
			var cam := inst.get_node_or_null("ChaseCamera")
			ctx.check(cam != null and cam is Camera3D, "ChaseCamera child present on vehicle")
			if cam is Camera3D:
				ctx.check((cam as Camera3D).current == true, "ChaseCamera is current")
			ctx.check(inst.get_node_or_null("Assists") != null, "Assists child present on vehicle")
			inst.free()
	return true

func test_suspension_settles_after_drop() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 1.2, 0))
	var heights: Array[float] = []
	for i in 4 * 60:
		await ctx.tree.physics_frame
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
	ctx.check(mx - mn < 0.03, "suspension settles: last-1 s height range < 0.03 m (%.4f)" % (mx - mn))
	var bounces := 0
	for i in range(1, heights.size() - 1):
		if heights[i] > heights[i - 1] and heights[i] >= heights[i + 1] and heights[i] > avg + 0.03:
			bounces += 1
	ctx.check(bounces <= 1, "suspension bounces at most once (%d)" % bounces)
	await ctx._despawn_car()
	return true

func test_reset_after_flip() -> bool:
	var flip := Basis(Vector3(1, 0, 0), PI)
	var car := await ctx._spawn_car(Vector3(0, 0.7, 0), flip)
	for i in 60:
		await ctx.tree.physics_frame
	Input.action_press("reset_car")
	for i in 90:
		await ctx.tree.physics_frame
	Input.action_release("reset_car")
	var up: Vector3 = car.global_transform.basis.y
	ctx.check(up.y > 0.9, "manual reset restores upright (up.y %.3f)" % up.y)
	ctx.check(car.linear_velocity.length() < 1.0, "manual reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	ctx.check(car.global_position.y > 0.3 and car.global_position.y < 2.0, "manual reset parks at sane height (y %.2f)" % car.global_position.y)
	car = await ctx._spawn_car(Vector3(0, 0.7, 0), flip)
	for i in 3 * 60:
		await ctx.tree.physics_frame
	var up2: Vector3 = car.global_transform.basis.y
	ctx.check(up2.y > 0.9, "inverted car self-rights without input (up.y %.3f)" % up2.y)
	ctx.check(car.linear_velocity.length() < 1.0, "auto reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	await ctx._despawn_car()
	return true

func test_reset_clears_overpass() -> bool:
	var base := Vector3(1.0, 1.7, -2.0)
	var cands := VehicleController.reset_candidates(base)
	ctx.check(cands.size() == 25, "reset spiral has 25 candidates (got %d)" % cands.size())
	if cands.size() == 25:
		ctx.check(cands[0] == base, "first reset candidate is the flip point")
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
		ctx.check(same_y, "all reset candidates share base height")
		ctx.check(ordered, "reset spiral radii are non-decreasing")
	var probe := VehicleController.reset_probe_shape() as BoxShape3D
	ctx.check(probe != null and probe.size == Vector3(2.0, 2.0, 4.4), "reset probe covers the car footprint plus margin")
	var flip := Basis(Vector3(1, 0, 0), PI)
	var car := await ctx._spawn_car(Vector3(0, 0.7, 0), flip)
	var deck := StaticBody3D.new()
	var dshape := CollisionShape3D.new()
	var dbox := BoxShape3D.new()
	dbox.size = Vector3(5, 0.5, 5)
	dshape.shape = dbox
	deck.add_child(dshape)
	deck.position = Vector3(0, 2.0, 0)
	ctx.tree.root.add_child(deck)
	await ctx.tree.physics_frame
	for i in 60:
		await ctx.tree.physics_frame
	Input.action_press("reset_car")
	for i in 90:
		await ctx.tree.physics_frame
	Input.action_release("reset_car")
	var up: Vector3 = car.global_transform.basis.y
	ctx.check(up.y > 0.9, "overpass reset restores upright (up.y %.3f)" % up.y)
	ctx.check(car.linear_velocity.length() < 1.0, "overpass reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	var p: Vector3 = car.global_position
	var flat := Vector2(p.x - 0.0, p.z - 0.0).length()
	ctx.check(flat >= 2.5, "overpass reset sidesteps from under the deck (%.2f m)" % flat)
	var inside := p.x > -3.5 and p.x < 3.5 and p.y > 0.75 and p.y < 3.25 and p.z > -4.7 and p.z < 4.7
	ctx.check(not inside, "overpass reset parks outside the deck (%.2f, %.2f, %.2f)" % [p.x, p.y, p.z])
	deck.queue_free()
	await ctx._despawn_car()
	return true

func test_reverse_latch_needs_standstill_in_first() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	Input.action_press("accelerate")
	for i in 12 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms >= 25.0:
			break
	ctx.check(car.speed_ms >= 25.0, "reaches 25 m/s before latch test (%.2f)" % car.speed_ms)
	ctx.check(car.current_gear >= 3, "gear >= 3 at speed (gear %d)" % car.current_gear)
	Input.action_release("accelerate")
	Input.action_press("brake")
	for i in 6 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms <= 0.8:
			break
		ctx.check(car.speed_ms > -0.5, "braking at speed never reverses (%.2f)" % car.speed_ms)
	for i in 6 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms < -1.0 and car.current_gear == 1:
			break
	ctx.check(car.speed_ms < -1.0, "continued brake hold backs up (%.2f)" % car.speed_ms)
	ctx.check(car.current_gear == 1, "latched in 1st gear (gear %d)" % car.current_gear)
	await ctx._despawn_car()
	return true

func test_reverse_latch_fields_and_throttle_unlatch() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 1.0
	for i in 3 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms < -1.0:
			break
	ctx.check(car.speed_ms < -1.0, "field-driven brake hold latches reverse (%.2f)" % car.speed_ms)
	car.input_brake = 0.0
	car.input_throttle = 1.0
	for i in 3 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms > 1.0:
			break
	ctx.check(car.speed_ms > 1.0, "throttle unlatches to forward drive (%.2f)" % car.speed_ms)
	await ctx._despawn_car()
	return true

func test_reverse_rpm_signed() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 1.0
	for i in 8 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms < -2.0:
			break
	ctx.check(car.speed_ms < -1.0, "field-driven brake hold latches reverse (%.2f)" % car.speed_ms)
	var reverse_speed: float = car.speed_ms
	var reverse_rpm: float = car.engine_rpm
	ctx.check(reverse_rpm < 0.0, "reverse reports negative rpm (%.0f at %.2f m/s)" % [reverse_rpm, reverse_speed])
	ctx.check(car.current_gear == 1, "reverse rpm sign keeps 1st gear (gear %d)" % car.current_gear)
	car.input_brake = 0.0
	car.input_throttle = 1.0
	var forward_rpm := 0.0
	var forward_speed := 0.0
	for i in 8 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms > 2.0:
			forward_rpm = car.engine_rpm
			forward_speed = car.speed_ms
			if absf(forward_speed) >= absf(reverse_speed) - 0.5:
				break
	ctx.check(forward_speed > 2.0, "throttle unlatches to forward drive (%.2f)" % forward_speed)
	ctx.check(forward_rpm > 0.0, "forward reports positive rpm (%.0f at %.2f m/s)" % [forward_rpm, forward_speed])
	ctx.check(reverse_rpm != forward_rpm, "forward/reverse rpm differ by sign (%.0f vs %.0f)" % [reverse_rpm, forward_rpm])
	ctx.check(signf(reverse_rpm) != signf(forward_rpm), "forward/reverse rpm signs oppose (%.0f vs %.0f)" % [reverse_rpm, forward_rpm])
	await ctx._despawn_car()
	return true

func test_reverse_rpm_idle_positive() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.linear_velocity = Vector3.ZERO
	var lo := 1e9
	var hi := -1e9
	for i in 30:
		await ctx.tree.physics_frame
		lo = minf(lo, car.engine_rpm)
		hi = maxf(hi, car.engine_rpm)
	ctx.check(lo > 0.0, "standstill rpm stays positive (min %.0f)" % lo)
	ctx.check(absf(car.engine_rpm - 800.0) < 1.0, "standstill rpm rests at idle (%.0f)" % car.engine_rpm)
	ctx.check(hi - lo < 1.0, "standstill rpm stable, no flicker (range %.2f)" % (hi - lo))
	await ctx._despawn_car()
	return true

func test_field_driven_ignores_reset_key() -> bool:
	var flip := Basis(Vector3(1, 0, 0), PI)
	var car := await ctx._spawn_car(Vector3(0, 0.7, 0), flip)
	car.use_player_input = false
	for i in 20:
		await ctx.tree.physics_frame
	Input.action_press("reset_car")
	for i in 20:
		await ctx.tree.physics_frame
	var up: Vector3 = car.global_transform.basis.y
	ctx.check(up.y < 0.3, "field-driven car ignores reset_car key (up.y %.3f)" % up.y)
	Input.action_release("reset_car")
	car.reset_vehicle()
	for i in 60:
		await ctx.tree.physics_frame
	var up2: Vector3 = car.global_transform.basis.y
	ctx.check(up2.y > 0.9, "reset_vehicle() still uprights field-driven car (up.y %.3f)" % up2.y)
	ctx.check(car.linear_velocity.length() < 1.0, "API reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	ctx.check(car.global_position.y > 0.3 and car.global_position.y < 2.0, "API reset parks at sane height (y %.2f)" % car.global_position.y)
	await ctx._despawn_car()
	return true

func test_steer_turns_at_speed() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 1.0
	for i in 10 * 60:
		await ctx.tree.physics_frame
		if car.speed_ms >= 10.0:
			break
	ctx.check(car.speed_ms >= 10.0, "reaches 10 m/s for the steer test (%.2f)" % car.speed_ms)
	car.input_throttle = 0.3
	car.input_steer = 1.0
	var total := 0.0
	var prev := ctx._yaw_of(car)
	for i in 2 * 60:
		await ctx.tree.physics_frame
		var yaw := ctx._yaw_of(car)
		total += wrapf(yaw - prev, -PI, PI)
		prev = yaw
	var up: Vector3 = car.global_transform.basis.y
	ctx.check(absf(total) > deg_to_rad(20.0), "full steer turns heading > 20 deg in 2 s (%.1f deg)" % rad_to_deg(total))
	ctx.check(up.y > 0.5, "car stays upright while turning (up.y %.3f)" % up.y)
	await ctx._despawn_car()
	return true
