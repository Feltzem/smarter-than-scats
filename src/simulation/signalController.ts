import type {
  SignalState,
  PhaseConfig,
  Approach,
  Movement,
} from "../data/types";
import { SITE36_CONFIGURATION } from "../data/site36Configuration";

/**
 * Phase definitions for a 4-phase detector-driven intersection.
 * This simulation uses left-hand traffic.
 *
 * Detector mapping (left-lane|right-lane):
 * N = 1|2, W = 3|4, S = 5|6, E = 7|8
 *
 * Phase A: 1|5 (+ detector 2 filters on gap)
 * Phase B: 7|8 + N left-turners from 1 (front-of-queue approximation)
 * Phase C: 3|7 (+ detector 4 filters on gap)
 * Phase D: 5|6 + E left-turners from 7 (front-of-queue approximation)
 */
export interface PhaseDefinition {
  index: number;
  label: string;
  description: string;
  /** Which approach+movement combos get green during this phase */
  greenMovements: Array<{ approach: Approach; movement: Movement }>;
}

export const PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    index: 0,
    label: "Phase A",
    description: "Detectors 1|5 (+ D2 right-turn filters on gap)",
    greenMovements: [
      { approach: "N", movement: "straight" },
      { approach: "N", movement: "left" },
      { approach: "S", movement: "straight" },
      { approach: "S", movement: "left" },
    ],
  },
  {
    index: 1,
    label: "Phase B",
    description: "Detectors 7|8 + N left from 1",
    greenMovements: [
      { approach: "E", movement: "straight" },
      { approach: "E", movement: "right" },
      { approach: "E", movement: "left" },
      { approach: "N", movement: "left" },
    ],
  },
  {
    index: 2,
    label: "Phase C",
    description: "Detectors 3|7 (+ D4 right-turn filters on gap)",
    greenMovements: [
      { approach: "W", movement: "straight" },
      { approach: "W", movement: "left" },
      { approach: "E", movement: "straight" },
      { approach: "E", movement: "left" },
    ],
  },
  {
    index: 3,
    label: "Phase D",
    description: "Detectors 5|6 + E left from 7",
    greenMovements: [
      { approach: "S", movement: "straight" },
      { approach: "S", movement: "right" },
      { approach: "S", movement: "left" },
      { approach: "E", movement: "left" },
    ],
  },
];

export const YELLOW_TIME = SITE36_CONFIGURATION.yellow;
export const ALL_RED_TIME = 2;
export const INTER_GREEN = YELLOW_TIME + ALL_RED_TIME;

export function getSignalGroupForMovement(
  approach: Approach,
  movement: Movement,
): number {
  return SITE36_CONFIGURATION.vehicleSignalGroups[approach][movement];
}

export function isSignalGroupActiveInPhase(
  signalGroup: number,
  phaseIndex: number,
): boolean {
  const phase = SITE36_CONFIGURATION.phaseSequence[phaseIndex];
  return phase ? SITE36_CONFIGURATION.phaseSignalGroups[phase].includes(signalGroup) : false;
}

export function isPermissiveOffMovement(
  approach: Approach,
  movement: Movement,
): boolean {
  const group = getSignalGroupForMovement(approach, movement);
  return SITE36_CONFIGURATION.movementRules[`${group}:${movement}`] === "permissive";
}

export function isGapFilteredMovement(
  approach: Approach,
  movement: Movement,
): boolean {
  const group = getSignalGroupForMovement(approach, movement);
  return SITE36_CONFIGURATION.movementRules[`${group}:${movement}`] === "gap-filtered";
}

export function movementCanProceedOnAspect(
  approach: Approach,
  movement: Movement,
  aspect: SignalState,
): boolean {
  return (
    aspect === "green" ||
    (aspect === "off" && isPermissiveOffMovement(approach, movement))
  );
}

export function getInterGreenForPhase(phaseIndex: number): number {
  return YELLOW_TIME + (SITE36_CONFIGURATION.allRed[phaseIndex] ?? ALL_RED_TIME);
}

