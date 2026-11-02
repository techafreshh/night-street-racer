extends RefCounted
## Main-menu boot and garage scene probes. One of the per-area probe suites executed in fixed order by
## tests/run_all.gd; see that file for the PASS/FAIL + Results + exit-code contract.
## Add future probes here: append the func and its name to get_test_names().

const TestContext = preload("res://tests/support/test_context.gd")

var ctx: TestContext

func _init(p_ctx: TestContext) -> void:
	ctx = p_ctx

func get_test_names() -> Array[String]:
	var names: Array[String] = [
		"test_main_menu_scene",
		"test_menu_buttons",
		"test_garage_writes_selected_car",
		"test_gamestate_typed_writers",
		"test_garage_writes_via_typed_api",
		"test_garage_scene_loads",
		"test_garage_car_grid",
		"test_garage_grid_async_defers_work",
		"test_garage_grid_async_completes",
		"test_garage_unlock_corrupt",
		"test_garage_color_persists",
	]
	return names

func test_main_menu_scene() -> bool:
	var packed = load("res://scenes/ui/main_menu.tscn")
	ctx.check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if packed is PackedScene:
		var instance: Node = packed.instantiate()
		ctx.check(instance != null, "main_menu instantiates")
		if instance != null:
			ctx.check(instance.name == "MainMenu", "root node is MainMenu")
			instance.free()
	return true

func test_menu_buttons() -> bool:
	var packed = load("res://scenes/ui/main_menu.tscn")
	ctx.check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "main menu instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "MainMenu", "root node is MainMenu")
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	for bname in ["RaceButton", "GarageButton", "SettingsButton"]:
		var btn := instance.find_child(bname, true, false) as BaseButton
		ctx.check(btn != null, "main menu has %s" % bname)
		if btn != null:
			ctx.check(btn.focus_mode != Control.FOCUS_NONE, "%s is focus-enabled for keyboard/gamepad" % bname)
	var quit_btn := instance.find_child("QuitButton", true, false) as BaseButton
	ctx.check(quit_btn != null, "main menu has QuitButton")
	var focus_owner := instance.get_viewport().gui_get_focus_owner()
	ctx.check(focus_owner != null, "a menu button holds keyboard/gamepad focus")
	var race := instance.find_child("RaceButton", true, false) as BaseButton
	if race != null:
		race.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(is_instance_valid(race), "pressing Race does not error")
		var swapped := ctx.tree.current_scene
		if swapped != null and swapped != instance:
			ctx.tree.root.remove_child(swapped)
			swapped.free()
		await ctx.tree.process_frame
	var garage := instance.find_child("GarageButton", true, false) as BaseButton
	if garage != null:
		garage.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(is_instance_valid(garage), "pressing Garage does not error")
		var garaged := ctx.tree.current_scene
		ctx.check(garaged != null and garaged != instance, "Garage press leaves MainMenu")
		ctx.check(garaged != null and (garaged.name == "Garage" or garaged.find_child("CarGrid", true, false) != null), "Garage press navigates to the garage scene")
		if garaged != null and garaged != instance:
			ctx.tree.root.remove_child(garaged)
			garaged.free()
		await ctx.tree.process_frame
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	return true

