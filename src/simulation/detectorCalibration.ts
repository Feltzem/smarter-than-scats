import type { DetectorCollectionMetrics, DetectorInterval } from "../data/types";

// DET type-3/type-4 time fields are stored in deciseconds, except green time.
const DET_TIME_UNIT_SECONDS = 0.1;
const MIN_SPACE_TIME_SECONDS = 0.2;
const MAX_SPACE_TIME_SECONDS = 4;
const MIN_HEADWAY_SECONDS = 0.8;
const MAX_HEADWAY_SECONDS = 2.4;
const DEFAULT_DETECTOR_OCCUPANCY_SECONDS = 1.3;

export interface DetectorFlowCalibration {
  detectorId: number;
  targetTimeHeadwaySeconds: number;
  saturationSpaceTimeSeconds: number;
  observedGapSeconds: number;
  detectorOccupancySeconds: number;
  greenSeconds: number;
  degreeOfSaturation: number;
  sampleCount: number;
}

export interface DetectorCalibrationProfile {
  byDetector: ReadonlyMap<number, DetectorFlowCalibration>;
  fallback: DetectorFlowCalibration;
}

/**
 * Build a site-flow profile from SCATS detector observations.
 *
 * Type-3 `occupancy` is the raw DET non-occupancy value (legacy field name),
 * stored in deciseconds. SCATS DS expresses effectively-used green as a
 * percentage, so the optimum detector space-time is:
 *
 *   t = (DS * green - green + nonOccupancy) / count
 *
 * Type-4 calibrated DS provides a second estimate after subtracting the
 * detector occupancy time learned from type-3. The observed terminal gap is
 * used only as a small low-DS correction; it is not treated as a saturation
 * headway.
 */
export function buildDetectorCalibration(
  intervals: DetectorInterval[],
): DetectorCalibrationProfile | null {
  const candidates: DetectorFlowCalibration[] = [];

  for (let detectorId = 1; detectorId <= 8; detectorId++) {
    const metrics = intervals
      .filter((interval) => interval.detectorId === detectorId)
      .flatMap((interval) => interval.metrics);
    const calibration = calibrateDetector(detectorId, metrics);
    if (calibration) candidates.push(calibration);
  }

  if (candidates.length === 0) return null;

  const fallback = combineCalibrations(0, candidates);
  return {
    byDetector: new Map(
      candidates.map((calibration) => [
        calibration.detectorId,
        calibration,
      ]),
    ),
    fallback,
  };
}

