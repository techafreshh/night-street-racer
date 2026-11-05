// Ported traffic lane loops as pure data.
// Corner points decoded from the Curve3D [in, out, pos] triples in
// scenes/city/traffic_paths.tscn (pos entries at y = 0.6); tuning mirrors
// TrafficManager (TRAFFIC_COUNT, RECYCLE_DISTANCE, RESPAWN_AHEAD,
// BASE_CRUISE) and TrafficCar (ACCEL_RATE, BRAKE_RATE).
// No imports so a single file loads under Node/vitest.

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type LaneLoop = {
  name: string;
  points: Vec3[];
  closed: boolean;
};

export const LANE_POINT_COUNT_MIN = 3;
export const LANE_COORD_LIMIT = 140.0;
export const LANE_Y_MIN = 0.0;
export const LANE_Y_MAX = 2.0;

function corner(x: number, z: number): Vec3 {
  return { x, y: 0.6, z };
}

export const LANE_LOOPS: LaneLoop[] = [
  {
    name: "LaneLoop0",
    points: [corner(-66, -66), corner(66, -66), corner(66, 66), corner(-66, 66)],
    closed: true,
  },
  {
    name: "LaneLoop1",
    points: [corner(-134, -134), corner(134, -134), corner(134, 134), corner(-134, 134)],
    closed: true,
  },
  {
    name: "LaneLoop2",
    points: [corner(-2, -2), corner(66, -2), corner(66, 66), corner(-2, 66)],
    closed: true,
  },
];

export const TRAFFIC_TUNING = {
  count: 6,
  cruise: 9.0,
  accel: 6.0,
  brake: 12.0,
  recycleDistance: 150.0,
  respawnAhead: 30.0,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Bounds mirror the gate-coordinate rule: 3+ finite points, closed loop,
// |x|,|z| within the district grid, y near the road surface. Boolean
// only, never throws.
export function validateLaneLoop(loop: unknown): boolean {
  try {
    if (loop === null || typeof loop !== "object") {
      return false;
    }
    const l = loop as Partial<LaneLoop>;
    if (!Array.isArray(l.points) || l.points.length < LANE_POINT_COUNT_MIN) {
      return false;
    }
    if (l.closed !== true) {
      return false;
    }
    for (const p of l.points) {
      if (p === null || typeof p !== "object") {
        return false;
      }
      const point = p as { x?: unknown; y?: unknown; z?: unknown };
      if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y) || !isFiniteNumber(point.z)) {
        return false;
      }
      if (Math.abs(point.x) > LANE_COORD_LIMIT || Math.abs(point.z) > LANE_COORD_LIMIT) {
        return false;
      }
      if (point.y < LANE_Y_MIN || point.y > LANE_Y_MAX) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