func test_garage_writes_selected_car() -> bool:
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for garage wiring")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable")
	if gs == null:
		return true
	var prev_car := StringName(gs.get("selected_car"))
	gs.set("selected_car", &"")
	var packed = load("res://scenes/ui/main_menu.tscn")
	ctx.check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		gs.set("selected_car", prev_car)
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var garage := instance.find_child("GarageButton", true, false) as BaseButton
	ctx.check(garage != null, "main menu has GarageButton")
	if garage != null:
		garage.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.get("selected_car")) == &"sedan", "fresh Garage press fills selected_car with sedan")
		var live := ctx.tree.current_scene
		ctx.check(live != null and live != instance, "Garage press leaves MainMenu")
		ctx.check(live != null and (live.name == "Garage" or live.find_child("CarGrid", true, false) != null), "Garage press navigates to the garage scene")
		if live != null and live != instance:
			var sedan_btn := live.find_child("Car_sedan", true, false) as BaseButton
			ctx.check(sedan_btn != null, "garage has Car_sedan")
			if sedan_btn != null:
				gs.select_car("hatch")
				sedan_btn.pressed.emit()
				await ctx.tree.process_frame
				await ctx.tree.process_frame
				ctx.check(StringName(gs.get("selected_car")) == &"sedan", "pressing Car_sedan writes selected_car")
			var back := live.find_child("BackButton", true, false) as BaseButton
			ctx.check(back != null, "garage has a BackButton")
			if back != null:
				back.pressed.emit()
				await ctx.tree.process_frame
				await ctx.tree.process_frame
				var home := ctx.tree.current_scene
				ctx.check(home != null and (home.name == "MainMenu" or home.find_child("RaceButton", true, false) != null), "garage BackButton returns to MainMenu")
		gs.select_car("hatch")
		garage.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.get("selected_car")) == &"hatch", "Garage never clobbers a pre-set car")
		var again := ctx.tree.current_scene
		ctx.check(again != null and (again.name == "Garage" or again.find_child("CarGrid", true, false) != null), "repeat Garage press still navigates to the garage")
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	ctx.check(src.contains("selected_car"), "menu.gd wires selected_car")
	ctx.check(src.contains("CAR_SELECTED"), "menu.gd prints the CAR_SELECTED token")
	var swapped := ctx.tree.current_scene
	if swapped != null and swapped != instance and is_instance_valid(swapped):
		if swapped.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(swapped)
		swapped.free()
		await ctx.tree.process_frame
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	gs.set("selected_car", prev_car)
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func test_gamestate_typed_writers() -> bool:
	var script = load("res://scripts/game/GameState.gd")
	ctx.check(script != null, "GameState.gd loads for typed writers")
	if script == null:
		return true
	ctx.check(StringName(script.get("DEFAULT_CAR")) == &"sedan", "DEFAULT_CAR is sedan")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "typed-writer probe starts from defaults")
	var node = script.new()
	ctx.check(node != null, "GameState instantiates standalone for typed writers")
	if node == null:
		SaveSystem.save_game(SaveSystem.default_data())
		return true
	ctx.check(node.has_method("select_car"), "GameState exposes select_car")
	ctx.check(node.has_method("select_event"), "GameState exposes select_event")
	node.select_car("hatch")
	ctx.check(StringName(node.get("selected_car")) == &"hatch", "select_car writes selected_car")
	node.select_event("neon_loop")
	ctx.check(StringName(node.get("current_event")) == &"neon_loop", "select_event writes current_event")
	node.free()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "typed-writer probe restores defaults")
	var car_packed = load("res://scenes/vehicles/car_sedan.tscn")
	ctx.check(car_packed is PackedScene, "default car scene car_sedan.tscn loads")
	return true

