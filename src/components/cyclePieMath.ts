const MAX_ARC_SEGMENT_DEG = 180;

type PieGeometry = {
  center: number;
  radius: number;
};

function polarToCartesian(
  angleDeg: number,
  { center, radius }: PieGeometry,
) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(angleRad),
    y: center + radius * Math.sin(angleRad),
  };
}

/**
 * Build a sector from arcs no larger than a semicircle.
 *
 * Keeping every SVG arc at 180 degrees or less avoids the alternate-centre
 * arc selected by some browsers when an animated sweep crosses 180 degrees.
 */
export function buildPieSlicePath(
  startAngleDeg: number,
  sweepDeg: number,
  geometry: PieGeometry,
): string {
  const safeSweepDeg = Math.min(360, Math.max(0, sweepDeg));
  if (safeSweepDeg <= 0) return "";

  const start = polarToCartesian(startAngleDeg, geometry);
  const commands = [
    `M ${geometry.center} ${geometry.center}`,
    `L ${start.x} ${start.y}`,
  ];
  let currentAngleDeg = startAngleDeg;
  let remainingSweepDeg = safeSweepDeg;

  while (remainingSweepDeg > 0) {
    const segmentSweepDeg = Math.min(
      MAX_ARC_SEGMENT_DEG,
      remainingSweepDeg,
    );
    currentAngleDeg += segmentSweepDeg;
    const end = polarToCartesian(currentAngleDeg, geometry);
    commands.push(
      `A ${geometry.radius} ${geometry.radius} 0 0 1 ${end.x} ${end.y}`,
    );
    remainingSweepDeg -= segmentSweepDeg;
  }

  commands.push("Z");
  return commands.join(" ");
}

/** Keep CSS rotation moving forwards when the hand crosses a cycle boundary. */
export function getUnwrappedCycleHandAngle(
  cycleCount: number,
  timeOnRing: number,
  ringDuration: number,
): number {
  const safeRingDuration = Math.max(1, ringDuration);
  const clampedTime = Math.min(safeRingDuration, Math.max(0, timeOnRing));
  const completedTurns = Math.max(0, cycleCount - 1);
  return (
    completedTurns * 360 + (clampedTime / safeRingDuration) * 360 - 90
  );
}

type FixedCycleProgress = {
  currentPhase: number;
  phaseElapsed: number;
  interGreenElapsed: number;
  inInterGreen: boolean;
  isIdle: boolean;
};

export function getPhaseBlockDurations(
  phaseGreens: readonly number[],
  interGreens: readonly number[],
): number[] {
  return phaseGreens.map(
    (green, index) => Math.max(0, green) + Math.max(0, interGreens[index] ?? 0),
  );
}

/** Position the fixed-time hand continuously through green and inter-green. */
export function getFixedCycleHandTime(
  phaseGreens: readonly number[],
  interGreens: readonly number[],
  progress: FixedCycleProgress,
): number {
  const phaseIndex = Math.max(
    0,
    Math.min(phaseGreens.length - 1, progress.currentPhase),
  );
  const phaseBlocks = getPhaseBlockDurations(phaseGreens, interGreens);
  const blockStart = phaseBlocks
    .slice(0, phaseIndex)
    .reduce((sum, duration) => sum + duration, 0);
  const greenDuration = Math.max(0, phaseGreens[phaseIndex] ?? 0);
  const interGreenDuration = Math.max(0, interGreens[phaseIndex] ?? 0);

  let elapsedInBlock: number;
  if (progress.isIdle) {
    elapsedInBlock = greenDuration + interGreenDuration;
  } else if (progress.inInterGreen) {
    elapsedInBlock =
      greenDuration +
      Math.min(interGreenDuration, Math.max(0, progress.interGreenElapsed));
  } else {
    elapsedInBlock = Math.min(
      greenDuration,
      Math.max(0, progress.phaseElapsed),
    );
  }

  return blockStart + elapsedInBlock;
}
