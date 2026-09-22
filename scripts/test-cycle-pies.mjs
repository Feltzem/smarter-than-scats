import assert from "node:assert/strict";

import {
  buildPieSlicePath,
  getFixedCycleHandTime,
  getPhaseBlockDurations,
  getUnwrappedCycleHandAngle,
} from "../src/components/cyclePieMath.ts";

const geometry = { center: 66, radius: 52 };

const overHalfCircle = buildPieSlicePath(-90, 183, geometry);
assert.equal(
  (overHalfCircle.match(/ A /g) ?? []).length,
  2,
  "a sweep over 180 degrees should be split into two stable arcs",
);
assert.doesNotMatch(overHalfCircle, / A [^ ]+ [^ ]+ 0 1 /);

const fullCircle = buildPieSlicePath(-90, 360, geometry);
assert.equal(
  (fullCircle.match(/ A /g) ?? []).length,
  2,
  "a full circle should use two semicircular arcs",
);
assert.equal(buildPieSlicePath(-90, 0, geometry), "");

const endOfCycle = getUnwrappedCycleHandAngle(34, 50, 50);
const startOfNextCycle = getUnwrappedCycleHandAngle(35, 0, 50);
assert.equal(endOfCycle, startOfNextCycle);
assert.ok(
  getUnwrappedCycleHandAngle(35, 1, 50) > endOfCycle,
  "the hand should continue forwards after wrapping into the next cycle",
);

const greens = [15, 20, 15, 20];
const interGreens = [8, 8, 8, 8];
assert.deepEqual(getPhaseBlockDurations(greens, interGreens), [23, 28, 23, 28]);
assert.equal(
  getFixedCycleHandTime(greens, interGreens, {
    currentPhase: 0,
    phaseElapsed: 15,
    interGreenElapsed: 3,
    inInterGreen: true,
    isIdle: false,
  }),
  18,
  "the player hand should keep advancing during inter-green",
);
assert.equal(
  getFixedCycleHandTime(greens, interGreens, {
    currentPhase: 1,
    phaseElapsed: 2,
    interGreenElapsed: 0,
    inInterGreen: false,
    isIdle: false,
  }),
  25,
  "the next phase should continue from the preceding phase block",
);

console.log("Cycle pie geometry checks passed");
