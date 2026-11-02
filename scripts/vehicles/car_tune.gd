class_name CarTune
extends Resource
## Tunable arcade handling baseline for one car setup.
## Single source of truth for engine, gearing, tire grip, roll stiffness,
## and downforce so tuning is data (assets/cars/tunes/*.tres), not magic
## numbers inside VehicleController. Apply via VehicleController.apply_tune().
## Every tunable documents its fun range in a `## Fun range:` comment AND
## mirrors it as a const min/max pair; static validate() enforces the consts
## so docs and checks cannot diverge. Pure-static: no scene needed.

const ENGINE_TORQUE_MIN := 250.0
const ENGINE_TORQUE_MAX := 550.0
const GEAR_RATIO_MIN := 0.5
const GEAR_RATIO_MAX := 4.0
const GEAR_COUNT_MIN := 4
const GEAR_COUNT_MAX := 6
const FINAL_DRIVE_MIN := 2.5
const FINAL_DRIVE_MAX := 4.5
const TIRE_GRIP_MIN := 0.8
const TIRE_GRIP_MAX := 1.4
const ROLL_STIFFNESS_MIN := 0.0
const ROLL_STIFFNESS_MAX := 15000.0
const DOWNFORCE_MIN := 0.0
const DOWNFORCE_MAX := 3.0
const DRIVETRAIN_MIN := 0
const DRIVETRAIN_MAX := 2

## Fun range: 250.0 - 550.0 Nm peak engine torque.
@export var engine_torque := 380.0
## Fun range: 4-6 strictly decreasing ratios, each 0.5 - 4.0.
@export var gear_ratios: Array[float] = [3.2, 2.1, 1.5, 1.1, 0.85]
## Fun range: 2.5 - 4.5 final drive.
@export var final_drive := 3.9
## Fun range: 0.8 - 1.4 front axle lateral grip multiplier.
@export var tire_grip_front := 1.0
## Fun range: 0.8 - 1.4 rear axle lateral grip multiplier.
@export var tire_grip_rear := 1.0
## Fun range: 0.0 - 15000.0 N/m front anti-roll rate.
@export var roll_stiffness_front := 8000.0
## Fun range: 0.0 - 15000.0 N/m rear anti-roll rate.
@export var roll_stiffness_rear := 6500.0
## Fun range: 0.0 - 3.0 N per (m/s)^2 central downforce coefficient.
@export var downforce_coefficient := 1.2
## Fun range: 0-2 drivetrain layout (0 FWD, 1 RWD, 2 AWD).
@export var drivetrain := 1


static func validate(tune: CarTune) -> bool:
	if tune == null:
		return false
	if tune.engine_torque < ENGINE_TORQUE_MIN or tune.engine_torque > ENGINE_TORQUE_MAX:
		return false
	if tune.gear_ratios.size() < GEAR_COUNT_MIN or tune.gear_ratios.size() > GEAR_COUNT_MAX:
		return false
	for i in tune.gear_ratios.size():
		var ratio: float = tune.gear_ratios[i]
		if ratio < GEAR_RATIO_MIN or ratio > GEAR_RATIO_MAX:
			return false
		if i > 0 and not (tune.gear_ratios[i - 1] > ratio):
			return false
	if tune.final_drive < FINAL_DRIVE_MIN or tune.final_drive > FINAL_DRIVE_MAX:
		return false
	if tune.tire_grip_front < TIRE_GRIP_MIN or tune.tire_grip_front > TIRE_GRIP_MAX:
		return false
	if tune.tire_grip_rear < TIRE_GRIP_MIN or tune.tire_grip_rear > TIRE_GRIP_MAX:
		return false
	if tune.roll_stiffness_front < ROLL_STIFFNESS_MIN or tune.roll_stiffness_front > ROLL_STIFFNESS_MAX:
		return false
	if tune.roll_stiffness_rear < ROLL_STIFFNESS_MIN or tune.roll_stiffness_rear > ROLL_STIFFNESS_MAX:
		return false
	if tune.downforce_coefficient < DOWNFORCE_MIN or tune.downforce_coefficient > DOWNFORCE_MAX:
		return false
	if tune.drivetrain < DRIVETRAIN_MIN or tune.drivetrain > DRIVETRAIN_MAX:
		return false
	return true
