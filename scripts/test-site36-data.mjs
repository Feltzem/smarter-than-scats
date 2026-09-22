import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile("public/data/36_20260225.json", "utf8"));
const expected = {
  AM: [242, 22, 245, 23, 203, 53, 409, 74],
  SCHOOL: [241, 27, 250, 25, 196, 54, 267, 61],
  PM: [273, 26, 246, 25, 267, 31, 242, 54],
};

assert.equal(data.siteConfiguration.siteId, "36");
assert.equal(data.siteConfiguration.cisVersion, "3d");
assert.deepEqual(data.siteConfiguration.maximumGreen, [40, 20, 40, 20]);
assert.deepEqual(data.siteConfiguration.allRed, [1.5, 2, 2, 1.5]);
assert.equal(data.sourceMetadata.decoderRevision, "site36-raw-decoder-2");
assert.deepEqual(data.siteConfiguration.movementRules, {
  "8:right": "gap-filtered",
  "4:right": "gap-filtered",
  "3:right": "permissive",
  "7:right": "permissive",
  "9:left": "permissive",
  "10:left": "permissive",
  "11:left": "permissive",
  "12:left": "permissive",
});
assert.deepEqual(
  data.sourceMetadata.sourceFiles.map(({ name }) => name),
  [
    "HCC_20260225.hst",
    "HCC_20260225.hist",
    "HCC_20260225.det",
    "Site 36 Naylor Galloway CIS V3d.xlsx",
  ],
);
assert.equal(data.sourceMetadata.extractionCounts.phaseTerminations, 3586);
assert.equal(data.sourceMetadata.extractionCounts.hstPhaseTerminations, 3586);
assert.equal(data.sourceMetadata.extractionCounts.histPhaseTerminations, 3586);
assert.equal(data.sourceMetadata.extractionCounts.detectorType9Records, 4376);
assert.equal(data.sourceMetadata.validation.hstHistOrder, true);
assert.equal(data.sourceMetadata.validation.histWithinOneSecond, true);

for (const [period, totals] of Object.entries(expected)) {
  const periodData = data.periods[period];
  const rows = periodData.detectorIntervals;
  const actual = Array.from({ length: 8 }, (_, detector) =>
    rows
      .filter((row) => row.detectorId === detector + 1)
      .reduce((sum, row) => sum + row.count, 0),
  );
  assert.deepEqual(actual, totals, `${period} detector totals`);
  assert.equal(periodData.arrivals.length, totals.reduce((a, b) => a + b, 0));
  assert.ok(periodData.arrivals.every((arrival) => arrival.detectorId >= 1));
  assert.ok(periodData.scatsPhaseTimeline.length > 0);
  assert.ok(periodData.signalGroupTransitions.length > 16);
  assert.ok(periodData.detectorMetrics.some((metric) => metric.collectionType === "type-3"));
  assert.ok(periodData.detectorMetrics.some((metric) => metric.collectionType === "type-4"));

  const timelines = new Map();
  for (let group = 1; group <= 16; group++) {
    const transitions = periodData.signalGroupTransitions.filter(
      (row) => row.signalGroup === group,
    );
    assert.equal(
      transitions.filter((row) => row.time === 0).length,
      1,
      `${period} signal group ${group} has one time-zero snapshot`,
    );
    for (let index = 1; index < transitions.length; index++) {
      assert.notEqual(
        transitions[index].aspect,
        transitions[index - 1].aspect,
        `${period} signal group ${group} has no unchanged transition`,
      );
    }
    timelines.set(group, transitions);
  }

  const stateAt = (group, time) => {
    let state = "off";
    for (const transition of timelines.get(group)) {
      if (transition.time > time) break;
      state = transition.aspect;
    }
    return state;
  };
  const classifyPhase = (time) => {
    const group1 = stateAt(1, time) === "green";
    const group2 = stateAt(2, time) === "green";
    const group5 = stateAt(5, time) === "green";
    const group6 = stateAt(6, time) === "green";
    if (group5 && group6) return "A";
    if (group1 && group2) return "C";
    if (group1) return "B";
    if (group5) return "D";
    return null;
  };

  let classifiable = 0;
  let matching = 0;
  for (const phase of periodData.scatsPhaseTimeline) {
    // A clipped boundary fragment no longer contains the midpoint of its
    // original termination interval, so its clipped midpoint is not a valid
    // phase classifier. The complete interior intervals are authoritative.
    if (
      phase.startTime === 0 ||
      phase.startTime + phase.duration === 3600
    ) {
      continue;
    }
    const midpoint = phase.startTime + phase.duration / 2;
    const recordedPhase = classifyPhase(midpoint);
    if (recordedPhase === null) continue;
    classifiable++;
    if (recordedPhase === phase.phase) matching++;
  }
  assert.ok(classifiable > 0, `${period} has classifiable phase events`);
  assert.equal(
    matching,
    classifiable,
    `${period} phase labels agree with primary signal groups at every classifiable midpoint`,
  );

  const phases = periodData.scatsPhaseTimeline;
  assert.equal(phases[0].startTime, 0, `${period} phase timeline is clipped at period start`);
  assert.equal(
    phases.at(-1).startTime + phases.at(-1).duration,
    3600,
    `${period} phase timeline is clipped at period end`,
  );
  for (let index = 1; index < phases.length; index++) {
    assert.equal(
      phases[index - 1].startTime + phases[index - 1].duration,
      phases[index].startTime,
      `${period} phase timeline is contiguous`,
    );
  }

  console.log(`${period}: ${matching}/${classifiable} phase midpoints agree`);
}

console.log("Site 36 data tests passed");
