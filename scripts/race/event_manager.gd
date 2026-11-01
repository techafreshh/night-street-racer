class_name RaceEventManager
extends Node
## Authoritative race flow: COUNTDOWN (3-2-1-GO) -> RACING -> FINISHED.
## Signal-driven, no UI inside physics. Countdown and the race clock use
## fixed 60 Hz steps: _physics_process(delta) is authoritative, and _process
## mirrors the countdown with a fixed 1/60 step so a headless --quit-after
## budget (which counts idle frames while physics ticks lag wall-clock)
## still observes GO, matching the race_four_ai boot-sim idiom. The race
## clock advances only while RACING. Lap math delegates to RaceEvent.
## Holds no VehicleController reference; racers poll can_drive().

enum State { COUNTDOWN, RACING, FINISHED }

signal countdown_tick(seconds_left: int)
signal race_started
signal lap_completed(lap_number: int)
signal race_finished

const COUNTDOWN_DURATION := 3.0
const STEP := 1.0 / 60.0

@export var event: RaceEvent
@export var autostart := true

var state: State = State.COUNTDOWN
var countdown_left: float = COUNTDOWN_DURATION
var countdown_value: int = int(COUNTDOWN_DURATION) + 1
var race_time: float = 0.0
var current_lap: int = 0
var total_laps: int = 1
var current_index: int = -1
var wrong_way: bool = false
var _armed: bool = false


func _ready() -> void:
	if autostart:
		start_race()


func start_race() -> void:
	if event != null and event.laps > 0:
		total_laps = event.laps
	else:
		total_laps = 1
	state = State.COUNTDOWN
	countdown_left = COUNTDOWN_DURATION
	countdown_value = int(COUNTDOWN_DURATION) + 1
	race_time = 0.0
	current_lap = 0
	current_index = -1
	wrong_way = false
	_armed = true


func reset_race() -> void:
	start_race()


func can_drive() -> bool:
	return _armed and state == State.RACING


func bind_route(route: RaceRoute) -> void:
	if route == null:
		return
	for i in route.gate_count():
		var gate := route.gate_at(i)
		if gate == null:
			continue
		if not gate.passed.is_connected(register_hit):
			gate.passed.connect(register_hit)


func register_hit(hit_index: int) -> bool:
	if not _armed:
		return false
	if state != State.RACING:
		return false
	if event == null:
		return false
	var count := event.checkpoints.size()
	if hit_index < 0 or hit_index >= count:
		return false
	if RaceEvent.is_correct_hit(hit_index, current_index, event):
		var prev := current_index
		current_index = hit_index
		wrong_way = false
		var lap_done := false
		if RaceEvent.is_circuit(event):
			if RaceEvent.completes_lap(hit_index, prev, event):
				lap_done = true
		else:
			if hit_index == count - 1:
				lap_done = true
		if lap_done:
			current_lap += 1
			lap_completed.emit(current_lap)
			if current_lap >= total_laps:
				state = State.FINISHED
				print("FINISHED")
				race_finished.emit()
		return true
	wrong_way = RaceEvent.is_wrong_way(hit_index, current_index, event)
	return false


func _physics_process(delta: float) -> void:
	_tick(delta, true)


func _process(_delta: float) -> void:
	_tick(STEP, false)


func _tick(step: float, allow_clock: bool) -> void:
	if not _armed:
		return
	if state == State.COUNTDOWN:
		countdown_left -= step
		if countdown_left <= 0.0:
			countdown_left = 0.0
			state = State.RACING
			print("RACING")
			race_started.emit()
		else:
			var want := int(ceil(countdown_left))
			if want < 1:
				want = 1
			if want > int(COUNTDOWN_DURATION):
				want = int(COUNTDOWN_DURATION)
			if want < countdown_value:
				countdown_value = want
				print("COUNTDOWN %d" % want)
				countdown_tick.emit(want)
	elif state == State.RACING:
		if allow_clock:
			race_time += step
