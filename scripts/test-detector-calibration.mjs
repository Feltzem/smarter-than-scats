import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildDetectorCalibration } from "../src/simulation/detectorCalibration.ts";

const synthetic = buildDetectorCalibration([
  {
    startTime: 0,
    endTime: 300,
    detectorId: 1,
    count: 10,
    metrics: [
      {
        collectionType: "type-3",
        count: 10,
        occupancy: 150,
        green: 30,
        gap: 20,
        degreeOfSaturation: 100,
      },
      {
        collectionType: "type-4",
        count: 10,
        green: 30,
        gap: 20,
        degreeOfSaturation: 100,
      },
    ],
  },
]);

assert.ok(synthetic);
const syntheticDetector = synthetic.byDetector.get(1);
assert.ok(syntheticDetector);
assert.equal(syntheticDetector.detectorOccupancySeconds, 1.5);
assert.equal(syntheticDetector.saturationSpaceTimeSeconds, 1.5);
assert.equal(syntheticDetector.degreeOfSaturation, 1);
assert.equal(syntheticDetector.targetTimeHeadwaySeconds, 1.5);

const data = JSON.parse(
  await readFile("public/data/36_20260225.json", "utf8"),
);

for (const [periodName, periodData] of Object.entries(data.periods)) {
  const profile = buildDetectorCalibration(periodData.detectorIntervals);
  assert.ok(profile, `${periodName} should have a detector calibration`);
  assert.equal(profile.byDetector.size, 8);

  const headways = [...profile.byDetector.values()].map(
    (value) => value.targetTimeHeadwaySeconds,
  );
  assert.ok(
    headways.every((value) => value >= 0.8 && value <= 2.4),
    `${periodName} headways should remain within calibrated safety bounds`,
  );
  assert.ok(
    new Set(headways.map((value) => value.toFixed(2))).size >= 4,
    `${periodName} should retain detector-specific calibration`,
  );
  assert.ok(
    [...profile.byDetector.values()].every((value) => value.sampleCount > 0),
    `${periodName} should use type-3/type-4 samples for every detector`,
  );
}

console.log("Detector calibration tests passed");