func test_garage_writes_via_typed_api() -> bool:
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for typed garage wiring")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for typed garage probe")
	if gs == null:
		return true
	var prev_car := StringName(gs.get("selected_car"))
	gs.set("selected_car", &"")
	var packed = load("res://scenes/ui/main_menu.tscn")
	ctx.check(packed is PackedScene, "main_menu.tscn loads as PackedScene")
	if not (packed is PackedScene):
		gs.set("selected_car", prev_car)
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var garage := instance.find_child("GarageButton", true, false) as BaseButton
	ctx.check(garage != null, "main menu has GarageButton")
	if garage != null:
		garage.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.get("selected_car")) == &"sedan", "fresh Garage press fills selected_car with sedan")
		var live := ctx.tree.current_scene
		ctx.check(live != null and live != instance, "Garage press leaves MainMenu")
		ctx.check(live != null and (live.name == "Garage" or live.find_child("CarGrid", true, false) != null), "Garage press navigates to the garage scene")
		gs.set("selected_car", &"hatch")
		garage.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.get("selected_car")) == &"hatch", "Garage never clobbers a pre-set car")
	var src := FileAccess.get_file_as_string("res://scripts/ui/menu.gd")
	ctx.check(src.contains("select_car"), "menu.gd routes the garage writer through select_car")
	ctx.check(src.contains("select_event"), "menu.gd routes the event writer through select_event")
	ctx.check(src.contains("CAR_SELECTED"), "menu.gd prints the CAR_SELECTED token")
	ctx.check(not src.contains("gs.set(\"selected_car\""), "menu.gd has no untyped selected_car writer")
	ctx.check(not src.contains("gs.set(\"current_event\""), "menu.gd has no untyped current_event writer")
	var navigated := ctx.tree.current_scene
	if navigated != null and navigated != instance and is_instance_valid(navigated):
		if navigated.get_parent() == ctx.tree.root:
			ctx.tree.root.remove_child(navigated)
		navigated.free()
		await ctx.tree.process_frame
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	gs.set("selected_car", prev_car)
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func test_garage_scene_loads() -> bool:
	var packed = load("res://scenes/ui/garage.tscn")
	ctx.check(packed is PackedScene, "garage.tscn loads as PackedScene")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "garage instantiates")
	if instance == null:
		return true
	ctx.check(instance.name == "Garage", "root node is Garage")
	var preview := instance.find_child("CarPreview", true, false)
	ctx.check(preview is SubViewport, "CarPreview is a SubViewport")
	var swatches := instance.find_child("ColorSwatches", true, false)
	ctx.check(swatches != null, "garage has ColorSwatches")
	if swatches != null:
		var buttons := 0
		for child in swatches.get_children():
			if child is BaseButton:
				buttons += 1
		ctx.check(buttons >= 4, "ColorSwatches holds >= 4 Buttons (got %d)" % buttons)
		for i in 4:
			ctx.check(swatches.get_node_or_null("Color%d" % i) is BaseButton, "ColorSwatches has Color%d" % i)
	ctx.check(instance.find_child("CarGrid", true, false) is GridContainer, "garage has a CarGrid")
	ctx.check(instance.find_child("CarInfo", true, false) is Label, "garage has a CarInfo label")
	ctx.check(instance.find_child("BackButton", true, false) is BaseButton, "garage has a BackButton")
	var src := FileAccess.get_file_as_string("res://scripts/ui/garage.gd")
	ctx.check(src.contains("GARAGE_READY"), "garage script prints GARAGE_READY")
	ctx.check(src.contains("select_car"), "garage script routes car writes through select_car")
	ctx.check(src.contains("select_color"), "garage script routes color writes through select_color")
	ctx.check(src.contains("CAR_SELECTED"), "garage script prints the CAR_SELECTED token")
	ctx.check(src.contains("COLOR_SELECTED"), "garage script prints the COLOR_SELECTED token")
	ctx.check(not src.contains("gs.set(\"selected_car\""), "garage script has no untyped selected_car writer")
	ctx.check(not src.contains("gs.set(\"selected_color\""), "garage script has no untyped selected_color writer")
	for banned in ["_physics_process", "apply_force", "apply_central_force", "linear_velocity", "angular_velocity", "RayCast", "PhysicsDirectBodyState3D"]:
		ctx.check(not src.contains(banned), "garage script carries no %s" % banned)
	instance.free()
	return true

