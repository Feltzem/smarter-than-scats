import type { SignalState, Approach, Movement } from "../data/types";
import { PHASE_DEFINITIONS, YELLOW_TIME, getInterGreenForPhase } from "./signalController";

/**
 * AI Adaptive Signal Controller
 *
 * Simulates a camera-based system that observes queue lengths on each
 * approach/lane and optimises green splits to minimise total queue length.
 *
 * Strategy:
 * - Actuated control: phases can gap-out (terminate early) when their
 *   queue clears, or extend up to a maximum when demand is heavy.
 * - Between cycles, green splits are reallocated proportionally to
 *   accumulated queue pressure (squared for urgency weighting).
 * - A momentum term smooths changes to avoid oscillation.
 */

const MIN_GREEN = 5;
const MAX_GREENS = [40, 20, 40, 20];
const MIN_CYCLE = 50;
const MAX_CYCLE = 120;
const LEARNING_RATE = 0.7;
const DEFAULT_GREEN = 15;

/** Gap-out / extend parameters */
const GAP_OUT_THRESHOLD = 0;       // gap-out when waiting vehicles <= this
const GAP_OUT_HOLD_TICKS = 20;     // ~2s of sustained empty queue to gap-out
const MAX_EXTEND = 15;             // max seconds a phase can extend beyond base

/** Queue observation per lane */
export interface QueueObservation {
  approach: Approach;
  lane: number;
  waitingVehicles: number;
}

/**
 * Maps each phase to the PRIMARY lanes it serves (direct green, not filters).
 * Filter turns and conditional lefts get reduced weight.
 */
interface PhaseLaneWeight {
  laneKey: string;
  weight: number;
}

const PHASE_LANE_WEIGHTS: PhaseLaneWeight[][] = [
  // Phase A: N↔S through/left (direct), N-right filters on gap (low weight)
  [
    { laneKey: "N-0", weight: 1.0 },
    { laneKey: "S-0", weight: 1.0 },
    { laneKey: "N-1", weight: 0.3 },  // filter right turn
  ],
  // Phase B: E through/right/left (direct), N-left conditional (low weight)
  [
    { laneKey: "E-0", weight: 1.0 },
    { laneKey: "E-1", weight: 1.0 },
  ],
  // Phase C: W↔E through/left (direct), W-right filters on gap (low weight)
  [
    { laneKey: "W-0", weight: 1.0 },
    { laneKey: "E-0", weight: 0.5 },  // shared with Phase B — lower weight here
    { laneKey: "W-1", weight: 0.3 },  // filter right turn
  ],
  // Phase D: S through/right/left (direct), E-left conditional (low weight)
  [
    { laneKey: "S-0", weight: 1.0 },
    { laneKey: "S-1", weight: 1.0 },
  ],
];

/** Simple lane keys for gap-out detection (only primary served lanes) */
const PHASE_PRIMARY_LANES: string[][] = [
  ["N-0", "S-0"],       // Phase A
  ["E-0", "E-1"],       // Phase B
  ["W-0"],              // Phase C primary (E-0 served elsewhere too)
  ["S-0", "S-1"],       // Phase D
];

export class AISignalController {
  private currentGreens: [number, number, number, number];
  private cycleStartTime = 0;
  private cycleCount = 0;

  // Accumulated queue pressure per phase during each cycle
  private phasePressure: [number, number, number, number] = [0, 0, 0, 0];
  private ticksThisCycle = 0;

  // Within-cycle actuated state
  private gapOutCounter = 0;          // ticks with empty queue in current phase
  private currentPhaseIndex = 0;      // which phase is currently green
  private phaseElapsed = 0;           // time spent in current phase (green + inter-green)
  private inInterGreen = false;       // are we in the inter-green period?
  private interGreenElapsed = 0;      // time in inter-green

  // Per-phase actual green used (for reporting)
  private actualGreensThisCycle: [number, number, number, number] = [0, 0, 0, 0];

  // Latest queue snapshot for within-cycle decisions
  private latestQueueMap = new Map<string, number>();

  // History of cycle configs for the pie chart
  private cycleHistory: Array<{
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  }> = [];

