class_name VehicleFX
extends Node
## Per-car effects layer: tire smoke, skid marks, and lamp feedback.
## Parent this to a VehicleController; each tick it reads the parent's
## physics readouts (wheel_slips, slip_intensity, brake_lockup, _brake,
## _handbrake, speed_ms, is_grounded) and drives three pooled outputs:
## four preloaded tire_smoke emitters (one per wheel), one ring-buffered
## SkidMarks trail, and code-built headlight/brake-light feedback.
## Detection reads controller state, never InputMap, so player-driven and
## field-driven (input_*) slip both trigger it. The force_slip seam
## (export property, --fx-force-slip CLI user arg, FX_FORCE_SLIP env)
## flows through the same emission path so a parked headless boot still
## exercises FX genuinely. Fixed-step dual tick (_physics_process
## authoritative, _process mirrors with STEP) follows event_manager.gd so
## headless --quit-after budgets observe FX_ACTIVE even when physics lags.
## Tolerates a null/wrong parent so headless scene probes never error.

const SMOKE_SCENE: PackedScene = preload("res://scenes/fx/tire_smoke.tscn")
const WHEEL_NAMES: Array[String] = ["WheelFL", "WheelFR", "WheelRL", "WheelRR"]
const WHEEL_FALLBACK: Array[Vector3] = [
	Vector3(-0.85, 0.0, -1.35), Vector3(0.85, 0.0, -1.35),
	Vector3(-0.85, 0.0, 1.35), Vector3(0.85, 0.0, 1.35),
]
const SLIP_THRESHOLD := 0.25
const STEP := 1.0 / 60.0
const HEARTBEAT_TICKS := 60

## Test/acceptance seam: forces smoke + marks through the normal path.
@export var force_slip := false
## Live readout: true while any smoke emitter is firing this tick.
var fx_active := false
## Mirrors /root/Settings camera_shake (assists.gd poll idiom); the chase
## camera owns the actual shake, FX only honors the toggle.
var shake_enabled := true

var _emitters: Array[GPUParticles3D] = []
var _skids: SkidMarks = null
var _headlight: SpotLight3D = null
var _brake_mats: Array[StandardMaterial3D] = []
var _announced := false
var _heartbeat := 0
var _built := false


func _ready() -> void:
	_resolve_force_slip()
	_poll_settings()
	# Deferred: _ready runs while the parent car is still setting up its
	# children, so add_child() here would fail outright (the CarPaint
	# idiom only mutates in _ready for the same reason). The build lands
	# on the first idle frame, well inside any headless boot budget.
	call_deferred("_build")


func _build() -> void:
	if _built:
		return
	if not is_inside_tree():
		return
	var car := get_parent() as Node3D
	if car == null:
		return
	_built = true
	for i in WHEEL_NAMES.size():
		var anchor: Vector3 = WHEEL_FALLBACK[i]
		var wheel := (car as Node).get_node_or_null(WHEEL_NAMES[i]) as Node3D
		if wheel != null:
			anchor = wheel.position
		var puff := SMOKE_SCENE.instantiate() as GPUParticles3D
		if puff == null:
			continue
		puff.name = "TireSmoke%s" % WHEEL_NAMES[i].right(2)
		puff.emitting = false
		car.add_child(puff)
		puff.position = anchor + Vector3(0, -0.25, 0)
		_emitters.append(puff)
	_skids = SkidMarks.new()
	_skids.name = "SkidMarks"
	car.add_child(_skids)
	_build_lights(car as Node)


## CLI user args (--fx-force-slip after the lone --) or the FX_FORCE_SLIP
## env var latch force_slip on; the export property covers editor/tests.
func _resolve_force_slip() -> void:
	if force_slip:
		return
	for arg in OS.get_cmdline_user_args():
		if arg == "--fx-force-slip":
			force_slip = true
			return
	if OS.get_environment("FX_FORCE_SLIP") == "1":
		force_slip = true


## Single forward SpotLight3D plus emissive headlamp quads up front and
## brake-light quads at the rear; brake mats brighten while braking.
func _build_lights(car: Node) -> void:
	var body := car as Node3D
	if body == null:
		return
	_headlight = SpotLight3D.new()
	_headlight.name = "Headlight"
	_headlight.position = Vector3(0, 1.2, -2.0)
	_headlight.light_energy = 2.0
	_headlight.spot_range = 25.0
	_headlight.spot_angle = 30.0
	body.add_child(_headlight)
	for side in [-1.0, 1.0]:
		var lamp := _make_quad(Color(1.0, 0.95, 0.8), 3.0)
		lamp.name = "Headlamp%d" % int(side)
		body.add_child(lamp)
		lamp.position = Vector3(0.6 * side, 0.6, -2.12)
		lamp.rotation.y = PI
		var brake_mat := _make_glow_mat(Color(0.6, 0.05, 0.05), 0.9)
		var brake := MeshInstance3D.new()
		brake.name = "Brakelight%d" % int(side)
		var quad := QuadMesh.new()
		quad.material = brake_mat
		quad.size = Vector2(0.35, 0.18)
		brake.mesh = quad
		body.add_child(brake)
		brake.position = Vector3(0.6 * side, 0.7, 2.12)
		_brake_mats.append(brake_mat)


