extends RefCounted
## Ground, district, city-kit, and lighting probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_test_ground_loads",
		"test_district_loads",
		"test_player_input_bridge",
		"test_export_presets_present",
		"test_export_presets_targets",
		"test_export_preset_names",
		"test_traffic_cap",
		"test_fx_pool_capped",
		"test_tune_values_in_range",
		"test_cornering_g_envelope_0_8_to_1_4g",
		"test_light_budget_max_8_omnis_per_mesh",
		"test_central_roads_not_coplanar",
		"test_city_kit_glb_present",
		"test_city_kit_credits",
		"test_district_night_uses_kit",
	]
	return names

func test_test_ground_loads() -> bool:
	var packed = load("res://scenes/city/test_ground.tscn")
	ctx.check(packed is PackedScene, "test_ground.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "test ground instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "TestGround", "root node is TestGround")
	var car: VehicleController = null
	for child in instance.get_children():
		if child is VehicleController:
			car = child
	ctx.check(car != null, "test ground spawns one VehicleController")
	if car != null:
		ctx.check(car.use_player_input == false, "spawned car is field-driven (use_player_input == false)")
		ctx.check(car.get_node_or_null("PlayerInput") != null, "spawned car has a PlayerInput bridge child")
	var ground: StaticBody3D = instance.get_node_or_null("Ground") as StaticBody3D
	ctx.check(ground != null, "test ground has a Ground StaticBody3D")
	if ground != null:
		var span := 0.0
		for child in ground.get_children():
			if child is CollisionShape3D:
				var box := (child as CollisionShape3D).shape as BoxShape3D
				if box != null:
					span = maxf(span, minf(box.size.x, box.size.z))
		ctx.check(span >= 400.0, "ground collision spans >= 400 m (%.1f)" % span)
	var walls := 0
	var walled_shapes := 0
	var lights := 0
	for child in instance.get_children():
		if child is DirectionalLight3D:
			lights += 1
		if child is StaticBody3D and str(child.name).begins_with("Wall"):
			walls += 1
			var has_shape := false
			var has_mesh := false
			for grandchild in child.get_children():
				if grandchild is CollisionShape3D:
					has_shape = true
				if grandchild is MeshInstance3D:
					has_mesh = true
			if has_shape and not has_mesh:
				walled_shapes += 1
	ctx.check(walls >= 4, "test ground has >= 4 barrier walls (%d)" % walls)
	ctx.check(walled_shapes >= 4, "walls are invisible (mesh-less) with collision (%d)" % walled_shapes)
	ctx.check(lights >= 1, "test ground has a DirectionalLight3D")
	instance.free()
	return true

