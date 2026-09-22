import type {
  Arrival,
  CarState,
  PedestrianPhaseRun,
  PedestrianSignalGroup,
  PedestrianState,
  SimulationResult,
  Approach,
  Movement,
  SignalState,
} from "../data/types";
import { ALL_PATHS, getPathIndex } from "./paths";
import { computeAcceleration, FREE_FLOW_SPEED } from "./carFollowing";
import type { FollowingProfile } from "./carFollowing";
import {
  FixedSignalController,
  PHASE_DEFINITIONS,
  phasesUsedByMovement,
  isGapFilteredMovement,
  movementCanProceedOnAspect,
  phaseAllowsFilterTurn,
} from "./signalController";
import type { FixedSignalProgressInfo, PhaseDemand } from "./signalController";
import { AISignalController } from "./aiController";
import { LiveScatsController } from "./liveScatsController";
import { ScatsReplayController } from "./scatsReplayController";
import {
  conflictingTurnGroup,
  getPhaseOptionsForGroup,
  PEDESTRIAN_SIGNAL_GROUPS,
} from "./pedestrians";
import type { DetectorCalibrationProfile } from "./detectorCalibration";
import { assignVehicle } from "../vehicles/catalog";

const DT = 0.1; // simulation timestep (seconds)
const MIN_VISIBLE_ROAD_GAP = 1.5; // meters of visible road between queued vehicles
const FILTER_TURN_LOOKAHEAD = 60; // meters upstream search for conflicting traffic
const FILTER_TURN_INTERSECTION_BLOCK = 18; // meters beyond stopline considered conflict zone
const FILTER_TURN_REQUIRED_GAP = 4.0; // seconds minimum acceptable gap
const WAITING_SPEED_THRESHOLD = 2.0; // m/s; includes creeping queue traffic
const WAITING_COLOR_SPEED_THRESHOLD = 0.5; // m/s; near-stationary for car heat color
const PEDESTRIAN_WALK_DURATION_SECONDS = 10;

export type SignalControllerType =
  | FixedSignalController
  | AISignalController
  | LiveScatsController
  | ScatsReplayController;

export interface SimulationSnapshot {
  time: number;
  cars: CarState[];
  pedestrians: PedestrianState[];
  currentPhase: number;
  fixedSignalProgress?: FixedSignalProgressInfo;
  vehiclesServed: number;
  pedestriansCrossed: number;
  totalDelay: number;
  phaseDelaySeconds: [number, number, number, number];
  signalStates: Map<string, SignalState>; // key: "approach-movement"
  laneStats: Map<
    string,
    { waitingVehicles: number; cumulativeDelayHours: number }
  >;
}

export class SimulationEngine {
  private arrivals: Arrival[];
  private controller: SignalControllerType;
  private cars: CarState[] = [];
  private pedestrians: PedestrianState[] = [];
  private completedCars: CarState[] = [];
  private nextArrivalIndex = 0;
  private pedestrianRunsByGroup: Map<
    PedestrianSignalGroup,
    PedestrianPhaseRun[]
  > = new Map();
  private nextRunIndexByGroup: Map<PedestrianSignalGroup, number> = new Map();
  private nextPedestrianId = 0;
  private simTime = 0;
  private totalDelay = 0;
  private phaseDelaySeconds: [number, number, number, number] = [0, 0, 0, 0];
  private laneDelaySeconds = new Map<string, number>();
  private vehiclesEntered = 0;
  private pedestriansCrossed = 0;
  private maxVehiclesInNetwork = 0;
  private readonly detectorCalibration?: DetectorCalibrationProfile;

  constructor(
    arrivals: Arrival[],
    controller: SignalControllerType,
    pedestrianRuns: PedestrianPhaseRun[] = [],
    detectorCalibration?: DetectorCalibrationProfile,
  ) {
    this.arrivals = [...arrivals].sort((a, b) => a.time - b.time);
    this.controller = controller;
    this.detectorCalibration = detectorCalibration;
    for (const group of PEDESTRIAN_SIGNAL_GROUPS) {
      const sorted = pedestrianRuns
        .filter((r) => r.signalGroup === group)
        .sort((a, b) => a.startTime - b.startTime);
      this.pedestrianRunsByGroup.set(group, sorted);
      this.nextRunIndexByGroup.set(group, 0);
    }
  }

