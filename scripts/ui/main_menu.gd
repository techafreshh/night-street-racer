extends Node3D
## Placeholder 3D menu root. Prints a ready line and quits cleanly on
## the pause action (or built-in ui_cancel). References no autoloads so
## the scene boots identically with or without the main loop's autoloads.

func _ready() -> void:
	print("MainMenu ready: Night Street Racer")

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel"):
		get_tree().quit()