func test_garage_car_grid() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "garage grid probe starts from defaults")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for garage grid")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for garage grid")
	if gs == null:
		return true
	ctx.check(GarageUI.is_car_unlocked("sedan"), "sedan is always unlocked")
	ctx.check(not GarageUI.is_car_unlocked("coupe"), "coupe is locked with an empty unlock list")
	ctx.check(not GarageUI.is_car_unlocked("hatch"), "hatch is locked with an empty unlock list")
	ctx.check(not GarageUI.is_car_unlocked("awd"), "awd is locked with an empty unlock list")
	var unlock_data := SaveSystem.load_game()
	var unlock_progress: Dictionary = unlock_data["progress"]
	unlock_progress["unlocked_cars"] = ["coupe"]
	unlock_data["progress"] = unlock_progress
	ctx.check(SaveSystem.save_game(unlock_data), "unlock probe grants coupe")
	ctx.check(GarageUI.is_car_unlocked("coupe"), "unlocked_cars opens coupe")
	ctx.check(not GarageUI.is_car_unlocked("hatch"), "hatch stays locked without a grant")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "unlock probe restores defaults")
	gs.set("selected_car", &"")
	gs.set("selected_color", 0)
	var packed = load("res://scenes/ui/garage.tscn")
	ctx.check(packed is PackedScene, "garage.tscn loads as PackedScene")
	if not (packed is PackedScene):
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var grid := instance.find_child("CarGrid", true, false) as GridContainer
	ctx.check(grid != null, "garage has a CarGrid")
	if grid == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	ctx.check(grid.get_child_count() == 4, "grid holds 4 car buttons (got %d)" % grid.get_child_count())
	var stems: Array[String] = ["sedan", "coupe", "hatch", "awd"]
	var names := {"sedan": "Sedan", "coupe": "Coupe", "hatch": "Hatch", "awd": "AWD"}
	for stem in stems:
		var btn := instance.find_child("Car_" + stem, true, false) as BaseButton
		ctx.check(btn != null, "grid has a button for %s" % stem)
		if btn == null:
			continue
		ctx.check((btn as Button).text.contains(str(names[stem])), "button text names %s" % stem)
	var sedan := instance.find_child("Car_sedan", true, false) as BaseButton
	ctx.check(sedan != null, "grid has Car_sedan")
	if sedan != null:
		ctx.check(sedan.disabled == false, "sedan stays enabled")
		ctx.check(sedan.focus_mode != Control.FOCUS_NONE, "sedan stays focusable")
	for stem in ["coupe", "hatch", "awd"]:
		var locked := instance.find_child("Car_" + stem, true, false) as BaseButton
		ctx.check(locked != null, "grid has Car_%s" % stem)
		if locked != null:
			ctx.check(locked.disabled, "%s is locked while not unlocked" % stem)
			ctx.check(locked.focus_mode == Control.FOCUS_NONE, "%s skips focus while locked" % stem)
	if sedan != null:
		sedan.pressed.emit()
		await ctx.tree.process_frame
		await ctx.tree.process_frame
		ctx.check(StringName(gs.get("selected_car")) == &"sedan", "pressing Car_sedan writes selected_car")
	var info := instance.find_child("CarInfo", true, false) as Label
	ctx.check(info != null and info.text.contains("Sedan"), "CarInfo names the picked car")
	if info != null:
		ctx.check(info.text.contains("Nm"), "CarInfo shows the live torque stat")
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "garage grid probe restores defaults")
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func test_garage_grid_async_defers_work() -> bool:
	var packed = load("res://scenes/ui/garage.tscn")
	ctx.check(packed is PackedScene, "garage.tscn loads as PackedScene for the deferral probe")
	if not (packed is PackedScene):
		return true
	var instance: Node = packed.instantiate()
	ctx.check(instance != null, "garage instantiates for the deferral probe")
	if instance == null:
		return true
	ctx.tree.root.add_child(instance)
	# _ready prints its token and returns synchronously; the grid build is
	# fire-and-forget, so the CarGrid must still be empty on this frame.
	var grid := instance.find_child("CarGrid", true, false) as GridContainer
	ctx.check(grid != null, "deferral probe has a CarGrid")
	if grid != null:
		ctx.check(grid.get_child_count() == 0, "grid is empty on the _ready frame (got %d)" % grid.get_child_count())
	var src := FileAccess.get_file_as_string("res://scripts/ui/garage.gd")
	ctx.check(src.contains("load_threaded_request"), "garage.gd issues threaded loads off _ready")
	ctx.check(src.contains("GARAGE_GRID_READY"), "garage.gd prints GARAGE_GRID_READY when the async grid completes")
	ctx.check(src.contains("load_threaded_get_status"), "garage.gd polls threaded load status")
	ctx.check(src.contains("_build_car_grid_async"), "garage.gd builds the grid via _build_car_grid_async")
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	return true