func test_district_loads() -> bool:
	var packed = load("res://scenes/city/district.tscn")
	ctx.check(packed is PackedScene, "district.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "district instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "District", "district root node is District")
	var block_packed = load("res://scenes/city/block.tscn")
	ctx.check(block_packed is PackedScene, "block.tscn loads as PackedScene")
	var block_inst: Node = null
	if block_packed is PackedScene:
		block_inst = (block_packed as PackedScene).instantiate()
		ctx.check(block_inst != null, "block prefab instantiates")
		if block_inst != null:
			ctx.check(block_inst.name == "Block", "block prefab root node is Block")
	var statics := instance.find_children("*", "StaticBody3D", true, false)
	var blocks := 0
	var roads := 0
	var walls := 0
	var walled_shapes := 0
	var layers_ok := true
	var block_dims_ok := true
	var road_dims_ok := true
	for body in statics:
		var rigid := body as StaticBody3D
		if rigid == null:
			continue
		if rigid.collision_layer != 1:
			layers_ok = false
		var bname := str(rigid.name)
		if bname.begins_with("Block_"):
			blocks += 1
			var measured := false
			for child in rigid.get_children():
				if child is CollisionShape3D:
					var box := (child as CollisionShape3D).shape as BoxShape3D
					if box != null and absf(box.size.x - 60.0) < 0.001 and absf(box.size.z - 60.0) < 0.001:
						measured = true
			if not measured:
				block_dims_ok = false
		elif bname.begins_with("Road_"):
			roads += 1
			var road_measured := false
			for child in rigid.get_children():
				if child is CollisionShape3D:
					var rbox := (child as CollisionShape3D).shape as BoxShape3D
					if rbox != null and absf(minf(rbox.size.x, rbox.size.z) - 8.0) < 0.001:
						road_measured = true
			if not road_measured:
				road_dims_ok = false
		elif bname.begins_with("Wall"):
			walls += 1
			var has_shape := false
			var has_mesh := false
			for grandchild in rigid.get_children():
				if grandchild is CollisionShape3D:
					has_shape = true
				if grandchild is MeshInstance3D:
					has_mesh = true
			if has_shape and not has_mesh:
				walled_shapes += 1
	ctx.check(statics.size() >= 16, "district has >= 16 StaticBody3D colliders (%d)" % statics.size())
	ctx.check(blocks >= 16, "district has >= 16 block colliders (%d)" % blocks)
	ctx.check(roads >= 10, "district has >= 10 road strips (%d)" % roads)
	ctx.check(walls >= 4, "district has >= 4 edge walls (%d)" % walls)
	ctx.check(walled_shapes >= 4, "edge walls are invisible (mesh-less) with collision (%d)" % walled_shapes)
	ctx.check(layers_ok, "every district StaticBody3D uses collision_layer 1")
	ctx.check(block_dims_ok, "block collision shapes measure 60 m")
	ctx.check(road_dims_ok, "road collision shapes measure 8 m wide")
	var lights := instance.find_children("*", "DirectionalLight3D", true, false)
	ctx.check(lights.size() >= 1, "district has a DirectionalLight3D")
	var spawn := instance.get_node_or_null("SpawnPoint")
	ctx.check(spawn != null and spawn is Marker3D, "district has a SpawnPoint Marker3D")
	if block_inst != null:
		block_inst.free()
	instance.free()
	return true

func test_player_input_bridge() -> bool:
	var packed = load("res://scenes/city/test_ground.tscn") as PackedScene
	ctx.check(packed != null, "test_ground.tscn loads for the bridge test")
	if packed == null:
		return true
	if is_instance_valid(ctx.ground):
		ctx.ground.queue_free()
		ctx.ground = null
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	ctx.check(not is_instance_valid(ctx.ground), "bridge test runs on exclusive scene ground (shared slab removed)")
	ctx.check(instance.get_node_or_null("Ground") != null, "scene instance provides the single Ground plane")
	var car: VehicleController = null
	for child in instance.get_children():
		if child is VehicleController:
			car = child
	ctx.check(car != null, "bridge test finds the spawned VehicleController")
	if car == null:
		instance.queue_free()
		await ctx.tree.process_frame
		await ctx.tree.physics_frame
		ctx._make_ground()
		return true
	Input.action_press("accelerate")
	for i in 30:
		await ctx.tree.physics_frame
	ctx.check(car.input_throttle > 0.5, "bridge copies accelerate into input_throttle (%.2f)" % car.input_throttle)
	ctx._release_inputs()
	for i in 5:
		await ctx.tree.physics_frame
	Input.action_press("reset_car")
	for i in 10:
		await ctx.tree.physics_frame
	ctx.check(car.input_reset == true, "bridge copies reset_car into input_reset")
	Input.action_release("reset_car")
	for i in 10:
		await ctx.tree.physics_frame
	ctx.check(car.input_reset == false, "bridge releases reset level when reset_car released")
	var flip := Basis(Vector3(1, 0, 0), PI)
	var pos: Vector3 = car.global_position
	car.global_transform = Transform3D(flip, Vector3(pos.x, 0.7, pos.z))
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	await ctx.tree.physics_frame
	Input.action_press("reset_car")
	for i in 15:
		await ctx.tree.physics_frame
	var up: Vector3 = car.global_transform.basis.y
	ctx.check(up.y > 0.9, "bridge reset restores upright (up.y %.3f)" % up.y)
	Input.action_release("reset_car")
	for i in 90:
		await ctx.tree.physics_frame
	ctx.check(car.linear_velocity.length() < 1.0, "bridge reset leaves car slow (%.2f m/s)" % car.linear_velocity.length())
	ctx.check(car.global_position.y > 0.3 and car.global_position.y < 2.0, "bridge reset parks at sane height (y %.2f)" % car.global_position.y)
	ctx._release_inputs()
	instance.queue_free()
	await ctx.tree.process_frame
	await ctx.tree.physics_frame
	ctx._make_ground()
	return true

