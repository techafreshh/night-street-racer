class_name FXPool
extends Node3D
## Pooled one-shot spark/dust emitters for the 1080p/60FPS perf budget.
## Preallocates MAX_FX CPUParticles3D children in _ready (emitting off,
## one_shot) and restarts them round-robin in burst(), so gameplay FX never
## allocates at runtime. CPU particles stay deterministic under headless CI
## and cheap on low-end integrated GPUs. Owns no lights and references no
## autoloads so headless boots behave identically.

const MAX_FX := 16
const FX_AMOUNT := 24
const FX_LIFETIME := 0.6

var _emitters: Array[CPUParticles3D] = []
var _cursor := 0


func _ready() -> void:
	_build()


func _build() -> void:
	if not _emitters.is_empty():
		return
	var spark := _make_spark_mesh()
	for i in MAX_FX:
		var puff := CPUParticles3D.new()
		puff.name = "FX%d" % i
		puff.amount = FX_AMOUNT
		puff.lifetime = FX_LIFETIME
		puff.one_shot = true
		puff.explosiveness = 0.9
		puff.emitting = false
		puff.direction = Vector3(0, 1, 0)
		puff.spread = 45.0
		puff.initial_velocity_min = 2.0
		puff.initial_velocity_max = 5.0
		puff.gravity = Vector3(0, -9.8, 0)
		puff.scale_amount_min = 0.5
		puff.scale_amount_max = 1.0
		puff.local_coords = false
		puff.color = Color(1, 1, 1, 1)
		puff.mesh = spark
		puff.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(puff)
		_emitters.append(puff)


## Fire one pooled burst at a world position; reuses the least-recently-used
## idle emitter and never adds children at runtime.
func burst(pos: Vector3, tint: Color = Color.WHITE) -> void:
	if _emitters.is_empty():
		_build()
	if _emitters.is_empty():
		return
	var idx := _pick_victim()
	var puff := _emitters[idx]
	if is_inside_tree():
		puff.global_position = pos
	else:
		puff.position = pos
	puff.color = tint
	puff.emitting = false
	puff.restart()
	_cursor = next_index(idx, _emitters.size())


## Count of emitters currently firing.
func active_count() -> int:
	var active := 0
	for puff in _emitters:
		if is_instance_valid(puff) and puff.emitting:
			active += 1
	return active


## Round-robin advance shared by burst() and tests; pure so it needs no tree.
static func next_index(cursor: int, count: int) -> int:
	if count <= 0:
		return 0
	return posmod(cursor + 1, count)


func _pick_victim() -> int:
	var count := _emitters.size()
	if count <= 0:
		return 0
	var start := posmod(_cursor, count)
	for step in count:
		var idx := posmod(start + step, count)
		var puff := _emitters[idx]
		if is_instance_valid(puff) and not puff.emitting:
			return idx
	return start


func _make_spark_mesh() -> QuadMesh:
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(1, 0.9, 0.7, 1)
	mat.emission_enabled = true
	mat.emission = Color(1, 0.85, 0.5, 1)
	mat.emission_energy_multiplier = 2.0
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	var quad := QuadMesh.new()
	quad.material = mat
	quad.size = Vector2(0.12, 0.12)
	return quad
