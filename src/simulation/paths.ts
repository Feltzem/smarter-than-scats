import type { Approach, Movement, Point } from "../data/types";

/**
 * Path definitions for a 4-way intersection with LEFT-HAND traffic.
 *
 * Canvas coordinate system: origin top-left, x right, y down.
 * The intersection is centered at (400, 400) on an 800×800 canvas.
 *
 * Lane layout per leg (looking from upstream toward the intersection):
 * 1) Inbound lane: left + straight
 * 2) Inbound lane: right turns
 * 3) Outbound lane (near centerline): receives right-turners
 * 4) Outbound lane (near kerb): receives through + left-turners
 */

const CENTER = 400;
const ROAD_HALF_WIDTH = 40; // half the road width
const LANE_WIDTH = 20;
const APPROACH_LENGTH = 350; // distance from center to canvas edge
const WORLD_PIXELS_PER_METRE = 5;

const STOP_BUFFER = 16;

// Lane center offsets from each leg centerline.
// Positive is to the RIGHT side of inbound travel for that leg.
// For left-hand traffic, inbound lanes sit on the LEFT side (negative offsets).
const INBOUND_MAIN_OFFSET = -(3 * LANE_WIDTH) / 2; // left+straight (left-most inbound lane)
const INBOUND_RIGHT_OFFSET = -LANE_WIDTH / 2; // right-turn-only (right inbound lane)
const OUTBOUND_CENTERLINE_OFFSET = LANE_WIDTH / 2; // right-turn receiving lane (near road centerline)
const OUTBOUND_KERB_OFFSET = (3 * LANE_WIDTH) / 2; // through + left receiving lane (near kerb)

const LEG_OUTWARD: Record<Approach, Point> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** A path is a series of waypoints. Cars interpolate between them. */
export interface PathDefinition {
  approach: Approach;
  movement: Movement;
  waypoints: Point[];
  stopLineDistance: number; // distance along path to the stop line
  totalLength: number;
}

function computePathLength(waypoints: Point[]): number {
  let len = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len / WORLD_PIXELS_PER_METRE;
}

function inboundDirection(approach: Approach): Point {
  const outward = LEG_OUTWARD[approach];
  return { x: -outward.x, y: -outward.y };
}

function rightOfInbound(approach: Approach): Point {
  const inbound = inboundDirection(approach);
  return { x: -inbound.y, y: inbound.x };
}

function pointOnLeg(
  approach: Approach,
  lateralOffset: number,
  distanceFromCenter: number,
): Point {
  const outward = LEG_OUTWARD[approach];
  const right = rightOfInbound(approach);

  return {
    x: CENTER + outward.x * distanceFromCenter + right.x * lateralOffset,
    y: CENTER + outward.y * distanceFromCenter + right.y * lateralOffset,
  };
}

function clockwiseApproach(approach: Approach): Approach {
  switch (approach) {
    case "N":
      return "E";
    case "E":
      return "S";
    case "S":
      return "W";
    case "W":
      return "N";
  }
}

function counterClockwiseApproach(approach: Approach): Approach {
  switch (approach) {
    case "N":
      return "W";
    case "W":
      return "S";
    case "S":
      return "E";
    case "E":
      return "N";
  }
}

function oppositeApproach(approach: Approach): Approach {
  switch (approach) {
    case "N":
      return "S";
    case "S":
      return "N";
    case "E":
      return "W";
    case "W":
      return "E";
  }
}

/** Build all 12 paths (4 approaches × 3 movements). */
function buildPaths(): PathDefinition[] {
  const paths: PathDefinition[] = [];

  const approaches: Approach[] = ["N", "S", "E", "W"];

  for (const approach of approaches) {
    const entryMain = pointOnLeg(
      approach,
      INBOUND_MAIN_OFFSET,
      APPROACH_LENGTH,
    );
    const entryRight = pointOnLeg(
      approach,
      INBOUND_RIGHT_OFFSET,
      APPROACH_LENGTH,
    );
    const stopDist =
      (APPROACH_LENGTH - ROAD_HALF_WIDTH - STOP_BUFFER) /
      WORLD_PIXELS_PER_METRE;

    // Straight: inbound main lane -> opposite outbound kerb lane
    const straightDest = oppositeApproach(approach);
    const straightExit = pointOnLeg(
      straightDest,
      OUTBOUND_KERB_OFFSET,
      APPROACH_LENGTH,
    );
    const straightWaypoints = [entryMain, straightExit];
    paths.push({
      approach,
      movement: "straight",
      waypoints: straightWaypoints,
      stopLineDistance: stopDist,
      totalLength: computePathLength(straightWaypoints),
    });

    // Left turn (clockwise from approach frame): inbound main lane -> destination outbound kerb lane
    const leftDest = clockwiseApproach(approach);
    const leftExit = pointOnLeg(
      leftDest,
      OUTBOUND_KERB_OFFSET,
      APPROACH_LENGTH,
    );
    const leftWaypoints = generateTurnWaypoints(
      approach,
      leftDest,
      entryMain,
      leftExit,
      INBOUND_MAIN_OFFSET,
      OUTBOUND_KERB_OFFSET,
    );
    paths.push({
      approach,
      movement: "left",
      waypoints: leftWaypoints,
      stopLineDistance: stopDist,
      totalLength: computePathLength(leftWaypoints),
    });

    // Right turn (anticlockwise from approach frame): inbound right-turn lane -> destination centerline lane
    const rightDest = counterClockwiseApproach(approach);
    const rightExit = pointOnLeg(
      rightDest,
      OUTBOUND_CENTERLINE_OFFSET,
      APPROACH_LENGTH,
    );
    const rightWaypoints = generateTurnWaypoints(
      approach,
      rightDest,
      entryRight,
      rightExit,
      INBOUND_RIGHT_OFFSET,
      OUTBOUND_CENTERLINE_OFFSET,
    );
    paths.push({
      approach,
      movement: "right",
      waypoints: rightWaypoints,
      stopLineDistance: stopDist,
      totalLength: computePathLength(rightWaypoints),
    });
  }

  return paths;
}