func _make_glow_mat(tint: Color, energy: float) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = tint
	mat.emission_enabled = true
	mat.emission = tint
	mat.emission_energy_multiplier = energy
	return mat


func _make_quad(tint: Color, energy: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.material = _make_glow_mat(tint, energy)
	quad.size = Vector2(0.35, 0.18)
	mi.mesh = quad
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


func _physics_process(delta: float) -> void:
	_tick(delta, true)


func _process(_delta: float) -> void:
	_tick(STEP, false)


func _tick(step: float, allow_skid: bool) -> void:
	if not is_inside_tree():
		return
	_poll_settings()
	var car := get_parent() as VehicleController
	if car == null:
		fx_active = false
		return
	var slips := _read_slips(car)
	var handbrake: bool = car.get("_handbrake")
	var braking: bool = float(car.get("_brake")) > 0.05
	var lockup: bool = bool(car.get("brake_lockup"))
	var speed: float = car.speed_ms
	var active_any := force_slip
	var per_wheel: Array[bool] = []
	for i in slips.size():
		var hot := force_slip or slips[i] > SLIP_THRESHOLD or lockup
		if not hot and handbrake and speed > 5.0:
			hot = true
		per_wheel.append(hot)
		active_any = active_any or hot
	if not active_any and car.slip_intensity > SLIP_THRESHOLD:
		active_any = true
	for i in mini(per_wheel.size(), _emitters.size()):
		var puff := _emitters[i]
		if is_instance_valid(puff):
			puff.emitting = per_wheel[i]
	if allow_skid and _skids != null and is_instance_valid(_skids):
		if car.is_grounded and (active_any or car.slip_intensity > SLIP_THRESHOLD):
			_add_skid_rung(car)
	_update_brake_lights(car, braking)
	_announce(step, car, active_any)


func _read_slips(car: VehicleController) -> Array[float]:
	var out: Array[float] = [0.0, 0.0, 0.0, 0.0]
	var raw: Array[float] = car.wheel_slips
	for i in mini(out.size(), raw.size()):
		out[i] = raw[i]
	return out


func _add_skid_rung(car: VehicleController) -> void:
	var body := car as Node3D
	if body == null:
		return
	var left := Vector3(-0.85, -0.55, 1.35)
	var right := Vector3(0.85, -0.55, 1.35)
	var rl := body.get_node_or_null("WheelRL") as Node3D
	var rr := body.get_node_or_null("WheelRR") as Node3D
	if rl != null:
		left = body.to_local(rl.global_position) + Vector3(0, -0.35, 0)
	if rr != null:
		right = body.to_local(rr.global_position) + Vector3(0, -0.35, 0)
	_skids.add_segment(body.to_global(left), body.to_global(right))


func _update_brake_lights(car: VehicleController, braking: bool) -> void:
	var reversing: bool = car.get("_reversing")
	var hot := braking or reversing
	for mat in _brake_mats:
		if is_instance_valid(mat):
			mat.emission_energy_multiplier = 4.0 if hot else 0.9


func _announce(step: float, car: VehicleController, active_any: bool) -> void:
	fx_active = active_any
	if step <= 0.0:
		return
	if active_any and not _announced:
		_announced = true
		_heartbeat = 0
		print("FX_ACTIVE slip=%.2f speed=%.1f" % [car.slip_intensity, car.speed_ms])
	elif active_any:
		_heartbeat += 1
		if _heartbeat >= HEARTBEAT_TICKS:
			_heartbeat = 0
			print("FX_ACTIVE slip=%.2f speed=%.1f" % [car.slip_intensity, car.speed_ms])
	else:
		_announced = false
		_heartbeat = 0


## Poll /root/Settings camera_shake exactly like assists.gd does.
func _poll_settings() -> void:
	if not is_inside_tree() or get_tree() == null:
		return
	var settings := get_node_or_null("/root/Settings")
	if settings == null:
		return
	for prop in settings.get_property_list():
		if prop.get("name") == "camera_shake":
			shake_enabled = bool(settings.get("camera_shake"))
			break


## Stop emitters and empty the trail while siblings are still valid
## (the car_paint.gd _exit_tree cleanup idiom); the tree frees the rest.
func _exit_tree() -> void:
	_built = false
	for puff in _emitters:
		if is_instance_valid(puff):
			puff.emitting = false
	_emitters.clear()
	if _skids != null and is_instance_valid(_skids):
		_skids.clear()
	_headlight = null
	_brake_mats.clear()
