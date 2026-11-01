class_name VehicleController
extends RigidBody3D
## Shared arcade physics car for player and AI alike.
## Custom raycast car on a RigidBody3D: 4 RayCast3D wheels measure
## compression each physics tick; suspension (spring + bump/rebound
## damper, travel-clamped) and tire forces (load-sensitive slip-angle
## lateral force with a friction-circle cap) are applied with
## apply_force at the wheel/contact offset so weight transfer and yaw
## emerge from the solver. Engine torque curve plus a 5-speed automatic
## gearbox feeds a FWD/RWD/AWD axle split; the handbrake cuts the rear
## lateral cap and locks the rears. Flip recovery teleports safely via
## _integrate_forces. Driven at fixed 60 Hz physics.
## Input seam: with use_player_input the controller samples InputMap
## actions (accelerate/brake/steer_left/steer_right/handbrake/reset_car);
## otherwise it reads the input_throttle/input_brake/input_steer/
## input_handbrake/input_reset fields (headless tests, AI racers).

enum DriveMode { FWD, RWD, AWD }

## Suspension (per wheel).
@export var spring_rate := 36000.0
@export var damper_bump := 4500.0
@export var damper_rebound := 6000.0
@export var wheel_travel := 0.30
@export var suspension_rest_length := 0.60
## Tires.
@export var tire_grip := 1.0
@export var tire_grip_front := 1.0
@export var tire_grip_rear := 1.0
@export var cornering_stiffness := 12000.0
@export var surface_grip := 1.0
@export var roll_stiffness_front := 8000.0
@export var roll_stiffness_rear := 6500.0
@export var downforce_coefficient := 1.2
## Engine and gearbox.
@export var tune: CarTune
@export var engine_max_torque := 380.0
@export var gear_ratios: Array[float] = [3.2, 2.1, 1.5, 1.1, 0.85]
@export var final_drive := 3.9
@export var shift_up_rpm := 5500.0
@export var shift_down_rpm := 2500.0
@export var drive_mode: DriveMode = DriveMode.RWD
## Steering and brakes.
@export var max_steer_angle := 0.55
@export var steer_speed_falloff := 0.05
@export var brake_force := 5500.0
@export var handbrake_force := 2500.0
@export var handbrake_grip_factor := 0.1
## Chassis.
@export var wheel_radius := 0.33
@export var drag_linear := 60.0
@export var drag_quadratic := 1.2
@export var rolling_resistance := 150.0
@export var reverse_max_speed := 8.0

## Swappable input source: sample InputMap when true, fields when false.
@export var use_player_input := true
## Driving assists (traction/stability), default ON; synced each tick from
## the Assists child node, which in turn honors the Settings.assists hook.
@export var assists_enabled := true
var input_throttle := 0.0
var input_brake := 0.0
var input_steer := 0.0
var input_handbrake := false
var input_reset := false

## Readouts for HUD, AI, and tests.
var speed_ms := 0.0
var current_gear := 1
var engine_rpm := 800.0
var is_grounded := false

var _throttle := 0.0
var _brake := 0.0
var _steer := 0.0
var _handbrake := false
var _current_steer := 0.0
var _reversing := false
var _shift_cooldown := 0.0
var _inverted_time := 0.0
var _pending_reset := false
var _reset_was_down := false
## Overpass clearance probe: car footprint (1.8 x 4.2) plus margin and headroom.
## Fun range: probe box size covering the parked car plus clearance.
const RESET_CLEAR_EXTENTS := Vector3(2.0, 2.0, 4.4)
## Fun range: 2.0 - 6.0 m lateral search radii for the reset spiral.
const RESET_LATERAL_RADII: Array[float] = [2.0, 4.0, 6.0]
## Fun range: 0.0 - 8.0 m maximum vertical lift when laterally blocked.
const RESET_LIFT_MAX := 8.0
## Probe center sits one metre above the candidate origin (parked car height).
const RESET_PROBE_OFFSET := Vector3(0, 1.0, 0)
var _reset_target := Vector3.ZERO
var _reset_has_target := false
var _wheels: Array[Dictionary] = []