function generateTurnWaypoints(
  approach: Approach,
  destination: Approach,
  entry: Point,
  exit: Point,
  entryOffset: number,
  exitOffset: number,
): Point[] {
  const points: Point[] = [entry];
  const numCurvePoints = 12;

  const pre = pointOnLeg(approach, entryOffset, ROAD_HALF_WIDTH);
  const post = pointOnLeg(destination, exitOffset, ROAD_HALF_WIDTH);

  const inbound = inboundDirection(approach);
  const outbound = LEG_OUTWARD[destination];

  // Scale the Bezier control tangents relative to the chord between the two
  // intersection-edge points (pre → post).  A fixed pixel value breaks left
  // turns: in left-hand traffic the left-turn chord is only ~14 px (tight,
  // near-side turn), while the right-turn chord is ~70 px (wide crossing).
  // Using a fixed 28 px tangent on a 14 px chord causes the Bezier to balloon
  // backward, creating the U-turn artefact.  Scaling to ~0.45× the chord
  // approximates a 90° circular arc for both turn types.
  const chordDx = post.x - pre.x;
  const chordDy = post.y - pre.y;
  const chord = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
  const tangentScale = chord * 0.45;

  const c1 = {
    x: pre.x + inbound.x * tangentScale,
    y: pre.y + inbound.y * tangentScale,
  };
  const c2 = {
    x: post.x - outbound.x * tangentScale,
    y: post.y - outbound.y * tangentScale,
  };

  points.push(pre);

  // Generate curve points
  for (let i = 1; i <= numCurvePoints; i++) {
    const t = i / (numCurvePoints + 1);
    const p = cubicBezier(pre, c1, c2, post, t);
    points.push(p);
  }

  points.push(post);
  points.push(exit);

  return points;
}

function cubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * p3.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * p3.y,
  };
}

/** Pre-built paths array */
export const ALL_PATHS = buildPaths();

/** Find the path index for a given approach+movement */
export function getPathIndex(approach: Approach, movement: Movement): number {
  return ALL_PATHS.findIndex(
    (p) => p.approach === approach && p.movement === movement,
  );
}

/**
 * Get position and rotation along a path at a given distance.
 */
export function getPositionOnPath(
  path: PathDefinition,
  distance: number,
): { x: number; y: number; rotation: number } {
  const pixelDistance = distance * WORLD_PIXELS_PER_METRE;

  if (pixelDistance <= 0) {
    const wp = path.waypoints[0];
    const next = path.waypoints[1];
    const dx = next.x - wp.x;
    const dy = next.y - wp.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const t = pixelDistance / segLen; // negative → extrapolate behind entry point
    return {
      x: wp.x + dx * t,
      y: wp.y + dy * t,
      rotation: Math.atan2(dy, dx),
    };
  }

  let remaining = pixelDistance;
  for (let i = 1; i < path.waypoints.length; i++) {
    const dx = path.waypoints[i].x - path.waypoints[i - 1].x;
    const dy = path.waypoints[i].y - path.waypoints[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (remaining <= segLen) {
      const t = remaining / segLen;
      return {
        x: path.waypoints[i - 1].x + dx * t,
        y: path.waypoints[i - 1].y + dy * t,
        rotation: Math.atan2(dy, dx),
      };
    }
    remaining -= segLen;
  }

  // Past the end
  const last = path.waypoints[path.waypoints.length - 1];
  const prev = path.waypoints[path.waypoints.length - 2];
  return {
    x: last.x,
    y: last.y,
    rotation: Math.atan2(last.y - prev.y, last.x - prev.x),
  };
}

export interface WorldPathPosition {
  x: number;
  z: number;
  heading: number;
}

export function pathPointToWorld(point: Point): { x: number; z: number } {
  return {
    x: (point.x - CENTER) / WORLD_PIXELS_PER_METRE,
    z: (point.y - CENTER) / WORLD_PIXELS_PER_METRE,
  };
}

export function getWorldPositionOnPath(
  path: PathDefinition,
  distance: number,
): WorldPathPosition {
  const position = getPositionOnPath(path, distance);
  const world = pathPointToWorld(position);
  return {
    ...world,
    heading: Math.PI / 2 - position.rotation,
  };
}

export {
  CENTER,
  ROAD_HALF_WIDTH,
  LANE_WIDTH,
  APPROACH_LENGTH,
  WORLD_PIXELS_PER_METRE,
};