func test_export_presets_present() -> bool:
	var cfg := ConfigFile.new()
	ctx.check(cfg.load("res://export_presets.cfg") == OK, "export_presets.cfg parses in the engine ConfigFile")
	var pairs: Array[String] = []
	for s: String in cfg.get_sections():
		if s.begins_with("preset.") and s.get_slice_count(".") == 2:
			pairs.append("%s|%s" % [str(cfg.get_value(s, "name", "")), str(cfg.get_value(s, "platform", ""))])
	ctx.check(pairs.has("Windows|Windows Desktop"), "Windows preset on platform Windows Desktop exists")
	ctx.check(pairs.has("Linux|Linux"), "Linux preset on platform Linux exists")
	return true

func test_export_presets_targets() -> bool:
	var cfg := ConfigFile.new()
	ctx.check(cfg.load("res://export_presets.cfg") == OK, "export_presets.cfg loads for target checks")
	var wanted := {"Windows": ".exe", "Linux": ".x86_64"}
	var seen: Array[String] = []
	for s: String in cfg.get_sections():
		if not (s.begins_with("preset.") and s.get_slice_count(".") == 2):
			continue
		var preset_name := str(cfg.get_value(s, "name", ""))
		if not wanted.has(preset_name):
			continue
		seen.append(preset_name)
		var path := str(cfg.get_value(s, "export_path", ""))
		ctx.check(path.begins_with("build/"), "%s exports under build/ (got %s)" % [preset_name, path])
		ctx.check(path.ends_with(str(wanted[preset_name])), "%s export path ends with %s (got %s)" % [preset_name, str(wanted[preset_name]), path])
		ctx.check(str(cfg.get_value(s + ".options", "binary_format/architecture", "")) == "x86_64", "%s targets x86_64" % preset_name)
		ctx.check(cfg.get_value(s, "encrypt_pck", true) == false, "%s leaves pck unencrypted" % preset_name)
		ctx.check(cfg.get_value(s, "dedicated_server", true) == false, "%s is not a dedicated-server preset" % preset_name)
	ctx.check(seen.has("Windows"), "Windows preset present for target checks")
	ctx.check(seen.has("Linux"), "Linux preset present for target checks")
	return true

func test_export_preset_names() -> bool:
	var cfg := ConfigFile.new()
	ctx.check(cfg.load("res://export_presets.cfg") == OK, "export_presets.cfg parses for name checks")
	var names: Array[String] = []
	for s: String in cfg.get_sections():
		if s.begins_with("preset.") and s.get_slice_count(".") == 2:
			names.append(str(cfg.get_value(s, "name", "")))
	ctx.check(names.has("Windows"), "preset named Windows exists")
	ctx.check(names.has("Linux"), "preset named Linux exists")
	ctx.check(not names.has("Windows Desktop"), "legacy Windows Desktop preset name is gone")
	return true

func test_traffic_cap() -> bool:
	ctx.check(TrafficManager.TRAFFIC_COUNT <= 8, "traffic fleet capped at 8 (%d)" % TrafficManager.TRAFFIC_COUNT)
	return true

