extends Node3D
## Grey-box night-city district: a 4x4 block street grid with road meshes,
## curb-step block slabs, and invisible route-edge walls.
## Grid math: BLOCK_SIZE 60 m, ROAD_WIDTH 8 m, PITCH 68 m, total side
## 4 * 60 + 5 * 8 = 280 m (DISTRICT_HALF 140 m). Block centers sit at
## -102 / -34 / 34 / 102 on x/z; road strips sit at -136 / -68 / 0 / 68 / 136.
## Road tops rest at y = 0, block-slab tops at y = 0.3; the 0.3 m step is the
## curb barrier. Prints a ready line for the headless boot probe. References
## no autoloads so the scene boots identically with or without the main loop.

const BLOCK_SIZE := 60.0
const ROAD_WIDTH := 8.0
const PITCH := 68.0
const DISTRICT_HALF := 140.0


func _ready() -> void:
	print("DISTRICT_READY")
