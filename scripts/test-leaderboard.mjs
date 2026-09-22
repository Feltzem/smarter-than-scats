import assert from "node:assert/strict";
import {
  createLeaderboardEntry,
  leaderboardToCsv,
  loadLeaderboard,
  normalizeLeaderboardName,
  sortLeaderboard,
} from "../src/scoring/leaderboard.ts";

const result = {
  totalDelay: 1234.5,
  totalDelayHours: 0.343,
  averageDelay: 12.3,
  vehiclesEntered: 120,
  vehiclesServed: 118,
  pedestriansCrossed: 14,
  maxVehiclesInNetwork: 23,
  phaseDelaySeconds: [120.2, 340.5, 89.6, 220.4],
  vehicleDelays: [],
};

assert.equal(normalizeLeaderboardName("  Ada   Lovelace  "), "Ada Lovelace");
assert.equal(normalizeLeaderboardName(" "), "");

const slower = createLeaderboardEntry({
  name: "Slow, Runner",
  period: "PM",
  phaseGreens: [20, 30, 20, 30],
  result: { ...result, totalDelay: 1500 },
  scoreCode: "slow-code",
  createdAt: "2026-09-22T10:00:00.000Z",
});
const faster = createLeaderboardEntry({
  name: "Ada",
  period: "AM",
  phaseGreens: [10, 20, 10, 20],
  result,
  scoreCode: "fast-code",
  createdAt: "2026-09-22T11:00:00.000Z",
});

assert.deepEqual(sortLeaderboard([slower, faster]), [faster, slower]);
assert.deepEqual(loadLeaderboard(), []);

const csv = leaderboardToCsv([slower, faster]);
assert.match(csv, /^rank,name,period,total_delay_seconds/m);
assert.match(csv, /1,Ada,AM,1234\.5/);
assert.match(csv, /"Slow, Runner",PM,1500/);
assert.match(csv, /fast-code/);

console.log("leaderboard tests passed");