  constructor() {
    this.currentGreens = [DEFAULT_GREEN, DEFAULT_GREEN, DEFAULT_GREEN, DEFAULT_GREEN];
    this.cycleHistory.push({
      cycleStart: 0,
      cycleLength: this.nominalCycleLength,
      phaseGreens: [...this.currentGreens],
    });
  }

  /** Nominal cycle length based on planned greens */
  get nominalCycleLength(): number {
    return this.currentGreens.reduce((a, b) => a + b, 0) +
      [0, 1, 2, 3].reduce((sum, phase) => sum + getInterGreenForPhase(phase), 0);
  }

  /** Actual cycle length getter for display (uses nominal) */
  get cycleLength(): number {
    return this.nominalCycleLength;
  }

  /** Called by the engine each tick with current queue observations */
  updateQueues(simTime: number, observations: QueueObservation[]): void {
    // Build a map of lane → waiting count
    this.latestQueueMap.clear();
    for (const obs of observations) {
      this.latestQueueMap.set(`${obs.approach}-${obs.lane}`, obs.waitingVehicles);
    }

    // Accumulate weighted pressure for each phase (squared for urgency)
    for (let p = 0; p < 4; p++) {
      let pressure = 0;
      for (const { laneKey, weight } of PHASE_LANE_WEIGHTS[p]) {
        const q = this.latestQueueMap.get(laneKey) ?? 0;
        pressure += q * q * weight;  // squared: penalizes long queues more
      }
      this.phasePressure[p] += pressure;
    }
    this.ticksThisCycle++;

    // Within-cycle actuated control
    this.updateActuatedPhase(simTime);
  }

  /**
   * Actuated phase control: gap-out early when queue clears,
   * extend when demand is heavy.
   */
  private updateActuatedPhase(simTime: number): void {
    if (this.inInterGreen) {
      this.interGreenElapsed += 0.1; // DT
      if (this.interGreenElapsed >= getInterGreenForPhase(this.currentPhaseIndex)) {
        // Move to next phase
        this.inInterGreen = false;
        this.interGreenElapsed = 0;
        this.currentPhaseIndex++;

        if (this.currentPhaseIndex >= 4) {
          // Cycle complete
          this.endCycle(simTime);
          return;
        }

        this.gapOutCounter = 0;
        this.phaseElapsed = 0;
      }
      return;
    }

    // Currently in green phase
    this.phaseElapsed += 0.1; // DT
    const baseGreen = this.currentGreens[this.currentPhaseIndex];

    // Check queue on primary served lanes
    let primaryWaiting = 0;
    for (const laneKey of PHASE_PRIMARY_LANES[this.currentPhaseIndex]) {
      primaryWaiting += this.latestQueueMap.get(laneKey) ?? 0;
    }

    // Gap-out: if queue is clear and we've served minimum green
    if (this.phaseElapsed >= MIN_GREEN) {
      if (primaryWaiting <= GAP_OUT_THRESHOLD) {
        this.gapOutCounter++;
        if (this.gapOutCounter >= GAP_OUT_HOLD_TICKS) {
          // Gap out — record actual green and start inter-green
          this.actualGreensThisCycle[this.currentPhaseIndex] = this.phaseElapsed;
          this.startInterGreen();
          return;
        }
      } else {
        this.gapOutCounter = 0;
      }
    }

    // Extension: allow extending beyond base green if demand persists
    const maxGreenForPhase = Math.min(
      MAX_GREENS[this.currentPhaseIndex] ?? 40,
      baseGreen + MAX_EXTEND,
    );

    if (this.phaseElapsed >= baseGreen) {
      // Past base green — extend only if there's demand
      if (primaryWaiting > 0 && this.phaseElapsed < maxGreenForPhase) {
        // Continue extending
        return;
      }
      // No demand or hit max extension — terminate
      this.actualGreensThisCycle[this.currentPhaseIndex] = this.phaseElapsed;
      this.startInterGreen();
    }
  }

  private startInterGreen(): void {
    this.inInterGreen = true;
    this.interGreenElapsed = 0;
  }