func _ready() -> void:
	apply_tune()
	for wheel_name in ["WheelFL", "WheelFR", "WheelRL", "WheelRR"]:
		var ray := get_node_or_null(wheel_name) as RayCast3D
		if ray == null:
			continue
		ray.add_exception(self)
		_wheels.append({
			"node": ray,
			"front": wheel_name == "WheelFL" or wheel_name == "WheelFR",
			"rear": wheel_name == "WheelRL" or wheel_name == "WheelRR",
			"left": wheel_name == "WheelFL" or wheel_name == "WheelRL",
			"prev_comp": 0.0,
			"comp": 0.0,
			"contact_r": Vector3.ZERO,
			"has_contact": false,
		})


func apply_tune() -> void:
	if tune == null:
		return
	if not CarTune.validate(tune):
		return
	engine_max_torque = tune.engine_torque
	gear_ratios = tune.gear_ratios.duplicate()
	final_drive = tune.final_drive
	tire_grip_front = tune.tire_grip_front
	tire_grip_rear = tune.tire_grip_rear
	roll_stiffness_front = tune.roll_stiffness_front
	roll_stiffness_rear = tune.roll_stiffness_rear
	downforce_coefficient = tune.downforce_coefficient


func reset_vehicle() -> void:
	_pending_reset = true


static func compute_suspension_force(compression: float, compression_velocity: float, spring: float, damp_bump: float, damp_rebound: float) -> float:
	var rate := damp_bump if compression_velocity >= 0.0 else damp_rebound
	return maxf(0.0, spring * maxf(compression, 0.0) + rate * compression_velocity)


static func compute_lateral_force(slip_angle: float, wheel_load: float, grip: float, stiffness: float, surface: float = 1.0, grip_factor: float = 1.0) -> float:
	var load := maxf(wheel_load, 0.0)
	var load_factor := clampf(load / 3500.0, 0.25, 1.6)
	var raw := -stiffness * slip_angle * load_factor
	var cap := grip * load * surface * grip_factor
	return clampf(raw, -cap, cap)


static func clamp_to_friction_circle(fx: float, fy: float, max_force: float, lateral_grip_factor: float = 1.0) -> Vector2:
	var capped := maxf(max_force, 0.0)
	var cx := clampf(fx, -capped, capped)
	var lat_cap := capped * clampf(lateral_grip_factor, 0.0, 1.0)
	var room := maxf(lat_cap * lat_cap - minf(cx * cx, lat_cap * lat_cap), 0.0)
	return Vector2(cx, clampf(fy, -sqrt(room), sqrt(room)))


## Deterministic reset candidates: base first, then 8 compass points at
## each radius in RESET_LATERAL_RADII (25 entries max), all sharing base y.
## Pure-static so headless tests call it with no scene.
static func reset_candidates(base: Vector3) -> Array[Vector3]:
	var out: Array[Vector3] = [base]
	var dirs: Array[Vector2] = [
		Vector2(0, -1), Vector2(1, -1).normalized(),
		Vector2(1, 0), Vector2(1, 1).normalized(),
		Vector2(0, 1), Vector2(-1, 1).normalized(),
		Vector2(-1, 0), Vector2(-1, -1).normalized(),
	]
	for radius in RESET_LATERAL_RADII:
		for d in dirs:
			out.append(Vector3(base.x + d.x * radius, base.y, base.z + d.y * radius))
	return out


## Overlap probe sized to the parked car footprint plus margin.
static func reset_probe_shape() -> BoxShape3D:
	var shape := BoxShape3D.new()
	shape.size = RESET_CLEAR_EXTENTS
	return shape


