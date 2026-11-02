class_name SkidMarks
extends Node3D
## World-space skid trail with a fixed-size ring buffer.
## Each add_segment() call appends one rung (left/right rear contact
## points); consecutive rungs form quads in a single ArrayMesh so the
## trail fades as one strip. Rungs older than FADE_TIME age out in
## _process; the buffer never holds more than MAX_SEGMENTS rungs.
## The node goes top-level at the origin so stored world positions stay
## put while the parent car drives away. All entry points no-op safely
## when the node is outside the tree (freestanding headless probes).

const MAX_SEGMENTS := 256
const FADE_TIME := 8.0
const RIDE_HEIGHT := 0.03

var _lefts: Array[Vector3] = []
var _rights: Array[Vector3] = []
var _ages: Array[float] = []
var _mesh_instance: MeshInstance3D = null
var _mesh: ArrayMesh = null
var _material: StandardMaterial3D = null


func _ready() -> void:
	top_level = true
	global_transform = Transform3D(Basis(), Vector3.ZERO)
	_material = StandardMaterial3D.new()
	_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_material.vertex_color_use_as_albedo = true
	_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	_material.albedo_color = Color(0.05, 0.05, 0.06, 1.0)
	_mesh = ArrayMesh.new()
	_mesh_instance = MeshInstance3D.new()
	_mesh_instance.name = "SkidMesh"
	_mesh_instance.mesh = _mesh
	_mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_mesh_instance)
	_rebuild()


## Append one trail rung in world coordinates. Oldest rungs drop once
## the buffer is full, so the trail length stays capped at MAX_SEGMENTS.
func add_segment(left_pos: Vector3, right_pos: Vector3) -> void:
	_lefts.append(left_pos)
	_rights.append(right_pos)
	_ages.append(0.0)
	while _lefts.size() > MAX_SEGMENTS:
		_lefts.pop_front()
		_rights.pop_front()
		_ages.pop_front()
	if is_inside_tree():
		_rebuild()


func segment_count() -> int:
	return _lefts.size()


func clear() -> void:
	_lefts.clear()
	_rights.clear()
	_ages.clear()
	if _mesh != null:
		_mesh.clear_surfaces()


func _process(delta: float) -> void:
	if _ages.is_empty():
		return
	var kept := false
	for i in range(_ages.size() - 1, -1, -1):
		_ages[i] += delta
		if _ages[i] >= FADE_TIME:
			_lefts.remove_at(i)
			_rights.remove_at(i)
			_ages.remove_at(i)
		else:
			kept = true
	if kept or _mesh == null:
		_rebuild()
	elif _mesh != null and _lefts.is_empty():
		_mesh.clear_surfaces()


func _alpha_at(age: float) -> float:
	return clampf(1.0 - age / FADE_TIME, 0.0, 1.0) * 0.75


func _rebuild() -> void:
	if _mesh == null or _mesh_instance == null:
		return
	if not is_inside_tree():
		return
	_mesh.clear_surfaces()
	if _lefts.size() < 2:
		return
	var origin: Vector3 = global_transform.origin
	var verts := PackedVector3Array()
	var colors := PackedColorArray()
	verts.resize((_lefts.size() - 1) * 6)
	colors.resize((_lefts.size() - 1) * 6)
	var vi := 0
	for i in range(1, _lefts.size()):
		var pl := _lefts[i - 1] - origin + Vector3(0, RIDE_HEIGHT, 0)
		var pr := _rights[i - 1] - origin + Vector3(0, RIDE_HEIGHT, 0)
		var cl := _lefts[i] - origin + Vector3(0, RIDE_HEIGHT, 0)
		var cr := _rights[i] - origin + Vector3(0, RIDE_HEIGHT, 0)
		var a0 := _alpha_at(maxf(_ages[i - 1], _ages[i]))
		var tint := Color(0.04, 0.04, 0.05, a0)
		verts[vi] = pl
		verts[vi + 1] = pr
		verts[vi + 2] = cl
		verts[vi + 3] = pr
		verts[vi + 4] = cr
		verts[vi + 5] = cl
		for k in 6:
			colors[vi + k] = tint
		vi += 6
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = colors
	_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_mesh.surface_set_material(0, _material)
