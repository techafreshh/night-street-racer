extends RefCounted
## Traffic, AI, and rubber-band probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"traffic_yields_when_blocked",
		"traffic_loops_without_error",
		"test_car_paint_clears_overrides_on_exit",
		"ai_completes_loop_without_offroad",
		"rubber_band_within_bounds",
		"race_four_ai_finish",
	]
	return names

func traffic_yields_when_blocked() -> bool:
	var lane := Path3D.new()
	lane.name = "YieldTestLane"
	var curve := Curve3D.new()
	curve.add_point(Vector3(0, 0.6, 0))
	curve.add_point(Vector3(0, 0.6, -100))
	lane.curve = curve
	ctx.tree.root.add_child(lane)
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	var packed := load("res://scenes/vehicles/traffic_car.tscn") as PackedScene
	ctx.check(packed != null, "traffic car scene loads for the yield test")
	if packed == null:
		lane.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		return true
	var car := packed.instantiate() as TrafficCar
	ctx.check(car != null, "traffic car instantiates for the yield test")
	if car == null:
		lane.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		return true
	ctx.tree.root.add_child(car)
	car.setup(lane, 0.0, 9.0)
	for i in 90:
		await ctx.tree.physics_frame
	ctx.check(car.speed_ms > 0.8 * 9.0, "traffic reaches cruise unblocked (%.2f)" % car.speed_ms)
	var blocker := StaticBody3D.new()
	blocker.name = "YieldTestBlocker"
	var bshape := CollisionShape3D.new()
	var bbox := BoxShape3D.new()
	bbox.size = Vector3(2, 2, 2)
	bshape.shape = bbox
	blocker.add_child(bshape)
	var fwd := -car.global_transform.basis.z
	var bp: Vector3 = car.global_position
	blocker.position = Vector3(bp.x, 1.0, bp.z) + fwd * 6.0
	ctx.tree.root.add_child(blocker)
	for i in 90:
		await ctx.tree.physics_frame
	ctx.check(car.speed_ms < 0.2 * 9.0, "traffic stops when blocked (%.2f)" % car.speed_ms)
	blocker.queue_free()
	await ctx.tree.process_frame
	for i in 120:
		await ctx.tree.physics_frame
		if car.speed_ms > 0.5 * 9.0:
			break
	ctx.check(car.speed_ms > 0.5 * 9.0, "traffic recovers when cleared (%.2f)" % car.speed_ms)
	car.queue_free()
	lane.queue_free()
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	return true

func traffic_loops_without_error() -> bool:
	var packed := load("res://scenes/city/traffic_paths.tscn") as PackedScene
	ctx.check(packed != null, "traffic paths prefab loads for the loop test")
	if packed == null:
		return true
	var paths: Node = packed.instantiate()
	ctx.check(paths != null, "traffic paths instantiate for the loop test")
	if paths == null:
		return true
	ctx.tree.root.add_child(paths)
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	var lane := paths.get_node_or_null("LaneLoop0") as Path3D
	ctx.check(lane != null and lane.curve != null, "LaneLoop0 provides a lane curve")
	if lane == null or lane.curve == null:
		paths.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		return true
	var length := lane.curve.get_baked_length()
	ctx.check(length > 100.0, "LaneLoop0 baked length exceeds 100 m (%.1f)" % length)
	var car_packed := load("res://scenes/vehicles/traffic_car.tscn") as PackedScene
	ctx.check(car_packed != null, "traffic car scene loads for the loop test")
	if car_packed == null:
		paths.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		return true
	var car := car_packed.instantiate() as TrafficCar
	ctx.check(car != null, "loop car instantiates")
	if car == null:
		paths.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		return true
	paths.add_child(car)
	car.setup(lane, length - 20.0, 9.0)
	var wrapped := false
	var prev := car.progress
	for i in 300:
		await ctx.tree.physics_frame
		if not is_instance_valid(car):
			break
		if car.progress < prev:
			wrapped = true
		prev = car.progress
	ctx.check(is_instance_valid(car), "loop car survives 300 physics frames")
	if is_instance_valid(car):
		ctx.check(car.progress >= 0.0 and car.progress < length, "progress stays in [0, length) (%.2f / %.1f)" % [car.progress, length])
		ctx.check(wrapped, "loop car wraps past the closed-loop seam")
		var p: Vector3 = car.global_position
		ctx.check(absf(p.x) <= 140.0 and absf(p.z) <= 140.0, "loop car stays inside the district (%.1f, %.1f)" % [p.x, p.z])
		ctx.check(p.y > 0.0 and p.y < 5.0, "loop car holds lane height (y %.2f)" % p.y)
	paths.queue_free()
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	return true

