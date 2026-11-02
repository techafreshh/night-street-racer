extends Node
## Audio mixer singleton (autoloaded right after Settings).
## Owns the menu music loop plus the UI click one-shot and drives the
## per-vehicle EngineAudio/SkidAudio/WindAudio AudioStreamPlayer3D hooks
## from the registered player car's engine_rpm/speed_ms/slip_intensity
## readouts. Routes SFX players to the SFX bus and music to the Music
## bus; bus levels stay owned by Settings, so volumes respect settings.
## The pitch/skid/wind maps are pure-static so headless tests can call
## them with no scene. Prints AUDIO_READY so headless boots can gate on
## it. Never raises when streams or /root/Settings are absent.

## Idle rpm anchoring the bottom of the engine pitch map.
const IDLE_RPM := 800.0
## Max wheel slip angle (radians) before the skid loop becomes audible.
const SKID_THRESHOLD := 0.20
## Slip angle (radians) where the skid loop reaches full volume.
const SKID_FULL := 0.50
## Speed (m/s) where the wind loop reaches full volume.
const WIND_FULL_SPEED := 40.0
## Music attenuation while racing (menu music keeps looping, ducked).
const DUCK_DB := -12.0
## Floor for fully faded loops (silent without hitting -inf dB).
const SILENCE_DB := -60.0

## Player car followed by _process; set via register_vehicle (the race
## registers its car, and player-driven vehicles self-register).
var _vehicle: Node = null
## True while the race duck offset applies to the music player.
var _ducked := false
var _music_player: AudioStreamPlayer = null
var _click_player: AudioStreamPlayer = null


## Engine pitch map: 0.6 at idle rising to 2.0 at max_engine_rpm.
## Pure-static so headless tests call it with no scene.
static func engine_pitch(rpm: float, max_rpm: float) -> float:
	var span := max_rpm - IDLE_RPM
	if span <= 0.0:
		return 0.6
	return clampf(0.6 + (rpm - IDLE_RPM) / span * 1.4, 0.6, 2.0)


## Skid loop gain 0..1: silent at or below SKID_THRESHOLD, fading to full
## at SKID_FULL. Pure-static so headless tests call it with no scene.
static func skid_gain(slip: float) -> float:
	var span := SKID_FULL - SKID_THRESHOLD
	if span <= 0.0:
		return 0.0
	return clampf((absf(slip) - SKID_THRESHOLD) / span, 0.0, 1.0)


## Wind loop gain 0..1: silent at standstill, full at WIND_FULL_SPEED.
## Pure-static so headless tests call it with no scene.
static func wind_gain(speed_ms: float) -> float:
	if WIND_FULL_SPEED <= 0.0:
		return 0.0
	return clampf(absf(speed_ms) / WIND_FULL_SPEED, 0.0, 1.0)


func _ready() -> void:
	_ensure_buses()
	_music_player = AudioStreamPlayer.new()
	_music_player.name = "MusicPlayer"
	_music_player.bus = &"Music"
	_music_player.stream = _load_loop_stream("res://assets/audio/music_menu.wav")
	add_child(_music_player)
	_click_player = AudioStreamPlayer.new()
	_click_player.name = "ClickPlayer"
	_click_player.bus = &"SFX"
	_click_player.stream = _load_one_shot("res://assets/audio/click.wav")
	add_child(_click_player)
	print("AUDIO_READY")
	start_menu_music()


