class_name RaceEvent
extends Resource
## Data-driven race event: route_id, type, laps, opponents, unlock_req, reward.
## Single source of truth for one race: the directed checkpoint list plus the
## sprint/circuit/drift encoding (laps) so adding a route later needs a new
## .tres, not new code. Contract fields: route_id, type, laps, opponents,
## unlock_req, reward. The export is named `event_type` (SPRINT/CIRCUIT/DRIFT);
## `type` above names the same slot for file scans.
## Order math is pure-static (no scene) so headless tests call it directly:
## next_index() walks gates from the -1 start sentinel, wrapping to 0 on
## circuits and returning -1 when a sprint is finished; is_wrong_way() flags
## only in-range hits that are neither the expected gate nor a duplicate.

enum EventType { SPRINT, CIRCUIT, DRIFT }

const CHECKPOINT_COUNT_MIN := 4
const CHECKPOINT_RADIUS_MIN := 6.0
const CHECKPOINT_RADIUS_MAX := 14.0
const CHECKPOINT_RADIUS_DEFAULT := 10.0
const SPRINT_LAPS := 1
const CIRCUIT_LAPS_MIN := 2
const CIRCUIT_LAPS_MAX := 5
const OPPONENTS_MIN := 0
const OPPONENTS_MAX := 7
const REWARD_MIN := 0
const REWARD_MAX := 5000
const MODE_RACE := &"race"
const MODE_TIME_TRIAL := &"time_trial"

## Unique event handle; matches the asset filename stem (e.g. harbor_sprint).
@export var route_id := ""
## Event type: SPRINT (point-to-point, 1 lap), CIRCUIT (loop, 2+ laps), or
## DRIFT (single judged run, sprint-like order math: 1 lap, final gate ends
## the run; slide scoring itself lives in DriftScoring, not in this type).
@export var event_type: EventType = EventType.SPRINT
## Fun range: 1 lap for sprints, 2 - 5 laps for circuits.
@export var laps := 1
## Fun range: 0 - 7 rival headcount (0 allows solo/time-trial).
@export var opponents := 3
## Prerequisite route_id; &"" means unlocked from the start.
@export var unlock_req: StringName = &""
## Fun range: 0 - 5000 credit payout.
@export var reward := 500
## Run mode: &"race" (rivals) or &"time_trial" (solo, no rivals).
@export var mode: StringName = MODE_RACE
## Directed checkpoint list: gate positions on the road grid at y ~ 1.
@export var checkpoints: PackedVector3Array = PackedVector3Array()
## Fun range: 6.0 - 14.0 m gate trigger radius.
@export var checkpoint_radius := 10.0


static func validate(event: RaceEvent) -> bool:
	if event == null:
		return false
	if event.route_id == "":
		return false
	if event.event_type == EventType.SPRINT or event.event_type == EventType.DRIFT:
		if event.laps != SPRINT_LAPS:
			return false
	elif event.laps < CIRCUIT_LAPS_MIN or event.laps > CIRCUIT_LAPS_MAX:
		return false
	if event.opponents < OPPONENTS_MIN or event.opponents > OPPONENTS_MAX:
		return false
	if event.reward < REWARD_MIN or event.reward > REWARD_MAX:
		return false
	if event.mode != MODE_RACE and event.mode != MODE_TIME_TRIAL:
		return false
	if event.checkpoints.size() < CHECKPOINT_COUNT_MIN:
		return false
	if event.checkpoint_radius < CHECKPOINT_RADIUS_MIN or event.checkpoint_radius > CHECKPOINT_RADIUS_MAX:
		return false
	for p in event.checkpoints:
		if p.y < 0.0 or p.y > 2.0:
			return false
		if absf(p.x) > 140.0 or absf(p.z) > 140.0:
			return false
	return true


static func is_circuit(event: RaceEvent) -> bool:
	return event != null and event.event_type == EventType.CIRCUIT


static func is_sprint(event: RaceEvent) -> bool:
	return event != null and event.event_type == EventType.SPRINT


## True for the judged drift run (sprint-like: 1 lap, final gate finishes).
static func is_drift(event: RaceEvent) -> bool:
	return event != null and event.event_type == EventType.DRIFT


## True when the event is flagged as a solo time-trial run.
static func is_time_trial(event: RaceEvent) -> bool:
	return event != null and event.mode == MODE_TIME_TRIAL


## Expected next gate after `last_index` (-1 is the race-start sentinel):
## 0 at start, wraps to 0 on circuits, -1 when a sprint/drift run is finished.
static func next_index(last_index: int, event: RaceEvent) -> int:
	if event == null:
		return -1
	var count := event.checkpoints.size()
	if count <= 0:
		return -1
	if last_index < 0:
		return 0
	if is_circuit(event):
		return posmod(last_index + 1, count)
	var nxt := last_index + 1
	if nxt >= count:
		return -1
	return nxt


static func is_correct_hit(hit_index: int, last_index: int, event: RaceEvent) -> bool:
	if event == null:
		return false
	var nxt := next_index(last_index, event)
	if nxt < 0:
		return false
	return hit_index == nxt


## True only for an in-range hit that is neither the expected next gate nor
## a duplicate of the last gate (out-of-range and finished-race hits are
## never wrong-way, they are simply ignored).
static func is_wrong_way(hit_index: int, last_index: int, event: RaceEvent) -> bool:
	if event == null:
		return false
	var count := event.checkpoints.size()
	if hit_index < 0 or hit_index >= count:
		return false
	if hit_index == next_index(last_index, event):
		return false
	if hit_index == last_index:
		return false
	return true


## True when a correct hit on the final gate closes a circuit lap.
static func completes_lap(hit_index: int, last_index: int, event: RaceEvent) -> bool:
	if event == null:
		return false
	if not is_circuit(event):
		return false
	var count := event.checkpoints.size()
	if count <= 0:
		return false
	if hit_index != count - 1:
		return false
	return is_correct_hit(hit_index, last_index, event)


## True when the velocity points away from the next gate (XZ plane).
static func is_moving_wrong_way(velocity: Vector3, car_pos: Vector3, next_pos: Vector3) -> bool:
	var flat := Vector3(velocity.x, 0.0, velocity.z)
	if flat.length() < 0.5:
		return false
	var to_next := Vector3(next_pos.x - car_pos.x, 0.0, next_pos.z - car_pos.z)
	if to_next.length() < 0.5:
		return false
	return flat.normalized().dot(to_next.normalized()) < 0.0
