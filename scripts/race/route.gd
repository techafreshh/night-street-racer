class_name RaceRoute
extends Node3D
## Live race route: spawns one Checkpoint gate per RaceEvent.checkpoints
## entry in _ready (no coordinates live in .tscn files), then tracks
## in-order progress via the RaceEvent statics. Prints a ready line for the
## headless boot probe. Reset with reset_race().

@export var event: RaceEvent
@export var checkpoint_scene: PackedScene = preload("res://scenes/races/checkpoint.tscn")

## Last validated gate (-1 is the race-start sentinel).
var current_index := -1
## Completed laps (circuits) / finished runs (sprints count 1).
var current_lap := 0
## True while the last non-ignored hit was out of order.
var wrong_way := false
## True when the route is complete (all laps / final sprint gate).
var finished := false
var _gates: Array[Checkpoint] = []


func _ready() -> void:
	if event == null:
		push_warning("RaceRoute: no event assigned")
		return
	if checkpoint_scene == null:
		push_warning("RaceRoute: no checkpoint scene assigned")
		return
	for i in event.checkpoints.size():
		var gate := checkpoint_scene.instantiate() as Checkpoint
		if gate == null:
			continue
		gate.setup(i, event.checkpoint_radius)
		gate.position = event.checkpoints[i]
		gate.passed.connect(_on_gate_passed)
		add_child(gate)
		_gates.append(gate)
	print("ROUTE_READY %s gates=%d laps=%d" % [event.route_id, _gates.size(), event.laps])


func gate_count() -> int:
	return _gates.size()


func gate_at(idx: int) -> Checkpoint:
	if idx < 0 or idx >= _gates.size():
		return null
	return _gates[idx]


## Feed a gate hit through the RaceEvent order math; returns true when the
## hit was the expected next gate.
func register_hit(hit_index: int) -> bool:
	if event == null or finished:
		return false
	var prev := current_index
	if RaceEvent.is_correct_hit(hit_index, current_index, event):
		current_index = hit_index
		wrong_way = false
		if RaceEvent.is_circuit(event):
			if RaceEvent.completes_lap(hit_index, prev, event):
				current_lap += 1
				if current_lap >= event.laps:
					finished = true
		elif hit_index == event.checkpoints.size() - 1:
			current_lap += 1
			finished = true
		return true
	wrong_way = RaceEvent.is_wrong_way(hit_index, current_index, event)
	return false


func reset_race() -> void:
	current_index = -1
	current_lap = 0
	wrong_way = false
	finished = false


func _on_gate_passed(hit_index: int) -> void:
	register_hit(hit_index)
