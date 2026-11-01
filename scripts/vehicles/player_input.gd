extends Node
## Bridges player InputMap actions into a VehicleController's input_* fields.
## Parent this to a VehicleController with use_player_input == false so the
## controller's _sample_inputs seam reads the fields this node writes.
## Returns early when the parent is not a VehicleController or when the car
## samples InputMap directly (use_player_input == true).

func _physics_process(_delta: float) -> void:
	var car := get_parent() as VehicleController
	if car == null or car.use_player_input:
		return
	car.input_throttle = Input.get_action_strength("accelerate")
	car.input_brake = Input.get_action_strength("brake")
	car.input_steer = Input.get_action_strength("steer_right") - Input.get_action_strength("steer_left")
	car.input_handbrake = Input.is_action_pressed("handbrake")
