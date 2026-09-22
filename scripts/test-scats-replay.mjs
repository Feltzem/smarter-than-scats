import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SimulationEngine } from "../src/simulation/engine.ts";
import { ScatsReplayController } from "../src/simulation/scatsReplayController.ts";
import { FixedSignalController } from "../src/simulation/signalController.ts";
import { buildDetectorCalibration } from "../src/simulation/detectorCalibration.ts";

const data = JSON.parse(await readFile("public/data/36_20260225.json", "utf8"));
const SIMULATION_TICKS = 36_000;
const DEFAULT_USER_GREENS = [10, 20, 10, 20];

function run(periodData, controller) {
  const detectorCalibration = buildDetectorCalibration(
    periodData.detectorIntervals,
  );
  const engine = new SimulationEngine(
    periodData.arrivals,
    controller,
    periodData.pedestrianRuns ?? [],
    detectorCalibration ?? undefined,
  );
  for (let tick = 0; tick < SIMULATION_TICKS; tick++) {
    engine.tick();
  }
  return engine.getResult();
}

const comparisons = [];
for (const periodName of ["AM", "SCHOOL", "PM"]) {
  const periodData = data.periods[periodName];
  const replay = run(
    periodData,
    new ScatsReplayController(
      periodData.scatsPhaseTimeline,
      periodData.scatsCycles,
      periodData.signalGroupTransitions,
    ),
  );
  const fixed = run(
    periodData,
    new FixedSignalController({ greens: DEFAULT_USER_GREENS }),
  );
  const servedFraction = replay.vehiclesServed / periodData.arrivals.length;

  assert.equal(
    replay.vehiclesEntered,
    periodData.arrivals.length,
    `${periodName} replay should admit every scheduled arrival`,
  );
  assert.ok(
    servedFraction >= 0.95,
    `${periodName} replay served only ${(servedFraction * 100).toFixed(1)}% by 3600 seconds`,
  );
  assert.ok(
    replay.maxVehiclesInNetwork < 100,
    `${periodName} replay network population reached ${replay.maxVehiclesInNetwork}`,
  );
  assert.ok(
    replay.averageDelay < 60,
    `${periodName} replay average delay reached ${replay.averageDelay.toFixed(1)} seconds`,
  );

  comparisons.push({
    period: periodName,
    scatsAverageDelay: replay.averageDelay.toFixed(1),
    scatsServed: `${replay.vehiclesServed}/${replay.vehiclesEntered}`,
    scatsMaxNetwork: replay.maxVehiclesInNetwork,
    defaultAverageDelay: fixed.averageDelay.toFixed(1),
    defaultServed: `${fixed.vehiclesServed}/${fixed.vehiclesEntered}`,
  });
}

console.table(comparisons);
console.log("Full-hour SCATS replay regressions passed");