func test_car_paint_clears_overrides_on_exit() -> bool:
	var packed := load("res://scenes/vehicles/traffic_car.tscn") as PackedScene
	ctx.check(packed != null, "traffic car scene loads for the paint override test")
	if packed == null:
		return true
	var car := packed.instantiate() as Node
	ctx.check(car != null, "paint test car instantiates")
	if car == null:
		return true
	ctx.tree.root.add_child(car)
	await ctx.tree.process_frame
	var paint := car.get_node_or_null("CarPaint") as CarPaint
	ctx.check(paint != null, "paint test car has a CarPaint node")
	if paint == null:
		car.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		return true
	var targets: Array[MeshInstance3D] = paint._target_meshes()
	ctx.check(not targets.is_empty(), "paint test finds at least one painted mesh")
	var painted_in_tree := false
	for mesh_inst in targets:
		if is_instance_valid(mesh_inst) and mesh_inst.mesh != null:
			if mesh_inst.get_surface_override_material(0) != null:
				painted_in_tree = true
	ctx.check(painted_in_tree, "surface override present while car is in tree")
	ctx.tree.root.remove_child(car)
	var cleared := true
	for mesh_inst in targets:
		if not is_instance_valid(mesh_inst) or mesh_inst.mesh == null:
			continue
		for i in mesh_inst.mesh.get_surface_count():
			if mesh_inst.get_surface_override_material(i) != null:
				cleared = false
	ctx.check(cleared, "surface overrides cleared after tree exit")
	ctx.tree.root.add_child(car)
	await ctx.tree.process_frame
	var repainted := false
	for mesh_inst in targets:
		if is_instance_valid(mesh_inst) and mesh_inst.mesh != null:
			if mesh_inst.get_surface_override_material(0) != null:
				repainted = true
	ctx.check(repainted, "surface override restored on re-enter")
	car.queue_free()
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	return true

func ai_completes_loop_without_offroad() -> bool:
	var line := load("res://assets/city/test_line.tres") as RacingLine
	ctx.check(line != null, "test_line.tres loads as RacingLine")
	if line == null:
		return true
	ctx.check(line.points.size() == 20, "test oval has 20 waypoints (got %d)" % line.points.size())
	var speeds := line.target_speeds()
	ctx.check(speeds.size() == 20, "baked speeds cover all waypoints (got %d)" % speeds.size())
	var lo := 1e9
	var hi := -1e9
	for s in speeds:
		lo = minf(lo, s)
		hi = maxf(hi, s)
	ctx.check(lo >= 8.0 and hi <= 28.0, "baked speeds within [8, 28] (lo %.2f hi %.2f)" % [lo, hi])
	ctx.check(lo < hi, "corner minimum slower than straight maximum (%.2f < %.2f)" % [lo, hi])
	ctx._release_inputs()
	if is_instance_valid(ctx.car):
		ctx.car.queue_free()
		ctx.car = null
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	ctx.check(packed != null, "ai_car.tscn loads as PackedScene")
	if packed == null:
		return true
	ctx.car = packed.instantiate() as VehicleController
	ctx.check(ctx.car != null, "AI car instantiates as VehicleController")
	if ctx.car == null:
		return true
	ctx.check(ctx.car.use_player_input == false, "AI car is field-driven")
	var brain := ctx.car.get_node_or_null("AIRacerInput")
	ctx.check(brain != null, "AI car has an AIRacerInput child")
	ctx.tree.root.add_child(ctx.car)
	ctx.car.global_transform = line.start_pose()
	for i in 5:
		await ctx.tree.physics_frame
	var max_dev := 0.0
	var laps := 0
	for i in 5400:
		await ctx.tree.physics_frame
		if not is_instance_valid(ctx.car):
			break
		max_dev = maxf(max_dev, line.distance_to_center(ctx.car.global_position))
		if brain != null and is_instance_valid(brain):
			laps = int(brain.get("laps_completed"))
			if laps >= 1:
				break
	ctx.check(laps >= 1, "AI completes one full loop (laps %d)" % laps)
	ctx.check(max_dev <= 4.5, "AI stays on road, max deviation <= 4.5 m (%.2f)" % max_dev)
	var up := Vector3.UP
	if is_instance_valid(ctx.car):
		up = ctx.car.global_transform.basis.y
	ctx.check(up.y > 0.5, "AI car stays upright (up.y %.3f)" % up.y)
	await ctx._despawn_car()
	return true

