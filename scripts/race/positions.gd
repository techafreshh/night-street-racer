class_name RacePositions
extends RefCounted
## Live position math plus the final results table for street races.
## Progress scores every racer on one formula for both sprints and circuits:
## lap * total + idx + frac, where lap is completed laps (0-based), total is
## event.checkpoints.size(), idx is the last validated gate (-1 is the
## race-start sentinel), and frac is the clamped fractional progress toward
## the next gate. Sorting scores descending yields live places; the results
## table retains every finisher's place and time (player + AI) at the line.
## Pure-static math (no scene) so headless tests call it directly; the
## instance shell only holds the results table and never touches gates.


## Progress score for one racer: raising lap, idx, or frac raises the score,
## and the -1 start sentinel stays below gate 0. frac is clamped to
## [0.0, 1.0] so callers never need to pre-clamp; lap and total are clamped
## to keep degenerate inputs monotonic instead of crashing.
static func progress(lap: int, idx: int, frac: float, total: int) -> float:
	return float(maxi(lap, 0) * maxi(total, 1) + idx) + clampf(frac, 0.0, 1.0)


## Fractional progress of the car along the XZ segment prev -> next,
## projected and clamped to [0.0, 1.0]. Y is ignored, mirroring the
## RaceEvent.is_moving_wrong_way flatten; degenerate segments shorter than
## 0.001 m yield 0.0 instead of dividing by zero.
static func fraction_to_next(car_pos: Vector3, prev_pos: Vector3, next_pos: Vector3) -> float:
	var seg := Vector2(next_pos.x - prev_pos.x, next_pos.z - prev_pos.z)
	if seg.length() < 0.001:
		return 0.0
	var rel := Vector2(car_pos.x - prev_pos.x, car_pos.z - prev_pos.z)
	return clampf(rel.dot(seg) / seg.length_squared(), 0.0, 1.0)


## Live standings over {"id", "progress"} dictionaries, sorted descending by
## progress with deterministic original-index tiebreak. Returns a new array
## (input is never mutated); entries missing "progress" sink to the bottom
## instead of crashing.
static func standings_for(entries: Array) -> Array:
	var decorated: Array = []
	for i in entries.size():
		var entry = entries[i]
		var score := -INF
		if entry is Dictionary and (entry as Dictionary).has("progress"):
			score = float((entry as Dictionary)["progress"])
		decorated.append({"entry": entry, "score": score, "index": i})
	decorated.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if float(a["score"]) != float(b["score"]):
			return float(a["score"]) > float(b["score"])
		return int(a["index"]) < int(b["index"])
	)
	var out: Array = []
	for d in decorated:
		out.append((d as Dictionary)["entry"])
	return out


var _finishers: Array = []


## Record a finisher; duplicates keep the first time and return the existing
## place, while empty ids and negative times are ignored (return 0).
func record_finish(racer: String, time_s: float) -> int:
	if racer == "" or time_s < 0.0:
		return 0
	for f in _finishers:
		if (f as Dictionary)["racer"] == racer:
			return place_of(racer)
	_finishers.append({"racer": racer, "time_s": time_s})
	return place_of(racer)


## Finishers sorted by ascending time with contiguous places 1..n stamped on
## copies; ties keep first-recorded order. Returns a new array each call.
func ordered_results() -> Array:
	var decorated: Array = []
	for i in _finishers.size():
		var f := _finishers[i] as Dictionary
		decorated.append({"racer": f["racer"], "time_s": float(f["time_s"]), "index": i})
	decorated.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if float(a["time_s"]) != float(b["time_s"]):
			return float(a["time_s"]) < float(b["time_s"])
		return int(a["index"]) < int(b["index"])
	)
	var out: Array = []
	for rank in decorated.size():
		var d := decorated[rank] as Dictionary
		out.append({"racer": d["racer"], "time_s": d["time_s"], "place": rank + 1})
	return out


## 1-based place for a recorded racer, or 0 when the racer never finished.
func place_of(racer: String) -> int:
	for r in ordered_results():
		if (r as Dictionary)["racer"] == racer:
			return int((r as Dictionary)["place"])
	return 0


## Number of recorded finishers.
func size() -> int:
	return _finishers.size()


## Drop every recorded finisher.
func clear() -> void:
	_finishers.clear()