  get time(): number {
    return this.simTime;
  }

  get isComplete(): boolean {
    return (
      this.nextArrivalIndex >= this.arrivals.length && this.cars.length === 0
    );
  }

  /** Advance simulation by one timestep */
  tick(): void {
    this.simTime += DT;

    // Spawn new cars
    while (
      this.nextArrivalIndex < this.arrivals.length &&
      this.arrivals[this.nextArrivalIndex].time <= this.simTime
    ) {
      const arrival = this.arrivals[this.nextArrivalIndex];
      const pathIndex = getPathIndex(arrival.approach, arrival.movement);
      if (pathIndex >= 0) {
        const vehicle = assignVehicle(arrival.id);
        const traits = this.createVehicleTraits(arrival.id, arrival.detectorId);
        const spawnDistance = this.getSpawnDistance(
          arrival.approach,
          arrival.movement,
          pathIndex,
          traits.standstillGap,
        );
        this.cars.push({
          id: arrival.id,
          approach: arrival.approach,
          movement: arrival.movement,
          vehicleClass: vehicle.definition.vehicleClass,
          vehicleVariant: vehicle.vehicleVariant,
          paintColor: vehicle.paintColor,
          pathIndex,
          distance: spawnDistance,
          speed: traits.desiredSpeed * 0.8,
          length: traits.length,
          standstillGap: traits.standstillGap,
          timeHeadway: traits.timeHeadway,
          desiredSpeed: traits.desiredSpeed,
          maxAcceleration: traits.maxAcceleration,
          comfortDeceleration: traits.comfortDeceleration,
          waitingTimeSeconds: 0,
          entryTime: this.simTime,
          exitTime: null,
          active: true,
          startupReactionTime: traits.startupReactionTime,
          reactionTimeRemaining: 0,
          signalWasGreen: true, // assume green on arrival; no spurious reaction
        });
        this.vehiclesEntered++;
      }
      this.nextArrivalIndex++;
    }

    if (this.controller instanceof FixedSignalController) {
      this.controller.updatePhaseDemand(
        this.simTime,
        this.buildPhaseDemand(),
        DT,
      );
    }

    const currentPhase = this.controller.getCurrentPhase(this.simTime);
    for (const group of PEDESTRIAN_SIGNAL_GROUPS) {
      const runs = this.pedestrianRunsByGroup.get(group)!;
      let idx = this.nextRunIndexByGroup.get(group)!;
      const compatiblePhases = getPhaseOptionsForGroup(group);
      const phaseOk = compatiblePhases.includes(currentPhase as 0 | 1 | 2 | 3);

      while (idx < runs.length && runs[idx].startTime <= this.simTime) {
        if (!phaseOk) break;

        const run = runs[idx];
        for (const direction of run.pedestrianDirections) {
          this.pedestrians.push({
            id: this.nextPedestrianId,
            runId: run.id,
            signalGroup: run.signalGroup,
            direction,
            startTime: this.simTime,
            duration: PEDESTRIAN_WALK_DURATION_SECONDS,
            progress: 0,
          });
          this.nextPedestrianId++;
          this.pedestriansCrossed++;
        }

        idx++;
        this.nextRunIndexByGroup.set(group, idx);
      }
    }

    for (const pedestrian of this.pedestrians) {
      const elapsed = this.simTime - pedestrian.startTime;
      pedestrian.progress = Math.max(
        0,
        Math.min(1, elapsed / pedestrian.duration),
      );
    }
    this.pedestrians = this.pedestrians.filter(
      (pedestrian) => pedestrian.progress < 1,
    );

    this.maxVehiclesInNetwork = Math.max(
      this.maxVehiclesInNetwork,
      this.cars.length,
    );

    const laneGroups = this.buildLaneGroups();

    const nextKinematics = new Map<
      number,
      { speed: number; distance: number }
    >();

    for (const car of this.cars) {
      const path = ALL_PATHS[car.pathIndex];
      if (!path) continue;

      const { distToLeader, leaderSpeed, leaderLength } =
        this.computeLaneLeader(car, laneGroups);

      // Signal state
      const signalState = this.controller.getSignalState(
        this.simTime,
        car.approach,
        car.movement,
      );
      let isGreen = movementCanProceedOnAspect(
        car.approach,
        car.movement,
        signalState,
      );

      // Conditional front-of-queue left turns:
      // - Phase B allows N-left from detector 1 only when lane-leader
      // - Phase D allows E-left from detector 7 only when lane-leader
      if (
        isGreen &&
        car.movement === "left" &&
        this.isConditionalLeft(car.approach)
      ) {
        isGreen = this.isFrontOfLaneQueue(
          car,
          laneGroups,
          path.stopLineDistance,
        );
      }

      if (
        !isGreen &&
        signalState === "off" &&
        isGapFilteredMovement(car.approach, car.movement)
      ) {
        const phaseIndex = this.controller.getCurrentPhase(this.simTime);
        isGreen = this.canFilterTurnOnGap(
          car,
          laneGroups,
          path.stopLineDistance,
          phaseIndex,
        );
      }

      if (
        isGreen &&
        (car.movement === "left" || car.movement === "right")
      ) {
        isGreen = !this.isTurnBlockedByPedestrians(
          car.approach,
          car.movement,
        );
      }

      // Startup reaction time: when signal transitions to green for a stopped car,
      // each driver has a random personal delay before they begin to move.
      const actualIsGreen = isGreen;
      if (
        actualIsGreen &&
        !car.signalWasGreen &&
        car.speed < 1.0 &&
        car.waitingTimeSeconds > 0.1
      ) {
        car.reactionTimeRemaining = car.startupReactionTime;
      }
      if (car.reactionTimeRemaining > 0) {
        car.reactionTimeRemaining = Math.max(0, car.reactionTimeRemaining - DT);
        isGreen = false;
      }
      car.signalWasGreen = actualIsGreen;

      // Distance to stop line (only relevant if not yet past it)
      const distToStopLine = path.stopLineDistance - car.distance;

      const profile: FollowingProfile = {
        desiredSpeed: car.desiredSpeed,
        maxAcceleration: car.maxAcceleration,
        comfortDeceleration: car.comfortDeceleration,
        standstillGap: car.standstillGap,
        timeHeadway: car.timeHeadway,
      };

      // Compute acceleration
      const accel = computeAcceleration(
        car.speed,
        distToLeader,
        leaderSpeed,
        distToStopLine,
        isGreen,
        profile,
        leaderLength,
      );

      // Update speed and position
      const speed = Math.max(0, car.speed + accel * DT);
      const distance = car.distance + speed * DT;
      nextKinematics.set(car.id, { speed, distance });
    }

    this.enforceLaneSpacing(laneGroups, nextKinematics);

    for (const car of this.cars) {
      const next = nextKinematics.get(car.id);
      if (!next) continue;
      car.speed = next.speed;
      car.distance = next.distance;
    }

    const phaseIndex = this.controller.getCurrentPhase(this.simTime);

    for (const car of this.cars) {
      const path = ALL_PATHS[car.pathIndex];
      if (!path) continue;

      const isWaitingForColor =
        car.distance <= path.stopLineDistance + 2 &&
        car.speed <= WAITING_COLOR_SPEED_THRESHOLD;
      if (isWaitingForColor) {
        car.waitingTimeSeconds += DT;
      }

      const delayIncrement = Math.max(
        0,
        (1 - car.speed / FREE_FLOW_SPEED) * DT,
      );
      this.totalDelay += delayIncrement;
      this.accumulatePhaseDemandDelay(
        phaseIndex,
        car.approach,
        car.movement,
        delayIncrement,
      );

      if (car.distance <= path.stopLineDistance + 2) {
        const laneKey = this.getLaneKey(car);
        this.laneDelaySeconds.set(
          laneKey,
          (this.laneDelaySeconds.get(laneKey) ?? 0) + delayIncrement,
        );
      }

      // Check if car has exited
      if (car.distance >= path.totalLength) {
        car.active = false;
        car.exitTime = this.simTime;

        this.completedCars.push(car);
      }
    }

    // Feed queue observations to adaptive controllers if applicable
    if (
      this.controller instanceof AISignalController ||
      this.controller instanceof LiveScatsController
    ) {
      const observations: Array<{
        approach: Approach;
        lane: number;
        waitingVehicles: number;
      }> = [];
      const approaches: Approach[] = ["N", "S", "E", "W"];
      for (const approach of approaches) {
        for (const lane of [0, 1]) {
          let waiting = 0;
          for (const car of this.cars) {
            const cl = car.movement === "right" ? 1 : 0;
            if (car.approach !== approach || cl !== lane) continue;
            const p = ALL_PATHS[car.pathIndex];
            if (!p) continue;
            if (
              car.distance <= p.stopLineDistance + 2 &&
              car.speed <= WAITING_SPEED_THRESHOLD
            ) {
              waiting++;
            }
          }
          observations.push({ approach, lane, waitingVehicles: waiting });
        }
      }
      this.controller.updateQueues(this.simTime, observations);
    }

    // Remove inactive cars
    this.cars = this.cars.filter((c) => c.active);
  }

