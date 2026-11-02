extends RefCounted
## Event-select grid probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_event_select_grid",
		"test_event_grid_async_defers_work",
		"test_event_grid_async_completes",
		"test_event_press_writes_current_event",
		"test_event_select_grid_skips_invalid",
		"test_event_grid_single_save_read",
		"test_event_grid_no_per_button_reads",
		"menu_typed_selection_reads",
	]
	return names

func test_event_select_grid() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "event select instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "EventSelect", "root node is EventSelect")
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var grid := instance.find_child("EventGrid", true, false) as GridContainer
	ctx.check(grid != null, "event select has an EventGrid")
	if grid == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	ctx.check(grid.get_child_count() >= 5, "grid holds >= 5 event buttons (got %d)" % grid.get_child_count())
	var enabled := 0
	for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		ctx.check(ev != null, "%s loads as RaceEvent" % stem)
		var btn := instance.find_child("Event_" + stem, true, false) as BaseButton
		ctx.check(btn != null, "grid has a button for %s" % stem)
		if btn == null:
			continue
		ctx.check((btn as Button).text.contains(stem), "button text names %s" % stem)
		var should_lock := ev == null or not MenuUI.is_unlocked(ev)
		ctx.check(btn.disabled == should_lock, "%s disabled matches lock state" % stem)
		if not btn.disabled:
			enabled += 1
			ctx.check(btn.focus_mode != Control.FOCUS_NONE, "%s stays focusable" % stem)
	ctx.check(enabled >= 1, "at least one event is unlocked (got %d)" % enabled)
	var back := instance.find_child("BackButton", true, false) as BaseButton
	ctx.check(back != null, "event select has a BackButton")
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	return true

func test_event_grid_async_defers_work() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads as PackedScene for the deferral probe")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "event select instantiates for the deferral probe")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	# _ready prints its tokens and returns synchronously; the grid build is
	# fire-and-forget, so the EventGrid must still be empty on this frame.
	var grid := instance.find_child("EventGrid", true, false) as GridContainer
	ctx.check(grid != null, "deferral probe has an EventGrid")
	if grid != null:
		ctx.check(grid.get_child_count() == 0, "grid is empty on the _ready frame (got %d)" % grid.get_child_count())
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	ctx.check(src.contains("load_threaded_request"), "menu.gd issues threaded loads off _ready")
	ctx.check(src.contains("EVENT_GRID_READY"), "menu.gd prints EVENT_GRID_READY when the async grid completes")
	ctx.check(src.contains("load_threaded_get_status"), "menu.gd polls threaded load status")
	ctx.check(src.contains("_build_event_grid_async"), "menu.gd builds the grid via _build_event_grid_async")
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	return true

func test_event_grid_async_completes() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads as PackedScene for the completion probe")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "event select instantiates for the completion probe")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var grid := instance.find_child("EventGrid", true, false) as GridContainer
	ctx.check(grid != null, "completion probe has an EventGrid")
	if grid == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	var expected := 0
	for path in MenuUI.EVENT_PATHS:
		var asset := load(path) as RaceEvent
		if asset != null and RaceEvent.validate(asset):
			expected += 1
	ctx.check(expected >= 5, "all 5 shipped events pass RaceEvent.validate() (got %d)" % expected)
	ctx.check(grid.get_child_count() == expected, "async grid holds only validated events (%d vs %d)" % [grid.get_child_count(), expected])
	for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		ctx.check(ev != null, "%s loads as RaceEvent" % stem)
		var btn := instance.find_child("Event_" + stem, true, false) as Button
		ctx.check(btn != null, "async grid has a button for %s" % stem)
		if btn == null:
			continue
		ctx.check(btn.custom_minimum_size == Vector2(320, 48), "%s keeps the 320x48 contract" % stem)
		ctx.check(btn.text.contains(stem), "async button text names %s" % stem)
		var should_lock := ev == null or not MenuUI.is_unlocked(ev)
		ctx.check(btn.disabled == should_lock, "%s disabled matches lock state" % stem)
		if should_lock:
			ctx.check(btn.text.contains("Locked"), "%s locked text carries the lock suffix" % stem)
			ctx.check(btn.focus_mode == Control.FOCUS_NONE, "%s locked button skips focus" % stem)
		else:
			ctx.check(not btn.text.contains("Locked"), "%s unlocked text has no lock suffix" % stem)
			ctx.check(btn.focus_mode != Control.FOCUS_NONE, "%s unlocked button stays focusable" % stem)
	var focused := ctx.tree.root.gui_get_focus_owner()
	var back := instance.find_child("BackButton", true, false) as BaseButton
	ctx.check(focused != null, "async build leaves focus on an unlocked button or BackButton")
	if focused != null:
		var focused_name := str((focused as Node).name)
		ctx.check(focused_name == "BackButton" or focused_name.begins_with("Event_"), "focus sits on %s" % focused_name)
		if focused_name.begins_with("Event_"):
			ctx.check(not (focused as BaseButton).disabled, "focus sits on an unlocked event (%s)" % focused_name)
	if back != null and focused == null:
		ctx.check(false, "focus owner is null despite BackButton existing")
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	return true