func rubber_band_within_bounds() -> bool:
	var line := load("res://assets/city/test_line.tres") as RacingLine
	ctx.check(line != null, "test_line.tres loads for the rubber-band check")
	if line == null:
		return true
	ctx.check(RubberBand.compute_aid(0.0, 3.0) == 0.0, "zero gap yields zero aid")
	ctx.check(RubberBand.compute_aid(1000.0, 3.0) == 3.0, "huge deficit clamps to +max_aid_s")
	ctx.check(RubberBand.compute_aid(-1000.0, 3.0) == -3.0, "huge surplus clamps to -max_aid_s")
	var toggle := RubberBand.new()
	toggle.enabled = false
	ctx.check(toggle.aid_for(50.0) == 0.0, "disabled band yields zero aid")
	toggle.enabled = true
	ctx.check(toggle.aid_for(50.0) > 0.0, "enabled band aids a 50 m deficit")
	ctx.check(toggle.aid_for(50.0) <= 3.0, "enabled aid respects max_aid_s")
	toggle.free()
	var sweep_ok := true
	var g := -500.0
	while g <= 500.0:
		if absf(RubberBand.compute_aid(g, 3.0)) > 3.0 + 0.001:
			sweep_ok = false
		g += 5.0
	ctx.check(sweep_ok, "gap sweep stays within +/- max_aid_s")
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	ctx.check(packed != null, "ai_car.tscn loads for the rubber-band run")
	if packed == null:
		return true
	ctx._release_inputs()
	if is_instance_valid(ctx.car):
		ctx.car.queue_free()
		ctx.car = null
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
	var total := line.track_length()
	# Rolling two-car duel, both starting on the opening straight with a 20 m
	# arc deficit: the chaser's proportional aid (1.6 m/s at 20 m) closes the
	# gap while both cars show their top speed on the straights ahead.
	var lead_s := 30.0
	var chase_s := 10.0
	var lead_p := line.point_at_arc(lead_s)
	var lead_d := line.point_at_arc(lead_s + 5.0) - lead_p
	lead_d.y = 0.0
	lead_d = lead_d.normalized()
	ctx.car = packed.instantiate() as VehicleController
	ctx.check(ctx.car != null, "band leader instantiates")
	if ctx.car == null:
		return true
	ctx.tree.root.add_child(ctx.car)
	ctx.car.global_transform = Transform3D(Basis(Vector3.UP, atan2(-lead_d.x, -lead_d.z)), lead_p + Vector3(0, 0.9, 0))
	ctx.car.linear_velocity = lead_d * 18.0
	ctx.car.add_to_group("racers")
	var band := ctx.car.get_node_or_null("RubberBand")
	ctx.check(band != null, "AI car carries a RubberBand child")
	var chaser := packed.instantiate() as VehicleController
	ctx.tree.root.add_child(chaser)
	var chase_p := line.point_at_arc(chase_s)
	var chase_d := line.point_at_arc(chase_s + 5.0) - chase_p
	chase_d.y = 0.0
	chase_d = chase_d.normalized()
	chaser.global_transform = Transform3D(Basis(Vector3.UP, atan2(-chase_d.x, -chase_d.z)), chase_p + Vector3(0, 0.9, 0))
	chaser.linear_velocity = chase_d * 18.0
	chaser.add_to_group("racers")
	var gap0 := fposmod(line.arc_of(ctx.car.global_position) - line.arc_of(chaser.global_position), total)
	ctx.check(absf(gap0 - 20.0) < 1.0, "duel starts with a 20 m deficit (%.1f m)" % gap0)
	var leader_top := 0.0
	var chaser_top := 0.0
	for i in 500:
		await ctx.tree.physics_frame
		if not is_instance_valid(ctx.car) or not is_instance_valid(chaser):
			break
		leader_top = maxf(leader_top, ctx.car.speed_ms)
		chaser_top = maxf(chaser_top, chaser.speed_ms)
	var gap1 := gap0
	if is_instance_valid(ctx.car) and is_instance_valid(chaser):
		gap1 = fposmod(line.arc_of(ctx.car.global_position) - line.arc_of(chaser.global_position), total)
	ctx.check(gap1 < gap0 - 5.0, "aided chaser closes the gap (%.1f m -> %.1f m)" % [gap0, gap1])
	var delta := absf(leader_top - line.max_speed) / line.max_speed
	ctx.check(delta <= 0.12, "leader max speed within 12%% of line top (%.2f m/s, delta %.1f%%)" % [leader_top, delta * 100.0])
	var chaser_delta := absf(chaser_top - line.max_speed) / line.max_speed
	ctx.check(chaser_delta <= 0.12, "aided chaser max speed within 12%% of line top (%.2f m/s, delta %.1f%%)" % [chaser_top, chaser_delta * 100.0])
	if is_instance_valid(chaser):
		chaser.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
	await ctx._despawn_car()
	return true

