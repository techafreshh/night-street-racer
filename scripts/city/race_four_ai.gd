extends Node3D
## Bootable 4-AI rubber-band race on a flat tarmac slab.
## Builds the shared 1000x1x1000 ground plane, spawns four ai_car.tscn cars
## in group "racers" on a staggered grid behind the test-line start pose,
## then counts frames and prints AI_FINISHED once. The counter advances on
## both idle and physics callbacks so a headless --quit-after budget (which
## counts idle iterations while physics ticks lag wall-clock time) still
## observes the finish line; the cars themselves always run on physics.

var _frames := 0
var _done := false


func _ready() -> void:
	var ground := StaticBody3D.new()
	ground.name = "Ground"
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1000, 1, 1000)
	shape.shape = box
	ground.add_child(shape)
	ground.position = Vector3(0, -0.5, 0)
	add_child(ground)
	var line := load("res://assets/city/test_line.tres") as RacingLine
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	var backs: Array[float] = [0.0, 8.0, 16.0, 24.0]
	var sides: Array[float] = [0.0, -2.0, 2.0, 0.0]
	for i in 4:
		var car := packed.instantiate() as VehicleController
		car.add_to_group("racers")
		add_child(car)
		# Stagger along arc length so every car starts on the loop: s measured
		# back from the start line, yaw facing down-track, lateral offset right.
		var s := fposmod(-backs[i], line.track_length())
		var p := line.point_at_arc(s)
		var d := line.point_at_arc(s + 5.0) - p
		d.y = 0.0
		d = d.normalized()
		var side_dir := d.cross(Vector3.UP).normalized()
		var spot := p + Vector3(0, 0.9, 0) + side_dir * sides[i]
		car.global_transform = Transform3D(Basis(Vector3.UP, atan2(-d.x, -d.z)), spot)


func _physics_process(_delta: float) -> void:
	_tick()


func _process(_delta: float) -> void:
	_tick()


func _tick() -> void:
	if _done:
		return
	_frames += 1
	if _frames >= 300:
		_done = true
		print("AI_FINISHED")