func test_event_press_writes_current_event() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "event select instantiates for press test")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	ctx.check(gs != null, "GameState singleton is reachable for event press")
	if gs == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	var resolved := &""
	for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
		var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
		if ev != null and MenuUI.is_unlocked(ev):
			resolved = StringName(stem)
			break
	ctx.check(resolved != &"", "at least one event is unlocked for press test")
	if resolved == &"":
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	var btn := instance.find_child("Event_" + String(resolved), true, false) as BaseButton
	ctx.check(btn != null, "grid has Event_%s button" % String(resolved))
	if btn == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		return true
	ctx.check(btn.disabled == false, "%s button is unlocked for press test" % String(resolved))
	var prev := StringName(gs.get("current_event"))
	btn.pressed.emit()
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.check(StringName(gs.get("current_event")) == resolved, "pressing %s writes current_event" % String(resolved))
	var navigated := ctx.tree.current_scene
	var navigated_grid := navigated.find_child("CarGrid", true, false) as GridContainer if navigated != null else null
	for _i in 40:
		if navigated_grid != null and is_instance_valid(navigated_grid) and navigated_grid.get_child_count() >= 4:
			break
		await ctx.tree.process_frame
	if navigated != null and navigated != instance and is_instance_valid(navigated):
		if navigated.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(navigated)
		navigated.free()
		await ctx.tree.process_frame
	gs.set("current_event", prev)
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	var detached := MenuUI.new()
	ctx.check(detached != null, "detached MenuUI instantiates")
	if detached != null:
		ctx.tree.root.add_child(detached)
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		gs.set("current_event", &"")
		detached._on_event_chosen(String(resolved))
		await ctx.tree.process_frame
		ctx.check(StringName(gs.get("current_event")) == resolved, "detached _on_event_chosen writes current_event %s" % String(resolved))
		var navigated_detached := ctx.tree.current_scene
		var detached_grid := navigated_detached.find_child("CarGrid", true, false) as GridContainer if navigated_detached != null else null
		for _i in 40:
			if detached_grid != null and is_instance_valid(detached_grid) and detached_grid.get_child_count() >= 4:
				break
			await ctx.tree.process_frame
		if navigated_detached != null and navigated_detached != detached and is_instance_valid(navigated_detached):
			if navigated_detached.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(navigated_detached)
			navigated_detached.free()
			await ctx.tree.process_frame
		gs.set("current_event", prev)
		ctx.tree.root.remove_child(detached)
		detached.free()
		await ctx.tree.process_frame
	return true

