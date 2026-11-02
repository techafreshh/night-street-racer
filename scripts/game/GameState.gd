extends Node
## Cross-cutting game state (autoload singleton). Stub for later laps:
## tracks the selected event and car without owning any scene or UI.
## Loads standalone (no _ready dependencies) so headless tests can
## instantiate it without entering the scene tree.

## Canonical default car id (owner of assets/cars/tunes/default_tune.tres,
## the car_sedan.tscn tune); used to fill selected_car when empty.
const DEFAULT_CAR: StringName = &"sedan"

var current_event: StringName = &""
var selected_car: StringName = &""
