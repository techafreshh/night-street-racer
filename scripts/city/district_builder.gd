extends Node3D
## Grey-box night-city district: a 4x4 block street grid with road meshes,
## curb-step block slabs, and invisible route-edge walls.
## Grid math: BLOCK_SIZE 60 m, ROAD_WIDTH 8 m, PITCH 68 m, total side
## 4 * 60 + 5 * 8 = 280 m (DISTRICT_HALF 140 m). Block centers sit at
## -102 / -34 / 34 / 102 on x/z; road strips sit at -136 / -68 / 0 / 68 / 136.
## Road tops: NS strips rest at y = 0 (datum); EW strips carry a +0.02 m
## anti-z-fighting lip (tops at y = +0.02, see ROAD_EW_LIP) so the two axes
## never present coplanar faces at the 25 NS x EW crossings. Block-slab tops
## sit at y = 0.3; the 0.3 m step is the curb barrier. Prints a ready line for the headless boot probe. References
## no autoloads so the scene boots identically with or without the main loop.

const BLOCK_SIZE := 60.0
const ROAD_WIDTH := 8.0
const PITCH := 68.0
const DISTRICT_HALF := 140.0
const ROAD_EW_LIP := 0.02


func _ready() -> void:
	print("DISTRICT_READY")