func test_fx_pool_capped() -> bool:
	ctx.check(FXPool.MAX_FX <= 16, "FX pool capped at 16 emitters (%d)" % FXPool.MAX_FX)
	ctx.check(FXPool.FX_AMOUNT <= 24, "FX emitter budget capped at 24 particles (%d)" % FXPool.FX_AMOUNT)
	ctx.check(FXPool.next_index(0, 16) == 1, "FX round-robin advances the cursor")
	ctx.check(FXPool.next_index(15, 16) == 0, "FX round-robin wraps at the cap")
	ctx.check(FXPool.next_index(5, 0) == 0, "FX round-robin handles an empty pool")
	var pool := FXPool.new()
	ctx.check(pool != null, "FXPool instantiates freestanding")
	ctx.tree.root.add_child(pool)
	await ctx.tree.process_frame
	var emitters := pool.find_children("*", "CPUParticles3D", true, false)
	ctx.check(emitters.size() == FXPool.MAX_FX, "FX pool preallocates exactly MAX_FX emitters (%d)" % emitters.size())
	for node in emitters:
		var puff := node as CPUParticles3D
		if puff == null:
			continue
		ctx.check(puff.one_shot == true, "pooled emitter %s is one-shot" % str(puff.name))
		ctx.check(puff.amount <= 24, "pooled emitter %s holds the particle budget (%d)" % [str(puff.name), puff.amount])
	var before := pool.get_child_count()
	for i in 20:
		pool.burst(Vector3(float(i), 1.0, 0.0), Color.WHITE)
	ctx.check(pool.get_child_count() == before, "20 bursts never allocate (child count %d)" % pool.get_child_count())
	ctx.check(pool.active_count() <= FXPool.MAX_FX, "active bursts stay within the cap (%d)" % pool.active_count())
	var omnis := pool.find_children("*", "OmniLight3D", true, false)
	var spots := pool.find_children("*", "SpotLight3D", true, false)
	ctx.check(omnis.is_empty() and spots.is_empty(), "FX pool owns no lights")
	ctx.tree.root.remove_child(pool)
	pool.free()
	await ctx.tree.process_frame
	return true

func test_tune_values_in_range() -> bool:
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
	return true

func test_cornering_g_envelope_0_8_to_1_4g() -> bool:
	# Steady-state cornering g via the production friction-cap path: a large
	# slip angle saturates compute_lateral_force so its return equals the cap
	# (grip x load). Summed caps over 4 wheels divided by vehicle weight in g
	# equals the mean axle grip, grounding the check in real tire math.
	var tune := load("res://assets/cars/tunes/default_tune.tres") as CarTune
	ctx.check(tune != null, "default tune loads for cornering envelope")
	if tune == null:
		return true
	ctx.check(CarTune.validate(tune), "default tune validates for cornering envelope")
	var wheel_load := 1200.0 * 9.81 / 4.0
	var cap_front := absf(VehicleController.compute_lateral_force(1.0, wheel_load, tune.tire_grip_front, 12000.0, 1.0, 1.0))
	var cap_rear := absf(VehicleController.compute_lateral_force(1.0, wheel_load, tune.tire_grip_rear, 12000.0, 1.0, 1.0))
	var weight := 1200.0 * 9.81
	var total := 2.0 * cap_front + 2.0 * cap_rear
	var cornering_g := total / weight
	var mean_grip := (tune.tire_grip_front + tune.tire_grip_rear) * 0.5
	ctx.check(tune.tire_grip_front >= 0.8 and tune.tire_grip_front <= 1.4, "front axle grip in 0.8-1.4 g (%.2f)" % tune.tire_grip_front)
	ctx.check(tune.tire_grip_rear >= 0.8 and tune.tire_grip_rear <= 1.4, "rear axle grip in 0.8-1.4 g (%.2f)" % tune.tire_grip_rear)
	ctx.check(absf(cornering_g - mean_grip) < 0.05, "envelope matches mean grip (%.3f g vs %.3f)" % [cornering_g, mean_grip])
	ctx.check(cornering_g >= 0.8 and cornering_g <= 1.4, "cornering g envelope 0.8-1.4 g (%.3f g)" % cornering_g)
	return true

