class_name AIRacerInput
extends Node
## Pure-pursuit AI bridge into a VehicleController's input_* fields.
## Parent this to a VehicleController with use_player_input == false so the
## controller's _sample_inputs seam reads the fields this node writes.
## Returns early when the parent is not a VehicleController or when the car
## samples InputMap directly (use_player_input == true). Steering pursues a
## speed-scaled lookahead point on the racing line; throttle/brake track the
## line's baked curvature target speed at the car's current position (which
## already encodes braking distance). Never reads InputMap and never sets
## input_reset/input_handbrake.

@export var racing_line: RacingLine
@export var lookahead_base := 4.0
@export var lookahead_gain := 0.5
@export var lookahead_max := 16.0
@export var steer_gain := 1.5
@export var ang_damp := 0.3
@export var throttle_gain := 0.5
@export var brake_gain := 0.4
@export var deadband := 0.5

var laps_completed := 0

var _progress := 0.0
var _has_left_start := false
var _last_idx := 0
var _seeded := false
var _prev_yaw := 0.0
var _seeded_yaw := false
var _prev_ang := 0.0


func _ready() -> void:
	if racing_line != null:
		racing_line.target_speeds()


func _physics_process(_delta: float) -> void:
	var car := get_parent() as VehicleController
	if car == null or car.use_player_input:
		return
	if racing_line == null or racing_line.points.size() < 2:
		return
	if not _seeded:
		_last_idx = racing_line.closest_index(car.global_position)
		_progress = 0.0
		_seeded = true
	var speed := car.speed_ms
	var lookahead := clampf(lookahead_base + lookahead_gain * speed, lookahead_base, lookahead_max)
	var look := racing_line.lookahead_point(car.global_position, lookahead)
	var fwd := -car.global_transform.basis.z
	fwd.y = 0.0
	if fwd.length() < 0.01:
		fwd = Vector3(0, 0, -1)
	fwd = fwd.normalized()
	var yaw := atan2(-fwd.x, -fwd.z)
	var yaw_rate := 0.0
	if _seeded_yaw:
		yaw_rate = wrapf(yaw - _prev_yaw, -PI, PI) / maxf(_delta, 0.0001)
	_prev_yaw = yaw
	_seeded_yaw = true
	var to := look - car.global_position
	to.y = 0.0
	var ang := 0.0
	var dang := 0.0
	if to.length() > 0.05:
		var want := to.normalized()
		ang = wrapf(atan2(-want.x, -want.z) - atan2(-fwd.x, -fwd.z), -PI, PI)
		dang = wrapf(ang - _prev_ang, -PI, PI) / maxf(_delta, 0.0001)
		car.input_steer = clampf(-steer_gain * ang - ang_damp * dang, -1.0, 1.0)
	else:
		car.input_steer = 0.0
	_prev_ang = ang
	var s_car := racing_line.arc_of(car.global_position)
	var idx := racing_line.closest_index(car.global_position)
	var look_idx := racing_line.closest_index(look)
	var kappa := maxf(
		RacingLine.curvature_of(racing_line.points, idx, racing_line.loop),
		RacingLine.curvature_of(racing_line.points, look_idx, racing_line.loop))
	var lat_load := maxf(absf(yaw_rate) * absf(speed), speed * speed * kappa)
	var target := minf(racing_line.speed_at_arc(s_car), racing_line.speed_at_arc(s_car + lookahead))
	# Shed speed when pointing off-track: the tires cannot cash a large
	# heading correction at speed, so slow until the turn is achievable.
	target *= clampf(1.2 - absf(ang) * 1.5, 0.35, 1.0)
	var band := get_parent().get_node_or_null("RubberBand")
	if band != null and band.get("enabled") == true:
		target = clampf(target + float(band.get("current_aid")), 0.0, racing_line.max_speed + float(band.get("max_aid_s")))
	var err := target - speed
	if err > deadband:
		var thr_cap := RacingLine.throttle_cap(lat_load)
		car.input_throttle = minf(clampf(err * throttle_gain, 0.0, 1.0), thr_cap)
		car.input_brake = 0.0
	elif err < -deadband:
		car.input_brake = clampf(-err * brake_gain, 0.0, 1.0)
		car.input_throttle = 0.0
	else:
		car.input_throttle = 0.0
		car.input_brake = 0.0
	var n := racing_line.points.size()
	var step := posmod(idx - _last_idx, n)
	if step > n / 2:
		step -= n
	_progress += float(step)
	_last_idx = idx
	var start_gap := Vector2(
		car.global_position.x - racing_line.points[0].x,
		car.global_position.z - racing_line.points[0].z
	).length()
	if start_gap > 10.0:
		_has_left_start = true
	if _has_left_start and _progress >= float(n):
		laps_completed += 1
		_progress -= float(n)
		_has_left_start = false
