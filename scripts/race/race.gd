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
## Cached personal best for the current event, loaded once in _bind_race so
## the per-frame delta push never touches disk while RACING.
var _cached_best := -1.0
## Player car sampled for drift scoring; set once in _spawn_player_car.
var _player_car: VehicleController = null
## AI rivals spawned from the event opponents count (race mode only).
var _rivals: Array[VehicleController] = []
## Shared runtime pursuit line baked from the event checkpoints.
var _race_line: RacingLine = null
## Accumulated drift points for the current run (banked to the HUD popup).
var _drift_total := 0.0
## Last whole-point total already pushed to the HUD popup.
var _drift_last_shown := 0


func _ready() -> void:
	_manager = get_node_or_null("EventManager") as RaceEventManager
	_route = get_node_or_null("Route") as RaceRoute
	_resolve_event_id()
	_build_ground()
	_spawn_player_car()
	_spawn_field()
	_bind_race()
	print("RACE_READY %s" % _event_id)


## Re-arm both halves of the race flow so the pause Restart button never
## touches countdown internals. The AI field respawns on the staggered grid
## (fresh brains); the player keeps its live transform, matching the
## pre-field restart semantic, while traffic runs on untouched.
func restart_race() -> void:
	if _manager != null:
		_manager.reset_race()
	if _route != null:
		_route.reset_race()
	_respawn_rivals()


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


## Event handle from GameState (typed GameState.get_current_event()),
## defaulting to harbor_sprint when empty.
func _resolve_event_id() -> void:
	var gs := get_node_or_null("/root/GameState")
	if gs == null:
		return
	if not gs.has_method("get_current_event"):
		return
	var current := StringName(gs.call("get_current_event"))
	if current != &"":
		_event_id = String(current)


## Car handle from GameState (typed GameState.get_selected_car() /
## GameState.get_default_car()), defaulting to DEFAULT_CAR when empty,
## mirroring menu.gd _on_garage's fill-default behavior.
func _resolve_car_id() -> String:
	var gs := get_node_or_null("/root/GameState")
	if gs == null:
		return FALLBACK_CAR
	if gs.has_method("get_selected_car"):
		var picked := StringName(gs.call("get_selected_car"))
		if picked != &"":
			return String(picked)
	if gs.has_method("get_default_car"):
		var fallback := StringName(gs.call("get_default_car"))
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
	_player_car = car
	add_child(car)
	var am := get_node_or_null("/root/AudioManager")
	if am != null and am.has_method("register_vehicle"):
		am.call("register_vehicle", car)
	_place_on_route(car)


## Checkpoint list for this run: the route event when bound, else the
## event asset fallback so detached boots (no Route node) still place cars.
func _event_points() -> PackedVector3Array:
	if _route != null and _route.event != null:
		return _route.event.checkpoints
	var ev := load("res://assets/events/%s.tres" % _event_id) as RaceEvent
	if ev != null:
		return ev.checkpoints
	return PackedVector3Array()


## Rival headcount from the route event (asset fallback when the route node
## is absent), clamped to the RaceEvent opponents range.
func _opponent_count() -> int:
	var count := 0
	if _route != null and _route.event != null:
		count = _route.event.opponents
	else:
		var ev := load("res://assets/events/%s.tres" % _event_id) as RaceEvent
		if ev != null:
			count = ev.opponents
	return clampi(count, RaceEvent.OPPONENTS_MIN, RaceEvent.OPPONENTS_MAX)


## Spawn the race-mode field after the player car: one ai_car.tscn rival per
## event opponents headcount plus ambient TrafficManager lanes. Suppressed
## whole in time-trial mode (solo best-chasing). Every lookup is guarded so
## headless boots without optional nodes still reach RACING.
func _spawn_field() -> void:
	if _is_time_trial():
		return
	var points := _event_points()
	if points.size() < 2:
		return
	_spawn_rivals(_opponent_count(), points)
	_spawn_traffic(points)


## Free the live rivals and respawn them on the staggered grid (fresh AI
## brains); the player and traffic keep their live transforms.
func _respawn_rivals() -> void:
	if _rivals.is_empty():
		return
	for rival in _rivals:
		if is_instance_valid(rival):
			rival.queue_free()
	_rivals.clear()
	if _is_time_trial():
		return
	var points := _event_points()
	if points.size() >= 2:
		_spawn_rivals(_opponent_count(), points)


