import assert from "node:assert/strict";

import { assignVehicle, VEHICLE_CATALOG } from "../src/vehicles/catalog.ts";
import { SimulationEngine } from "../src/simulation/engine.ts";
import { FixedSignalController } from "../src/simulation/signalController.ts";
import {
  getWorldPositionOnPath,
  getPositionOnPath,
  pathPointToWorld,
  ALL_PATHS,
  WORLD_PIXELS_PER_METRE,
} from "../src/simulation/paths.ts";

assert.equal(
  VEHICLE_CATALOG.reduce((total, entry) => total + entry.weight, 0),
  100,
);

const first = assignVehicle(42);
assert.deepEqual(assignVehicle(42), first);
assert.ok(
  ["hatchback", "sedan", "ute", "truck", "bus"].includes(
    first.definition.vehicleClass,
  ),
);
assert.ok(first.definition.dimensions.length > 0);
assert.ok(first.paintColor.startsWith("#"));

const classCounts = new Map();
for (let id = 0; id < 10000; id++) {
  const vehicleClass = assignVehicle(id).definition.vehicleClass;
  classCounts.set(vehicleClass, (classCounts.get(vehicleClass) ?? 0) + 1);
}
assert.ok((classCounts.get("hatchback") ?? 0) > 2800);
assert.ok((classCounts.get("hatchback") ?? 0) < 3600);
assert.ok((classCounts.get("sedan") ?? 0) > 2600);
assert.ok((classCounts.get("sedan") ?? 0) < 3400);
assert.ok((classCounts.get("bus") ?? 0) > 500);
assert.ok((classCounts.get("bus") ?? 0) < 1100);

assert.deepEqual(pathPointToWorld({ x: 400, y: 400 }), { x: 0, z: 0 });
assert.deepEqual(pathPointToWorld({ x: 450, y: 350 }), { x: 10, z: -10 });

const worldPosition = getWorldPositionOnPath(ALL_PATHS[0], 0);
assert.ok(Number.isFinite(worldPosition.x));
assert.ok(Number.isFinite(worldPosition.z));
assert.ok(Number.isFinite(worldPosition.heading));

const straightPath = ALL_PATHS.find(
  (path) => path.approach === "N" && path.movement === "straight",
);
assert.ok(straightPath);
assert.ok(Math.abs(straightPath.totalLength - 140) < 0.001);
assert.ok(Math.abs(straightPath.stopLineDistance - 58.8) < 0.001);
const entryPoint = getPositionOnPath(straightPath, 0);
const oneMetrePoint = getPositionOnPath(straightPath, 1);
assert.ok(
  Math.abs(
    Math.hypot(oneMetrePoint.x - entryPoint.x, oneMetrePoint.y - entryPoint.y) -
      WORLD_PIXELS_PER_METRE,
  ) < 0.001,
);

const queueEngine = new SimulationEngine(
  [
    {
      id: 1,
      time: 0,
      approach: "N",
      movement: "straight",
      lane: 0,
      detectorId: 1,
    },
    {
      id: 2,
      time: 0,
      approach: "N",
      movement: "straight",
      lane: 0,
      detectorId: 1,
    },
  ],
  new FixedSignalController({ greens: [10, 20, 10, 20] }),
);
queueEngine.tick();
const queuedCars = queueEngine
  .getSnapshot()
  .cars.sort((a, b) => b.distance - a.distance);
assert.equal(queuedCars.length, 2);
assert.ok(
  queuedCars[0].distance - queuedCars[1].distance >=
    queuedCars[0].length + queuedCars[1].standstillGap + 1.5 - 0.001,
);

const motionEngine = new SimulationEngine(
  Array.from({ length: 40 }, (_, id) => ({
    id,
    time: id * 0.7,
    approach: "N",
    movement: "straight",
    lane: 0,
    detectorId: 1,
  })),
  new FixedSignalController({ greens: [10, 20, 10, 20] }),
);
const previousDistances = new Map();
let backwardMoves = 0;
let spacingViolations = 0;
const observedQueueGaps = [];
for (let tick = 0; tick < 900; tick++) {
  motionEngine.tick();
  const snapshot = motionEngine.getSnapshot();
  const motionCars = snapshot.cars
    .filter((car) => car.approach === "N" && car.movement === "straight")
    .sort((a, b) => b.distance - a.distance);
  for (const car of motionCars) {
    const previousDistance = previousDistances.get(car.id);
    if (previousDistance !== undefined && car.distance < previousDistance) {
      backwardMoves++;
    }
    previousDistances.set(car.id, car.distance);
  }
  for (let index = 1; index < motionCars.length; index++) {
    const leader = motionCars[index - 1];
    const follower = motionCars[index];
    if (leader.distance >= 60.8 || follower.distance >= 60.8) continue;

    const gap = leader.distance - follower.distance;
    const minimumGap = leader.length + follower.standstillGap + 1.5;
    if (gap < minimumGap - 0.001) spacingViolations++;
    observedQueueGaps.push(gap);
  }
}
assert.equal(backwardMoves, 0);
assert.equal(spacingViolations, 0);
assert.ok(
  observedQueueGaps.some((gap) => Math.abs(gap - observedQueueGaps[0]) > 0.01),
);

console.log("vehicle catalog and path transform tests passed");