func test_event_select_grid_skips_invalid() -> bool:
	var base := load("res://assets/events/harbor_sprint.tres") as RaceEvent
	ctx.check(base != null, "harbor_sprint loads as the filter baseline")
	if base == null:
		return true
	ctx.check(RaceEvent.validate(base), "filter baseline passes RaceEvent.validate()")
	var bad_laps := base.duplicate() as RaceEvent
	bad_laps.laps = 99
	ctx.check(not RaceEvent.validate(bad_laps), "laps=99 fails RaceEvent.validate()")
	var bad_gates := base.duplicate() as RaceEvent
	bad_gates.checkpoints = PackedVector3Array([Vector3(0, 1, 0), Vector3(10, 1, 0)])
	ctx.check(not RaceEvent.validate(bad_gates), "fewer than 4 gates fails RaceEvent.validate()")
	var bad_radius := base.duplicate() as RaceEvent
	bad_radius.checkpoint_radius = 99.0
	ctx.check(not RaceEvent.validate(bad_radius), "out-of-range radius fails RaceEvent.validate()")
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads for the filter check")
	if not (packed is PackedScene):
		return true
	var select: Node = packed.instantiate()
	ctx.tree.root.add_child(select)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var grid := select.find_child("EventGrid", true, false) as GridContainer
	ctx.check(grid != null, "event select has an EventGrid for the filter check")
	if grid == null:
		ctx.tree.root.remove_child(select)
		select.free()
		return true
	var expected := 0
	for path in MenuUI.EVENT_PATHS:
		var asset := load(path) as RaceEvent
		if asset != null and RaceEvent.validate(asset):
			expected += 1
	ctx.check(expected >= 5, "all 5 shipped events pass RaceEvent.validate() (got %d)" % expected)
	ctx.check(grid.get_child_count() == expected, "grid holds only validated events (%d vs %d)" % [grid.get_child_count(), expected])
	for child in grid.get_children():
		var btn := child as Button
		ctx.check(btn != null, "grid child %s is a Button" % str(child.name))
		if btn == null:
			continue
		var stem := str(btn.name).trim_prefix("Event_")
		ctx.check(stem != str(btn.name), "grid button name carries an Event_ stem (%s)" % str(btn.name))
		var backed := load("res://assets/events/%s.tres" % stem) as RaceEvent
		ctx.check(backed != null, "grid button %s backs a RaceEvent asset" % stem)
		if backed != null:
			ctx.check(RaceEvent.validate(backed), "grid button %s backs a validated event" % stem)
	ctx.check(select.find_child("Event_bogus_event", true, false) == null, "no button exists for a synthetic invalid stem")
	ctx.tree.root.remove_child(select)
	select.free()
	await ctx.tree.process_frame
	return true

func test_event_grid_single_save_read() -> bool:
	var packed = load("res://scenes/ui/event_select.tscn")
	ctx.check(packed is PackedScene, "event_select.tscn loads for the single-read probe")
	if not (packed is PackedScene):
		return true
	var seed := SaveSystem.default_data()
	(seed["progress"] as Dictionary)["unlocked_events"] = ["harbor_sprint"]
	(seed["records"] as Dictionary)["harbor_sprint"] = {"best_time_s": 88.2, "best_position": 1}
	ctx.check(SaveSystem.save_game(seed), "single-read probe seeds a partial save")
	var unlocked := Progression.unlocked_events()
	var bests := TimeTrial.all_bests()
	ctx.check((unlocked as Array) == ["harbor_sprint"], "one unlock snapshot holds the seeded ladder")
	ctx.check(absf(float(bests.get("harbor_sprint", -1.0)) - 88.2) < 0.001, "one best snapshot holds the seeded 88.2")
	var select: Node = packed.instantiate()
	ctx.tree.root.add_child(select)
	var grid := select.find_child("EventGrid", true, false) as GridContainer
	ctx.check(grid != null, "single-read probe has an EventGrid")
	var expected := 0
	for path in MenuUI.EVENT_PATHS:
		var asset := load(path) as RaceEvent
		if asset != null and RaceEvent.validate(asset):
			expected += 1
	if grid != null:
		for _i in 60:
			if grid.get_child_count() >= expected:
				break
			await ctx.tree.process_frame
		ctx.check(grid.get_child_count() == expected, "grid builds all %d validated events from the seeded save" % expected)
		for stem in ["harbor_sprint", "downtown_gp", "neon_loop", "bayline_circuit", "alley_sprint"]:
			var ev := load("res://assets/events/%s.tres" % stem) as RaceEvent
			if ev == null:
				continue
			var want_open := Progression.is_unlocked_with(ev, unlocked)
			ctx.check(MenuUI.is_unlocked(ev) == want_open, "%s snapshot parity with the legacy shim" % stem)
			ctx.check(absf(TimeTrial.get_best(stem) - float(bests.get(stem, -1.0))) < 0.001, "%s best parity with the snapshot" % stem)
			var btn := select.find_child("Event_" + stem, true, false) as Button
			ctx.check(btn != null, "seeded grid has a button for %s" % stem)
			if btn == null:
				continue
			ctx.check(btn.disabled == (not want_open), "%s disabled matches the snapshot lock" % stem)
			if want_open:
				ctx.check(not btn.text.contains("Locked"), "%s open button carries no lock suffix" % stem)
			else:
				ctx.check(btn.text.contains("Locked"), "%s locked button carries the lock suffix" % stem)
				ctx.check(btn.focus_mode == Control.FOCUS_NONE, "%s locked button skips focus" % stem)
			if stem == "harbor_sprint":
				ctx.check(btn.text.contains(TimeTrial.format_time(88.2)), "seeded best renders its BEST tag (got %s)" % btn.text)
			else:
				ctx.check(not btn.text.contains("BEST"), "%s with no record carries no BEST tag" % stem)
	ctx.tree.root.remove_child(select)
	select.free()
	await ctx.tree.process_frame
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "single-read probe restores defaults")
	return true

