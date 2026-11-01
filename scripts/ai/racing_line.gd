class_name RacingLine
extends Resource
## Interpolated-polyline racing line with baked curvature target speeds.
## Stores the oval route as XZ waypoints plus speed limits; per-point target
## speeds are baked lazily (sqrt(lateral_accel / kappa) with a backward
## braking pass) so the .tres holds one source of truth and the math stays
## pure-static and unit-testable with no scene. Helpers project the car onto
## the polyline, walk a lookahead distance along arc length, and build the
## standing-start pose for headless sims.

@export var points: PackedVector3Array = PackedVector3Array()
@export var loop := true
@export var road_half_width := 4.0
## Fun range: 8.0 - 35.0 m/s straight-line target speed.
@export var max_speed := 28.0
## Fun range: 4.0 - 15.0 m/s slowest corner target speed.
@export var min_speed := 8.0
## Fun range: 4.0 - 9.0 m/s^2 lateral grip budget for corner speeds.
@export var lateral_accel := 7.0
## Fun range: 3.0 - 9.0 m/s^2 braking budget for the backward pass.
@export var brake_decel := 6.0

var _speeds: PackedFloat32Array = PackedFloat32Array()


## Heading-change curvature at point i over mean segment length
## (circumcircle-equivalent; 0 on straights, ~1/R on arcs).
static func curvature_of(pts: PackedVector3Array, i: int, loop_line: bool) -> float:
	var n := pts.size()
	if n < 3:
		return 0.0
	if not loop_line and (i <= 0 or i >= n - 1):
		return 0.0
	var prev: Vector3 = pts[posmod(i - 1, n)]
	var cur: Vector3 = pts[i]
	var nxt: Vector3 = pts[posmod(i + 1, n)]
	var a := Vector2(cur.x - prev.x, cur.z - prev.z)
	var b := Vector2(nxt.x - cur.x, nxt.z - cur.z)
	var la := a.length()
	var lb := b.length()
	if la < 0.001 or lb < 0.001:
		return 0.0
	var ang := absf(wrapf(a.angle_to(b), -PI, PI))
	var avg := (la + lb) * 0.5
	if avg < 0.001:
		return 0.0
	return ang / avg


## Corner speed from the lateral grip budget, clamped to [min, max].
static func raw_speed(kappa: float, grip_accel: float, top_speed: float, low_speed: float) -> float:
	if kappa <= 0.0001:
		return top_speed
	return clampf(sqrt(maxf(grip_accel, 0.01) / kappa), low_speed, top_speed)


## Per-point target speeds with a backward braking pass over segment arc
## lengths, so the car brakes before corners instead of arriving too hot.
static func bake_speeds(pts: PackedVector3Array, loop_line: bool, top_speed: float, low_speed: float, grip_accel: float, brake: float) -> PackedFloat32Array:
	var n := pts.size()
	var out := PackedFloat32Array()
	out.resize(n)
	if n == 0:
		return out
	for i in n:
		out[i] = raw_speed(curvature_of(pts, i, loop_line), grip_accel, top_speed, low_speed)
	var ds := PackedFloat32Array()
	ds.resize(n)
	for i in n:
		if not loop_line and i == n - 1:
			ds[i] = 0.0
		else:
			var nxt: Vector3 = pts[posmod(i + 1, n)]
			ds[i] = Vector2(nxt.x - pts[i].x, nxt.z - pts[i].z).length()
	var decel := maxf(brake, 0.01)
	if loop_line:
		for _pass in n:
			var changed := false
			for i in n:
				var j := posmod(i + 1, n)
				var allow := sqrt(maxf(out[j] * out[j] + 2.0 * decel * ds[i], 0.0))
				if out[i] > allow + 0.001:
					out[i] = minf(out[i], allow)
					changed = true
			if not changed:
				break
	else:
		for i in range(n - 2, -1, -1):
			var allow := sqrt(maxf(out[i + 1] * out[i + 1] + 2.0 * decel * ds[i], 0.0))
			out[i] = minf(out[i], allow)
	return out


## Throttle cap from cornering load: when lateral demand eats the rear
## friction circle there is no room left for drive force, so full throttle
## while cornering hard spins the car (power oversteer). Linear headroom
## against the grip budget keeps the combined force inside the circle.
static func throttle_cap(lat_accel: float, grip_budget: float = 9.0) -> float:
	return clampf(1.0 - absf(lat_accel) / maxf(grip_budget, 0.01), 0.25, 1.0)