func test_garage_grid_async_completes() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "garage async completion probe starts from defaults")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for garage async completion")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for garage async completion")
	if gs == null:
		return true
	gs.set("selected_car", &"")
	gs.set("selected_color", 0)
	var packed = load("res://scenes/ui/garage.tscn")
	ctx.check(packed is PackedScene, "garage.tscn loads as PackedScene for the completion probe")
	if not (packed is PackedScene):
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var grid := instance.find_child("CarGrid", true, false) as GridContainer
	ctx.check(grid != null, "completion probe has a CarGrid")
	if grid == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	ctx.check(grid.get_child_count() == 4, "async grid holds 4 car buttons (got %d)" % grid.get_child_count())
	var stems: Array[String] = ["sedan", "coupe", "hatch", "awd"]
	var names := {"sedan": "Sedan", "coupe": "Coupe", "hatch": "Hatch", "awd": "AWD"}
	for stem in stems:
		var btn := instance.find_child("Car_" + stem, true, false) as Button
		ctx.check(btn != null, "async grid has a button for %s" % stem)
		if btn == null:
			continue
		ctx.check(btn.custom_minimum_size == Vector2(320, 48), "%s keeps the 320x48 contract" % stem)
		ctx.check(btn.text.contains(str(names[stem])), "async button text names %s" % stem)
		var should_lock := stem != "sedan"
		ctx.check(btn.disabled == should_lock, "%s disabled matches lock state" % stem)
		if should_lock:
			ctx.check(btn.text.contains("Locked"), "%s locked text carries the lock suffix" % stem)
			ctx.check(btn.focus_mode == Control.FOCUS_NONE, "%s locked button skips focus" % stem)
		else:
			ctx.check(not btn.text.contains("Locked"), "%s unlocked text has no lock suffix" % stem)
			ctx.check(btn.focus_mode != Control.FOCUS_NONE, "%s unlocked button stays focusable" % stem)
	var info := instance.find_child("CarInfo", true, false) as Label
	ctx.check(info != null and info.text.contains("Sedan"), "CarInfo names the picked car")
	if info != null:
		ctx.check(info.text.contains("Nm"), "CarInfo shows the live torque stat")
	var focused := ctx.tree.root.gui_get_focus_owner()
	var back := instance.find_child("BackButton", true, false) as BaseButton
	ctx.check(focused != null, "async build leaves focus on an unlocked button or BackButton")
	if focused != null:
		var focused_name := str((focused as Node).name)
		ctx.check(focused_name == "BackButton" or focused_name.begins_with("Car_"), "focus sits on %s" % focused_name)
		if focused_name.begins_with("Car_"):
			ctx.check(not (focused as BaseButton).disabled, "focus sits on an unlocked car (%s)" % focused_name)
	if back != null and focused == null:
		ctx.check(false, "focus owner is null despite BackButton existing")
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "garage async completion probe restores defaults")
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true

