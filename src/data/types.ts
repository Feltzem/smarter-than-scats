/** Approach direction */
export type Approach = "N" | "S" | "E" | "W";

/** Vehicle movement */
export type Movement = "straight" | "left" | "right";
export type PhaseIndex = 0 | 1 | 2 | 3;

/** Signal state */
export type SignalState = "green" | "yellow" | "red" | "off";

export interface SignalGroupAspect {
  signalGroup: number;
  aspect: SignalState;
}

export interface SignalGroupTransition extends SignalGroupAspect {
  time: number;
}

export interface PedestrianSignalTransition {
  time: number;
  signalGroup: PedestrianSignalGroup;
  state: "walk" | "clearance" | "stop";
}

export interface DetectorCollectionMetrics {
  collectionType: "type-3" | "type-4" | "type-9";
  count: number;
  /** Raw SCATS non-occupancy value in deciseconds (legacy field name). */
  occupancy?: number;
  green?: number;
  gap?: number;
  degreeOfSaturation?: number;
}

export interface DetectorInterval {
  startTime: number;
  endTime: number;
  detectorId: number;
  count: number;
  metrics: DetectorCollectionMetrics[];
}

export interface PedestrianDemand {
  id: number;
  time: number;
  signalGroup: PedestrianSignalGroup;
  permittedPhases: PhaseIndex[];
}

export interface SiteConfiguration {
  siteId: "36";
  intersectionName: "Naylor / Galloway";
  cisVersion: "3d";
  timezone: "Pacific/Auckland";
  phaseSequence: ["A", "B", "C", "D"];
  minimumGreen: number;
  maximumGreen: [number, number, number, number];
  yellow: number;
  allRed: [number, number, number, number];
  vehicleSignalGroups: Record<Approach, Record<Movement, number>>;
  pedestrianSignalGroups: Record<
    "P1" | "P2" | "P3" | "P4",
    PedestrianSignalGroup
  >;
  phaseSignalGroups: Record<"A" | "B" | "C" | "D", number[]>;
  conflictMatrix: number[][];
  lateStartGroups: number[];
  detectorGapSettings: Record<string, number>;
  pedestrianTiming: { walk: number; clearance: number };
  movementRules: Record<string, "permissive" | "gap-filtered" | "stopped">;
}

/** A single vehicle arrival */
export interface Arrival {
  id: number;
  time: number; // seconds from sim start
  approach: Approach;
  movement: Movement;
  lane: number; // 0 = through/left, 1 = right-turn
  detectorId: number;
}

/** A single SCATS cycle record */
export interface ScatsCycle {
  cycleStart: number; // seconds from sim start
  cycleLength: number; // seconds
  phaseGreens: number[]; // green time per phase (4 phases)
}

/** A single SCATS phase event from exported phasing logs */
export interface ScatsPhaseEvent {
  phase: "A" | "B" | "C" | "D";
  phaseIndex: 0 | 1 | 2 | 3;
  startTime: number; // seconds from sim period start
  duration: number; // seconds
}

export type PedestrianSignalGroup = 13 | 14 | 15 | 16;

export type PedestrianDirection = "W-E" | "E-W" | "N-S" | "S-N";

/** One scheduled pedestrian phase run from the 5-minute exports */
export interface PedestrianPhaseRun {
  id: number;
  startTime: number; // seconds from sim period start
  signalGroup: PedestrianSignalGroup;
  phaseIndex: 0 | 1 | 2 | 3;
  pedestrianDirections: PedestrianDirection[];
}

/** Runtime pedestrian used by the simulator/renderer */
export interface PedestrianState {
  id: number;
  runId: number;
  signalGroup: PedestrianSignalGroup;
  direction: PedestrianDirection;
  startTime: number;
  duration: number;
  progress: number; // 0..1
}

/** Peak period definition */
export interface PeriodData {
  label: string;
  startTime: number; // seconds from midnight
  endTime: number;
  arrivals: Arrival[];
  scatsCycles: ScatsCycle[];
  scatsPhaseTimeline?: ScatsPhaseEvent[];
  pedestrianRuns?: PedestrianPhaseRun[];
  detectorIntervals: DetectorInterval[];
  detectorMetrics: DetectorCollectionMetrics[];
  signalGroupTransitions: SignalGroupTransition[];
  pedestrianDemands: PedestrianDemand[];
  pedestrianSignalTransitions: PedestrianSignalTransition[];
}

/** Full intersection data for one day */
export interface IntersectionData {
  intersection: string;
  date: string;
  siteConfiguration: SiteConfiguration;
  sourceMetadata?: Record<string, unknown>;
  periods: {
    AM: PeriodData;
    SCHOOL: PeriodData;
    PM: PeriodData;
  };
}

/** Player's phase configuration */
export interface PhaseConfig {
  greens: [number, number, number, number]; // green time per phase in seconds
}

/** Result of a simulation run */
export interface SimulationResult {
  totalDelay: number; // vehicle-seconds
  totalDelayHours: number; // vehicle-hours
  averageDelay: number; // seconds per vehicle
  vehiclesServed: number;
  vehiclesEntered: number;
  pedestriansCrossed: number;
  maxVehiclesInNetwork: number;
  phaseDelaySeconds: [number, number, number, number];
  vehicleDelays: number[]; // delay per vehicle
}

/** Per-phase signal info for display */
export interface PhaseInfo {
  index: number;
  label: string;
  approaches: string; // e.g. "N↔S Through"
}

/** Game state */
export type GameState = "SETUP" | "RUNNING" | "PAUSED" | "COMPLETE";

/** Period key */
export type PeriodKey = "AM" | "SCHOOL" | "PM";

/** 2D point */
export interface Point {
  x: number;
  y: number;
}

/** Car state in simulation */
export interface CarState {
  id: number;
  approach: Approach;
  movement: Movement;
  vehicleClass: "hatchback" | "sedan" | "ute" | "truck" | "bus";
  vehicleVariant: string;
  paintColor: string;
  pathIndex: number; // which of the 12 paths
  distance: number; // distance along path in meters
  speed: number; // m/s
  length: number; // vehicle length in meters
  standstillGap: number; // desired standstill bumper gap in meters
  timeHeadway: number; // desired moving headway in seconds
  desiredSpeed: number; // free-flow desired speed in m/s
  maxAcceleration: number; // max acceleration in m/s²
  comfortDeceleration: number; // comfortable deceleration in m/s²
  waitingTimeSeconds: number; // cumulative stopped/queued time
  entryTime: number; // sim time when entered
  exitTime: number | null; // sim time when exited (null if still active)
  active: boolean;
  startupReactionTime: number; // random per-driver reaction delay on green (s)
  reactionTimeRemaining: number; // countdown after signal goes green
  signalWasGreen: boolean; // actual signal state last tick (for transition detection)
}