## Instance one ai_car.tscn rival per opponents count: AI-driven through the
## AIRacerInput seam, sharing one runtime RacingLine baked from the event
## checkpoints (the same array Route consumes), staggered behind the player
## start like race_four_ai.gd. Guarded by ResourceLoader.exists so a missing
## AI scene still boots RACING.
func _spawn_rivals(count: int, points: PackedVector3Array) -> void:
	if count <= 0:
		return
	if not ResourceLoader.exists("res://scenes/vehicles/ai_car.tscn"):
		return
	var packed := load("res://scenes/vehicles/ai_car.tscn") as PackedScene
	if packed == null:
		return
	_race_line = _build_racing_line(points)
	var start: Vector3 = points[0]
	var fwd := Vector3(points[1].x - start.x, 0.0, points[1].z - start.z)
	if fwd.length() < 0.01:
		fwd = Vector3(0, 0, -1.0)
	fwd = fwd.normalized()
	var yaw := atan2(-fwd.x, -fwd.z)
	var side := fwd.cross(Vector3.UP).normalized()
	for i in count:
		var car := packed.instantiate() as VehicleController
		if car == null:
			continue
		car.use_player_input = false
		car.add_to_group("racers")
		var brain := car.get_node_or_null("AIRacerInput")
		if brain != null and _race_line != null:
			brain.set("racing_line", _race_line)
		var band := car.get_node_or_null("RubberBand")
		if band != null and _race_line != null:
			band.set("racing_line", _race_line)
		var paint := car.get_node_or_null("CarPaint")
		if paint != null and paint.get("color_index") != null:
			paint.set("color_index", posmod(i + 1, CarPaint.COLORS.size()))
		add_child(car)
		var back := float(i + 1) * 7.0
		var lateral := 2.5 if i % 2 == 0 else -2.5
		car.global_transform = Transform3D(
			Basis(Vector3.UP, yaw),
			Vector3(start.x - fwd.x * back + side.x * lateral, start.y + 1.0, start.z - fwd.z * back + side.z * lateral))
		_rivals.append(car)


## Runtime pursuit line for the AI field from the event checkpoints (the
## same array Route consumes): looped on circuits, open on sprints/drift.
## Shared by every rival; target speeds bake lazily on first use.
func _build_racing_line(points: PackedVector3Array) -> RacingLine:
	var line := RacingLine.new()
	line.points = points.duplicate()
	var loop := false
	if _route != null and _route.event != null:
		loop = RaceEvent.is_circuit(_route.event)
	else:
		var ev := load("res://assets/events/%s.tres" % _event_id) as RaceEvent
		loop = ev != null and RaceEvent.is_circuit(ev)
	line.loop = loop
	return line


## Ambient traffic for race mode: a TrafficManager holding two rectangular
## Path3D loops around the event bounds (outer/inner, like the district
## traffic_paths loops), so _spawn_fleet/_collect_lanes run their stock
## paths. Guarded by ResourceLoader.exists; time-trial runs solo.
func _spawn_traffic(points: PackedVector3Array) -> void:
	if not ResourceLoader.exists("res://scenes/vehicles/traffic_car.tscn"):
		return
	if get_node_or_null("Traffic") != null:
		return
	var bounds := _lane_bounds(points)
	var manager := TrafficManager.new()
	manager.name = "Traffic"
	for lane_idx in 2:
		var lane := Path3D.new()
		lane.name = "LaneLoop%d" % lane_idx
		var curve := Curve3D.new()
		curve.closed = true
		curve.bake_interval = 1.0
		for corner in _lane_rect(bounds, lane_idx):
			curve.add_point(Vector3(corner.x, 0.6, corner.y))
		lane.curve = curve
		manager.add_child(lane)
	add_child(manager)


## XZ bounds of the event gates padded for surrounding streets (minimum
## 60 m span so degenerate lines still yield valid loops).
static func _lane_bounds(points: PackedVector3Array) -> Rect2:
	var min_x := INF
	var max_x := -INF
	var min_z := INF
	var max_z := -INF
	for p in points:
		min_x = minf(min_x, p.x)
		max_x = maxf(max_x, p.x)
		min_z = minf(min_z, p.z)
		max_z = maxf(max_z, p.z)
	var pad := 20.0
	min_x -= pad
	max_x += pad
	min_z -= pad
	max_z += pad
	var cx := (min_x + max_x) * 0.5
	var cz := (min_z + max_z) * 0.5
	var hx := maxf((max_x - min_x) * 0.5, 30.0)
	var hz := maxf((max_z - min_z) * 0.5, 30.0)
	return Rect2(cx - hx, cz - hz, hx * 2.0, hz * 2.0)


