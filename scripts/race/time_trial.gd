class_name TimeTrial
extends RefCounted
## Solo time-trial helper: best-time load/save-if-faster, live delta math
## and formatting. Pure-static, scene-free helper
## (like SaveSystem / Progression): reads/writes the SaveSystem
## records[event_id] = {"best_time_s": float, "best_position": int} table
## through load-modify-save round-trips so bests survive restarts.
## Headless-safe: never raises; invalid input is a false return.
## Live delta = race_time - best: negative means ahead, positive behind.

## Disk-free best lookup inside one records table: absent or corrupt
## entries read as -1.0 with no I/O of their own.
static func _best_from_table(table: Dictionary, event_id: String) -> float:
	if event_id.is_empty():
		return -1.0
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


## Stored best for event_id in seconds, or -1.0 when absent or corrupt.
static func get_best(event_id: String) -> float:
	if event_id.is_empty():
		return -1.0
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return -1.0
	return _best_from_table(records as Dictionary, event_id)


## Single-read snapshot of every stored best ({event_id: best_time_s},
## corrupt entries dropped) so the menu grid renders all BEST tags from
## one disk read instead of one get_best load per button (issue #168).
static func all_bests() -> Dictionary:
	var out := {}
	var data := SaveSystem.load_game()
	var records: Variant = data.get("records", {})
	if not (records is Dictionary):
		return out
	var table := records as Dictionary
	for key in table.keys():
		var best := _best_from_table(table, String(key))
		if best > 0.0:
			out[String(key)] = best
	return out


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
	var merged := {}
	if table.has(event_id) and table[event_id] is Dictionary:
		merged = (table[event_id] as Dictionary).duplicate()
	merged["best_time_s"] = time_s
	merged["best_position"] = place
	table[event_id] = merged
	data["records"] = table
	return SaveSystem.save_game(data)
