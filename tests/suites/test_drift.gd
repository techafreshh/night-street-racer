extends RefCounted
## Drift-event scoring probes: sustained-slide scoring vs straight-line
## farming, and higher-only best persistence. One of the per-area probe
## suites executed in fixed order by tests/run_all.gd; see that file for
## the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"drift_scores_slide_not_straight",
		"drift_best_persists",
	]
	return names

func drift_scores_slide_not_straight() -> bool:
	ctx.check(FileAccess.file_exists("res://scripts/race/drift_scoring.gd"), "scripts/race/drift_scoring.gd exists")
	ctx.check(absf(DriftScoring.MIN_SLIP_DEG - 12.0) < 0.001, "slip threshold is 12deg (got %.2f)" % DriftScoring.MIN_SLIP_DEG)
	ctx.check(absf(DriftScoring.MIN_SPEED_MS - 10.0) < 0.001, "speed threshold is 10m/s (got %.2f)" % DriftScoring.MIN_SPEED_MS)
	var straight := DriftScoring.slip_angle_deg(20.0, 0.0)
	ctx.check(straight < DriftScoring.MIN_SLIP_DEG, "straight driving reads below the slip gate (%.2f deg)" % straight)
	ctx.check(absf(straight) < 0.001, "straight driving reads ~0deg (got %.3f)" % straight)
	var slide := DriftScoring.slip_angle_deg(20.0, 7.64)
	ctx.check(slide >= DriftScoring.MIN_SLIP_DEG, "sustained slide reads above the slip gate (%.2f deg)" % slide)
	ctx.check(absf(slide - 20.0) < 0.5, "slide matches the atan2 tire shape (%.2f deg, want ~20)" % slide)
	ctx.check(DriftScoring.is_drifting(20.0, 20.0), "20deg at 20m/s is drifting")
	ctx.check(not DriftScoring.is_drifting(5.0, 20.0), "5deg at 20m/s is below the slip gate")
	ctx.check(not DriftScoring.is_drifting(20.0, 5.0), "20deg at 5m/s is below the speed gate")
	ctx.check(not DriftScoring.is_drifting(0.0, 0.0), "standstill is not drifting")
	ctx.check(DriftScoring.score_delta(20.0, 20.0, 1.0) > 0.0, "slide sample scores above zero")
	ctx.check(absf(DriftScoring.score_delta(20.0, 20.0, 1.0) - 400.0) < 0.001, "slide scores slip*speed*delta (got %.2f)" % DriftScoring.score_delta(20.0, 20.0, 1.0))
	ctx.check(DriftScoring.score_delta(5.0, 20.0, 1.0) == 0.0, "below-slip sample scores 0")
	ctx.check(DriftScoring.score_delta(20.0, 5.0, 1.0) == 0.0, "below-speed sample scores 0")
	ctx.check(DriftScoring.score_delta(20.0, 20.0, 0.0) == 0.0, "zero delta scores 0")
	ctx.check(DriftScoring.score_delta(20.0, 20.0, -1.0) == 0.0, "negative delta scores 0")
	var brief := DriftScoring.score_delta(20.0, 20.0, 0.25)
	var sustained := DriftScoring.score_delta(20.0, 20.0, 1.0)
	ctx.check(sustained > brief, "sustained slide outscores a brief one (%.1f > %.1f)" % [sustained, brief])
	var wiggle := 0.0
	for i in 8:
		wiggle += DriftScoring.score_delta(3.0, 20.0, 0.125)
	ctx.check(wiggle == 0.0, "straight-line wiggles farm 0 (got %.2f)" % wiggle)
	var parked := 0.0
	for i in 8:
		parked += DriftScoring.score_delta(20.0, 2.0, 0.125)
	ctx.check(parked == 0.0, "slow slides farm 0 (got %.2f)" % parked)
	ctx.check(DriftScoring.score_delta(20.0, 20.0, 0.5) > 0.0, "handbrake-initiated slide meeting the gates still scores (no handbrake gate)")
	return true

func drift_best_persists() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "drift probe starts from defaults")
	ctx.check(DriftScoring.get_best("drift_park") == 0, "no drift best stored for a fresh event")
	ctx.check(DriftScoring.save_best_if_higher("drift_park", 250), "first score seeds the drift best")
	ctx.check(DriftScoring.get_best("drift_park") == 250, "seeded drift best reads back 250")
	ctx.check(not DriftScoring.save_best_if_higher("drift_park", 200), "lower score never overwrites the best")
	ctx.check(DriftScoring.get_best("drift_park") == 250, "record keeps 250 after a lower run")
	ctx.check(DriftScoring.save_best_if_higher("drift_park", 400), "higher score overwrites the best")
	ctx.check(DriftScoring.get_best("drift_park") == 400, "record keeps 400 after a higher run")
	var loaded := SaveSystem.load_game()
	var entry: Dictionary = (loaded["records"] as Dictionary).get("drift_park", {})
	ctx.check(int(entry.get("best_drift_score", 0)) == 400, "best_drift_score persists to disk")
	ctx.check(not DriftScoring.save_best_if_higher("", 300), "empty event_id writes nothing")
	ctx.check(not DriftScoring.save_best_if_higher("drift_park", 0), "zero score writes nothing")
	ctx.check(not DriftScoring.save_best_if_higher("drift_park", -50), "negative score writes nothing")
	ctx.check(DriftScoring.get_best("drift_park") == 400, "record keeps 400 after invalid writes")
	ctx.check(DriftScoring.get_best("") == 0, "empty event_id has no best")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "drift probe restores defaults")
	return true