  private accumulatePhaseDemandDelay(
    activePhaseIndex: number,
    approach: Approach,
    movement: Movement,
    delayIncrement: number,
  ): void {
    if (delayIncrement <= 0) return;

    let attributed = false;

    for (let p = 0; p < PHASE_DEFINITIONS.length; p++) {
      if (p === activePhaseIndex) continue;
      const servesMovement = PHASE_DEFINITIONS[p].greenMovements.some(
        (gm) => gm.approach === approach && gm.movement === movement,
      );
      if (!servesMovement) continue;

      this.phaseDelaySeconds[p] += delayIncrement;
      attributed = true;
    }

    // Fallback keeps totals stable if movement is not mapped to any non-active phase.
    if (!attributed) {
      this.phaseDelaySeconds[activePhaseIndex] += delayIncrement;
    }
  }

  /** Run multiple ticks */
  advance(numTicks: number): void {
    for (let i = 0; i < numTicks; i++) {
      this.tick();
    }
  }

  /** Get current snapshot for rendering */
  getSnapshot(): SimulationSnapshot {
    const signalStates = new Map<string, SignalState>();
    const approaches: Approach[] = ["N", "S", "E", "W"];
    const movements: Movement[] = ["straight", "left", "right"];
    const laneStats = new Map<
      string,
      { waitingVehicles: number; cumulativeDelayHours: number }
    >();

    for (const approach of approaches) {
      for (const lane of [0, 1]) {
        const laneKey = `${approach}-${lane}`;
        laneStats.set(laneKey, {
          waitingVehicles: 0,
          cumulativeDelayHours:
            (this.laneDelaySeconds.get(laneKey) ?? 0) / 3600,
        });
      }
    }

    for (const a of approaches) {
      for (const m of movements) {
        const key = `${a}-${m}`;
        signalStates.set(
          key,
          this.controller.getSignalState(this.simTime, a, m),
        );
      }
    }

    for (const car of this.cars) {
      const path = ALL_PATHS[car.pathIndex];
      if (!path) continue;

      const isWaiting =
        car.distance <= path.stopLineDistance + 2 &&
        car.speed <= WAITING_SPEED_THRESHOLD;

      if (!isWaiting) continue;

      const laneKey = this.getLaneKey(car);
      const stats = laneStats.get(laneKey);
      if (!stats) continue;
      stats.waitingVehicles += 1;
    }

    return {
      time: this.simTime,
      cars: [...this.cars],
      pedestrians: [...this.pedestrians],
      currentPhase: this.controller.getCurrentPhase(this.simTime),
      fixedSignalProgress:
        this.controller instanceof FixedSignalController
          ? this.controller.getProgressInfo()
          : undefined,
      vehiclesServed: this.completedCars.length,
      pedestriansCrossed: this.pedestriansCrossed,
      totalDelay: this.totalDelay,
      phaseDelaySeconds: [...this.phaseDelaySeconds] as [
        number,
        number,
        number,
        number,
      ],
      signalStates,
      laneStats,
    };
  }

