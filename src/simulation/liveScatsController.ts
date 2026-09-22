import type { SignalState, Approach, Movement } from "../data/types";
import { PHASE_DEFINITIONS, YELLOW_TIME, getInterGreenForPhase } from "./signalController";
import type { QueueObservation } from "./aiController";

/**
 * Live SCATS Adaptive Signal Controller
 *
 * Simulates SCATS (Sydney Coordinated Adaptive Traffic System) operating
 * in real-time using detector observations, based on SCATS Core v6.12.0
 * Operating Instructions.
 *
 * Key SCATS behaviours replicated:
 * - Actuated phase control with gapping (gap-out when no demand detected)
 * - Stretch phase: one phase (Phase A) absorbs remaining cycle time
 * - Degree of Saturation (DS) measurement per approach
 * - Split plan voting: DS-based selection between stored split plans
 * - Cycle length adaptation based on maximum DS
 * - 2-consecutive-vote stability filter for plan changes
 */

// ── Phase timing limits ──
const MIN_GREEN = 7;
const MAX_GREEN = 55;

// ── Cycle length limits (LCL / HCL from SCATS manual) ──
const MIN_CYCLE = 50;   // LCL
const MAX_CYCLE = 120;  // HCL
const CYCLE_STEP = 5;   // seconds per cycle length adjustment

// ── Gap-out parameters ──
const GAP_TIME_SECONDS = 3.0;        // seconds of no demand to gap-out
const GAP_TIME_TICKS = Math.round(GAP_TIME_SECONDS / 0.1); // DT = 0.1

// ── Stretch phase (gets remaining cycle time, no-gap by default) ──
const STRETCH_PHASE = 0; // Phase A is the stretch phase

// ── Degree of Saturation thresholds ──
const SAT_FLOW = 0.5;    // vehicles per second per lane (≈1800 veh/hr)
const DS_HIGH = 0.9;     // increase cycle length above this
const DS_LOW = 0.7;      // decrease cycle length below this

// ── Plan voting ──
const VOTE_CONFIRM = 2;  // consecutive votes needed to change plan

// ── Default cycle length ──
const DEFAULT_CYCLE = 70;

/**
 * Stored split plans as percentage of available green time per phase.
 * SCATS sites typically store 1–16 plans; we use 4 representative ones.
 * Values are proportional weights (normalised at runtime).
 */
const SPLIT_PLANS: number[][] = [
  [25, 25, 25, 25],   // Plan 0: Equal — low/balanced traffic
  [35, 15, 35, 15],   // Plan 1: NS-heavy — N/S dominant flow
  [15, 35, 15, 35],   // Plan 2: EW-heavy — E/W dominant flow
  [30, 20, 30, 20],   // Plan 3: Balanced-high — general peak
];

/**
 * Maps each phase to the primary detector lanes it serves.
 * Used for DS calculation and gap-out detection.
 */
const PHASE_PRIMARY_LANES: string[][] = [
  ["N-0", "S-0"],       // Phase A
  ["E-0", "E-1"],       // Phase B
  ["W-0"],              // Phase C (E-0 shared, counted under B)
  ["S-0", "S-1"],       // Phase D
];

/**
 * Strategic approach lane groups for DS measurement.
 * Each approach group maps to the phases it primarily feeds demand to.
 */
interface StrategicApproach {
  lanes: string[];
  primaryPhase: number;
}

const STRATEGIC_APPROACHES: StrategicApproach[] = [
  { lanes: ["N-0", "N-1"], primaryPhase: 0 },  // North → Phase A
  { lanes: ["S-0", "S-1"], primaryPhase: 3 },  // South → Phase D (also A)
  { lanes: ["E-0", "E-1"], primaryPhase: 1 },  // East → Phase B
  { lanes: ["W-0", "W-1"], primaryPhase: 2 },  // West → Phase C
];

export class LiveScatsController {
  // ── Cycle-level state ──
  private cycleLength = DEFAULT_CYCLE;
  private currentGreens: [number, number, number, number];
  private cycleStartTime = 0;
  private cycleCount = 0;

  // ── Split plan state ──
  private activePlanIndex = 0;
  private pendingVotePlan = -1;
  private consecutiveVotes = 0;

  // ── Within-cycle actuated state ──
  private currentPhaseIndex = 0;
  private phaseElapsed = 0;
  private inInterGreen = false;
  private interGreenElapsed = 0;
  private gapOutCounter = 0;

  // ── DS measurement per approach (accumulated each cycle) ──
  private approachDemand: number[] = [0, 0, 0, 0];  // total demand observed
  private approachGreenTime: number[] = [0, 0, 0, 0]; // green time given
  private ticksThisCycle = 0;

  // ── Queue observation snapshot ──
  private latestQueueMap = new Map<string, number>();

  // ── Per-phase actual green used this cycle ──
  private phaseGreenUsed: [number, number, number, number] = [0, 0, 0, 0];

  // ── History for pie chart ──
  private cycleHistory: Array<{
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  }> = [];

