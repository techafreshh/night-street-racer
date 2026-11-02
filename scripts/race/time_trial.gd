class_name TimeTrial
extends RefCounted
## Solo time-trial helper: best-time load/save-if-faster, live delta math
## and formatting, and mode predicates. Pure-static, scene-free helper
## (like SaveSystem / Progression): reads/writes the SaveSystem
## records[event_id] = {"best_time_s": float, "best_position": int} table
## through load-modify-save round-trips so bests survive restarts.
## Headless-safe: never raises; invalid input is a false return.
## Live delta = race_time - best: negative means ahead, positive behind.

## Run-mode aliases mirroring RaceEvent.MODE_RACE / MODE_TIME_TRIAL.
const MODE_RACE := &"race"
const MODE_TIME_TRIAL := &"time_trial"


## True when the mode handle names the solo time-trial mode.
static func is_time_trial_mode(m: Variant) -> bool:
	return StringName(str(m)) == MODE_TIME_TRIAL


## Stored best for event_id in seconds, or -1.0 when absent or corrupt.
static func get_best(event_id: String) -> float:
	if event_id.is_empty():
		return -1.0
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return -1.0
	var table := records as Dictionary
	if not table.has(event_id):
		return -1.0
	var entry: Variant = table[event_id]
	if not (entry is Dictionary):
		return -1.0
	if not (entry as Dictionary).has("best_time_s"):
		return -1.0
	var best: Variant = (entry as Dictionary)["best_time_s"]
	if not (best is int or best is float):
		return -1.0
	if float(best) <= 0.0:
		return -1.0
	return float(best)


## Signed gap to the stored best: race_time - best (ahead is negative).
static func compute_delta(now_s: float, best_s: float) -> float:
	return now_s - best_s


## Race clock in seconds; time-trial shows zero-padded mm:ss.mmm.
static func format_time(seconds: float) -> String:
	var t := maxf(seconds, 0.0)
	var minutes := int(t / 60.0)
	var secs := int(t) % 60
	var millis := int(roundf((t - floorf(t)) * 1000.0))
	if millis >= 1000:
		millis = 999
	return "%02d:%02d.%03d" % [minutes, secs, millis]


## Signed delta; ahead (negative) shows "-", behind shows "+".
static func format_delta(d: float) -> String:
	var sign := "+" if d >= 0.0 else "-"
	return "%s%s" % [sign, format_time(absf(d))]


## Persist time_s only when it beats the stored best (or no best exists).
## Returns false and writes nothing when event_id is empty, time_s <= 0,
## or an existing best_time_s is already <= time_s. Solo time-trial
## records best_position = place (1 when the caller omits it).
static func save_best_if_faster(event_id: String, time_s: float, place := 1) -> bool:
	if event_id.is_empty():
		return false
	if time_s <= 0.0:
		return false
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return false
	var table := records as Dictionary
	if table.has(event_id):
		var entry: Variant = table[event_id]
		if entry is Dictionary and (entry as Dictionary).has("best_time_s"):
			var stored: Variant = (entry as Dictionary)["best_time_s"]
			if stored is int or stored is float:
				if float(stored) <= time_s:
					return false
	table[event_id] = {"best_time_s": time_s, "best_position": place}
	data["records"] = table
	return SaveSystem.save_game(data)