  /** Get final result */
  getResult(): SimulationResult {
    const delays = this.completedCars.map((car) => {
      const path = ALL_PATHS[car.pathIndex];
      const freeFlowTime = path.totalLength / FREE_FLOW_SPEED;
      return Math.max(0, car.exitTime! - car.entryTime - freeFlowTime);
    });

    return {
      totalDelay: this.totalDelay,
      totalDelayHours: this.totalDelay / 3600,
      averageDelay:
        this.vehiclesEntered > 0 ? this.totalDelay / this.vehiclesEntered : 0,
      vehiclesServed: this.completedCars.length,
      vehiclesEntered: this.vehiclesEntered,
      pedestriansCrossed: this.pedestriansCrossed,
      maxVehiclesInNetwork: this.maxVehiclesInNetwork,
      phaseDelaySeconds: [...this.phaseDelaySeconds] as [
        number,
        number,
        number,
        number,
      ],
      vehicleDelays: delays,
    };
  }

  /** Reset the simulation */
  reset(): void {
    this.cars = [];
    this.pedestrians = [];
    this.completedCars = [];
    this.nextArrivalIndex = 0;
    for (const group of PEDESTRIAN_SIGNAL_GROUPS) {
      this.nextRunIndexByGroup.set(group, 0);
    }
    this.nextPedestrianId = 0;
    this.simTime = 0;
    this.totalDelay = 0;
    this.phaseDelaySeconds = [0, 0, 0, 0];
    this.laneDelaySeconds = new Map<string, number>();
    this.vehiclesEntered = 0;
    this.pedestriansCrossed = 0;
    this.maxVehiclesInNetwork = 0;
  }

