extends CanvasLayer
## Standalone HUD: a pure display sink for race state pushed in via setters.
## Owns no simulation: it caches its six named nodes, formats plain values
## for display, and defensively subscribes to race signals only when a
## provider is already present at runtime. Safe to boot alone: every lookup
## is guarded, there is no per-frame polling, and _ready prints HUD_READY.

const MAP_SIZE := Vector2(200, 200)
const PLAYER_DOT := Vector2(6, 6)
const CHECKPOINT_DOT := Vector2(4, 4)
const DRIFT_FADE_TIME := 1.5

var _speed_label: Label
var _gear_label: Label
var _position_label: Label
var _timer_label: Label
var _drift_popup: Label
var _player_dot: ColorRect
var _checkpoint_layer: Control
var _drift_age := 0.0


func _ready() -> void:
	_speed_label = get_node_or_null("SpeedLabel") as Label
	_gear_label = get_node_or_null("GearLabel") as Label
	_position_label = get_node_or_null("PositionLabel") as Label
	_timer_label = get_node_or_null("TimerLabel") as Label
	_drift_popup = get_node_or_null("DriftPopup") as Label
	_player_dot = get_node_or_null("Minimap/SubViewport/PlayerDot") as ColorRect
	_checkpoint_layer = get_node_or_null("Minimap/SubViewport/CheckpointLayer") as Control
	set_speed(0.0)
	set_gear(1, false)
	set_lap_position(1, 1, 1, 1)
	set_race_time(0.0)
	if _drift_popup != null:
		_drift_popup.visible = false
	_wire_race_signals()
	print("HUD_READY")


func _process(delta: float) -> void:
	if _drift_popup == null or not _drift_popup.visible:
		return
	_drift_age += delta
	var left := clampf(1.0 - _drift_age / DRIFT_FADE_TIME, 0.0, 1.0)
	var tint := _drift_popup.modulate
	tint.a = left
	_drift_popup.modulate = tint
	if left <= 0.0:
		_drift_popup.visible = false


## Speed in m/s; HUD shows integer km/h.
func set_speed(speed_ms: float) -> void:
	if _speed_label == null:
		return
	_speed_label.text = "%d km/h" % int(absf(speed_ms) * 3.6)


## Gear number, or "R" while reversing.
func set_gear(gear: int, reversing: bool) -> void:
	if _gear_label == null:
		return
	if reversing:
		_gear_label.text = "R"
	else:
		_gear_label.text = str(gear)


## Shared standing + lap readout: "P<pos>/<total>  LAP <lap>/<laps>".
func set_lap_position(pos: int, total: int, lap: int, laps: int) -> void:
	if _position_label == null:
		return
	_position_label.text = "P%d/%d  LAP %d/%d" % [pos, total, lap, laps]


## Race clock in seconds; HUD shows zero-padded mm:ss.mmm.
func set_race_time(seconds: float) -> void:
	if _timer_label == null:
		return
	var t := maxf(seconds, 0.0)
	var minutes := int(t / 60.0)
	var secs := int(t) % 60
	var millis := int(roundf((t - floorf(t)) * 1000.0))
	if millis >= 1000:
		millis = 999
	_timer_label.text = "%02d:%02d.%03d" % [minutes, secs, millis]


## Drift feedback popup; fades out on its own in _process.
func show_drift(score: int) -> void:
	if _drift_popup == null:
		return
	_drift_popup.text = "DRIFT +%d" % score
	_drift_age = 0.0
	var tint := _drift_popup.modulate
	tint.a = 1.0
	_drift_popup.modulate = tint
	_drift_popup.visible = true


## Player marker; normalized 0..1 across the minimap face.
func set_minimap_player(p: Vector2) -> void:
	if _player_dot == null:
		return
	var clamped := Vector2(clampf(p.x, 0.0, 1.0), clampf(p.y, 0.0, 1.0))
	_player_dot.position = clamped * (MAP_SIZE - PLAYER_DOT)


## Checkpoint markers; normalized 0..1 points, rebuilt on each push.
func set_minimap_checkpoints(points: Array) -> void:
	if _checkpoint_layer == null:
		return
	for child in _checkpoint_layer.get_children():
		child.free()
	for point in points:
		if not (point is Vector2):
			continue
		var clamped := Vector2(clampf(point.x, 0.0, 1.0), clampf(point.y, 0.0, 1.0))
		var dot := ColorRect.new()
		dot.color = Color(1.0, 0.85, 0.2, 1.0)
		dot.size = CHECKPOINT_DOT
		dot.position = clamped * (MAP_SIZE - CHECKPOINT_DOT)
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_checkpoint_layer.add_child(dot)


## One-shot subscriber pass: link known race signals only where the
## provider node actually offers them, so a missing car/route/manager
## is simply skipped instead of erroring.
func _wire_race_signals() -> void:
	var tree := get_tree()
	if tree == null:
		return
	var candidates: Array[Node] = []
	var scene := tree.current_scene
	if scene != null and scene != self:
		candidates.append(scene)
	var host := get_parent()
	if host != null and host != self and not candidates.has(host):
		candidates.append(host)
	if scene != null:
		for child in scene.get_children():
			if child is Node and child != self and not candidates.has(child):
				candidates.append(child)
	for node in candidates:
		_try_link(node, &"countdown_tick", _on_countdown_tick)
		_try_link(node, &"race_started", _on_race_started)
		_try_link(node, &"lap_completed", _on_lap_completed)
		_try_link(node, &"race_finished", _on_race_finished)
		_try_link(node, &"passed", _on_gate_passed)


func _try_link(node: Node, sig: StringName, handler: Callable) -> void:
	if node == null or not node.has_signal(sig):
		return
	var stream := Signal(node, sig)
	if stream.is_connected(handler):
		return
	stream.connect(handler)


func _on_countdown_tick(seconds_left: int) -> void:
	set_race_time(float(maxi(seconds_left, 0)))


func _on_race_started() -> void:
	if _drift_popup != null:
		_drift_popup.visible = false


func _on_lap_completed(_lap_number: int) -> void:
	pass


func _on_race_finished() -> void:
	pass


func _on_gate_passed(_checkpoint_index: int) -> void:
	pass
