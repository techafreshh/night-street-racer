extends Node
## Cross-cutting game state (autoload singleton). Stub for later laps:
## tracks the selected event and car without owning any scene or UI.
## Loads standalone (no _ready dependencies) so headless tests can
## instantiate it without entering the scene tree.

var current_event: StringName = &""
var selected_car: StringName = &""
