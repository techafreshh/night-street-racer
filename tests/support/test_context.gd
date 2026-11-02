extends RefCounted
## Shared fixture and helpers for the headless probe suites (see tests/run_all.gd).
## Holds the SceneTree, the shared tarmac slab, the active car, and the per-test
## ok flag; suites reach it as `ctx`.

var tree: SceneTree
var ground: StaticBody3D = null
var car: VehicleController = null
var _current_ok := true

func _init(p_tree: SceneTree) -> void:
	tree = p_tree

func check(condition: bool, label: String) -> void:
	if not condition:
		_current_ok = false
		push_error("FAIL detail: %s" % label)

func _make_ground() -> void:
	if is_instance_valid(ground):
		ground.free()
		ground = null
	ground = StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1000, 1, 1000)
	shape.shape = box
	ground.add_child(shape)
	ground.position = Vector3(0, -0.5, 0)
	tree.root.add_child(ground)

func _release_inputs() -> void:
	for action in ["accelerate", "brake", "steer_left", "steer_right", "handbrake", "look_back", "reset_car", "pause"]:
		Input.action_release(action)

func _spawn_car(pos: Vector3, car_basis: Basis = Basis()) -> VehicleController:
	_release_inputs()
	if is_instance_valid(car):
		car.queue_free()
		car = null
		await tree.process_frame
		await tree.physics_frame
	var packed := load("res://scenes/vehicles/vehicle_base.tscn") as PackedScene
	car = packed.instantiate() as VehicleController
	tree.root.add_child(car)
	car.global_transform = Transform3D(car_basis, pos)
	return car

func _despawn_car() -> void:
	_release_inputs()
	if is_instance_valid(car):
		car.queue_free()
		car = null
		await tree.process_frame
		await tree.physics_frame

func _yaw_of(car: VehicleController) -> float:
	var fwd := -car.global_transform.basis.z
	return atan2(-fwd.x, -fwd.z)