const PHASE_COUNT = 4;

export type PhaseIndex = 0 | 1 | 2 | 3;
export type PhaseDemand = [number, number, number, number];

export interface FixedSignalProgressInfo {
  currentPhase: PhaseIndex;
  phaseElapsed: number;
  interGreenElapsed: number;
  inInterGreen: boolean;
  isIdle: boolean;
  skippedPhases: [boolean, boolean, boolean, boolean];
  cycleCount: number;
}

function emptyPhaseDemand(): PhaseDemand {
  return [0, 0, 0, 0];
}

function emptySkippedPhases(): [boolean, boolean, boolean, boolean] {
  return [false, false, false, false];
}

/** Fixed-time signal controller using player's phase config, with demand skip */
export class FixedSignalController {
  private config: PhaseConfig;
  private currentPhaseIndex = 0;
  private phaseElapsed = 0;
  private inInterGreen = false;
  private interGreenElapsed = 0;
  private isIdle = false;
  private latestPhaseDemand: PhaseDemand = emptyPhaseDemand();
  private skippedPhasesThisCycle = emptySkippedPhases();
  private cycleCount = 0;
  private hasStartedPhase = false;

  constructor(config: PhaseConfig) {
    this.config = config;
  }

  get cycleLength(): number {
    return (
      this.config.greens.reduce((a, b) => a + b, 0) +
      SITE36_CONFIGURATION.allRed.reduce((sum, red) => sum + YELLOW_TIME + red, 0)
    );
  }

  /**
   * Called by the engine each tick with current stop-line demand.
   * Empty phases are skipped only before their green starts; once a demanded
   * phase begins, the player's selected green time is served.
  */
  updatePhaseDemand(
    simTime: number,
    phaseDemand: PhaseDemand,
    deltaSeconds: number,
  ): void {
    void simTime;
    this.latestPhaseDemand = [...phaseDemand] as PhaseDemand;

    if (this.inInterGreen) {
      this.interGreenElapsed += deltaSeconds;
      if (this.interGreenElapsed >= getInterGreenForPhase(this.currentPhaseIndex)) {
        this.inInterGreen = false;
        this.interGreenElapsed = 0;
        this.startNextDemandPhase(this.currentPhaseIndex + 1);
      }
      return;
    }

    if (this.isIdle) {
      this.startNextDemandPhase(this.currentPhaseIndex);
      if (this.isIdle) return;
    } else if (
      this.phaseElapsed <= 0 &&
      !this.hasDemandForPhase(this.currentPhaseIndex)
    ) {
      this.startNextDemandPhase(this.currentPhaseIndex);
      if (this.isIdle) return;
    }

    this.phaseElapsed += deltaSeconds;

    if (this.phaseElapsed >= this.config.greens[this.currentPhaseIndex]) {
      this.phaseElapsed = this.config.greens[this.currentPhaseIndex];
      this.inInterGreen = true;
      this.interGreenElapsed = 0;
    }
  }

  /** Get signal state for a specific approach+movement at a given sim time */
  getSignalState(
    simTime: number,
    approach: Approach,
    movement: Movement,
  ): SignalState {
    void simTime;
    if (this.isIdle) return "red";

    const phase = PHASE_DEFINITIONS[this.currentPhaseIndex];
    const isInPhase = phase.greenMovements.some(
      (gm) => gm.approach === approach && gm.movement === movement,
    );

    if (!isInPhase) {
      const signalGroup = getSignalGroupForMovement(approach, movement);
      const hasControlledPhase = SITE36_CONFIGURATION.phaseSequence.some((phase) =>
        SITE36_CONFIGURATION.phaseSignalGroups[phase].includes(signalGroup),
      );
      return hasControlledPhase ? "red" : "off";
    }

    if (this.inInterGreen) {
      return this.interGreenElapsed < YELLOW_TIME ? "yellow" : "red";
    }

    return "green";
  }