function calibrateDetector(
  detectorId: number,
  metrics: DetectorCollectionMetrics[],
): DetectorFlowCalibration | null {
  const type3 = metrics.filter(
    (metric) => metric.collectionType === "type-3",
  );
  const type4 = metrics.filter(
    (metric) => metric.collectionType === "type-4",
  );

  const detectorOccupancySamples: number[] = [];
  const type3SpaceTimeSamples: number[] = [];

  for (const metric of type3) {
    const count = metric.count;
    const green = metric.green;
    const rawNonOccupancy = metric.occupancy;
    const rawDs = metric.degreeOfSaturation;
    if (
      count <= 0 ||
      !isPositiveFinite(green) ||
      !isFiniteNumber(rawNonOccupancy) ||
      !isPositiveFinite(rawDs)
    ) {
      continue;
    }

    const nonOccupancy = rawNonOccupancy * DET_TIME_UNIT_SECONDS;
    const ds = rawDs / 100;
    const detectorOccupancy = (green - nonOccupancy) / count;
    const optimumSpaceTime =
      (ds * green - green + nonOccupancy) / count;

    if (isWithin(detectorOccupancy, 0.2, MAX_SPACE_TIME_SECONDS)) {
      detectorOccupancySamples.push(detectorOccupancy);
    }
    if (
      isWithin(
        optimumSpaceTime,
        MIN_SPACE_TIME_SECONDS,
        MAX_SPACE_TIME_SECONDS,
      )
    ) {
      type3SpaceTimeSamples.push(optimumSpaceTime);
    }
  }

  const detectorOccupancy =
    median(detectorOccupancySamples) ?? DEFAULT_DETECTOR_OCCUPANCY_SECONDS;
  const type4SpaceTimeSamples: number[] = [];

  for (const metric of type4) {
    const count = metric.count;
    const green = metric.green;
    const calibratedDs = metric.degreeOfSaturation;
    if (
      count <= 0 ||
      !isPositiveFinite(green) ||
      !isPositiveFinite(calibratedDs)
    ) {
      continue;
    }

    const effectiveHeadway = (green * (calibratedDs / 100)) / count;
    const optimumSpaceTime = effectiveHeadway - detectorOccupancy;
    if (
      isWithin(
        optimumSpaceTime,
        MIN_SPACE_TIME_SECONDS,
        MAX_SPACE_TIME_SECONDS,
      )
    ) {
      type4SpaceTimeSamples.push(optimumSpaceTime);
    }
  }

  const spaceTimeSamples = [
    ...type3SpaceTimeSamples,
    ...type4SpaceTimeSamples,
  ];
  const saturationSpaceTime = median(spaceTimeSamples);
  if (saturationSpaceTime === null) return null;

  const gapSeconds =
    median(
      metrics
        .map((metric) =>
          isFiniteNumber(metric.gap)
            ? metric.gap * DET_TIME_UNIT_SECONDS
            : Number.NaN,
        )
        .filter((value) => isWithin(value, 0.2, 8)),
    ) ?? saturationSpaceTime;
  const degreeOfSaturation =
    medianDs(type4) ?? medianDs(type3) ?? 0;
  const greenSeconds =
    median(
      metrics
        .map((metric) => metric.green ?? Number.NaN)
        .filter(isPositiveFinite),
    ) ?? 0;

  // At lower DS, observed gaps contain useful free-flow spacing information,
  // but only a quarter of that difference is applied so terminal gap-out data
  // cannot dominate the saturation-flow estimate.
  const lowDemandWeight = 1 - clamp(degreeOfSaturation, 0, 1);
  const targetTimeHeadway = clamp(
    saturationSpaceTime +
      lowDemandWeight *
        0.25 *
        (clamp(gapSeconds, 0.5, 4) - saturationSpaceTime),
    MIN_HEADWAY_SECONDS,
    MAX_HEADWAY_SECONDS,
  );

  return {
    detectorId,
    targetTimeHeadwaySeconds: targetTimeHeadway,
    saturationSpaceTimeSeconds: saturationSpaceTime,
    observedGapSeconds: gapSeconds,
    detectorOccupancySeconds: detectorOccupancy,
    greenSeconds,
    degreeOfSaturation,
    sampleCount: spaceTimeSamples.length,
  };
}

function medianDs(metrics: DetectorCollectionMetrics[]): number | null {
  return median(
    metrics
      .map((metric) =>
        isFiniteNumber(metric.degreeOfSaturation)
          ? metric.degreeOfSaturation / 100
          : Number.NaN,
      )
      .filter((value) => isWithin(value, 0.01, 1.5)),
  );
}

function combineCalibrations(
  detectorId: number,
  values: DetectorFlowCalibration[],
): DetectorFlowCalibration {
  const middle = (selector: (value: DetectorFlowCalibration) => number) =>
    median(values.map(selector)) ?? 0;

  return {
    detectorId,
    targetTimeHeadwaySeconds: middle(
      (value) => value.targetTimeHeadwaySeconds,
    ),
    saturationSpaceTimeSeconds: middle(
      (value) => value.saturationSpaceTimeSeconds,
    ),
    observedGapSeconds: middle((value) => value.observedGapSeconds),
    detectorOccupancySeconds: middle(
      (value) => value.detectorOccupancySeconds,
    ),
    greenSeconds: middle((value) => value.greenSeconds),
    degreeOfSaturation: middle((value) => value.degreeOfSaturation),
    sampleCount: values.reduce((sum, value) => sum + value.sampleCount, 0),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function isPositiveFinite(value: number | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isWithin(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