## Per-frame audio follow: steer the registered player car (falling back
## to the first VehicleController in the tree) so its 3D loops track
## rpm/slip/speed. Every lookup is guarded; silent no-op headless.
func _process(_delta: float) -> void:
	var car := _follow_target()
	if car == null:
		return
	var rpm := 800.0
	var max_rpm := 7200.0
	if car.get("engine_rpm") is float:
		rpm = float(car.get("engine_rpm"))
	if car.get("max_engine_rpm") is float and float(car.get("max_engine_rpm")) > 0.0:
		max_rpm = float(car.get("max_engine_rpm"))
	var speed := 0.0
	if car.get("speed_ms") is float:
		speed = float(car.get("speed_ms"))
	var slip := 0.0
	if car.get("slip_intensity") is float:
		slip = float(car.get("slip_intensity"))
	var engine := car.get_node_or_null("EngineAudio") as AudioStreamPlayer3D
	if engine != null:
		_drive_loop(engine, "res://assets/audio/engine.wav",
				_gain_to_db(clampf(0.35 + 0.65 * (rpm - IDLE_RPM) / maxf(max_rpm - IDLE_RPM, 1.0), 0.0, 1.0)))
		engine.pitch_scale = engine_pitch(rpm, max_rpm)
	var skid := car.get_node_or_null("SkidAudio") as AudioStreamPlayer3D
	if skid != null:
		_drive_loop(skid, "res://assets/audio/skid.wav", _gain_to_db(skid_gain(slip)))
	var wind := car.get_node_or_null("WindAudio") as AudioStreamPlayer3D
	if wind != null:
		_drive_loop(wind, "res://assets/audio/wind.wav", _gain_to_db(wind_gain(speed)))


## Follow target: the registered car while it is valid, else the first
## VehicleController in the tree (guarded like hud.gd's signal wiring).
func _follow_target() -> Node:
	if _vehicle != null:
		if is_instance_valid(_vehicle):
			return _vehicle
		_vehicle = null
	var tree := get_tree()
	if tree == null or tree.root == null:
		return null
	var found := tree.root.find_children("*", "VehicleController", true, false)
	if found.is_empty():
		return null
	return found[0]


## Keep a 3D loop playing at the given volume, loading its stream on
## demand so vehicles spawned before the mixer still sound right.
func _drive_loop(player: AudioStreamPlayer3D, stream_path: String, volume_db: float) -> void:
	if player.stream == null and ResourceLoader.exists(stream_path):
		var loaded := load(stream_path) as AudioStreamWAV
		if loaded != null:
			loaded.loop_mode = AudioStreamWAV.LOOP_FORWARD
			player.stream = loaded
	if player.stream == null:
		return
	player.volume_db = volume_db
	if not player.playing:
		player.play()


## Linear 0..1 gain to dB, floored at SILENCE_DB instead of -inf.
func _gain_to_db(gain: float) -> float:
	if gain <= 0.001:
		return SILENCE_DB
	return linear_to_db(clampf(gain, 0.001, 1.0))


## Follow this car in _process (the race calls this for its player car).
func register_vehicle(car: Node) -> void:
	_vehicle = car


## Stop following car (no-op unless it is the followed one).
func unregister_vehicle(car: Node) -> void:
	if _vehicle == car:
		_vehicle = null


## UI click one-shot; guarded no-op when the stream is missing headless.
func play_click() -> void:
	if _click_player == null or not is_instance_valid(_click_player):
		return
	if _click_player.stream == null:
		return
	_click_player.play()


## (Re)start the menu music loop at full volume; guarded no-op headless.
func start_menu_music() -> void:
	_ducked = false
	if _music_player == null or not is_instance_valid(_music_player):
		return
	if _music_player.stream == null:
		return
	_music_player.volume_db = 0.0
	if not _music_player.playing:
		_music_player.play()


## Lower the menu music loop for racing; keeps looping under the SFX.
func duck_music_for_race() -> void:
	_ducked = true
	if _music_player == null or not is_instance_valid(_music_player):
		return
	if _music_player.stream == null:
		return
	if not _music_player.playing:
		_music_player.play()
	_music_player.volume_db = DUCK_DB


## Create the Music/SFX buses when missing, mirroring
## settings.gd:_apply_bus; levels stay owned by Settings.
func _ensure_buses() -> void:
	for bus_name in [&"Music", &"SFX"]:
		if AudioServer.get_bus_index(bus_name) != -1:
			continue
		AudioServer.add_bus()
		var idx := AudioServer.bus_count - 1
		if idx >= 0:
			AudioServer.set_bus_name(idx, bus_name)


## Looping stream load: missing files yield null instead of raising.
func _load_loop_stream(path: String) -> AudioStreamWAV:
	var stream := _load_one_shot(path)
	if stream != null:
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		stream.loop_end = stream.get_data().size() / 2
	return stream


## Plain stream load: missing files yield null instead of raising.
func _load_one_shot(path: String) -> AudioStreamWAV:
	if not ResourceLoader.exists(path):
		return null
	return load(path) as AudioStreamWAV