  constructor() {
    // Initialise green splits from Plan 0 (equal)
    this.currentGreens = this.computeGreensFromPlan(this.activePlanIndex);
    this.cycleHistory.push({
      cycleStart: 0,
      cycleLength: this.cycleLength,
      phaseGreens: [...this.currentGreens],
    });
  }

  /** Compute absolute green times from a split plan and current cycle length */
  private computeGreensFromPlan(planIndex: number): [number, number, number, number] {
    const plan = SPLIT_PLANS[planIndex];
    const totalWeight = plan.reduce((a, b) => a + b, 0);
    const availableGreen = this.cycleLength -
      [0, 1, 2, 3].reduce((sum, phase) => sum + getInterGreenForPhase(phase), 0);

    const greens: [number, number, number, number] = [0, 0, 0, 0];
    for (let p = 0; p < 4; p++) {
      greens[p] = Math.max(MIN_GREEN, Math.min(MAX_GREEN,
        Math.round((plan[p] / totalWeight) * availableGreen)));
    }
    return greens;
  }

  /** Nominal cycle length (planned greens + inter-greens) */
  get nominalCycleLength(): number {
    return this.cycleLength;
  }

  /** Called by the engine each tick with current queue observations */
  updateQueues(simTime: number, observations: QueueObservation[]): void {
    // Build lane → waiting count map
    this.latestQueueMap.clear();
    for (const obs of observations) {
      this.latestQueueMap.set(`${obs.approach}-${obs.lane}`, obs.waitingVehicles);
    }

    // Accumulate demand on strategic approaches
    for (let a = 0; a < STRATEGIC_APPROACHES.length; a++) {
      let demand = 0;
      for (const lane of STRATEGIC_APPROACHES[a].lanes) {
        demand += this.latestQueueMap.get(lane) ?? 0;
      }
      this.approachDemand[a] += demand;
    }

    // Track green time per approach (which approaches are currently getting green)
    if (!this.inInterGreen) {
      for (let a = 0; a < STRATEGIC_APPROACHES.length; a++) {
        if (STRATEGIC_APPROACHES[a].primaryPhase === this.currentPhaseIndex) {
          this.approachGreenTime[a] += 0.1; // DT
        }
      }
    }

    this.ticksThisCycle++;
    this.updateActuatedPhase(simTime);
  }

  /** Actuated phase control — SCATS-style gapping with stretch phase */
  private updateActuatedPhase(simTime: number): void {
    if (this.inInterGreen) {
      this.interGreenElapsed += 0.1;
      if (this.interGreenElapsed >= getInterGreenForPhase(this.currentPhaseIndex)) {
        this.inInterGreen = false;
        this.interGreenElapsed = 0;
        this.currentPhaseIndex++;

        if (this.currentPhaseIndex >= 4) {
          this.endCycle(simTime);
          return;
        }

        this.gapOutCounter = 0;
        this.phaseElapsed = 0;
      }
      return;
    }

    // Currently in green phase
    this.phaseElapsed += 0.1;
    const allocatedGreen = this.currentGreens[this.currentPhaseIndex];
    const isStretchPhase = this.currentPhaseIndex === STRETCH_PHASE;

    // Check queue on primary served lanes
    let primaryWaiting = 0;
    for (const laneKey of PHASE_PRIMARY_LANES[this.currentPhaseIndex]) {
      primaryWaiting += this.latestQueueMap.get(laneKey) ?? 0;
    }

    // Minimum green must be served first
    if (this.phaseElapsed < MIN_GREEN) {
      return;
    }

    // Stretch phase: runs to allocated green (no gap-out) unless no demand
    if (isStretchPhase) {
      if (this.phaseElapsed >= allocatedGreen) {
        // Stretch phase has served its time — can extend if demand, but cap at MAX
        if (primaryWaiting > 0 && this.phaseElapsed < MAX_GREEN) {
          return; // extend
        }
        this.phaseGreenUsed[this.currentPhaseIndex] = this.phaseElapsed;
        this.startInterGreen();
        return;
      }
      // Not yet at allocated green — keep running (stretch = no-gap)
      return;
    }

    // Non-stretch phases: gap-out when no demand detected for GAP_TIME
    if (primaryWaiting === 0) {
      this.gapOutCounter++;
      if (this.gapOutCounter >= GAP_TIME_TICKS) {
        // Gap out — phase terminates early
        this.phaseGreenUsed[this.currentPhaseIndex] = this.phaseElapsed;
        this.startInterGreen();
        return;
      }
    } else {
      this.gapOutCounter = 0;
    }

    // Check if allocated green time is reached
    if (this.phaseElapsed >= allocatedGreen) {
      // Extend if demand persists, up to MAX_GREEN
      if (primaryWaiting > 0 && this.phaseElapsed < MAX_GREEN) {
        return;
      }
      this.phaseGreenUsed[this.currentPhaseIndex] = this.phaseElapsed;
      this.startInterGreen();
    }
  }

