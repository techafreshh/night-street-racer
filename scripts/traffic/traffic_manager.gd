class_name TrafficManager
extends Node3D
## Owns the district lane Path3D children and a fleet of kinematic TrafficCars.
## Spawns TRAFFIC_COUNT cars synchronously in _ready, so any headless boot log
## contains the TRAFFIC_SPAWNED line, and recycles cars straying farther than
## RECYCLE_DISTANCE from the player anchor to RESPAWN_AHEAD past the closest
## lane point. References no autoloads so headless boots behave identically.

const TRAFFIC_COUNT := 6
const RECYCLE_DISTANCE := 150.0
const RESPAWN_AHEAD := 30.0
const BASE_CRUISE := 9.0

@export var car_scene: PackedScene = preload("res://scenes/vehicles/traffic_car.tscn")

var _cars: Array[TrafficCar] = []
var _lanes: Array[Path3D] = []
var _anchor: Node3D = null


func _ready() -> void:
	_lanes = _collect_lanes()
	_spawn_fleet()
	print("TRAFFIC_SPAWNED count=%d" % _cars.size())


func _physics_process(_delta: float) -> void:
	if _cars.is_empty() or _lanes.is_empty():
		return
	var anchor := _resolve_anchor()
	for car in _cars:
		if not is_instance_valid(car):
			continue
		if car.global_position.distance_to(anchor) <= RECYCLE_DISTANCE:
			continue
		_recycle(car, anchor)


func _collect_lanes() -> Array[Path3D]:
	var lanes: Array[Path3D] = []
	for child in get_children():
		if child is Path3D:
			lanes.append(child)
	lanes.sort_custom(func(a: Path3D, b: Path3D) -> bool: return str(a.name) < str(b.name))
	return lanes


func _spawn_fleet() -> void:
	if _lanes.is_empty() or car_scene == null:
		return
	var per_lane := int(ceil(float(TRAFFIC_COUNT) / float(_lanes.size())))
	for i in TRAFFIC_COUNT:
		var lane := _lanes[i % _lanes.size()]
		var length := 0.0
		if lane.curve != null:
			length = lane.curve.get_baked_length()
		if length < 1.0:
			continue
		var slot := i / _lanes.size()
		var car := car_scene.instantiate() as TrafficCar
		if car == null:
			continue
		add_child(car)
		_cars.append(car)
		car.setup(lane, length * float(slot) / float(per_lane), BASE_CRUISE + float(i % 3 - 1) * 1.5)


func _resolve_anchor() -> Vector3:
	if is_instance_valid(_anchor):
		return _anchor.global_position
	_anchor = null
	var vehicle := _find_vehicle(get_tree().root)
	if vehicle != null:
		_anchor = vehicle
		return vehicle.global_position
	var spawn := _find_spawn(get_tree().root)
	if spawn != null:
		_anchor = spawn
		return spawn.global_position
	return global_position


func _find_vehicle(node: Node) -> Node3D:
	if node is VehicleController:
		return node as Node3D
	for child in node.get_children():
		var found := _find_vehicle(child)
		if found != null:
			return found
	return null


func _find_spawn(node: Node) -> Node3D:
	if node is Marker3D and str(node.name) == "SpawnPoint":
		return node as Node3D
	for child in node.get_children():
		var found := _find_spawn(child)
		if found != null:
			return found
	return null


func _recycle(car: TrafficCar, anchor: Vector3) -> void:
	var lane := car.lane
	if lane == null or not is_instance_valid(lane):
		lane = _lanes[0]
	var curve := lane.curve
	if curve == null:
		return
	var length := curve.get_baked_length()
	if length < 1.0:
		return
	car.lane = lane
	car.progress = fposmod(TrafficCar.closest_progress(curve, lane.to_local(anchor)) + RESPAWN_AHEAD, length)
	car.snap_to_lane()
