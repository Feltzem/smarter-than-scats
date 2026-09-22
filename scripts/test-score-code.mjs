import assert from "node:assert/strict";
import {
  buildScorePayload,
  buildScoreVerificationCode,
  verifyScoreVerificationCode,
} from "../src/scoring/scoreCode.ts";

const input = {
  period: "AM",
  phaseConfig: { greens: [10, 20, 10, 40], interGreen: 5 },
  trafficDivisor: 50,
  result: {
    totalDelay: 12345.4,
    totalDelayHours: 3.429,
    averageDelay: 28.74,
    vehiclesEntered: 512,
    vehiclesServed: 508,
    pedestriansCrossed: 44,
    maxVehiclesInNetwork: 31,
    phaseDelaySeconds: [120.2, 340.5, 89.6, 220.4],
    vehicleDelays: [],
  },
};

const expectedPayload =
  "STS2|S=site36-cis-3d|P=AM|G=10201040|IG=CIS3D|DIV=50|TD=12345|AD=287|VE=512|VS=508|PED=44|MAX=31|PD=120,341,90,220";
const expectedCode = `${expectedPayload}|CHK=E26D984A6F0F`;

assert.equal(buildScorePayload(input), expectedPayload);
assert.equal(buildScoreVerificationCode(input), expectedCode);
assert.equal(verifyScoreVerificationCode(expectedCode), true);
assert.equal(
  verifyScoreVerificationCode(
    "STS1|S=site36-v1|P=AM|G=10201040|IG=05|DIV=50|TD=12345|AD=287|VE=512|VS=508|PED=44|MAX=31|PD=120,341,90,220|CHK=59E8B0866CD0",
  ),
  true,
);

assert.notEqual(
  buildScoreVerificationCode({
    ...input,
    phaseConfig: { greens: [10, 20, 15, 40], interGreen: 5 },
  }),
  expectedCode,
);
assert.notEqual(
  buildScoreVerificationCode({
    ...input,
    result: { ...input.result, totalDelay: 12346 },
  }),
  expectedCode,
);
assert.notEqual(
  buildScoreVerificationCode({
    ...input,
    trafficDivisor: 1,
  }),
  expectedCode,
);

assert.equal(verifyScoreVerificationCode(expectedCode.replace("TD=12345", "TD=12346")), false);
assert.equal(verifyScoreVerificationCode(expectedPayload), false);
assert.equal(verifyScoreVerificationCode(expectedCode.replace("STS2", "STS0")), false);

console.log("score code tests passed");
