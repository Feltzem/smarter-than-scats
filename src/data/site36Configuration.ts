import type { SignalGroupAspect, SiteConfiguration } from "./types";

const PHASE_SIGNAL_GROUPS = {
  A: [5, 6, 11, 12, 13, 14],
  B: [1, 3, 9, 12, 15, 16],
  C: [1, 2, 9, 10, 13, 14],
  D: [3, 5, 7, 9, 11, 15, 16],
};

function buildConflictMatrix(): number[][] {
  const matrix = Array.from({ length: 17 }, () => Array(17).fill(0));
  for (let a = 1; a <= 16; a++) {
    for (let b = a + 1; b <= 16; b++) {
      const sharedPhase = Object.values(PHASE_SIGNAL_GROUPS).some(
        (groups) => groups.includes(a) && groups.includes(b),
      );
      matrix[a][b] = sharedPhase ? 0 : 1;
      matrix[b][a] = matrix[a][b];
    }
  }
  return matrix;
}

export function assertConflictFreeAspects(
  aspects: Record<number, SignalGroupAspect>,
): void {
  const greenGroups = Object.entries(aspects)
    .filter(([, aspect]) => aspect.aspect === "green")
    .map(([group]) => Number(group));
  for (let i = 0; i < greenGroups.length; i++) {
    for (let j = i + 1; j < greenGroups.length; j++) {
      const a = greenGroups[i];
      const b = greenGroups[j];
      if (SITE36_CONFIGURATION.conflictMatrix[a]?.[b] === 1) {
        throw new Error(`CIS conflict: signal groups ${a} and ${b} are green`);
      }
    }
  }
}

/**
 * Stable cells from CIS V3d, with the movement assignment transcribed from
 * the embedded Site 36 signal diagram. The diagram is the authoritative
 * source for the approach-to-signal-group mapping.
 */
export const SITE36_CONFIGURATION: SiteConfiguration = {
  siteId: "36",
  intersectionName: "Naylor / Galloway",
  cisVersion: "3d",
  timezone: "Pacific/Auckland",
  phaseSequence: ["A", "B", "C", "D"],
  minimumGreen: 5,
  maximumGreen: [40, 20, 40, 20],
  yellow: 4,
  allRed: [1.5, 2, 2, 1.5],
  vehicleSignalGroups: {
    N: { straight: 6, left: 12, right: 8 },
    W: { straight: 2, left: 10, right: 4 },
    S: { straight: 5, left: 11, right: 7 },
    E: { straight: 1, left: 9, right: 3 },
  },
  pedestrianSignalGroups: { P1: 16, P2: 15, P3: 14, P4: 13 },
  // CIS active-phase table, including the protected/lag groups used by
  // filtering and pedestrian protection.
  phaseSignalGroups: PHASE_SIGNAL_GROUPS,
  // Matrix is indexed by signal group; 1 means the pair may not be green
  // together. The diagonal is intentionally zero.
  conflictMatrix: buildConflictMatrix(),
  lateStartGroups: [7, 8, 9, 10, 11, 12],
  detectorGapSettings: {
    minimumGapSeconds: 3,
    detectorHeadwaySeconds: 1.2,
    filterRequiredGapSeconds: 4,
  },
  pedestrianTiming: { walk: 6, clearance: 9 },
  movementRules: {
    "8:right": "gap-filtered",
    "4:right": "gap-filtered",
    "3:right": "permissive",
    "7:right": "permissive",
    "9:left": "permissive",
    "10:left": "permissive",
    "11:left": "permissive",
    "12:left": "permissive",
  },
};
