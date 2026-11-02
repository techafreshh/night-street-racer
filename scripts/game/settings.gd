extends Node
## User-facing audio/accessibility preferences (autoload singleton).
## Owns the five PRD section 10 settings keys (master/music/sfx volumes,
## assists, camera shake), applies volumes straight to AudioServer buses,
## and persists across restarts via SaveSystem (user://save.json).
## Mirrors the GameState coalesced load-modify-save pattern: the typed
## setters clamp/validate then schedule exactly one deferred write-back
## per frame (plus flush() on demand and on exit), and reload_from_disk()
## allow-lists only the five known keys while suppressing write-back.
## Disk failures are silent no-ops so standalone instances work headless.
## Consumers poll /root/Settings (VehicleAssists polls assists and the
## chase camera polls camera_shake); nothing is pushed to them.

## True while bulk-loading from disk so the setters skip write-back.
var _loading := false
## True while a coalesced write-back is scheduled but not yet flushed.
var _persist_pending := false

var master_volume: float = 0.8:
	set(value):
		var level := _clamp_volume(value, 0.8)
		if _loading:
			master_volume = level
			return
		if master_volume == level:
			return
		master_volume = level
		_request_persist()
		_apply_volumes()
	get:
		return master_volume

var music_volume: float = 0.7:
	set(value):
		var level := _clamp_volume(value, 0.7)
		if _loading:
			music_volume = level
			return
		if music_volume == level:
			return
		music_volume = level
		_request_persist()
		_apply_volumes()
	get:
		return music_volume

var sfx_volume: float = 0.9:
	set(value):
		var level := _clamp_volume(value, 0.9)
		if _loading:
			sfx_volume = level
			return
		if sfx_volume == level:
			return
		sfx_volume = level
		_request_persist()
		_apply_volumes()
	get:
		return sfx_volume

var assists: bool = true:
	set(value):
		var flag := true
		if value is bool:
			flag = value
		if _loading:
			assists = flag
			return
		if assists == flag:
			return
		assists = flag
		_request_persist()
	get:
		return assists

var camera_shake: bool = true:
	set(value):
		var flag := true
		if value is bool:
			flag = value
		if _loading:
			camera_shake = flag
			return
		if camera_shake == flag:
			return
		camera_shake = flag
		_request_persist()
	get:
		return camera_shake


func _ready() -> void:
	reload_from_disk()


## Numeric volumes clamp into VOLUME_MIN/MAX; anything else (String,
## bool, null) falls back to the per-key default.
func _clamp_volume(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		return clampf(float(value), SaveSystem.VOLUME_MIN, SaveSystem.VOLUME_MAX)
	return fallback


## Disk volumes apply only when numeric and inside VOLUME_MIN/MAX;
## corrupt entries (wrong type or out of range) fall back to defaults.
func _disk_volume(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var level := float(value)
		if level >= SaveSystem.VOLUME_MIN and level <= SaveSystem.VOLUME_MAX:
			return level
	return fallback


## Disk flags apply only when strictly bool; anything else falls back.
func _disk_flag(value: Variant, fallback: bool) -> bool:
	if value is bool:
		return value
	return fallback


## Re-read user://save.json into the five settings. Missing or corrupt
## entries fall back to defaults, and write-back stays suppressed.
func reload_from_disk() -> void:
	_persist_pending = false
	_loading = true
	var data := SaveSystem.load_game()
	var settings: Dictionary = data.get("settings", {})
	master_volume = _disk_volume(settings.get("master_volume"), 0.8)
	music_volume = _disk_volume(settings.get("music_volume"), 0.7)
	sfx_volume = _disk_volume(settings.get("sfx_volume"), 0.9)
	assists = _disk_flag(settings.get("assists"), true)
	camera_shake = _disk_flag(settings.get("camera_shake"), true)
	_loading = false
	_apply_volumes()


## Merge the live settings into the saved document, keeping progress /
## records opaque for other laps. Silent no-op on failure.
func _persist() -> void:
	if _loading:
		return
	var data := SaveSystem.load_game()
	var settings: Dictionary = data.get("settings", {})
	settings["master_volume"] = master_volume
	settings["music_volume"] = music_volume
	settings["sfx_volume"] = sfx_volume
	settings["assists"] = assists
	settings["camera_shake"] = camera_shake
	data["settings"] = settings
	SaveSystem.save_game(data)


## Mark the settings dirty and schedule exactly one deferred write-back,
## no matter how many setters fire in the same frame. No-op while
## bulk-loading and when a write is already scheduled.
func _request_persist() -> void:
	if _loading:
		return
	if _persist_pending:
		return
	_persist_pending = true
	call_deferred("_deferred_persist")


## Deferred write-back target: clears the pending flag first so a stranded
## call after an explicit flush() is a no-op.
func _deferred_persist() -> void:
	if not _persist_pending:
		return
	_persist_pending = false
	_persist()


## Synchronous read-your-writes: durably store the pending settings now.
## Clears the pending flag first so a stranded deferred call afterwards is
## a no-op; a second flush without new writes writes nothing.
func flush() -> void:
	if not _persist_pending:
		return
	_persist_pending = false
	_persist()


func _exit_tree() -> void:
	flush()


## Push the three levels to the Master/Music/SFX buses. Music/SFX are
## created at runtime when missing; Master must already exist. Level 0
## mutes instead of applying -inf dB. Never raises.
func _apply_volumes() -> void:
	_apply_bus(&"Master", master_volume)
	_apply_bus(&"Music", music_volume)
	_apply_bus(&"SFX", sfx_volume)


func _apply_bus(bus_name: StringName, level: float) -> void:
	var idx := AudioServer.get_bus_index(bus_name)
	if idx == -1:
		if bus_name == &"Master":
			return
		AudioServer.add_bus()
		idx = AudioServer.bus_count - 1
		AudioServer.set_bus_name(idx, bus_name)
	if idx < 0 or idx >= AudioServer.bus_count:
		return
	if level <= 0.0001:
		AudioServer.set_bus_mute(idx, true)
		return
	AudioServer.set_bus_mute(idx, false)
	AudioServer.set_bus_volume_db(idx, linear_to_db(clampf(level, 0.0001, 1.0)))
