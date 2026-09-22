import type {
  Approach,
  PedestrianDirection,
  PedestrianSignalGroup,
  PedestrianState,
  Movement,
} from "../data/types";
import { CENTER, ROAD_HALF_WIDTH } from "./paths";

export interface CrosswalkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CrosswalkGeometry {
  signalGroup: PedestrianSignalGroup;
  rect: CrosswalkRect;
  start: { x: number; y: number };
  end: { x: number; y: number };
  orientation: "horizontal" | "vertical";
}

export const PEDESTRIAN_SIGNAL_GROUPS: PedestrianSignalGroup[] = [
  13, 14, 15, 16,
];

const CROSSWALK_BAND = 22;
const CROSSWALK_MARGIN = -4;

const NORTH_CROSSWALK_Y = CENTER - ROAD_HALF_WIDTH - CROSSWALK_MARGIN;
const SOUTH_CROSSWALK_Y = CENTER + ROAD_HALF_WIDTH + CROSSWALK_MARGIN;
const WEST_CROSSWALK_X = CENTER - ROAD_HALF_WIDTH - CROSSWALK_MARGIN;
const EAST_CROSSWALK_X = CENTER + ROAD_HALF_WIDTH + CROSSWALK_MARGIN;

export const CROSSWALK_GEOMETRY: Record<
  PedestrianSignalGroup,
  CrosswalkGeometry
> = {
  // Group 13: west leg crosswalk
  13: {
    signalGroup: 13,
    orientation: "vertical",
    rect: {
      x: WEST_CROSSWALK_X - CROSSWALK_BAND / 2,
      y: CENTER - ROAD_HALF_WIDTH,
      width: CROSSWALK_BAND,
      height: ROAD_HALF_WIDTH * 2,
    },
    start: { x: WEST_CROSSWALK_X, y: CENTER - ROAD_HALF_WIDTH + 4 },
    end: { x: WEST_CROSSWALK_X, y: CENTER + ROAD_HALF_WIDTH - 4 },
  },
  // Group 14: east leg crosswalk
  14: {
    signalGroup: 14,
    orientation: "vertical",
    rect: {
      x: EAST_CROSSWALK_X - CROSSWALK_BAND / 2,
      y: CENTER - ROAD_HALF_WIDTH,
      width: CROSSWALK_BAND,
      height: ROAD_HALF_WIDTH * 2,
    },
    start: { x: EAST_CROSSWALK_X, y: CENTER - ROAD_HALF_WIDTH + 4 },
    end: { x: EAST_CROSSWALK_X, y: CENTER + ROAD_HALF_WIDTH - 4 },
  },
  // Group 15: north leg crosswalk
  15: {
    signalGroup: 15,
    orientation: "horizontal",
    rect: {
      x: CENTER - ROAD_HALF_WIDTH,
      y: NORTH_CROSSWALK_Y - CROSSWALK_BAND / 2,
      width: ROAD_HALF_WIDTH * 2,
      height: CROSSWALK_BAND,
    },
    start: { x: CENTER - ROAD_HALF_WIDTH + 4, y: NORTH_CROSSWALK_Y },
    end: { x: CENTER + ROAD_HALF_WIDTH - 4, y: NORTH_CROSSWALK_Y },
  },
  // Group 16: south leg crosswalk
  16: {
    signalGroup: 16,
    orientation: "horizontal",
    rect: {
      x: CENTER - ROAD_HALF_WIDTH,
      y: SOUTH_CROSSWALK_Y - CROSSWALK_BAND / 2,
      width: ROAD_HALF_WIDTH * 2,
      height: CROSSWALK_BAND,
    },
    start: { x: CENTER - ROAD_HALF_WIDTH + 4, y: SOUTH_CROSSWALK_Y },
    end: { x: CENTER + ROAD_HALF_WIDTH - 4, y: SOUTH_CROSSWALK_Y },
  },
};

