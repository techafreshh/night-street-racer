class_name RaceScene
extends Node3D
## Thin full-race controller: one declarative scene per event composing the
## shared ground slab, a player car, the Route gates, the EventManager flow,
## the HUD sink, and the pause overlay. Never duplicates countdown or clock
## logic (event_manager.gd owns it); restart only re-arms manager + route.
## Safe to boot alone: every lookup is guarded and the finish handoff
## degrades to staying in-race when results.tscn is absent. Prints
## RACE_READY so headless boots can gate on it.

## Fallbacks when GameState carries no selection yet.
const FALLBACK_EVENT := "harbor_sprint"
const FALLBACK_CAR := "sedan"

var _event_id := FALLBACK_EVENT
var _manager: RaceEventManager = null
var _route: RaceRoute = null


func _ready() -> void:
	_manager = get_node_or_null("EventManager") as RaceEventManager
	_route = get_node_or_null("Route") as RaceRoute
	_resolve_event_id()
	_build_ground()
	_spawn_player_car()
	_bind_race()
	print("RACE_READY %s" % _event_id)


## Re-arm both halves of the race flow so the pause Restart button never
## touches countdown internals.
func restart_race() -> void:
	if _manager != null:
		_manager.reset_race()
	if _route != null:
		_route.reset_race()


## Shared ground slab so headless boots have valid car physics.
func _build_ground() -> void:
	var ground := StaticBody3D.new()
	ground.name = "Ground"
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1000, 1, 1000)
	shape.shape = box
	ground.add_child(shape)
	ground.position = Vector3(0, -0.5, 0)
	add_child(ground)


## Event handle from GameState, defaulting to harbor_sprint when empty.
func _resolve_event_id() -> void:
	var gs := get_node_or_null("/root/GameState")
	if gs != null:
		var current := StringName(gs.get("current_event"))
		if current != &"":
			_event_id = String(current)


## Car handle from GameState, defaulting to DEFAULT_CAR when empty,
## mirroring menu.gd _on_garage's fill-default behavior.
func _resolve_car_id() -> String:
	var gs := get_node_or_null("/root/GameState")
	if gs != null:
		var picked := StringName(gs.get("selected_car"))
		if picked != &"":
			return String(picked)
		var fallback := StringName(gs.get("DEFAULT_CAR"))
		if fallback != &"":
			return String(fallback)
	return FALLBACK_CAR


## Instance the picked car scene (sedan when the pick is missing), sample
## player input through the vehicle_controller.gd input seam, and spawn it
## above the route's first checkpoint facing the second.
func _spawn_player_car() -> void:
	var car_id := _resolve_car_id()
	var path := "res://scenes/vehicles/car_%s.tscn" % car_id
	if not ResourceLoader.exists(path):
		path = "res://scenes/vehicles/car_sedan.tscn"
	var packed := load(path) as PackedScene
	if packed == null:
		push_warning("RaceScene: missing car scene %s" % path)
		return
	var car := packed.instantiate() as VehicleController
	if car == null:
		return
	car.use_player_input = true
	add_child(car)
	_place_on_route(car)


func _place_on_route(car: VehicleController) -> void:
	var points := PackedVector3Array()
	if _route != null and _route.event != null:
		points = _route.event.checkpoints
	if points.size() < 2:
		var ev := load("res://assets/events/%s.tres" % _event_id) as RaceEvent
		if ev != null:
			points = ev.checkpoints
	if points.size() < 2:
		car.global_transform = Transform3D(Basis(), Vector3(0, 1.0, 0))
		return
	var start: Vector3 = points[0]
	var next: Vector3 = points[1]
	var flat := Vector3(next.x - start.x, 0.0, next.z - start.z)
	if flat.length() < 0.01:
		flat = Vector3(0, 0, -1.0)
	flat = flat.normalized()
	var yaw := atan2(-flat.x, -flat.z)
	car.global_transform = Transform3D(Basis(Vector3.UP, yaw), Vector3(start.x, start.y + 1.0, start.z))


## Bind the route gates to the manager flow, subscribe the finish handoff,
## and seed the HUD through its existing setters only.
func _bind_race() -> void:
	if _manager != null and _route != null:
		_manager.bind_route(_route)
	if _manager != null:
		if not _manager.race_finished.is_connected(_on_finished):
			_manager.race_finished.connect(_on_finished)
	var hud := get_node_or_null("HUD")
	if hud != null and hud.has_method("set_race_time"):
		hud.call("set_race_time", 0.0)


## Record the solo player finish through a RacePositions table, hand it to
## GameState for the results screen when it exposes the writer, and change
## to results.tscn only when the scene exists; otherwise stay in-race (the
## manager already printed FINISHED).
func _on_finished() -> void:
	var table := RacePositions.new()
	var race_time := 0.0
	if _manager != null:
		race_time = _manager.race_time
	table.record_finish("player", race_time)
	var result := {
		"event_id": _event_id,
		"places": table.ordered_results(),
		"player_racer": "player",
	}
	var gs := get_node_or_null("/root/GameState")
	if gs != null and gs.has_method("set_last_result"):
		gs.call("set_last_result", result)
	if not ResourceLoader.exists("res://scenes/ui/results.tscn"):
		return
	var tree := get_tree()
	if tree == null:
		return
	tree.change_scene_to_file("res://scenes/ui/results.tscn")