func test_event_grid_no_per_button_reads() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	ctx.check(src != "", "menu.gd source loads for the no-per-button-read probe")
	if src == "":
		return true
	var btn_start := src.find("func _add_event_button")
	ctx.check(btn_start >= 0, "menu.gd keeps _add_event_button")
	if btn_start >= 0:
		var btn_rest := src.substr(btn_start)
		var btn_next := btn_rest.find("\nfunc ", 1)
		var btn_body := btn_rest.substr(0, btn_next) if btn_next >= 0 else btn_rest
		for banned in ["load_game", "get_best(", "is_event_unlocked(", "is_unlocked("]:
			ctx.check(not btn_body.contains(banned), "_add_event_button performs no %s (builder snapshots once)" % banned)
	var async_start := src.find("func _build_event_grid_async")
	ctx.check(async_start >= 0, "menu.gd keeps _build_event_grid_async")
	if async_start >= 0:
		var async_rest := src.substr(async_start)
		var async_next := async_rest.find("\nfunc ", 1)
		var async_body := async_rest.substr(0, async_next) if async_next >= 0 else async_rest
		ctx.check(async_body.contains("Progression.unlocked_events()"), "async builder snapshots unlocks once")
		ctx.check(async_body.contains("TimeTrial.all_bests()"), "async builder snapshots bests once")
		ctx.check(async_body.contains("is_unlocked_with"), "async builder evaluates locks from the snapshot")
		ctx.check(async_body.contains("EVENT_GRID_READY"), "async builder still prints EVENT_GRID_READY")
	var prog := FileAccess.get_file_as_string("res://scripts/game/progression.gd")
	ctx.check(prog.contains("func unlocked_events"), "progression.gd exposes the unlock snapshot")
	ctx.check(prog.contains("func is_unlocked_with"), "progression.gd exposes the pure lock predicate")
	var pure_start := prog.find("func is_unlocked_with")
	if pure_start >= 0:
		var pure_rest := prog.substr(pure_start)
		var pure_next := pure_rest.find("\nstatic func ", 1)
		var pure_body := pure_rest.substr(0, pure_next) if pure_next >= 0 else pure_rest
		ctx.check(not pure_body.contains("load_game"), "is_unlocked_with evaluates with no disk read")
	var tt := FileAccess.get_file_as_string("res://scripts/race/time_trial.gd")
	ctx.check(tt.contains("func all_bests"), "time_trial.gd exposes the best snapshot")
	var snap_start := tt.find("func all_bests")
	if snap_start >= 0:
		var snap_rest := tt.substr(snap_start)
		var snap_next := snap_rest.find("\nstatic func ", 1)
		var snap_body := snap_rest.substr(0, snap_next) if snap_next >= 0 else snap_rest
		ctx.check(snap_body.contains("load_game"), "all_bests performs the single bests read")
	var table_start := tt.find("func _best_from_table")
	if table_start >= 0:
		var table_rest := tt.substr(table_start)
		var table_next := table_rest.find("\nstatic func ", 1)
		var table_body := table_rest.substr(0, table_next) if table_next >= 0 else table_rest
		ctx.check(not table_body.contains("load_game"), "_best_from_table evaluates with no disk read")
	return true

