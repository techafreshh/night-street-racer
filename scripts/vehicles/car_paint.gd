class_name CarPaint
extends Node
## Per-car paint hook for the tuner bodies.
## Tints the sibling Body meshes instance-locally via
## set_surface_override_material with a duplicated StandardMaterial3D,
## so variants never mutate the shared imported GLB material.

@export var body_color := Color(0.75, 0.76, 0.8, 1)


func _ready() -> void:
	var car := get_parent()
	if car == null:
		return
	var body := car.get_node_or_null("Body")
	if body == null:
		return
	for mi in body.find_children("*", "MeshInstance3D", true, false):
		var mesh_inst := mi as MeshInstance3D
		if mesh_inst == null or mesh_inst.mesh == null:
			continue
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
			tinted.albedo_color = body_color
			mesh_inst.set_surface_override_material(i, tinted)