const GROUP_PHASE_OPTIONS: Record<
  PedestrianSignalGroup,
  Array<0 | 1 | 2 | 3>
> = {
  13: [0, 2], // A or C
  14: [0], // A
  15: [3], // D
  16: [1, 3], // B or D
};

const GROUP_DIRECTIONS: Record<PedestrianSignalGroup, PedestrianDirection[]> = {
  13: ["N-S", "S-N"],
  14: ["N-S", "S-N"],
  15: ["W-E", "E-W"],
  16: ["W-E", "E-W"],
};

const TURN_CONFLICT_GROUP_BY_APPROACH: Record<
  Approach,
  Record<"left" | "right", PedestrianSignalGroup>
> = {
  N: { left: 14, right: 13 },
  E: { left: 16, right: 15 },
  S: { left: 13, right: 14 },
  W: { left: 15, right: 16 },
};

const SAME_SIDE_DIRECTIONS_BY_APPROACH: Record<Approach, PedestrianDirection> =
  {
    N: "N-S",
    E: "E-W",
    S: "S-N",
    W: "W-E",
  };

export function getPhaseOptionsForGroup(
  signalGroup: PedestrianSignalGroup,
): Array<0 | 1 | 2 | 3> {
  return GROUP_PHASE_OPTIONS[signalGroup];
}

export function getDirectionsForGroup(
  signalGroup: PedestrianSignalGroup,
): PedestrianDirection[] {
  return GROUP_DIRECTIONS[signalGroup];
}

export function getCrosswalkGeometry(
  signalGroup: PedestrianSignalGroup,
): CrosswalkGeometry {
  return CROSSWALK_GEOMETRY[signalGroup];
}

export function getCrosswalkPosition(
  signalGroup: PedestrianSignalGroup,
  direction: PedestrianDirection,
  progress: number,
): { x: number; y: number } {
  const g = getCrosswalkGeometry(signalGroup);
  const t = Math.max(0, Math.min(1, progress));

  if (direction === "W-E") {
    return {
      x: g.start.x + (g.end.x - g.start.x) * t,
      y: g.start.y,
    };
  }
  if (direction === "E-W") {
    return {
      x: g.end.x + (g.start.x - g.end.x) * t,
      y: g.end.y,
    };
  }
  if (direction === "N-S") {
    return {
      x: g.start.x,
      y: g.start.y + (g.end.y - g.start.y) * t,
    };
  }

  return {
    x: g.end.x,
    y: g.end.y + (g.start.y - g.end.y) * t,
  };
}

export function conflictingLeftTurnGroup(
  approach: Approach,
): PedestrianSignalGroup {
  return TURN_CONFLICT_GROUP_BY_APPROACH[approach].left;
}

export function conflictingTurnGroup(
  approach: Approach,
  movement: Extract<Movement, "left" | "right">,
): PedestrianSignalGroup {
  return TURN_CONFLICT_GROUP_BY_APPROACH[approach][movement];
}

export function pedestrianStartsFromSameSide(
  approach: Approach,
  pedestrian: Pick<PedestrianState, "direction">,
): boolean {
  return pedestrian.direction === SAME_SIDE_DIRECTIONS_BY_APPROACH[approach];
}

export function allCrosswalks(): CrosswalkGeometry[] {
  return Object.values(CROSSWALK_GEOMETRY);
}

export function getWalkSignalPosition(signalGroup: PedestrianSignalGroup): {
  x: number;
  y: number;
} {
  const cornerOffset = ROAD_HALF_WIDTH + 14;
  const nw = { x: CENTER - cornerOffset, y: CENTER - cornerOffset };
  const ne = { x: CENTER + cornerOffset, y: CENTER - cornerOffset };
  const se = { x: CENTER + cornerOffset, y: CENTER + cornerOffset };
  const sw = { x: CENTER - cornerOffset, y: CENTER + cornerOffset };

  if (signalGroup === 13) return nw;
  if (signalGroup === 15) return ne;
  if (signalGroup === 14) return se;
  return sw;
}
