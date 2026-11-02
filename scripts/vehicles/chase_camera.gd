extends Camera3D
## Speed-reactive chase camera for the MW05 feel.
## Parent this to a VehicleController; each frame it trails behind the car
## with exponential position lag, widens FOV 70 -> 85 with speed, and adds
## a deterministic sine-based micro-shake (no randf, no autoloads).
## Tolerates a null/wrong parent so headless scene probes never error.

@export var follow_distance := 7.0
@export var follow_height := 3.0
@export var lookahead_distance := 4.0
@export var position_smoothing := 6.0
@export var camera_shake := true
@export var shake_amplitude := 0.06

var _time := 0.0
var _was_looking_back := false


func _ready() -> void:
	current = true
	fov = 70.0


func _process(delta: float) -> void:
	var car := get_parent() as VehicleController
	if car == null:
		return
	_time += delta
	var speed := absf(car.speed_ms)
	var t := clampf(speed / 40.0, 0.0, 1.0)
	fov = lerpf(70.0, 85.0, t)
	var car_basis := car.global_transform.basis
	var fwd := -car_basis.z
	# Look-back is view-only: while held, snap to the mirrored front slot
	# and aim back at the car; on release snap back to the trail slot so
	# the next frames resume the normal smoothed chase.
	var looking_back := Input.is_action_pressed("look_back")
	var target := car.global_position + car_basis.z * follow_distance + Vector3.UP * follow_height
	var look := car.global_position + fwd * lookahead_distance + Vector3.UP * 1.2
	if looking_back:
		target = car.global_position + fwd * follow_distance + Vector3.UP * follow_height
		look = car.global_position - fwd * lookahead_distance + Vector3.UP * 1.2
		global_position = target
	elif _was_looking_back:
		global_position = target
	else:
		var weight := 1.0 - exp(-position_smoothing * maxf(delta, 0.0001))
		global_position = global_position.lerp(target, clampf(weight, 0.0, 1.0))
	_was_looking_back = looking_back
	var to_look := look - global_position
	if to_look.length() > 0.05 and absf(to_look.normalized().dot(Vector3.UP)) < 0.999:
		look_at(look, Vector3.UP)
	if is_inside_tree() and get_tree() != null:
		var settings := get_node_or_null("/root/Settings")
		if settings != null:
			for prop in settings.get_property_list():
				if prop.get("name") == "camera_shake":
					camera_shake = bool(settings.get("camera_shake"))
					break
	if camera_shake and speed > 1.0:
		var s := shake_amplitude * t
		translate(Vector3(sin(_time * 31.0) * s, sin(_time * 47.0 + 1.3) * s * 0.6, 0.0))