## First clearance-free reset destination at or near `desired`. Tries the
## lateral spiral at parked height, then lifts straight up from the
## original x/z; falls back to the old formula when space state is
## unavailable (freestanding instance). Never returns an intersecting pose
## when a clear one was found; when fully blocked, returns the highest
## probe rather than the intersecting original.
func find_clear_reset_position(desired: Vector3) -> Vector3:
	if not is_inside_tree():
		return desired
	var world := get_world_3d()
	if world == null:
		return desired
	var space := world.direct_space_state
	if space == null:
		return desired
	var shape := reset_probe_shape()
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.collide_with_bodies = true
	query.collide_with_areas = false
	query.exclude = [get_rid()]
	for candidate in reset_candidates(desired):
		query.transform = Transform3D(Basis(), candidate + RESET_PROBE_OFFSET)
		if space.intersect_shape(query, 1).is_empty():
			return candidate
	var lifted := desired + Vector3(0, RESET_LIFT_MAX, 0)
	var height := 1.0
	while height <= RESET_LIFT_MAX:
		var up := Vector3(desired.x, desired.y + height, desired.z)
		query.transform = Transform3D(Basis(), up + RESET_PROBE_OFFSET)
		if space.intersect_shape(query, 1).is_empty():
			return up
		height += 1.0
	return lifted


func _sample_inputs() -> void:
	if use_player_input:
		_throttle = Input.get_action_strength("accelerate")
		_brake = Input.get_action_strength("brake")
		_steer = Input.get_action_strength("steer_right") - Input.get_action_strength("steer_left")
		_handbrake = Input.is_action_pressed("handbrake")
	else:
		_throttle = clampf(input_throttle, 0.0, 1.0)
		_brake = clampf(input_brake, 0.0, 1.0)
		_steer = clampf(input_steer, -1.0, 1.0)
		_handbrake = input_handbrake


func _sample_torque(rpm: float) -> float:
	var pts: Array[Vector2] = [
		Vector2(800.0, 0.55), Vector2(1500.0, 0.75), Vector2(3000.0, 1.0),
		Vector2(4500.0, 1.0), Vector2(5500.0, 0.85), Vector2(6500.0, 0.6),
		Vector2(7200.0, 0.4),
	]
	if rpm <= pts[0].x:
		return engine_max_torque * pts[0].y
	for i in range(1, pts.size()):
		if rpm <= pts[i].x:
			var t := (rpm - pts[i - 1].x) / (pts[i].x - pts[i - 1].x)
			return engine_max_torque * lerpf(pts[i - 1].y, pts[i].y, t)
	return engine_max_torque * pts[pts.size() - 1].y


func _driven_wheel_count() -> int:
	match drive_mode:
		DriveMode.FWD, DriveMode.RWD:
			return 2
		_:
			return 4


func _is_driven(front: bool) -> bool:
	match drive_mode:
		DriveMode.FWD:
			return front
		DriveMode.RWD:
			return not front
		_:
			return true


func _apply_anti_roll(up: Vector3) -> void:
	for is_front in [true, false]:
		var stiffness := roll_stiffness_front if is_front else roll_stiffness_rear
		var left_comp := 0.0
		var right_comp := 0.0
		var left_r := Vector3.ZERO
		var right_r := Vector3.ZERO
		var left_ok := false
		var right_ok := false
		for w in _wheels:
			if bool(w["front"]) != is_front:
				continue
			if not bool(w.get("has_contact", false)):
				continue
			if bool(w.get("left", false)):
				left_comp = float(w.get("comp", 0.0))
				left_r = w.get("contact_r", Vector3.ZERO)
				left_ok = true
			else:
				right_comp = float(w.get("comp", 0.0))
				right_r = w.get("contact_r", Vector3.ZERO)
				right_ok = true
		if not (left_ok and right_ok):
			continue
		var transfer := stiffness * (left_comp - right_comp)
		apply_force(up * transfer, left_r)
		apply_force(up * -transfer, right_r)


