class_name DriftScoring
extends RefCounted
## Drift-event scoring helper: earned slide scoring for the stretch drift
## event, plus higher-only best persistence. Pure-static, scene-free helper
## (like TimeTrial / SaveSystem / Progression): reads/writes the
## SaveSystem records[event_id] = {"best_drift_score": int} table through
## load-modify-save round-trips so bests survive restarts.
## Headless-safe: never raises; invalid input is a false/zero return.
## Scoring is rate-based: earned = slip_deg * speed_ms * delta * SCORE_FACTOR,
## gated by slip >= MIN_SLIP_DEG and speed >= MIN_SPEED_MS. Straight-line
## wiggles never farm because they fail the gate; handbrake initiation
## counts by construction because no handbrake flag gates the samples.

## Fun range: slip below 12deg never scores (straight-line wiggles).
const MIN_SLIP_DEG := 12.0
## Fun range: speed below 10m/s never scores (parking-lot slides).
const MIN_SPEED_MS := 10.0
## Points per (slip_deg * speed_ms * second) of sustained slide.
const SCORE_FACTOR := 1.0


## Slip angle in degrees from planar velocity components, using the same
## atan2 shape as VehicleController tire physics
## (slip = atan2(lateral, |forward| + 1.0)): straight driving reads ~0deg,
## sustained slides read high. Returns the magnitude (always >= 0).
static func slip_angle_deg(forward_speed: float, lateral_speed: float) -> float:
	return absf(rad_to_deg(atan2(lateral_speed, absf(forward_speed) + 1.0)))


## Dual-threshold gate: true only when slip and speed both clear their
## minimums. Handbrake is deliberately not a gate: any sample meeting the
## slip/speed thresholds scores, so handbrake-initiated slides count.
static func is_drifting(slip_deg: float, speed_ms: float) -> bool:
	return absf(slip_deg) >= MIN_SLIP_DEG and absf(speed_ms) >= MIN_SPEED_MS


## Points earned by one sample: 0 when the gate fails or delta <= 0,
## otherwise slip_deg * speed_ms * delta * SCORE_FACTOR (clamped >= 0).
static func score_delta(slip_deg: float, speed_ms: float, delta: float) -> float:
	if delta <= 0.0:
		return 0.0
	if not is_drifting(slip_deg, speed_ms):
		return 0.0
	return maxf(absf(slip_deg) * absf(speed_ms) * delta * SCORE_FACTOR, 0.0)


## Disk-free best lookup inside one records table: absent or corrupt
## entries read as 0 with no I/O of their own.
static func _best_from_table(table: Dictionary, event_id: String) -> int:
	if event_id.is_empty():
		return 0
	if not table.has(event_id):
		return 0
	var entry: Variant = table[event_id]
	if not (entry is Dictionary):
		return 0
	if not (entry as Dictionary).has("best_drift_score"):
		return 0
	var best: Variant = (entry as Dictionary)["best_drift_score"]
	if not (best is int or best is float):
		return 0
	if float(best) <= 0.0:
		return 0
	return int(best)


## Stored best for event_id in points, or 0 when absent or corrupt.
static func get_best(event_id: String) -> int:
	if event_id.is_empty():
		return 0
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return 0
	return _best_from_table(records as Dictionary, event_id)


## Single-read snapshot of every stored drift best ({event_id: score},
## corrupt entries dropped) so the results screen renders banners from one
## disk read instead of one get_best load per row.
static func all_bests() -> Dictionary:
	var out := {}
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return out
	var table := records as Dictionary
	for key in table.keys():
		var best := _best_from_table(table, String(key))
		if best > 0:
			out[String(key)] = best
	return out


## Persist score only when it beats the stored best (or no best exists).
## Returns false and writes nothing when event_id is empty, score <= 0, or
## an existing best_drift_score is already >= score. Merges into the stored
## entry so sibling keys (best_time_s / best_position) survive the write.
static func save_best_if_higher(event_id: String, score: int) -> bool:
	if event_id.is_empty():
		return false
	if score <= 0:
		return false
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return false
	var table := records as Dictionary
	if table.has(event_id):
		var entry: Variant = table[event_id]
		if entry is Dictionary and (entry as Dictionary).has("best_drift_score"):
			var stored: Variant = (entry as Dictionary)["best_drift_score"]
			if stored is int or stored is float:
				if int(stored) >= score:
					return false
	var merged := {}
	if table.has(event_id) and table[event_id] is Dictionary:
		merged = (table[event_id] as Dictionary).duplicate()
	merged["best_drift_score"] = score
	table[event_id] = merged
	data["records"] = table
	return SaveSystem.save_game(data)
