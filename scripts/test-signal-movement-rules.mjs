import assert from "node:assert/strict";

import { SITE36_CONFIGURATION } from "../src/data/site36Configuration.ts";
import {
  getSignalGroupForMovement,
  isGapFilteredMovement,
  movementCanProceedOnAspect,
  phaseAllowsFilterTurn,
} from "../src/simulation/signalController.ts";

const protectedLefts = [
  ["E", 9],
  ["W", 10],
  ["S", 11],
  ["N", 12],
];

for (const [approach, signalGroup] of protectedLefts) {
  assert.equal(getSignalGroupForMovement(approach, "left"), signalGroup);
  assert.equal(
    SITE36_CONFIGURATION.movementRules[`${signalGroup}:left`],
    "permissive",
  );
  assert.equal(movementCanProceedOnAspect(approach, "left", "off"), true);
  assert.equal(movementCanProceedOnAspect(approach, "left", "green"), true);
  assert.equal(movementCanProceedOnAspect(approach, "left", "red"), false);
  assert.equal(movementCanProceedOnAspect(approach, "left", "yellow"), false);
}

for (const [approach, signalGroup] of [["E", 3], ["S", 7]]) {
  assert.equal(getSignalGroupForMovement(approach, "right"), signalGroup);
  assert.equal(movementCanProceedOnAspect(approach, "right", "off"), true);
  assert.equal(isGapFilteredMovement(approach, "right"), false);
}

for (const [approach, signalGroup] of [["N", 8], ["W", 4]]) {
  assert.equal(getSignalGroupForMovement(approach, "right"), signalGroup);
  assert.equal(isGapFilteredMovement(approach, "right"), true);
  assert.equal(movementCanProceedOnAspect(approach, "right", "off"), false);
  assert.equal(movementCanProceedOnAspect(approach, "right", "red"), false);
  assert.equal(movementCanProceedOnAspect(approach, "right", "yellow"), false);
}

assert.equal(phaseAllowsFilterTurn(0, "N", "right"), true);
assert.equal(phaseAllowsFilterTurn(2, "N", "right"), false);
assert.equal(phaseAllowsFilterTurn(2, "W", "right"), true);
assert.equal(phaseAllowsFilterTurn(0, "W", "right"), false);
assert.equal(phaseAllowsFilterTurn(3, "S", "right"), false);

console.log("Site 36 movement-rule checks passed");
