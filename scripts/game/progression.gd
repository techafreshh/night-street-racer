class_name Progression
extends RefCounted
## Unlock ladder for events and cars (issue #21).
## Pure-static, scene-free helper (like SaveSystem / RaceEvent /
## RacePositions): top-3 finishes record the completed event (which opens
## the next rung through its asset unlock_req) and wins grant the mapped
## car. Persists through SaveSystem load-modify-save round-trips so
## unlocks survive restarts; settings/records pass through untouched.
## Headless-safe: tests call apply_result without mounting the
## GameState autoload.

## Ladder order mirrors MenuUI.EVENT_PATHS (and the unlock_req chain).
const LADDER: Array[String] = [
	"harbor_sprint",
	"downtown_gp",
	"neon_loop",
	"bayline_circuit",
	"alley_sprint",
	"drift_park",
]
## Win reward per ladder rung (clamped index): harbor grants coupe,
## downtown grants hatch, neon onward grants awd.
const REWARD_CARS: Array[String] = ["coupe", "hatch", "awd"]


## Coerce any saved value to a clean string list: non-Array yields empty,
## non-String/non-StringName entries and empty strings are dropped,
## StringName entries fold to String.
static func _string_list(v: Variant) -> Array[String]:
	var out: Array[String] = []
	if not (v is Array):
		return out
	for item in (v as Array):
		if item is String:
			if (item as String).is_empty():
				continue
			out.append(item)
		elif item is StringName:
			var folded := String(item)
			if folded.is_empty():
				continue
			out.append(folded)
	return out


## Single-read snapshot of the unlocked event ladder (issue #168): the menu
## grid builds one Button per event, so it snapshots once and evaluates
## every button with the disk-free is_unlocked_with instead of re-reading
## the save file per button.
static func unlocked_events() -> Array[String]:
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	return _string_list(progress.get("unlocked_events", []))

## Single-read snapshot of the unlocked car grants (issue #174): the garage
## grid builds one Button per car, so it snapshots once and evaluates
## every button with the disk-free is_car_unlocked_with instead of
## re-reading the save file per button.
static func unlocked_cars() -> Array[String]:
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	return _string_list(progress.get("unlocked_cars", []))

## Disk-free lock rule over a snapshot from unlocked_events(): null never
## opens, an empty unlock_req is open from the start, otherwise the
## requirement must sit in the snapshot.
static func is_unlocked_with(ev: RaceEvent, unlocked: Array[String]) -> bool:
	if ev == null:
		return false
	if ev.unlock_req == &"":
		return true
	return unlocked.has(String(ev.unlock_req))


## Save-backed lock rule: null never opens, an empty unlock_req is open
## from the start, otherwise the requirement must sit in unlocked_events.
static func is_event_unlocked(ev: RaceEvent) -> bool:
	if ev == null:
		return false
	if ev.unlock_req == &"":
		return true
	return is_unlocked_with(ev, unlocked_events())


## Disk-free car lock rule over a snapshot from unlocked_cars()
## (issue #174): sedan is always open, otherwise the car must sit in
## the snapshot. Corrupt/mixed lists behave as today because the
## snapshot already passed through _string_list.
static func is_car_unlocked_with(car_id: String, unlocked: Array[String]) -> bool:
	if StringName(car_id) == StringName("sedan"):
		return true
	return unlocked.has(car_id)


## Next rung after event_id, or "" when unknown or already last.
static func next_event_after(event_id: String) -> String:
	var idx := LADDER.find(event_id)
	if idx < 0 or idx + 1 >= LADDER.size():
		return ""
	return LADDER[idx + 1]


## Win reward for event_id (clamped ladder index), or "" when unknown.
static func mapped_car(event_id: String) -> String:
	var idx := LADDER.find(event_id)
	if idx < 0:
		return ""
	return REWARD_CARS[clampi(idx, 0, REWARD_CARS.size() - 1)]


## Record a simulated result: place 1-3 records the completed event (the
## next rung opens because its asset unlock_req now sits in the list) and
## place 1 additionally grants the mapped car; place >= 4 (or an unknown
## event, or place < 1) is a no-op returning the unchanged snapshot.
## event_unlocked names the newly opened next rung (via next_event_after);
## both tokens print only for fresh unlocks, never for repeats.
static func apply_result(event_id: String, place: int) -> Dictionary:
	var data := SaveSystem.load_game()
	var progress: Dictionary = data.get("progress", {})
	var events := _string_list(progress.get("unlocked_events", []))
	var cars := _string_list(progress.get("unlocked_cars", []))
	if LADDER.find(event_id) < 0 or place < 1 or place > 3:
		return {
			"unlocked_events": events,
			"unlocked_cars": cars,
			"event_unlocked": "",
			"car_unlocked": "",
		}
	var event_unlocked := ""
	var car_unlocked := ""
	if not events.has(event_id):
		events.append(event_id)
		event_unlocked = next_event_after(event_id)
	if place == 1:
		var car := mapped_car(event_id)
		if car != "" and not cars.has(car):
			cars.append(car)
			car_unlocked = car
	progress["unlocked_events"] = events
	progress["unlocked_cars"] = cars
	data["progress"] = progress
	SaveSystem.save_game(data)
	if event_unlocked != "":
		print("EVENT_UNLOCKED %s" % event_unlocked)
	if car_unlocked != "":
		print("CAR_UNLOCKED %s" % car_unlocked)
	return {
		"unlocked_events": events,
		"unlocked_cars": cars,
		"event_unlocked": event_unlocked,
		"car_unlocked": car_unlocked,
	}