  private startInterGreen(): void {
    this.inInterGreen = true;
    this.interGreenElapsed = 0;
  }

  /** End-of-cycle: compute DS, vote for plan, adapt cycle length */
  private endCycle(simTime: number): void {
    this.cycleCount++;

    // ── 1. Compute Degree of Saturation per strategic approach ──
    const ds: number[] = [0, 0, 0, 0];
    for (let a = 0; a < STRATEGIC_APPROACHES.length; a++) {
      const greenTime = this.approachGreenTime[a];
      if (greenTime > 0 && this.ticksThisCycle > 0) {
        // Average demand per tick × ticks → total demand-ticks
        // DS ≈ avg_demand / (sat_flow × green_time × lanes)
        const avgDemand = this.approachDemand[a] / this.ticksThisCycle;
        const laneCount = STRATEGIC_APPROACHES[a].lanes.length;
        const capacity = SAT_FLOW * greenTime * laneCount;
        ds[a] = capacity > 0 ? Math.min(1.99, avgDemand / capacity) : 0;
      }
    }

    const maxDS = Math.max(...ds);

    // ── 2. Cycle length adaptation based on max DS ──
    if (maxDS > DS_HIGH) {
      this.cycleLength = Math.min(MAX_CYCLE, this.cycleLength + CYCLE_STEP);
    } else if (maxDS < DS_LOW) {
      this.cycleLength = Math.max(MIN_CYCLE, this.cycleLength - CYCLE_STEP);
    }

    // ── 3. Split plan voting ──
    // Each approach votes for the plan whose split best matches its DS
    const planScores = SPLIT_PLANS.map((plan) => {
      const totalWeight = plan.reduce((a, b) => a + b, 0);
      let score = 0;
      for (let a = 0; a < STRATEGIC_APPROACHES.length; a++) {
        const phaseIdx = STRATEGIC_APPROACHES[a].primaryPhase;
        const planShare = plan[phaseIdx] / totalWeight;
        // Score = how well this plan's allocation matches the approach's DS
        // Higher DS needs higher share → minimise |DS - share × scaleFactor|
        const demand = ds[a];
        const totalDS = ds.reduce((x, y) => x + y, 0) || 1;
        const demandShare = demand / totalDS;
        score -= Math.abs(planShare - demandShare); // negative = closer match is better
      }
      return score;
    });

    // Find best scoring plan
    let bestPlan = 0;
    let bestScore = planScores[0];
    for (let i = 1; i < planScores.length; i++) {
      if (planScores[i] > bestScore) {
        bestScore = planScores[i];
        bestPlan = i;
      }
    }

    // 2-consecutive-vote stability filter
    if (bestPlan !== this.activePlanIndex) {
      if (bestPlan === this.pendingVotePlan) {
        this.consecutiveVotes++;
        if (this.consecutiveVotes >= VOTE_CONFIRM) {
          this.activePlanIndex = bestPlan;
          this.consecutiveVotes = 0;
          this.pendingVotePlan = -1;
        }
      } else {
        this.pendingVotePlan = bestPlan;
        this.consecutiveVotes = 1;
      }
    } else {
      this.pendingVotePlan = -1;
      this.consecutiveVotes = 0;
    }

    // ── 4. Compute new green splits from active plan + cycle length ──
    this.currentGreens = this.computeGreensFromPlan(this.activePlanIndex);

    // ── 5. Reset accumulators ──
    this.approachDemand = [0, 0, 0, 0];
    this.approachGreenTime = [0, 0, 0, 0];
    this.ticksThisCycle = 0;
    this.cycleStartTime = simTime;
    this.currentPhaseIndex = 0;
    this.phaseElapsed = 0;
    this.gapOutCounter = 0;
    this.inInterGreen = false;
    this.interGreenElapsed = 0;
    this.phaseGreenUsed = [0, 0, 0, 0];

    this.cycleHistory.push({
      cycleStart: simTime,
      cycleLength: this.cycleLength,
      phaseGreens: [...this.currentGreens],
    });
  }

  getSignalState(
    _simTime: number,
    approach: Approach,
    movement: Movement,
  ): SignalState {
    if (this.inInterGreen) {
      if (this.interGreenElapsed < YELLOW_TIME) {
        const phase = PHASE_DEFINITIONS[this.currentPhaseIndex];
        const isInPhase = phase.greenMovements.some(
          (gm) => gm.approach === approach && gm.movement === movement,
        );
        if (isInPhase) return "yellow";
      }
      return "red";
    }

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

  getCurrentGreens(): [number, number, number, number] {
    return [...this.currentGreens] as [number, number, number, number];
  }

  getCycleHistory(): Array<{
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  }> {
    return this.cycleHistory;
  }

  getCurrentCycleInfo(simTime: number): {
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  } {
    void simTime;
    return {
      cycleStart: this.cycleStartTime,
      cycleLength: this.cycleLength,
      phaseGreens: [...this.currentGreens],
    };
  }

  getCycleCount(): number {
    return this.cycleCount;
  }
}