func test_garage_unlock_corrupt() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "corrupt unlock probe starts from defaults")
	var corrupt_shapes: Array = ["coupe", {"coupe": true}, 42, null]
	for shape in corrupt_shapes:
		var doc := SaveSystem.load_game()
		var progress: Dictionary = doc.get("progress", {})
		progress["unlocked_cars"] = shape
		doc["progress"] = progress
		ctx.check(SaveSystem.save_game(doc), "corrupt shape %s saves" % str(shape))
		ctx.check(GarageUI.is_car_unlocked("sedan"), "sedan stays unlocked on corrupt %s" % str(shape))
		ctx.check(not GarageUI.is_car_unlocked("coupe"), "coupe stays locked on corrupt %s" % str(shape))
	var mixed := SaveSystem.load_game()
	var mixed_progress: Dictionary = mixed.get("progress", {})
	mixed_progress["unlocked_cars"] = ["coupe", 42, ""]
	mixed["progress"] = mixed_progress
	ctx.check(SaveSystem.save_game(mixed), "mixed unlock list saves")
	ctx.check(GarageUI.is_car_unlocked("sedan"), "sedan stays unlocked on mixed list")
	ctx.check(GarageUI.is_car_unlocked("coupe"), "mixed list partially honors the valid coupe grant")
	ctx.check(not GarageUI.is_car_unlocked("hatch"), "mixed list leaves ungranted hatch locked")
	var grant := SaveSystem.load_game()
	var grant_progress: Dictionary = grant.get("progress", {})
	grant_progress["unlocked_cars"] = ["coupe"]
	grant["progress"] = grant_progress
	ctx.check(SaveSystem.save_game(grant), "valid grant saves")
	ctx.check(GarageUI.is_car_unlocked("coupe"), "valid grant opens coupe")
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "corrupt unlock probe restores defaults")
	return true

func test_garage_color_persists() -> bool:
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "color probe starts from defaults")
	var gs: Node = ctx.tree.root.get_node_or_null("GameState")
	var mounted := false
	if gs == null:
		var gs_script = load("res://scripts/game/GameState.gd")
		ctx.check(gs_script != null, "GameState.gd loads for color probe")
		if gs_script == null:
			return true
		gs = gs_script.new()
		gs.name = "GameState"
		ctx.tree.root.add_child(gs)
		mounted = true
	ctx.check(gs != null, "GameState singleton is reachable for color probe")
	if gs == null:
		return true
	ctx.check(gs.has_method("select_color"), "GameState exposes select_color")
	gs.set("selected_car", &"sedan")
	gs.set("selected_color", 0)
	var packed = load("res://scenes/ui/garage.tscn")
	ctx.check(packed is PackedScene, "garage.tscn loads as PackedScene")
	if not (packed is PackedScene):
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	var instance: Node = packed.instantiate()
	ctx.tree.root.add_child(instance)
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	var swatch := instance.find_child("Color2", true, false) as BaseButton
	ctx.check(swatch != null, "swatches have Color2")
	if swatch == null:
		ctx.tree.root.remove_child(instance)
		instance.free()
		if mounted:
			ctx.tree.root.remove_child(gs)
			gs.free()
		return true
	swatch.pressed.emit()
	await ctx.tree.process_frame
	await ctx.tree.process_frame
	ctx.check(int(gs.get("selected_color")) == 2, "swatch press writes selected_color")
	gs.flush()
	gs.reload_from_disk()
	ctx.check(int(gs.get("selected_color")) == 2, "selected_color survives reload_from_disk")
	var preview := instance.find_child("CarPreview", true, false) as SubViewport
	ctx.check(preview != null, "garage keeps its CarPreview")
	var painted := -1
	if preview != null:
		var pivot := preview.get_node_or_null("PreviewPivot") as Node3D
		ctx.check(pivot != null, "CarPreview hosts a PreviewPivot")
		if pivot != null:
			for child in pivot.get_children():
				var paint := (child as Node).get_node_or_null("CarPaint")
				if paint != null:
					painted = int(paint.get("color_index"))
	ctx.check(painted == 2, "preview CarPaint.color_index matches the swatch (got %d)" % painted)
	ctx.tree.root.remove_child(instance)
	instance.free()
	await ctx.tree.process_frame
	gs.flush()
	ctx.check(SaveSystem.save_game(SaveSystem.default_data()), "color probe restores defaults")
	if mounted:
		ctx.tree.root.remove_child(gs)
		gs.free()
		await ctx.tree.process_frame
	return true