## Rectangle corners for one traffic loop: idx 0 rides the outer bounds,
## idx 1 an inner loop inset 12 m so the two lanes never overlap.
static func _lane_rect(bounds: Rect2, lane_idx: int) -> Array[Vector2]:
	var inset := 0.0 if lane_idx == 0 else 12.0
	var x0 := bounds.position.x + inset
	var z0 := bounds.position.y + inset
	var x1 := bounds.position.x + bounds.size.x - inset
	var z1 := bounds.position.y + bounds.size.y - inset
	if x1 - x0 < 10.0:
		var cx := (x0 + x1) * 0.5
		x0 = cx - 5.0
		x1 = cx + 5.0
	if z1 - z0 < 10.0:
		var cz := (z0 + z1) * 0.5
		z0 = cz - 5.0
		z1 = cz + 5.0
	return [Vector2(x0, z0), Vector2(x1, z0), Vector2(x1, z1), Vector2(x0, z1)]


func _place_on_route(car: VehicleController) -> void:
	var points := _event_points()
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


## Per-frame live pushes while RACING: clock + standings-derived position +
## minimap player dot every frame (checkpoint dots are static for the run
## and pushed once in _bind_race); drift samples always score into the run
## total (banked whole points to the HUD DriftPopup); in time-trial mode
## with a stored best, race_time - best mirrors to the HUD DeltaLabel.
## Uses the bests cached in _bind_race; no disk reads happen here.
func _process(_delta: float) -> void:
	if _manager == null or _manager.state != RaceEventManager.State.RACING:
		return
	_sample_drift(_delta)
	_push_hud()
	if not _is_time_trial():
		return
	var hud := get_node_or_null("HUD")
	if hud == null or not hud.has_method("set_delta"):
		return
	if _cached_best <= 0.0:
		return
	hud.call("set_delta", _manager.race_time - _cached_best)


## Push the live race state to the HUD sink: clock, standings-derived
## P<pos>/<total> LAP <lap>/<laps>, and the normalized minimap player dot.
## All node/method lookups are guarded so HUD-less boots keep RACING.
func _push_hud() -> void:
	var hud := get_node_or_null("HUD")
	if hud == null or _manager == null:
		return
	if hud.has_method("set_race_time"):
		hud.call("set_race_time", _manager.race_time)
	var ordered := RacePositions.standings_for(_standings_entries())
	var pos := 1
	for i in ordered.size():
		if str((ordered[i] as Dictionary)["id"]) == "player":
			pos = i + 1
			break
	var total := maxi(ordered.size(), 1)
	var laps := maxi(_manager.total_laps, 1)
	var lap := mini(_manager.current_lap + 1, laps)
	if hud.has_method("set_lap_position"):
		hud.call("set_lap_position", pos, total, lap, laps)
	if hud.has_method("set_minimap_player") and _player_car != null and is_instance_valid(_player_car):
		hud.call("set_minimap_player", _normalize_minimap(_player_car.global_position))


## Live standings over {id, progress} for the player plus every valid rival,
## scored by completed laps plus fractional arc on the shared pursuit line.
func _standings_entries() -> Array:
	var entries: Array = []
	entries.append({"id": "player", "progress": _racer_progress(_player_car, _manager.current_lap)})
	var n := 0
	for rival in _rivals:
		n += 1
		if rival == null or not is_instance_valid(rival):
			continue
		var laps := _manager.current_lap
		var brain := rival.get_node_or_null("AIRacerInput")
		if brain != null:
			laps = int(brain.get("laps_completed"))
		entries.append({"id": "ai_%d" % n, "progress": _racer_progress(rival, laps)})
	return entries


