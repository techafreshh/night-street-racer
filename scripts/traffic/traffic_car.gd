class_name TrafficCar
extends AnimatableBody3D
## Kinematic lane follower for ambient district traffic. Samples its assigned
## Path3D lane by baked distance, steers from the curve tangent, and eases
## toward a target speed chosen by a forward RayCast3D (blocked -> 0.0,
## clear -> cruise). Motion is a direct global_transform write, never a
## physics force, so traffic cannot shove the player's RigidBody3D. A missing,
## empty, or degenerate lane stops the car safely instead of erroring.

const ACCEL_RATE := 6.0
const BRAKE_RATE := 12.0
const SAMPLE_COUNT := 64

@export var lane: Path3D = null
@export var progress: float = 0.0
@export var cruise_speed: float = 9.0

var speed_ms: float = 0.0

var _speed: float = 0.0

@onready var yield_ray: RayCast3D = get_node_or_null("YieldRay") as RayCast3D


static func wanted_speed(blocked: bool, cruise: float) -> float:
	if blocked:
		return 0.0
	return cruise


static func closest_progress(curve: Curve3D, target: Vector3) -> float:
	if curve == null:
		return 0.0
	if curve.get_point_count() < 2:
		return 0.0
	var length := curve.get_baked_length()
	if length < 1.0:
		return 0.0
	var best := 0.0
	var best_d := INF
	for i in SAMPLE_COUNT:
		var off := length * float(i) / float(SAMPLE_COUNT)
		var d := curve.sample_baked(off).distance_squared_to(target)
		if d < best_d:
			best_d = d
			best = off
	return best


func setup(p_lane: Path3D, p_progress: float, p_cruise: float) -> void:
	lane = p_lane
	cruise_speed = p_cruise
	progress = p_progress
	snap_to_lane()


func snap_to_lane() -> void:
	if lane == null or not is_instance_valid(lane):
		return
	var curve := lane.curve
	if curve == null or curve.get_point_count() < 2:
		return
	var length := curve.get_baked_length()
	if length < 1.0:
		return
	progress = fposmod(progress, length)
	global_transform = Transform3D(_lane_basis(progress, length), _lane_position(progress))


func is_blocked() -> bool:
	if yield_ray == null or not is_instance_valid(yield_ray):
		yield_ray = get_node_or_null("YieldRay") as RayCast3D
	if yield_ray == null:
		return false
	return yield_ray.is_colliding()


func _physics_process(delta: float) -> void:
	var curve: Curve3D = null
	if lane != null and is_instance_valid(lane):
		curve = lane.curve
	if curve == null or curve.get_point_count() < 2 or curve.get_baked_length() < 1.0:
		_speed = move_toward(_speed, 0.0, BRAKE_RATE * delta)
		speed_ms = _speed
		return
	var length := curve.get_baked_length()
	var target := wanted_speed(is_blocked(), cruise_speed)
	var rate := ACCEL_RATE if target > _speed else BRAKE_RATE
	_speed = move_toward(_speed, target, rate * delta)
	speed_ms = _speed
	progress = fposmod(progress + _speed * delta, length)
	global_transform = Transform3D(_lane_basis(progress, length), _lane_position(progress))


func _lane_position(offset: float) -> Vector3:
	return lane.to_global(lane.curve.sample_baked(offset))


func _lane_basis(offset: float, length: float) -> Basis:
	var here := _lane_position(offset)
	var ahead := lane.to_global(lane.curve.sample_baked(fposmod(offset + 1.0, length)))
	var dir := ahead - here
	if dir.length_squared() < 0.000001:
		return global_transform.basis
	dir = dir.normalized()
	if absf(dir.dot(Vector3.UP)) > 0.999:
		return global_transform.basis
	return Basis.looking_at(dir, Vector3.UP)