func _physics_process(delta: float) -> void:
	_sample_inputs()
	var basis_xform := global_transform.basis
	var up := basis_xform.y
	var fwd := -basis_xform.z
	var right := basis_xform.x
	var forward_speed := linear_velocity.dot(fwd)
	speed_ms = forward_speed

	# Speed-sensitive front steering, smoothed toward target.
	var assisted_steer := VehicleAssists.correct_steer(_steer, forward_speed, assists_enabled)
	var steer_target := assisted_steer * max_steer_angle / (1.0 + absf(forward_speed) * steer_speed_falloff)
	_current_steer = move_toward(_current_steer, steer_target, 5.0 * delta)

	# Reverse latch (AI contract — replicate this sequence, don't just set brake):
	# 1. Release throttle and slow to near-standstill (forward_speed in
	#    (-0.5, 0.8)) with current_gear == 1 via the auto downshift cascade.
	# 2. Hold brake above 0.5 to latch _reversing; brake at speed only
	#    decelerates and never reverses.
	# 3. Keep holding brake to back up toward reverse_max_speed (brake
	#    doubles as reverse throttle while latched).
	# 4. Any throttle unlatches back to forward drive.
	if _brake > 0.5 and forward_speed > -0.5 and forward_speed < 0.8 and current_gear == 1 and _throttle < 0.05:
		_reversing = true
	if _throttle > 0.05:
		_reversing = false

	# Engine force from the torque curve at the current rpm and gear.
	var gear_ratio: float = gear_ratios[clampi(current_gear - 1, 0, gear_ratios.size() - 1)]
	var engine_force_total := _throttle * _sample_torque(engine_rpm) * gear_ratio * final_drive / wheel_radius
	var driven_count := _driven_wheel_count()

	var grounded := 0
	for w in _wheels:
		var ray: RayCast3D = w["node"]
		ray.force_raycast_update()
		var front: bool = w["front"]
		var rear: bool = w["rear"]

		# Suspension: compression from ray length, damper from its rate.
		var comp := 0.0
		var contact := ray.global_transform.origin + ray.target_position
		var has_contact := false
		if ray.is_colliding():
			var hit := ray.get_collision_point()
			contact = hit
			comp = clampf(suspension_rest_length - ray.global_transform.origin.distance_to(hit), 0.0, wheel_travel)
			has_contact = true
			grounded += 1
		var prev_comp: float = w["prev_comp"]
		var comp_vel := (comp - prev_comp) / maxf(delta, 0.0001)
		w["prev_comp"] = comp
		w["comp"] = comp
		w["has_contact"] = has_contact
		if not has_contact:
			w["contact_r"] = Vector3.ZERO
			continue
		var susp := compute_suspension_force(comp, comp_vel, spring_rate, damper_bump, damper_rebound)

		var r := contact - global_position
		w["contact_r"] = r
		var vel := linear_velocity + angular_velocity.cross(r)
		var wheel_steer := _current_steer if front else 0.0
		var w_fwd := fwd * cos(wheel_steer) + right * sin(wheel_steer)
		var w_right := right * cos(wheel_steer) - fwd * sin(wheel_steer)
		var f_speed := vel.dot(w_fwd)
		var l_speed := vel.dot(w_right)
		var slip := atan2(l_speed, absf(f_speed) + 1.0)
		var ramp := clampf(absf(f_speed) / 2.0, 0.0, 1.0)

		# Longitudinal: drive split per drive_mode, service brake on all
		# wheels, handbrake lock on the rears.
		var fx := 0.0
		if _reversing and _is_driven(front):
			if f_speed > -reverse_max_speed:
				fx = -_brake * engine_max_torque * 0.6 * gear_ratios[0] * final_drive / wheel_radius / float(driven_count)
		elif _is_driven(front):
			fx += engine_force_total / float(driven_count)
		if _handbrake and rear:
			if absf(f_speed) > 0.5:
				fx += -signf(f_speed) * handbrake_force
			else:
				fx += -f_speed * handbrake_force * 2.0
		elif _brake > 0.01 and not _reversing:
			if absf(f_speed) > 0.5:
				fx += -signf(f_speed) * _brake * brake_force
			else:
				fx += -f_speed * _brake * brake_force * 2.0

		var lat_factor := handbrake_grip_factor if (_handbrake and rear) else 1.0
		var axle_grip := tire_grip_front if front else tire_grip_rear
		var fy_raw := compute_lateral_force(slip, susp, axle_grip, cornering_stiffness, surface_grip, lat_factor) * ramp
		var fy := VehicleAssists.damp_slip(fy_raw, assists_enabled)
		var max_f := axle_grip * susp * surface_grip
		var capped := clamp_to_friction_circle(fx, fy, max_f, lat_factor)
		apply_force(up * susp + w_fwd * capped.x + w_right * capped.y, r)

	_apply_anti_roll(up)
	var planar_speed := Vector2(linear_velocity.x, linear_velocity.z).length()
	if planar_speed > 0.01:
		apply_central_force(-up * downforce_coefficient * planar_speed * planar_speed)

	is_grounded = grounded > 0

	# Central drag plus rolling resistance.
	var horizontal := Vector3(linear_velocity.x, 0.0, linear_velocity.z)
	var drag_force := -horizontal * (drag_linear + drag_quadratic * horizontal.length())
	apply_central_force(drag_force)
	if absf(forward_speed) > 0.1:
		apply_central_force(-fwd * signf(forward_speed) * rolling_resistance)

	# Automatic gearbox with shift hysteresis from vehicle speed.
	var wheel_rps := absf(forward_speed) / (TAU * wheel_radius)
	engine_rpm = maxf(800.0, wheel_rps * gear_ratio * final_drive * 60.0)
	_shift_cooldown -= delta
	if not _reversing and _shift_cooldown <= 0.0:
		if current_gear < gear_ratios.size() and engine_rpm > shift_up_rpm:
			current_gear += 1
			_shift_cooldown = 0.4
		elif current_gear > 1 and engine_rpm < shift_down_rpm:
			current_gear -= 1
			_shift_cooldown = 0.4

	# Reset on demand (press edge) plus automatic recovery when inverted
	# and slow. The edge fires once per press so holding the key parks
	# the car instead of climbing.
	if up.y < 0.3 and linear_velocity.length() < 3.0:
		_inverted_time += delta
	else:
		_inverted_time = 0.0
	var reset_down := Input.is_action_pressed("reset_car") if use_player_input else input_reset
	if reset_down and not _reset_was_down:
		_pending_reset = true
	_reset_was_down = reset_down
	if _inverted_time > 1.0:
		_pending_reset = true
	if _pending_reset and not _reset_has_target:
		var parked := Vector3(global_position.x, maxf(global_position.y, 0.0) + 1.0, global_position.z)
		_reset_target = find_clear_reset_position(parked)
		_reset_has_target = true


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	if not _pending_reset:
		return
	_pending_reset = false
	var t := state.transform
	var fwd_flat := -t.basis.z
	fwd_flat.y = 0.0
	var yaw := 0.0
	if fwd_flat.length() > 0.01:
		yaw = atan2(-fwd_flat.x, -fwd_flat.z)
	var pos := t.origin
	if _reset_has_target:
		pos = _reset_target
		_reset_has_target = false
	else:
		pos = Vector3(pos.x, maxf(pos.y, 0.0) + 1.0, pos.z)
	state.transform = Transform3D(Basis(Vector3.UP, yaw), pos)
	state.linear_velocity = Vector3.ZERO
	state.angular_velocity = Vector3.ZERO
	current_gear = 1
	engine_rpm = 800.0
	_reversing = false
	_inverted_time = 0.0
	_current_steer = 0.0