  private endCycle(simTime: number): void {
    this.cycleCount++;

    // Calculate average pressure per phase over this cycle
    const avgPressure: [number, number, number, number] = [0, 0, 0, 0];
    if (this.ticksThisCycle > 0) {
      for (let p = 0; p < 4; p++) {
        avgPressure[p] = this.phasePressure[p] / this.ticksThisCycle;
      }
    }

    const totalPressure = avgPressure.reduce((a, b) => a + b, 0);

    // Faster adaptation in first few cycles, then settle
    const lr = this.cycleCount <= 3
      ? Math.min(1.0, LEARNING_RATE + 0.2)
      : LEARNING_RATE;

    if (totalPressure > 0.01) {
      // Determine target total green time based on overall demand
      const demandFactor = Math.min(1, Math.sqrt(totalPressure) / 8);
      const targetTotalGreen = MIN_CYCLE - [0, 1, 2, 3].reduce((sum, phase) => sum + getInterGreenForPhase(phase), 0) +
        demandFactor * (MAX_CYCLE - MIN_CYCLE);

      // Allocate green proportionally to pressure (sqrt to avoid extremes)
      const sqrtPressure = avgPressure.map(p => Math.sqrt(p));
      const totalSqrt = sqrtPressure.reduce((a, b) => a + b, 0);

      const targetGreens: [number, number, number, number] = [0, 0, 0, 0];
      if (totalSqrt > 0) {
        for (let p = 0; p < 4; p++) {
          const share = sqrtPressure[p] / totalSqrt;
          targetGreens[p] = Math.max(MIN_GREEN, Math.min(MAX_GREENS[p] ?? 40,
            Math.round(share * targetTotalGreen)));
        }
      }

      // Blend with current greens (momentum for stability)
      for (let p = 0; p < 4; p++) {
        if (totalSqrt > 0) {
          this.currentGreens[p] = Math.max(MIN_GREEN, Math.min(MAX_GREENS[p] ?? 40,
            Math.round(
              this.currentGreens[p] * (1 - lr) +
              targetGreens[p] * lr
            )));
        }
      }
    }

    // Reset accumulators
    this.phasePressure = [0, 0, 0, 0];
    this.ticksThisCycle = 0;
    this.cycleStartTime = simTime;
    this.currentPhaseIndex = 0;
    this.phaseElapsed = 0;
    this.gapOutCounter = 0;
    this.inInterGreen = false;
    this.interGreenElapsed = 0;
    this.actualGreensThisCycle = [0, 0, 0, 0];

    this.cycleHistory.push({
      cycleStart: simTime,
      cycleLength: this.nominalCycleLength,
      phaseGreens: [...this.currentGreens],
    });
  }

  getSignalState(
    _simTime: number,
    approach: Approach,
    movement: Movement,
  ): SignalState {
    // Use actuated phase state directly
    if (this.inInterGreen) {
      // During inter-green: check if this is the ending phase (yellow) or just red
      if (this.interGreenElapsed < YELLOW_TIME) {
        const phase = PHASE_DEFINITIONS[this.currentPhaseIndex];
        const isInPhase = phase.greenMovements.some(
          (gm) => gm.approach === approach && gm.movement === movement,
        );
        if (isInPhase) return "yellow";
      }
      return "red";
    }

    // During green: check if this approach/movement is in the current phase
    const phase = PHASE_DEFINITIONS[this.currentPhaseIndex];
    const isInPhase = phase.greenMovements.some(
      (gm) => gm.approach === approach && gm.movement === movement,
    );

    if (isInPhase) return "green";
    return "red";
  }

  getCurrentPhase(simTime: number): number {
    void simTime;
    return this.currentPhaseIndex;
  }

  /** Get current green splits for display */
  getCurrentGreens(): [number, number, number, number] {
    return [...this.currentGreens] as [number, number, number, number];
  }

  /** Get cycle history for pie chart display */
  getCycleHistory(): Array<{
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  }> {
    return this.cycleHistory;
  }

  /** Get the current cycle info */
  getCurrentCycleInfo(simTime: number): {
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  } {
    void simTime;
    return {
      cycleStart: this.cycleStartTime,
      cycleLength: this.nominalCycleLength,
      phaseGreens: [...this.currentGreens],
    };
  }

  getCycleCount(): number {
    return this.cycleCount;
  }
}