func race_four_ai_finish() -> bool:
	var line := load("res://assets/city/test_line.tres") as RacingLine
	ctx.check(line != null, "test_line.tres loads for the four-AI finish")
	if line == null:
		return true
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	ctx.check(packed != null, "ai_car.tscn loads for the four-AI finish")
	if packed == null:
		return true
	ctx._release_inputs()
	if is_instance_valid(ctx.car):
		ctx.car.queue_free()
		ctx.car = null
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
	var backs: Array[float] = [0.0, 8.0, 16.0, 24.0]
	var sides: Array[float] = [0.0, -2.0, 2.0, 0.0]
	var total := line.track_length()
	var grid: Array[VehicleController] = []
	for i in 4:
		var c := packed.instantiate() as VehicleController
		ctx.tree.root.add_child(c)
		# Stagger along arc length so every car starts on the loop.
		var gs := fposmod(-backs[i], total)
		var gp := line.point_at_arc(gs)
		var gd := line.point_at_arc(gs + 5.0) - gp
		gd.y = 0.0
		gd = gd.normalized()
		var gside := gd.cross(Vector3.UP).normalized()
		c.global_transform = Transform3D(Basis(Vector3.UP, atan2(-gd.x, -gd.z)), gp + Vector3(0, 0.9, 0) + gside * sides[i])
		c.add_to_group("racers")
		grid.append(c)
		if i == 0:
			ctx.car = c
	var start_arcs: Array[float] = []
	for c in grid:
		start_arcs.append(line.arc_of(c.global_position))
	for i in 300:
		await ctx.tree.physics_frame
	for i in grid.size():
		var c := grid[i]
		if not is_instance_valid(c):
			ctx.check(false, "AI car %d survives 300 physics frames" % i)
			continue
		var up: Vector3 = c.global_transform.basis.y
		ctx.check(up.y > 0.5, "AI car %d stays upright (up.y %.3f)" % [i, up.y])
		var advanced := fposmod(line.arc_of(c.global_position) - start_arcs[i], total)
		ctx.check(advanced > 5.0, "AI car %d advances from the grid (%.1f m)" % [i, advanced])
	print("AI_FINISHED")
	for c in grid:
		if is_instance_valid(c) and c != ctx.car:
			c.queue_free()
	await ctx._despawn_car()
	return true
