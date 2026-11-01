class_name Checkpoint
extends Area3D
## One directed-route gate: an Area3D trigger that emits `passed` with its
## checkpoint_index only when a VehicleController enters, so traffic props
## and stray bodies never advance the race. The trigger radius is applied to
## a duplicated sphere shape (per-gate, never shared) from trigger_radius.

signal passed(checkpoint_index: int)

## Gate order in RaceEvent.checkpoints; -1 means unassigned.
@export var checkpoint_index := -1
## Fun range: 6.0 - 14.0 m trigger radius (mirrors RaceEvent bounds).
@export var trigger_radius := 10.0


func _ready() -> void:
	_apply_radius()
	body_entered.connect(_on_body_entered)


## Assign gate order and trigger size before (or after) entering the tree.
func setup(idx: int, radius: float) -> void:
	checkpoint_index = idx
	trigger_radius = radius
	if is_node_ready():
		_apply_radius()


func _apply_radius() -> void:
	var shape_node := get_node_or_null("CollisionShape3D") as CollisionShape3D
	if shape_node == null or not (shape_node.shape is SphereShape3D):
		return
	var dup := (shape_node.shape as SphereShape3D).duplicate() as SphereShape3D
	dup.radius = trigger_radius
	shape_node.shape = dup


func _on_body_entered(body: Node3D) -> void:
	if body is VehicleController:
		passed.emit(checkpoint_index)
