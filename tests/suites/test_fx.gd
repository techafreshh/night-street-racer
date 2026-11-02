extends RefCounted
## Effects probes: tire smoke, skid marks, and speed feel. One of the
## per-area probe suites executed in fixed order by tests/run_all.gd;
## see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

const CAR_SCENES: Array[String] = [
	"res://scenes/vehicles/vehicle_base.tscn",
	"res://scenes/vehicles/car_sedan.tscn",
	"res://scenes/vehicles/car_coupe.tscn",
	"res://scenes/vehicles/car_hatch.tscn",
	"res://scenes/vehicles/car_awd.tscn",
	"res://scenes/vehicles/ai_car.tscn",
]

var ctx: TestContext


func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx


func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_fx_files_exist",
		"test_tire_smoke_scene",
		"test_skid_marks_api",
		"test_vehicle_fx_wiring",
		"test_slip_activation",
		"test_parked_silent",
		"test_force_slip_path",
		"test_shake_respect",
	]
	return names


func test_fx_files_exist() -> bool:
	ctx.check(FileAccess.file_exists("res://scenes/fx/tire_smoke.tscn"), "scenes/fx/tire_smoke.tscn exists")
	ctx.check(FileAccess.file_exists("res://scripts/fx/skid_marks.gd"), "scripts/fx/skid_marks.gd exists")
	ctx.check(FileAccess.file_exists("res://scripts/fx/vehicle_fx.gd"), "scripts/fx/vehicle_fx.gd exists")
	return true


func test_tire_smoke_scene() -> bool:
	var packed := load("res://scenes/fx/tire_smoke.tscn") as PackedScene
	ctx.check(packed != null, "tire_smoke.tscn loads as PackedScene")
	if packed == null:
		return true
	var inst := packed.instantiate() as GPUParticles3D
	ctx.check(inst != null, "tire_smoke root is GPUParticles3D")
	if inst == null:
		return true
	ctx.check(inst.amount <= 32, "smoke budget capped (amount %d <= 32)" % inst.amount)
	ctx.check(inst.amount == 24, "smoke budget is 24 particles (got %d)" % inst.amount)
	ctx.check(inst.emitting == false, "smoke idles with emitting=false")
	ctx.check(inst.local_coords == false, "smoke trails in world space (local_coords=false)")
	ctx.check(inst.process_material is ParticleProcessMaterial, "smoke drives a procedural ParticleProcessMaterial")
	ctx.check(inst.draw_pass_1 != null, "smoke has a draw pass mesh (no external textures)")
	inst.free()
	return true


func test_skid_marks_api() -> bool:
	var cls := load("res://scripts/fx/skid_marks.gd") as GDScript
	ctx.check(cls != null, "skid_marks.gd loads as GDScript")
	if cls == null:
		return true
	var trail := cls.new() as Node3D
	ctx.check(trail != null, "SkidMarks instantiates freestanding")
	if trail == null:
		return true
	ctx.check(int(trail.get("MAX_SEGMENTS")) == 256, "skid trail capped at 256 segments")
	ctx.check(absf(float(trail.get("FADE_TIME")) - 8.0) < 0.01, "skid trail fades over ~8 s")
	for i in 300:
		var p := Vector3(float(i) * 0.1, 0.03, 0.0)
		trail.call("add_segment", p + Vector3(-0.8, 0, 0), p + Vector3(0.8, 0, 0))
	ctx.check(int(trail.call("segment_count")) <= 256, "300 rungs stay within the 256 cap (got %d)" % int(trail.call("segment_count")))
	ctx.check(int(trail.call("segment_count")) == 256, "ring buffer holds the newest 256 rungs (got %d)" % int(trail.call("segment_count")))
	trail.call("clear")
	ctx.check(int(trail.call("segment_count")) == 0, "clear() empties the trail")
	trail.free()
	return true


func test_vehicle_fx_wiring() -> bool:
	for path in CAR_SCENES:
		var packed := load(path) as PackedScene
		ctx.check(packed != null, "%s loads as PackedScene" % path)
		if packed == null:
			continue
		var inst := packed.instantiate()
		ctx.check(inst != null, "%s instantiates" % path)
		if inst == null:
			continue
		var fx := inst.get_node_or_null("VehicleFX")
		ctx.check(fx != null, "%s carries a VehicleFX child" % path.get_file())
		if fx != null:
			ctx.check(bool(fx.get("force_slip")) == false, "%s force_slip defaults off" % path.get_file())
			ctx.check(bool(fx.get("fx_active")) == false, "%s fx_active idles off" % path.get_file())
		inst.free()
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	for i in 10:
		await ctx.tree.physics_frame
	var fx := car.get_node_or_null("VehicleFX")
	ctx.check(fx != null, "live car keeps its VehicleFX node")
	if fx != null:
		var puffs := 0
		for child in car.get_children():
			if child is GPUParticles3D and String(child.name).begins_with("TireSmoke"):
				puffs += 1
		ctx.check(puffs == 4, "live car pools 4 smoke emitters (got %d)" % puffs)
		ctx.check(car.get_node_or_null("SkidMarks") != null, "live car carries a SkidMarks node")
		var spots := 0
		for child in car.get_children():
			if child is SpotLight3D:
				spots += 1
		ctx.check(spots == 1, "live car adds exactly one headlight SpotLight (got %d)" % spots)
	await ctx._despawn_car()
	return true