func test_light_budget_max_8_omnis_per_mesh() -> bool:
	var packed = load("res://scenes/city/district_night.tscn")
	ctx.check(packed is PackedScene, "district_night.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "district night instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "DistrictNight", "district night root node is DistrictNight")
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	var envs := instance.find_children("*", "WorldEnvironment", true, false)
	ctx.check(envs.size() == 1, "scene contains exactly one WorldEnvironment (%d)" % envs.size())
	if envs.size() == 1:
		var env: Environment = (envs[0] as WorldEnvironment).environment
		ctx.check(env != null, "WorldEnvironment has an Environment")
		if env != null:
			ctx.check(env.glow_enabled == true, "night environment has glow enabled")
			ctx.check(env.sky != null, "night environment has a sky")
			if env.sky != null and env.sky.sky_material is PanoramaSkyMaterial:
				var pano := (env.sky.sky_material as PanoramaSkyMaterial).panorama
				ctx.check(pano != null, "panorama sky texture is set")
			else:
				ctx.check(false, "night sky uses a PanoramaSkyMaterial")
	ctx.check(ResourceLoader.exists("res://assets/city/night_sky.hdr"), "night_sky.hdr is vendored")
	var suns := instance.find_children("*", "DirectionalLight3D", true, false)
	ctx.check(suns.size() == 1, "scene contains exactly one DirectionalLight3D (%d)" % suns.size())
	var omnis := instance.find_children("*", "OmniLight3D", true, false)
	ctx.check(omnis.size() <= 8, "scene total omnis stay in budget (%d)" % omnis.size())
	var meshes := instance.find_children("*", "MeshInstance3D", true, false)
	ctx.check(meshes.size() > 0, "district night has meshes (%d)" % meshes.size())
	var emissive := 0
	for node in meshes:
		var mi := node as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var mat: Material = mi.mesh.surface_get_material(i)
			if mat == null:
				mat = mi.get_surface_override_material(i)
			if mat is StandardMaterial3D and (mat as StandardMaterial3D).emission_enabled:
				emissive += 1
	ctx.check(emissive >= 1, "at least one emissive StandardMaterial3D dresses the scene (%d meshes)" % emissive)
	var worst := 0
	var worst_name := ""
	for node in meshes:
		var mi := node as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		var aabb: AABB = mi.mesh.get_aabb()
		var center: Vector3 = mi.global_transform * aabb.get_center()
		var radius: float = aabb.size.length() * 0.5
		var count := 0
		for light in omnis:
			var omni := light as OmniLight3D
			if omni == null:
				continue
			if omni.global_position.distance_to(center) <= omni.omni_range + radius:
				count += 1
		if count > worst:
			worst = count
			worst_name = str(mi.name)
		ctx.check(count <= 8, "mesh %s sees %d omnis (budget 8)" % [str(mi.name), count])
	ctx.check(worst <= 8, "worst mesh sees %d omnis (%s)" % [worst, worst_name])
	ctx.tree.root.remove_child(instance)
	instance.free()
	return true