  private getLaneKey(car: CarState): string {
    const lane = car.movement === "right" ? 1 : 0;
    return `${car.approach}-${lane}`;
  }

  private getSpawnDistance(
    approach: Approach,
    movement: Movement,
    pathIndex: number,
    followerStandstillGap: number,
  ): number {
    const laneKey = `${approach}-${movement === "right" ? 1 : 0}`;
    const path = ALL_PATHS[pathIndex];
    if (!path) return 0;

    let spawnDistance = 0;
    for (const candidate of this.cars) {
      if (this.getLaneKey(candidate) !== laneKey) continue;

      const candidatePath = ALL_PATHS[candidate.pathIndex];
      if (!candidatePath) continue;

      const laneCouplingEnd =
        Math.min(path.stopLineDistance, candidatePath.stopLineDistance) + 2;
      if (candidate.distance >= laneCouplingEnd) continue;

      spawnDistance = Math.min(
        spawnDistance,
        candidate.distance -
          candidate.length -
          followerStandstillGap -
          MIN_VISIBLE_ROAD_GAP,
      );
    }

    return spawnDistance;
  }

  private buildPhaseDemand(): PhaseDemand {
    const phaseDemand: PhaseDemand = [0, 0, 0, 0];

    for (const car of this.cars) {
      const path = ALL_PATHS[car.pathIndex];
      if (!path) continue;

      const isWaiting =
        car.distance <= path.stopLineDistance + 2 &&
        car.speed <= WAITING_SPEED_THRESHOLD;
      if (!isWaiting) continue;

      for (const phaseIndex of phasesUsedByMovement(
        car.approach,
        car.movement,
      )) {
        phaseDemand[phaseIndex] += 1;
      }
    }

    // A queued pedestrian call is phase demand. This prevents a compatible
    // phase from being skipped while a call is waiting to be served.
    for (const [
      signalGroup,
      groupRuns,
    ] of this.pedestrianRunsByGroup.entries()) {
      const nextIndex = this.nextRunIndexByGroup.get(signalGroup) ?? 0;
      for (let i = nextIndex; i < groupRuns.length; i++) {
        const run = groupRuns[i];
        if (!run || run.startTime > this.simTime) break;
        phaseDemand[run.phaseIndex] += 1;
      }
    }

    return phaseDemand;
  }

