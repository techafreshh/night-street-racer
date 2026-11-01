extends Node3D
## Grey-box driving test ground: a flat 400x400m plane with grid material,
## four invisible barrier walls, and one player-driven VehicleController.
## Prints a ready line for the headless boot probe. References no autoloads
## so the scene boots identically with or without the main loop's autoloads.

func _ready() -> void:
	print("TEST_GROUND_READY")