func test_central_roads_not_coplanar() -> bool:
	var scenes: Array[String] = [
		"res://scenes/city/district.tscn",
		"res://scenes/city/district_night.tscn",
	]
	for scene_path in scenes:
		var packed = load(scene_path)
		ctx.check(packed is PackedScene, "%s loads as PackedScene" % scene_path)
		if not (packed is PackedScene):
			continue
		var instance: Node = (packed as PackedScene).instantiate()
		ctx.check(instance != null, "%s instantiates" % scene_path)
		if instance == null:
			continue
		ctx.tree.root.add_child(instance)
		await ctx.tree.process_frame
		var ns_body := instance.get_node_or_null("Road_NS_2")
		var ew_body := instance.get_node_or_null("Road_EW_2")
		ctx.check(ns_body != null, "%s has Road_NS_2" % scene_path)
		ctx.check(ew_body != null, "%s has Road_EW_2" % scene_path)
		if ns_body == null or ew_body == null:
			ctx.tree.root.remove_child(instance)
			instance.free()
			continue
		var ns_mesh := ns_body.get_node_or_null("MeshInstance3D") as MeshInstance3D
		var ew_mesh := ew_body.get_node_or_null("MeshInstance3D") as MeshInstance3D
		var ns_col := ns_body.get_node_or_null("CollisionShape3D") as CollisionShape3D
		var ew_col := ew_body.get_node_or_null("CollisionShape3D") as CollisionShape3D
		ctx.check(ns_mesh != null, "%s Road_NS_2 has a MeshInstance3D" % scene_path)
		ctx.check(ew_mesh != null, "%s Road_EW_2 has a MeshInstance3D" % scene_path)
		ctx.check(ns_col != null, "%s Road_NS_2 has a CollisionShape3D" % scene_path)
		ctx.check(ew_col != null, "%s Road_EW_2 has a CollisionShape3D" % scene_path)
		if ns_mesh == null or ew_mesh == null or ns_col == null or ew_col == null:
			ctx.tree.root.remove_child(instance)
			instance.free()
			continue
		var ns_box := ns_mesh.mesh as BoxMesh
		var ew_box := ew_mesh.mesh as BoxMesh
		ctx.check(ns_box != null, "%s Road_NS_2 mesh is a BoxMesh" % scene_path)
		ctx.check(ew_box != null, "%s Road_EW_2 mesh is a BoxMesh" % scene_path)
		if ns_box == null or ew_box == null:
			ctx.tree.root.remove_child(instance)
			instance.free()
			continue
		var ns_parent_y: float = (ns_body as Node3D).position.y
		var ew_parent_y: float = (ew_body as Node3D).position.y
		var ns_top: float = ns_parent_y + ns_mesh.position.y + ns_box.size.y * 0.5
		var ew_top: float = ew_parent_y + ew_mesh.position.y + ew_box.size.y * 0.5
		ctx.check(ns_top >= -0.01 and ns_top <= 0.05, "%s NS top at datum (%.3f)" % [scene_path, ns_top])
		ctx.check(ew_top >= -0.01 and ew_top <= 0.05, "%s EW top near datum (%.3f)" % [scene_path, ew_top])
		var lip: float = ew_top - ns_top
		ctx.check(absf(lip - 0.02) <= 0.005, "%s EW lip +0.02 over NS (gap %.4f)" % [scene_path, lip])
		ctx.check(absf(ns_col.position.y - ns_mesh.position.y) < 0.001, "%s NS collision matches mesh (%.4f vs %.4f)" % [scene_path, ns_col.position.y, ns_mesh.position.y])
		ctx.check(absf(ew_col.position.y - ew_mesh.position.y) < 0.001, "%s EW collision matches mesh (%.4f vs %.4f)" % [scene_path, ew_col.position.y, ew_mesh.position.y])
		ctx.tree.root.remove_child(instance)
		instance.free()
	return true

func test_city_kit_glb_present() -> bool:
	var dir := DirAccess.open("res://assets/city")
	ctx.check(dir != null, "assets/city directory opens")
	if dir == null:
		return true
	var glbs: Array[String] = []
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if not dir.current_is_dir() and entry.ends_with(".glb"):
			glbs.append(entry)
		entry = dir.get_next()
	dir.list_dir_end()
	ctx.check(glbs.size() >= 5, "assets/city holds >= 5 kit .glb files (got %d)" % glbs.size())
	for g in glbs:
		var packed = load("res://assets/city/%s" % g)
		ctx.check(packed is PackedScene, "kit %s loads as PackedScene" % g)
		if packed is PackedScene:
			var inst: Node = (packed as PackedScene).instantiate()
			ctx.check(inst != null, "kit %s instantiates" % g)
			if inst != null:
				inst.free()
	return true

