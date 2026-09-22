import type { Arrival, PeriodData, Approach, Movement } from './types';

/**
 * Generate synthetic arrival data using a Poisson process.
 * Used when no real SCATS data is available.
 */
function poissonArrivals(
  rate: number, // vehicles per second
  duration: number, // seconds
  startTime: number,
  approach: Approach,
  id_offset: number
): Arrival[] {
  const arrivals: Arrival[] = [];
  let t = startTime;
  let id = id_offset;

  while (t < startTime + duration) {
    const u = Math.random();
    const interArrival = -Math.log(u) / rate;
    t += interArrival;
    if (t >= startTime + duration) break;

    const movementRoll = Math.random();
    let movement: Movement;
    if (movementRoll < 0.65) movement = 'straight';
    else if (movementRoll < 0.85) movement = 'left';
    else movement = 'right';

      arrivals.push({
      id: id++,
      time: t - startTime, // relative to period start
      approach,
      movement,
        lane: movement === 'right' ? 1 : 0,
        detectorId: movement === 'right' ? 2 : 1,
    });
  }
  return arrivals;
}

/**
 * Generate a full period of synthetic arrivals.
 * Rates are vehicles per hour per approach.
 */
export function generateSyntheticPeriod(
  label: string,
  durationMinutes: number,
  rates: Record<Approach, number> // veh/hour per approach
): PeriodData {
  const duration = durationMinutes * 60;
  let allArrivals: Arrival[] = [];
  let idCounter = 0;

  const approaches: Approach[] = ['N', 'S', 'E', 'W'];
  for (const approach of approaches) {
    const ratePerSecond = rates[approach] / 3600;
    const newArrivals = poissonArrivals(ratePerSecond, duration, 0, approach, idCounter);
    allArrivals = allArrivals.concat(newArrivals);
    idCounter += newArrivals.length + 1;
  }

  // Sort by time
  allArrivals.sort((a, b) => a.time - b.time);

  // Re-assign sequential IDs
  allArrivals.forEach((a, i) => (a.id = i));

  return {
    label,
    startTime: 0,
    endTime: duration,
    arrivals: allArrivals,
    scatsCycles: [], // No SCATS data
    detectorIntervals: [],
    detectorMetrics: [],
    signalGroupTransitions: [],
    pedestrianDemands: [],
    pedestrianSignalTransitions: [],
  };
}

/** Default synthetic data for demo mode */
export function getDefaultPeriods(): Record<string, PeriodData> {
  return {
    AM: generateSyntheticPeriod('AM Peak', 15, {
      N: 600, S: 500, E: 400, W: 350,
    }),
    SCHOOL: generateSyntheticPeriod('School', 15, {
      N: 300, S: 350, E: 500, W: 450,
    }),
    PM: generateSyntheticPeriod('PM Peak', 15, {
      N: 500, S: 600, E: 350, W: 400,
    }),
  };
}