static func _seg_dist(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var denom := ab.length_squared()
	if denom < 0.000001:
		return p.distance_to(a)
	var t := clampf((p - a).dot(ab) / denom, 0.0, 1.0)
	return p.distance_to(a + ab * t)


## Lazily baked per-point target speeds, cached until points change size.
func target_speeds() -> PackedFloat32Array:
	if _speeds.size() != points.size():
		_speeds = RacingLine.bake_speeds(points, loop, max_speed, min_speed, lateral_accel, brake_decel)
	return _speeds


func target_speed_at(idx: int) -> float:
	var s := target_speeds()
	if s.is_empty():
		return max_speed
	return s[posmod(idx, s.size())]


func closest_index(pos: Vector3) -> int:
	var best := 0
	var best_d := INF
	for i in points.size():
		var d := Vector2(pos.x - points[i].x, pos.z - points[i].z).length_squared()
		if d < best_d:
			best_d = d
			best = i
	return best


## XZ distance from a position to the nearest track segment.
func distance_to_center(pos: Vector3) -> float:
	var n := points.size()
	if n == 0:
		return 0.0
	if n == 1:
		return Vector2(pos.x - points[0].x, pos.z - points[0].z).length()
	var p := Vector2(pos.x, pos.z)
	var count := n if loop else n - 1
	var best := INF
	for i in count:
		var a := Vector2(points[i].x, points[i].z)
		var b := Vector2(points[posmod(i + 1, n)].x, points[posmod(i + 1, n)].z)
		best = minf(best, RacingLine._seg_dist(p, a, b))
	return best


func track_length() -> float:
	var n := points.size()
	if n < 2:
		return 0.0
	var count := n if loop else n - 1
	var total := 0.0
	for i in count:
		var nxt: Vector3 = points[posmod(i + 1, n)]
		total += Vector2(nxt.x - points[i].x, nxt.z - points[i].z).length()
	return total


## Track point at arc distance s from points[0] (wraps when loop is true).
func point_at_arc(s: float) -> Vector3:
	var n := points.size()
	if n == 0:
		return Vector3.ZERO
	if n == 1:
		return points[0]
	var total := track_length()
	if total < 0.001:
		return points[0]
	var rest := fposmod(s, total) if loop else clampf(s, 0.0, total)
	var count := n if loop else n - 1
	for i in count:
		var a: Vector3 = points[i]
		var b: Vector3 = points[posmod(i + 1, n)]
		var seg := Vector2(b.x - a.x, b.z - a.z).length()
		if rest <= seg:
			var t := rest / seg if seg > 0.0001 else 0.0
			return a.lerp(b, t)
		rest -= seg
	return points[n - 1] if not loop else points[0]


## Track point `dist` metres ahead of the car's projection onto the line.
func lookahead_point(pos: Vector3, dist: float) -> Vector3:
	return point_at_arc(arc_of(pos) + dist)


## Arc distance of the car's projection onto the line from points[0].
func arc_of(pos: Vector3) -> float:
	var n := points.size()
	if n < 2:
		return 0.0
	var p := Vector2(pos.x, pos.z)
	var count := n if loop else n - 1
	var best_d := INF
	var best_s := 0.0
	var s := 0.0
	for i in count:
		var a := Vector2(points[i].x, points[i].z)
		var b := Vector2(points[posmod(i + 1, n)].x, points[posmod(i + 1, n)].z)
		var ab := b - a
		var denom := ab.length_squared()
		var t := 0.0
		if denom > 0.000001:
			t = clampf((p - a).dot(ab) / denom, 0.0, 1.0)
		var d := p.distance_to(a + ab * t)
		if d < best_d:
			best_d = d
			best_s = s + ab.length() * t
		s += ab.length()
	return best_s


## Baked target speed interpolated at arc distance s (continuous tracking
## so braking starts as soon as the baked profile ramps down, not when the
## nearest index flips).
func speed_at_arc(s: float) -> float:
	var sp := target_speeds()
	var n := points.size()
	if sp.is_empty() or n < 2:
		return max_speed
	var total := track_length()
	if total < 0.001:
		return sp[0]
	var rest := fposmod(s, total) if loop else clampf(s, 0.0, total)
	var count := n if loop else n - 1
	for i in count:
		var a: Vector3 = points[i]
		var b: Vector3 = points[posmod(i + 1, n)]
		var seg := Vector2(b.x - a.x, b.z - a.z).length()
		if rest <= seg:
			var t := rest / seg if seg > 0.0001 else 0.0
			return lerpf(sp[i], sp[posmod(i + 1, n)], t)
		rest -= seg
	return sp[n - 1] if not loop else sp[0]


## Standing start on points[0] facing points[1], car height 0.9 m.
func start_pose() -> Transform3D:
	if points.size() < 2:
		return Transform3D(Basis(), Vector3(0, 0.9, 0))
	var origin: Vector3 = points[0] + Vector3(0, 0.9, 0)
	var d: Vector3 = points[1] - points[0]
	d.y = 0.0
	if d.length() < 0.001:
		d = Vector3(0, 0, -1)
	d = d.normalized()
	return Transform3D(Basis(Vector3.UP, atan2(-d.x, -d.z)), origin)
