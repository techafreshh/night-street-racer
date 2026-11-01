class_name RubberBand
extends Node
## Clamped catch-up aid for AI racers on the district loop.
## Parent this to a VehicleController beside its AIRacerInput bridge: the
## bridge adds `current_aid` to its pursuit target speed, clamped so no car
## ever gains more than `max_aid_s` (default 3.0 m/s, ~10.7% of the 28 m/s
## line top speed, inside the 12% bound). Toggle the effect with `enabled`.
## This node only publishes a target-speed offset each physics frame; all
## drive force still comes from the car's tune through its input_* fields.

@export var enabled := true
## Maximum target-speed offset in m/s, applied symmetrically both ways.
@export var max_aid_s := 3.0
## Proportional aid per metre of wrapped arc gap to the race leader.
@export var gain := 0.08
@export var racing_line: RacingLine

## Aid consumed by AIRacerInput this frame (m/s, within +/- max_aid_s).
var current_aid := 0.0


## Pure clamp: proportional aid for a signed gap, bounded both ways.
static func compute_aid(gap_m: float, max_aid: float, p_gain := 0.08) -> float:
	return clampf(gap_m * p_gain, -max_aid, max_aid)


## Instance aid honoring the toggle: disabled always yields zero.
func aid_for(gap_m: float) -> float:
	if not enabled:
		return 0.0
	return RubberBand.compute_aid(gap_m, max_aid_s, gain)


func _physics_process(_delta: float) -> void:
	current_aid = 0.0
	if not enabled:
		return
	var car := get_parent() as VehicleController
	if car == null:
		return
	var line: RacingLine = racing_line
	if line == null:
		var brain := get_parent().get_node_or_null("AIRacerInput")
		if brain != null:
			line = brain.get("racing_line") as RacingLine
	if line == null or line.points.size() < 2:
		return
	var total := line.track_length()
	if total < 1.0:
		return
	var body := car as Node3D
	if body == null:
		return
	var own := line.arc_of(body.global_transform.origin)
	var members := get_tree().get_nodes_in_group("racers")
	if members.is_empty():
		return
	var arcs: Array[float] = []
	for m in members:
		var nd := m as Node3D
		if nd == null:
			continue
		arcs.append(line.arc_of(nd.global_transform.origin))
	if arcs.is_empty():
		return
	# Leader is the member ahead of every other member within a half lap,
	# which stays seam-safe while the field spread is under half the loop.
	var leader_arc := own
	for c in arcs:
		var ahead := true
		for o in arcs:
			if fposmod(c - o, total) > total * 0.5:
				ahead = false
				break
		if ahead:
			leader_arc = c
			break
	var gap := fposmod(leader_arc - own, total)
	if gap > total * 0.5:
		return
	current_aid = aid_for(gap)