func _drive_to_speed(car: VehicleController, target: float, max_frames: int) -> void:
	car.use_player_input = false
	car.input_throttle = 1.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.input_handbrake = false
	for i in max_frames:
		await ctx.tree.physics_frame
		if car.speed_ms >= target:
			break


func _any_smoke_on(car: Node) -> bool:
	for child in car.get_children():
		if child is GPUParticles3D and String(child.name).begins_with("TireSmoke"):
			if (child as GPUParticles3D).emitting:
				return true
	return false


func test_slip_activation() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	await _drive_to_speed(car, 12.0, 10 * 60)
	ctx.check(car.speed_ms >= 8.0, "reaches slide speed for the FX probe (%.2f m/s)" % car.speed_ms)
	car.input_throttle = 0.3
	car.input_steer = 1.0
	car.input_handbrake = true
	var slipped := false
	var smoked := false
	for i in 120:
		await ctx.tree.physics_frame
		if car.slip_intensity > 0.25:
			slipped = true
		if _any_smoke_on(car):
			smoked = true
		if slipped and smoked:
			break
	ctx.check(slipped, "handbrake slide pushes slip_intensity past 0.25 (got %.3f)" % car.slip_intensity)
	ctx.check(smoked, "slip lights a smoke emitter within 120 frames")
	var fx := car.get_node_or_null("VehicleFX")
	if fx != null:
		ctx.check(bool(fx.get("fx_active")), "VehicleFX reports fx_active while sliding")
	await ctx._despawn_car()
	return true


func test_parked_silent() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.input_handbrake = false
	for i in 30:
		await ctx.tree.physics_frame
	ctx.check(not _any_smoke_on(car), "parked car emits no smoke")
	var fx := car.get_node_or_null("VehicleFX")
	if fx != null:
		ctx.check(not bool(fx.get("fx_active")), "parked car reports fx_active=false")
	await ctx._despawn_car()
	return true


func test_force_slip_path() -> bool:
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	car.use_player_input = false
	car.input_throttle = 0.0
	car.input_brake = 0.0
	car.input_steer = 0.0
	car.input_handbrake = false
	var fx := car.get_node_or_null("VehicleFX")
	ctx.check(fx != null, "live car exposes VehicleFX for the force_slip seam")
	if fx == null:
		await ctx._despawn_car()
		return true
	fx.set("force_slip", true)
	var smoked := false
	for i in 30:
		await ctx.tree.physics_frame
		if _any_smoke_on(car):
			smoked = true
			break
	ctx.check(smoked, "force_slip fires smoke from standstill through the same path")
	ctx.check(bool(fx.get("fx_active")), "force_slip reports fx_active from standstill")
	var src := FileAccess.get_file_as_string("res://scripts/fx/vehicle_fx.gd")
	ctx.check(src.contains("--fx-force-slip"), "vehicle_fx honors the --fx-force-slip CLI seam")
	ctx.check(src.contains("FX_FORCE_SLIP"), "vehicle_fx honors the FX_FORCE_SLIP env seam")
	await ctx._despawn_car()
	return true


func test_shake_respect() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/fx/vehicle_fx.gd")
	ctx.check(src.contains("camera_shake"), "vehicle_fx polls the camera_shake setting")
	var car := await ctx._spawn_car(Vector3(0, 0.9, 0))
	for i in 5:
		await ctx.tree.physics_frame
	var fx := car.get_node_or_null("VehicleFX")
	ctx.check(fx != null, "live car exposes VehicleFX for the shake check")
	if fx == null:
		await ctx._despawn_car()
		return true
	ctx.check(bool(fx.get("shake_enabled")) == true, "shake defaults on like the chase camera")
	var settings := ctx.tree.root.get_node_or_null("Settings")
	if settings != null:
		settings.set("camera_shake", false)
		for i in 5:
			await ctx.tree.physics_frame
		ctx.check(bool(fx.get("shake_enabled")) == false, "VehicleFX follows Settings.camera_shake off")
		settings.set("camera_shake", true)
		for i in 5:
			await ctx.tree.physics_frame
		ctx.check(bool(fx.get("shake_enabled")) == true, "VehicleFX follows Settings.camera_shake on")
	await ctx._despawn_car()
	return true
