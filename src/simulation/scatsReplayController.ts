import type {
  Approach,
  Movement,
  ScatsCycle,
  ScatsPhaseEvent,
  SignalGroupTransition,
  SignalState,
} from "../data/types";
import { PHASE_DEFINITIONS } from "./signalController";
import { SITE36_CONFIGURATION } from "../data/site36Configuration";

/**
 * Replays historical SCATS phase events captured for a specific day.
 * This keeps SCATS behavior deterministic and aligned to exported logs.
 */
export class ScatsReplayController {
  private readonly phaseTimeline: ScatsPhaseEvent[];
  private readonly cycles: ScatsCycle[];
  private readonly signalGroupTimelines = new Map<
    number,
    SignalGroupTransition[]
  >();
  private phaseCursor = 0;
  private cycleCursor = 0;

  constructor(
    phaseTimeline: ScatsPhaseEvent[] = [],
    cycles: ScatsCycle[] = [],
    signalGroupTimeline: SignalGroupTransition[] = [],
  ) {
    this.phaseTimeline = [...phaseTimeline].sort(
      (a, b) => a.startTime - b.startTime,
    );
    this.cycles = [...cycles].sort((a, b) => a.cycleStart - b.cycleStart);
    for (const transition of signalGroupTimeline) {
      const timeline = this.signalGroupTimelines.get(transition.signalGroup) ?? [];
      timeline.push(transition);
      this.signalGroupTimelines.set(transition.signalGroup, timeline);
    }
    for (const timeline of this.signalGroupTimelines.values()) {
      timeline.sort((a, b) => a.time - b.time);
    }
  }

  getSignalState(
    simTime: number,
    approach: Approach,
    movement: Movement,
  ): SignalState {
    const signalGroup = SITE36_CONFIGURATION.vehicleSignalGroups[approach][movement];
    const transition = this.getSignalGroupTransitionAt(simTime, signalGroup);
    if (transition) return transition.aspect;

    const phaseEvent = this.getPhaseEventAt(simTime);
    if (!phaseEvent) return "red";

    const activePhase = PHASE_DEFINITIONS[phaseEvent.phaseIndex];
    const isInPhase = activePhase.greenMovements.some(
      (gm) => gm.approach === approach && gm.movement === movement,
    );

    if (isInPhase) return "green";
    const controlled = SITE36_CONFIGURATION.phaseSequence.some((phase) =>
      SITE36_CONFIGURATION.phaseSignalGroups[phase].includes(signalGroup),
    );
    return controlled ? "red" : "off";
  }

  private getSignalGroupTransitionAt(
    simTime: number,
    signalGroup: number,
  ): SignalGroupTransition | null {
    const timeline = this.signalGroupTimelines.get(signalGroup);
    if (!timeline || timeline.length === 0 || timeline[0].time > simTime) {
      return null;
    }

    let low = 0;
    let high = timeline.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (timeline[middle].time <= simTime) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return timeline[high] ?? null;
  }

  getCurrentPhase(simTime: number): number {
    const phaseEvent = this.getPhaseEventAt(simTime);
    if (phaseEvent) return phaseEvent.phaseIndex;
    if (this.phaseTimeline.length > 0) {
      return this.phaseTimeline[this.phaseTimeline.length - 1].phaseIndex;
    }
    return 0;
  }

  getCurrentCycleInfo(simTime: number): {
    cycleStart: number;
    cycleLength: number;
    phaseGreens: number[];
  } {
    const cycle = this.getCycleAt(simTime);
    if (cycle) {
      return {
        cycleStart: cycle.cycleStart,
        cycleLength: Math.max(1, cycle.cycleLength),
        phaseGreens: normalizePhaseGreens(cycle.phaseGreens),
      };
    }

    const phaseEvent = this.getPhaseEventAt(simTime);
    if (phaseEvent) {
      const greens = [0, 0, 0, 0];
      greens[phaseEvent.phaseIndex] = Math.max(
        1,
        Math.round(phaseEvent.duration),
      );
      return {
        cycleStart: phaseEvent.startTime,
        cycleLength: Math.max(1, Math.round(phaseEvent.duration)),
        phaseGreens: greens,
      };
    }

    return {
      cycleStart: 0,
      cycleLength: 1,
      phaseGreens: [1, 1, 1, 1],
    };
  }

  getCycleCount(): number {
    if (this.cycles.length === 0) return 0;
    return Math.max(1, this.cycleCursor + 1);
  }

  private getPhaseEventAt(simTime: number): ScatsPhaseEvent | null {
    if (this.phaseTimeline.length === 0) return null;

    while (
      this.phaseCursor + 1 < this.phaseTimeline.length &&
      this.phaseTimeline[this.phaseCursor + 1].startTime <= simTime
    ) {
      this.phaseCursor++;
    }

    const candidate = this.phaseTimeline[this.phaseCursor];
    if (!candidate) return null;

    if (simTime < candidate.startTime) {
      return this.phaseTimeline[0] ?? null;
    }

    if (simTime <= candidate.startTime + candidate.duration) {
      return candidate;
    }

    return null;
  }

  private getCycleAt(simTime: number): ScatsCycle | null {
    if (this.cycles.length === 0) return null;

    while (
      this.cycleCursor + 1 < this.cycles.length &&
      this.cycles[this.cycleCursor + 1].cycleStart <= simTime
    ) {
      this.cycleCursor++;
    }

    return this.cycles[this.cycleCursor] ?? null;
  }
}

function normalizePhaseGreens(raw: number[]): [number, number, number, number] {
  return [
    Math.max(0, Math.round(raw[0] ?? 0)),
    Math.max(0, Math.round(raw[1] ?? 0)),
    Math.max(0, Math.round(raw[2] ?? 0)),
    Math.max(0, Math.round(raw[3] ?? 0)),
  ];
}
