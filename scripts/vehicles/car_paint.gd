class_name CarPaint
extends Node
## Per-car paint hook for the tuner bodies.
## Selects one of four shared palette variants by color_index and tints the
## sibling BodyMesh (box-body scenes) or every MeshInstance3D under the Body
## subtree (GLB-body scenes, skipping Wheel* meshes) instance-locally via
## set_surface_override_material with a duplicated StandardMaterial3D, so
## variants never mutate the shared imported GLB material.

const COLORS = [
	Color(0.15, 0.35, 0.95, 1.0),
	Color(0.95, 0.4, 0.1, 1.0),
	Color(0.75, 0.76, 0.8, 1.0),
	Color(0.1, 0.6, 0.2, 1.0),
]

## Fun range: 0-3 index into the shared COLORS palette (wraps with posmod).
@export var color_index := 0:
	set(value):
		color_index = value
		if is_inside_tree():
			_apply()


func _ready() -> void:
	_apply()


func _apply() -> void:
	var car := get_parent()
	if car == null or COLORS.is_empty():
		return
	var tint: Color = COLORS[posmod(color_index, COLORS.size())]
	var targets: Array[MeshInstance3D] = []
	var slab := car.get_node_or_null("BodyMesh") as MeshInstance3D
	if slab != null and slab.mesh != null:
		targets.append(slab)
	else:
		var body := car.get_node_or_null("Body")
		if body == null:
			return
		for mi in body.find_children("*", "MeshInstance3D", true, false):
			var mesh_inst := mi as MeshInstance3D
			if mesh_inst == null or mesh_inst.mesh == null:
				continue
			if str(mesh_inst.name).contains("Wheel"):
				continue
			targets.append(mesh_inst)
	for mesh_inst in targets:
		for i in mesh_inst.mesh.get_surface_count():
			var src := mesh_inst.mesh.surface_get_material(i) as StandardMaterial3D
			var tinted := StandardMaterial3D.new()
			if src != null:
				tinted.metallic = src.metallic
				tinted.roughness = src.roughness
				tinted.emission_enabled = src.emission_enabled
				tinted.emission = src.emission
				tinted.emission_energy_multiplier = src.emission_energy_multiplier
			else:
				tinted.metallic = 0.6
				tinted.roughness = 0.35
			tinted.albedo_color = tint
			mesh_inst.set_surface_override_material(i, tinted)
