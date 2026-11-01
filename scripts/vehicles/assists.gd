class_name VehicleAssists
extends Node
## Traction/stability assists, default ON.
## Parent this to a VehicleController; each physics tick it refreshes the
## local flag from `/root/Settings` `assists` (when that node/property
## exists) and pushes it into the parent's `assists_enabled` field.
## The correction math is pure-static so headless tests can call it with
## no scene: with `enabled == false` the input is returned unchanged,
## with `enabled == true` a strictly smaller magnitude is returned.

@export var assists_enabled := true
@export var steer_damp_strength := 0.2
@export var slip_damp_strength := 0.25


static func correct_steer(steer: float, speed_ms: float, enabled: bool, max_damp: float = 0.2) -> float:
	if not enabled:
		return steer
	var t := clampf(absf(speed_ms) / 40.0, 0.0, 1.0)
	return steer * (1.0 - clampf(max_damp, 0.0, 0.9) * t)


static func damp_slip(raw_slip: float, enabled: bool, damp: float = 0.25) -> float:
	if not enabled:
		return raw_slip
	return raw_slip * (1.0 - clampf(damp, 0.0, 0.9))


func _physics_process(_delta: float) -> void:
	var car := get_parent() as VehicleController
	if car == null:
		return
	if is_inside_tree() and get_tree() != null:
		var settings := get_node_or_null("/root/Settings")
		if settings != null:
			for prop in settings.get_property_list():
				if prop.get("name") == "assists":
					assists_enabled = bool(settings.get("assists"))
					break
	car.assists_enabled = assists_enabled