## Progress score for one racer: completed laps plus fractional arc along
## the shared pursuit line (0 when the line or car is unavailable).
func _racer_progress(car: VehicleController, laps: int) -> float:
	if _race_line == null or car == null or not is_instance_valid(car):
		return RacePositions.progress(laps, 0, 0.0, 1)
	var total := maxf(_race_line.track_length(), 1.0)
	var frac := clampf(_race_line.arc_of(car.global_position) / total, 0.0, 1.0)
	return RacePositions.progress(laps, 0, frac, 1)


## Static checkpoint dots for the minimap, normalized 0..1 over the
## +/-140 m event bounds (RaceEvent.validate range); pushed once per run.
func _minimap_points() -> Array:
	var dots: Array = []
	for p in _event_points():
		dots.append(_normalize_minimap(p))
	return dots


## Normalize an XZ position to 0..1 over the +/-140 m event bounds.
static func _normalize_minimap(pos: Vector3) -> Vector2:
	return Vector2((pos.x + 140.0) / 280.0, (pos.z + 140.0) / 280.0)


## Score one drift sample from the player car velocity vs basis: slip comes
## from DriftScoring.slip_angle_deg (the VehicleController atan2 shape),
## points from DriftScoring.score_delta, banked whole points to the existing
## hud.show_drift sink. Display-only push; the HUD never simulates.
func _sample_drift(delta: float) -> void:
	if _player_car == null or not is_instance_valid(_player_car):
		return
	if delta <= 0.0:
		return
	var basis_xform: Basis = _player_car.global_transform.basis
	var fwd := -basis_xform.z
	var right := basis_xform.x
	var vel: Vector3 = _player_car.linear_velocity
	var slip := DriftScoring.slip_angle_deg(vel.dot(fwd), vel.dot(right))
	var planar := Vector2(vel.x, vel.z).length()
	_drift_total += DriftScoring.score_delta(slip, planar, delta)
	var whole := int(_drift_total)
	if whole <= _drift_last_shown:
		return
	_drift_last_shown = whole
	var hud := get_node_or_null("HUD")
	if hud != null and hud.has_method("show_drift"):
		hud.call("show_drift", whole)


## True when GameState selects the solo time-trial mode (single spelling:
## GameState.is_time_trial_mode()).
func _is_time_trial() -> bool:
	var gs := get_node_or_null("/root/GameState")
	if gs == null:
		return false
	return gs.has_method("is_time_trial_mode") and bool(gs.call("is_time_trial_mode"))


## Bind the route gates to the manager flow, subscribe the finish handoff,
## and seed the HUD through its existing setters only. Caches the stored
## best once so the per-frame delta push stays off disk.
func _bind_race() -> void:
	if _manager != null and _route != null:
		_manager.bind_route(_route)
	var audio := get_node_or_null("/root/AudioManager")
	if audio != null and audio.has_method("duck_music_for_race"):
		audio.call("duck_music_for_race")
	if _manager != null:
		if not _manager.race_finished.is_connected(_on_finished):
			_manager.race_finished.connect(_on_finished)
	_cached_best = TimeTrial.get_best(_event_id)
	_drift_total = 0.0
	_drift_last_shown = 0
	var hud := get_node_or_null("HUD")
	if hud != null and hud.has_method("set_race_time"):
		hud.call("set_race_time", 0.0)
	if hud != null and hud.has_method("clear_delta"):
		hud.call("clear_delta")
	if hud != null and hud.has_method("set_minimap_checkpoints"):
		hud.call("set_minimap_checkpoints", _minimap_points())


## Record the full field through a RacePositions table: player plus every
## rival id (ai_1..) in live-standings order, all stamped with the manager
## clock so ordered_results tie-order yields places equal to the standings;
## time-trial stays a single player entry. Hands the table to GameState for
## the results screen when it exposes the writer, and changes to
## results.tscn only when the scene exists; otherwise stays in-race (the
## manager already printed FINISHED). Best-time compare-plus-write lives in
## results.gd alone so the fresh-best banner path writes exactly once.
func _on_finished() -> void:
	var table := RacePositions.new()
	var race_time := 0.0
	if _manager != null:
		race_time = _manager.race_time
	if _is_time_trial() or _rivals.is_empty():
		table.record_finish("player", race_time)
	else:
		for entry in RacePositions.standings_for(_standings_entries()):
			table.record_finish(str((entry as Dictionary)["id"]), race_time)
	var result := {
		"event_id": _event_id,
		"places": table.ordered_results(),
		"player_racer": "player",
		"drift_score": int(_drift_total),
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