  private buildLaneGroups(): Map<string, CarState[]> {
    const groups = new Map<string, CarState[]>();

    for (const car of this.cars) {
      const lane = car.movement === "right" ? 1 : 0;
      const key = `${car.approach}-${lane}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(car);
    }

    for (const group of groups.values()) {
      group.sort((a, b) => b.distance - a.distance);
    }

    return groups;
  }

  private computeLaneLeader(
    car: CarState,
    laneGroups: Map<string, CarState[]>,
  ): { distToLeader: number; leaderSpeed: number; leaderLength: number } {
    const lane = car.movement === "right" ? 1 : 0;
    const key = `${car.approach}-${lane}`;
    const group = laneGroups.get(key);
    if (!group)
      return { distToLeader: Infinity, leaderSpeed: 0, leaderLength: 0 };

    const path = ALL_PATHS[car.pathIndex];
    if (!path)
      return { distToLeader: Infinity, leaderSpeed: 0, leaderLength: 0 };

    // Shared-lane following is enforced through the full approach queue region.
    const laneCouplingEnd = path.stopLineDistance + 2;

    for (const candidate of group) {
      if (candidate.id === car.id) continue;
      if (candidate.distance <= car.distance) break;
      if (
        car.distance < laneCouplingEnd &&
        candidate.distance < laneCouplingEnd
      ) {
        return {
          distToLeader: candidate.distance - car.distance,
          leaderSpeed: candidate.speed,
          leaderLength: candidate.length,
        };
      }
    }

    return { distToLeader: Infinity, leaderSpeed: 0, leaderLength: 0 };
  }

  private isConditionalLeft(approach: Approach): boolean {
    return approach === "N" || approach === "E";
  }

  private opposingApproach(approach: Approach): Approach {
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

  private canFilterTurnOnGap(
    car: CarState,
    laneGroups: Map<string, CarState[]>,
    stopLineDistance: number,
    phaseIndex: number,
  ): boolean {
    if (!phaseAllowsFilterTurn(phaseIndex, car.approach, car.movement)) {
      return false;
    }

    const distToStopLine = stopLineDistance - car.distance;
    if (distToStopLine < -2 || distToStopLine > 25) return false;

    if (!this.isFrontOfLaneQueue(car, laneGroups, stopLineDistance))
      return false;

    const opposing = this.opposingApproach(car.approach);
    const opposingLaneKey = `${opposing}-0`;
    const opposingLane = laneGroups.get(opposingLaneKey) ?? [];

    for (const conflictCar of opposingLane) {
      const conflictPath = ALL_PATHS[conflictCar.pathIndex];
      if (!conflictPath) continue;

      const conflictStopLine = conflictPath.stopLineDistance;
      const conflictDistToStop = conflictStopLine - conflictCar.distance;

      if (conflictDistToStop < -2) {
        const inIntersectionDistance = conflictCar.distance - conflictStopLine;
        if (inIntersectionDistance <= FILTER_TURN_INTERSECTION_BLOCK) {
          return false;
        }
        continue;
      }

      if (conflictDistToStop > FILTER_TURN_LOOKAHEAD) continue;
      if (conflictCar.speed <= 0.5) continue;

      const timeToConflict =
        conflictDistToStop / Math.max(2, conflictCar.speed);
      if (timeToConflict >= 0 && timeToConflict < FILTER_TURN_REQUIRED_GAP) {
        return false;
      }
    }

    return true;
  }

  private isFrontOfLaneQueue(
    car: CarState,
    laneGroups: Map<string, CarState[]>,
    stopLineDistance: number,
  ): boolean {
    const lane = car.movement === "right" ? 1 : 0;
    const key = `${car.approach}-${lane}`;
    const group = laneGroups.get(key);
    if (!group || group.length === 0) return false;

    // Queue relevance region: from upstream to just before/at stop line.
    const relevantCars = group.filter(
      (c) => c.distance <= stopLineDistance + 2,
    );
    if (relevantCars.length === 0) return false;

    return relevantCars[0].id === car.id;
  }

  private isTurnBlockedByPedestrians(
    approach: Approach,
    movement: "left" | "right",
  ): boolean {
    const conflictingGroup = conflictingTurnGroup(approach, movement);
    const conflictingPedestrians = this.pedestrians.filter(
      (pedestrian) => pedestrian.signalGroup === conflictingGroup,
    );
    return conflictingPedestrians.length > 0;
  }

  private enforceLaneSpacing(
    laneGroups: Map<string, CarState[]>,
    nextKinematics: Map<number, { speed: number; distance: number }>,
  ): void {
    for (const group of laneGroups.values()) {
      if (group.length < 2) continue;

      for (let i = 1; i < group.length; i++) {
        const leader = group[i - 1];
        const follower = group[i];
        const leaderNext = nextKinematics.get(leader.id);
        const followerNext = nextKinematics.get(follower.id);
        if (!leaderNext || !followerNext) continue;

        const leaderPath = ALL_PATHS[leader.pathIndex];
        const followerPath = ALL_PATHS[follower.pathIndex];
        if (!leaderPath || !followerPath) continue;

        const laneCouplingEnd =
          Math.min(leaderPath.stopLineDistance, followerPath.stopLineDistance) +
          2;

        if (
          leader.distance >= laneCouplingEnd ||
          follower.distance >= laneCouplingEnd
        ) {
          continue;
        }

        const standstillQueueGap =
          leader.length + follower.standstillGap + MIN_VISIBLE_ROAD_GAP;
        const dynamicGap =
          leader.length +
          follower.standstillGap +
          follower.timeHeadway * Math.max(0, followerNext.speed) +
          MIN_VISIBLE_ROAD_GAP;
        const desiredGap = Math.max(standstillQueueGap, dynamicGap);
        const maxFollowerDistance = leaderNext.distance - desiredGap;

        if (followerNext.distance > maxFollowerDistance) {
          const cappedDistance = Math.max(
            follower.distance,
            maxFollowerDistance,
          );
          const allowedTravel = Math.max(
            0,
            (cappedDistance - follower.distance) / DT,
          );
          followerNext.distance = cappedDistance;
          followerNext.speed = Math.min(followerNext.speed, allowedTravel);
        }
      }
    }
  }

  private createVehicleTraits(
    id: number,
    detectorId: number,
  ): {
    length: number;
    standstillGap: number;
    timeHeadway: number;
    desiredSpeed: number;
    maxAcceleration: number;
    comfortDeceleration: number;
    startupReactionTime: number;
  } {
    return {
      length: this.scaleFromNoise(id, 1, 4.1, 5.8),
      standstillGap: this.scaleFromNoise(id, 2, 1.5, 5.5),
      timeHeadway: this.calibratedTimeHeadway(id, detectorId),
      desiredSpeed: this.scaleFromNoise(
        id,
        4,
        FREE_FLOW_SPEED * 0.9,
        FREE_FLOW_SPEED * 1.08,
      ),
      maxAcceleration: this.scaleFromNoise(id, 5, 1.6, 3.2),
      comfortDeceleration: this.scaleFromNoise(id, 6, 3.8, 5.5),
      startupReactionTime: this.scaleFromNoise(id, 7, 0.8, 2.2),
    };
  }

  private calibratedTimeHeadway(id: number, detectorId: number): number {
    if (!this.detectorCalibration) {
      return this.scaleFromNoise(id, 3, 1.6, 2.6);
    }

    const calibration =
      this.detectorCalibration.byDetector.get(detectorId) ??
      this.detectorCalibration.fallback;
    const driverVariation = this.scaleFromNoise(id, 3, 0.88, 1.12);
    return Math.max(
      0.7,
      Math.min(2.8, calibration.targetTimeHeadwaySeconds * driverVariation),
    );
  }

  private scaleFromNoise(
    id: number,
    salt: number,
    min: number,
    max: number,
  ): number {
    return min + (max - min) * this.unitNoise(id, salt);
  }

  private unitNoise(id: number, salt: number): number {
    const value = Math.sin((id + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }
}

export { DT };