func menu_typed_selection_reads() -> bool:
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	ctx.check(src != "", "menu.gd source loads for the typed-reads probe")
	if src == "":
		return true
	ctx.check(src.contains("has_method(\"get_selected_car\")"), "menu guards the get_selected_car reader")
	ctx.check(src.contains("gs.call(\"get_selected_car\")"), "menu routes the car read through get_selected_car")
	ctx.check(src.contains("has_method(\"get_default_car\")"), "menu guards the get_default_car reader")
	ctx.check(src.contains("gs.call(\"get_default_car\")"), "menu routes the default read through get_default_car")
	ctx.check(not src.contains("gs.get(\"selected_car\")"), "menu keeps no stringly selected_car read")
	ctx.check(not src.contains("gs.get(\"DEFAULT_CAR\")"), "menu keeps no stringly DEFAULT_CAR read")
	ctx.check(src.contains("CAR_SELECTED"), "menu keeps the CAR_SELECTED token")
	ctx.check(src.contains("select_car"), "menu keeps the typed select_car writer")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for the menu typed-reads probe")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
		await ctx.tree.process_frame
	ctx.check(gs != null, "GameState singleton is reachable for the menu typed-reads probe")
	if gs == null:
		return true
	ctx.check(gs.has_method("get_selected_car"), "GameState exposes get_selected_car")
	ctx.check(gs.has_method("get_default_car"), "GameState exposes get_default_car")
	var prev := StringName(gs.get("selected_car"))
	gs.call("select_car", "hatch")
	await ctx.tree.process_frame
	ctx.check(StringName(gs.call("get_selected_car")) == &"hatch", "typed writer flows to the typed reader (got %s)" % String(gs.call("get_selected_car")))
	var packed = load("res://scenes/ui/main_menu.tscn")
	ctx.check(packed is PackedScene, "main_menu.tscn loads for the menu typed-reads probe")
	if not (packed is PackedScene):
		gs.set("selected_car", prev)
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var garage_btn := instance.find_child("GarageButton", true, false) as BaseButton
	ctx.check(garage_btn != null, "main menu has GarageButton for the typed-reads probe")
	if garage_btn != null:
		garage_btn.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.call("get_selected_car")) == &"hatch", "Garage press never clobbers a pre-set car (got %s)" % String(gs.call("get_selected_car")))
		var live := ctx.tree.current_scene
		ctx.check(live != null and live != instance, "Garage press leaves MainMenu")
		if live != null and live != instance and is_instance_valid(live):
			if live.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(live)
			live.free()
			await ctx.tree.process_frame
	gs.set("selected_car", &"")
	await ctx.tree.process_frame
	var fresh: Node = packed.instantiate()
	ctx.tree.root.add_child(fresh)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var fresh_btn := fresh.find_child("GarageButton", true, false) as BaseButton
	ctx.check(fresh_btn != null, "fresh menu has GarageButton for the fill-default probe")
	if fresh_btn != null:
		fresh_btn.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.call("get_selected_car")) == &"sedan", "empty selection fills the default sedan (got %s)" % String(gs.call("get_selected_car")))
		var filled := ctx.tree.current_scene
		if filled != null and filled != fresh and is_instance_valid(filled):
			if filled.get_parent() == ctx.tree.root:
				ctx.tree.root.remove_child(filled)
			filled.free()
			await ctx.tree.process_frame
	if is_instance_valid(fresh):
		if fresh.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(fresh)
		fresh.free()
		await ctx.tree.process_frame
	if is_instance_valid(instance):
		if instance.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(instance)
		instance.free()
		await ctx.tree.process_frame
	var swapped := ctx.tree.current_scene
	if swapped != null and swapped != instance and swapped != fresh and is_instance_valid(swapped):
		if swapped.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(swapped)
		swapped.free()
		await ctx.tree.process_frame
	gs.set("selected_car", prev)
	await ctx.tree.process_frame
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true