  /** Get the current phase index at a given sim time */
  getCurrentPhase(simTime: number): number {
    void simTime;
    return this.currentPhaseIndex;
  }

  getProgressInfo(): FixedSignalProgressInfo {
    return {
      currentPhase: this.currentPhaseIndex as PhaseIndex,
      phaseElapsed: this.phaseElapsed,
      interGreenElapsed: this.interGreenElapsed,
      inInterGreen: this.inInterGreen,
      isIdle: this.isIdle,
      skippedPhases: [...this.skippedPhasesThisCycle] as [
        boolean,
        boolean,
        boolean,
        boolean,
      ],
      cycleCount: this.cycleCount,
    };
  }

  private hasDemandForPhase(phaseIndex: number): boolean {
    return (this.latestPhaseDemand[phaseIndex] ?? 0) > 0;
  }

  private startNextDemandPhase(startIndex: number): void {
    const skippedDuringSearch: PhaseIndex[] = [];

    for (let offset = 0; offset < PHASE_COUNT; offset++) {
      const phaseIndex = (startIndex + offset) % PHASE_COUNT;
      if (!this.hasDemandForPhase(phaseIndex)) {
        skippedDuringSearch.push(phaseIndex as PhaseIndex);
        continue;
      }

      const wrappedIntoNewCycle = this.hasStartedPhase
        ? startIndex + offset >= PHASE_COUNT
        : true;
      if (wrappedIntoNewCycle) {
        this.skippedPhasesThisCycle = emptySkippedPhases();
        this.cycleCount++;
      }

      for (const skippedPhase of skippedDuringSearch) {
        if (this.shouldKeepServedPhaseColored(skippedPhase, startIndex)) {
          continue;
        }
        this.skippedPhasesThisCycle[skippedPhase] = true;
      }
      this.skippedPhasesThisCycle[phaseIndex as PhaseIndex] = false;

      this.currentPhaseIndex = phaseIndex;
      this.phaseElapsed = 0;
      this.interGreenElapsed = 0;
      this.inInterGreen = false;
      this.isIdle = false;
      this.hasStartedPhase = true;
      return;
    }

    for (const skippedPhase of skippedDuringSearch) {
      if (this.shouldKeepServedPhaseColored(skippedPhase, startIndex)) {
        continue;
      }
      this.skippedPhasesThisCycle[skippedPhase] = true;
    }

    this.phaseElapsed = 0;
    this.interGreenElapsed = 0;
    this.inInterGreen = false;
    this.isIdle = true;
  }

  private shouldKeepServedPhaseColored(
    phaseIndex: PhaseIndex,
    startIndex: number,
  ): boolean {
    return (
      this.hasStartedPhase &&
      phaseIndex === this.currentPhaseIndex &&
      (this.isIdle || startIndex !== this.currentPhaseIndex)
    );
  }
}

export function phaseServesMovement(
  phaseIndex: number,
  approach: Approach,
  movement: Movement,
): boolean {
  const phase = PHASE_DEFINITIONS[phaseIndex];
  if (!phase) return false;

  return phase.greenMovements.some(
    (gm) => gm.approach === approach && gm.movement === movement,
  );
}

export function phaseAllowsFilterTurn(
  phaseIndex: number,
  approach: Approach,
  movement: Movement,
): boolean {
  return (
    isGapFilteredMovement(approach, movement) &&
    phaseServesMovement(phaseIndex, approach, "straight")
  );
}

export function phasesUsedByMovement(
  approach: Approach,
  movement: Movement,
): PhaseIndex[] {
  const phases: PhaseIndex[] = [];

  for (let p = 0; p < PHASE_DEFINITIONS.length; p++) {
    if (
      phaseServesMovement(p, approach, movement) ||
      phaseAllowsFilterTurn(p, approach, movement)
    ) {
      phases.push(p as PhaseIndex);
    }
  }

  return phases;
}