func test_city_kit_credits() -> bool:
	ctx.check(FileAccess.file_exists("res://docs/CREDITS"), "docs/CREDITS exists")
	var text := ""
	if FileAccess.file_exists("res://docs/CREDITS"):
		text = FileAccess.get_file_as_string("res://docs/CREDITS")
	ctx.check(text.contains("Kenney"), "CREDITS names Kenney")
	ctx.check(text.contains("Poly Haven"), "CREDITS names Poly Haven")
	ctx.check(text.contains("https://kenney.nl/assets/category:3D"), "CREDITS pins the Kenney 3D URL")
	ctx.check(text.contains("https://polyhaven.com/hdris"), "CREDITS pins the Poly Haven HDRIs URL")
	ctx.check(text.contains("CC0"), "CREDITS records the CC0 license")
	return true

func test_district_night_uses_kit() -> bool:
	var packed = load("res://scenes/city/district_night.tscn")
	ctx.check(packed is PackedScene, "district_night.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "district night instantiates for the kit check")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	var names: Array[String] = []
	for child in instance.get_children():
		names.append(str(child.name))
	var has_tower := false
	var has_shop := false
	var has_lamp := false
	var has_neon := false
	var has_barrier := false
	var has_prop := false
	for n in names:
		if n.begins_with("Kit_Tower"):
			has_tower = true
		if n.begins_with("Kit_Shop"):
			has_shop = true
		if n.begins_with("Kit_Lamp"):
			has_lamp = true
		if n.begins_with("Kit_Neon"):
			has_neon = true
		if n.begins_with("Kit_Barrier"):
			has_barrier = true
		if n.begins_with("Kit_Prop"):
			has_prop = true
	ctx.check(has_tower, "night district instances tower kit buildings")
	ctx.check(has_shop, "night district instances shop kit buildings")
	ctx.check(has_lamp, "night district instances streetlamp kits")
	ctx.check(has_neon, "night district instances neon-sign kits")
	ctx.check(has_barrier, "night district instances barrier kits along the route edges")
	ctx.check(has_prop, "night district instances street-prop kits")
	for wall_name in ["WallN", "WallS", "WallE", "WallW"]:
		var wall := instance.get_node_or_null(wall_name) as StaticBody3D
		ctx.check(wall != null, "%s edge wall exists" % wall_name)
		if wall == null:
			continue
		ctx.check(wall.collision_layer == 1, "%s keeps collision_layer 1" % wall_name)
		ctx.check(wall.get_node_or_null("CollisionShape3D") != null, "%s keeps its CollisionShape3D" % wall_name)
		var stripe := wall.get_node_or_null("BarrierStripe") as MeshInstance3D
		ctx.check(stripe != null, "%s has a visible BarrierStripe mesh child" % wall_name)
		if stripe != null:
			ctx.check(stripe.mesh != null, "%s BarrierStripe mesh is set" % wall_name)
	var envs := instance.find_children("*", "WorldEnvironment", true, false)
	ctx.check(envs.size() == 1, "kit pass keeps exactly one WorldEnvironment (%d)" % envs.size())
	var suns := instance.find_children("*", "DirectionalLight3D", true, false)
	ctx.check(suns.size() == 1, "kit pass keeps exactly one DirectionalLight3D (%d)" % suns.size())
	var omnis := instance.find_children("*", "OmniLight3D", true, false)
	ctx.check(omnis.size() <= 8, "kit pass adds no lights: omnis stay in budget (%d)" % omnis.size())
	ctx.tree.root.remove_child(instance)
	instance.free()
	return true
