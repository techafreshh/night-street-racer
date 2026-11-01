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
	var target := car.global_position + car_basis.z * follow_distance + Vector3.UP * follow_height
	var weight := 1.0 - exp(-position_smoothing * maxf(delta, 0.0001))
	global_position = global_position.lerp(target, clampf(weight, 0.0, 1.0))
	var look := car.global_position + fwd * lookahead_distance + Vector3.UP * 1.2
	var to_look := look - global_position
	if to_look.length() > 0.05 and absf(to_look.normalized().dot(Vector3.UP)) < 0.999:
		look_at(look, Vector3.UP)
	if camera_shake and speed > 1.0:
		var s := shake_amplitude * t
		translate(Vector3(sin(_time * 31.0) * s, sin(_time * 47.0 + 1.3) * s * 0.6, 0.0))
