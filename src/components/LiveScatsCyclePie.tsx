import { useEffect, useRef, useState } from "react";

import { PHASE_DEFINITIONS } from "../simulation/signalController";
import { buildPieSlicePath } from "./cyclePieMath";

interface LiveScatsCyclePieProps {
  phaseGreens: [number, number, number, number];
  cycleLength: number;
  cycleCount: number;
  simTime: number;
  cycleStartTime: number;
  currentPhase: number;
  darkMode?: boolean;
}

const PHASE_COLORS = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d"];
const LIVE_SCATS_ACCENT = "#f59e0b";
const MAX_CYCLE_PIE_SECONDS = 120;
const PIE_SIZE = 132;
const PIE_CENTER = PIE_SIZE / 2;
const PIE_RADIUS = 52;
const PIE_ANIMATION_MS = 320;

type AnimatedCycleState = {
  cycleLength: number;
  phaseGreens: [number, number, number, number];
};

export function LiveScatsCyclePie({
  phaseGreens,
  cycleLength,
  cycleCount,
  simTime,
  cycleStartTime,
  currentPhase,
  darkMode = true,
}: LiveScatsCyclePieProps) {
  const [phaseAGreen, phaseBGreen, phaseCGreen, phaseDGreen] = phaseGreens;
  const effectiveCycleLength = Math.max(1, cycleLength);
  const displayedCycleLength = Math.min(
    effectiveCycleLength,
    MAX_CYCLE_PIE_SECONDS,
  );
  const [animatedCycle, setAnimatedCycle] = useState<AnimatedCycleState>({
    cycleLength: displayedCycleLength,
    phaseGreens,
  });
  const animatedCycleRef = useRef(animatedCycle);

  useEffect(() => {
    animatedCycleRef.current = animatedCycle;
  }, [animatedCycle]);

  useEffect(() => {
    const startState = animatedCycleRef.current;
    const targetState: AnimatedCycleState = {
      cycleLength: displayedCycleLength,
      phaseGreens: [phaseAGreen, phaseBGreen, phaseCGreen, phaseDGreen],
    };

    let frameId = 0;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / PIE_ANIMATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextState: AnimatedCycleState = {
        cycleLength:
          startState.cycleLength +
          (targetState.cycleLength - startState.cycleLength) * eased,
        phaseGreens: startState.phaseGreens.map((value, index) => {
          const targetValue = targetState.phaseGreens[index] ?? value;
          return value + (targetValue - value) * eased;
        }) as [number, number, number, number],
      };

      animatedCycleRef.current = nextState;
      setAnimatedCycle(nextState);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameId);
  }, [
    displayedCycleLength,
    phaseAGreen,
    phaseBGreen,
    phaseCGreen,
    phaseDGreen,
  ]);

  const animatedCycleLength = Math.max(1, animatedCycle.cycleLength);
  const timeInCycle = Math.max(
    0,
    Math.min(effectiveCycleLength, simTime - cycleStartTime),
  );
  const timeOnPie = Math.min(timeInCycle, animatedCycleLength);
  const pieSweepDeg = (animatedCycleLength / MAX_CYCLE_PIE_SECONDS) * 360;
  const handAngleDeg = (timeOnPie / MAX_CYCLE_PIE_SECONDS) * 360 - 90;
  const pieOutlineColor = darkMode
    ? "rgba(255,255,255,0.18)"
    : "rgba(200, 204, 214, 0.45)";
  const slicePaths = animatedCycle.phaseGreens.map((duration, index) => {
    const proportion =
      animatedCycleLength > 0 ? duration / animatedCycleLength : 0;
    const sweepDeg = pieSweepDeg * proportion;
    const startAngle =
      -90 +
      animatedCycle.phaseGreens
        .slice(0, index)
        .reduce(
          (sum, previousDuration) =>
            sum +
            pieSweepDeg *
              (animatedCycleLength > 0
                ? previousDuration / animatedCycleLength
                : 0),
          0,
        );
    const path = buildPieSlicePath(startAngle, sweepDeg, {
      center: PIE_CENTER,
      radius: PIE_RADIUS,
    });
    return {
      path,
      duration,
      index,
      sweepDeg,
    };
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>SCATS Cycle</span>
        <span style={styles.cycleInfo}>
          {cycleCount > 0
            ? `${effectiveCycleLength}s (Cycle #${cycleCount})`
            : `${effectiveCycleLength}s`}
        </span>
      </div>

      <div style={styles.pieWrap}>
        <svg
          viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
          style={styles.pieSvg}
          aria-label={`SCATS cycle ${effectiveCycleLength} seconds`}
          role="img"
        >
          <circle
            cx={PIE_CENTER}
            cy={PIE_CENTER}
            r={PIE_RADIUS}
            fill="none"
            stroke={pieOutlineColor}
            strokeWidth={1.5}
          />
          {slicePaths.map(({ path, duration, index, sweepDeg }) => {
            if (!path || sweepDeg <= 0) return null;
            const pct = ((duration / effectiveCycleLength) * 100).toFixed(0);
            const label =
              PHASE_DEFINITIONS[index]?.label ?? `Phase ${index + 1}`;
            return (
              <path
                key={label}
                d={path}
                fill={PHASE_COLORS[index]}
                stroke={
                  index === currentPhase
                    ? "#ffffff"
                    : `${PHASE_COLORS[index]}99`
                }
                strokeWidth={index === currentPhase ? 3 : 1.5}
                strokeLinejoin="round"
              >
                <title>{`${label} (${duration}s): ${pct}%`}</title>
              </path>
            );
          })}
        </svg>
        <div style={styles.handLayer}>
          <div
            style={{
              ...styles.hand,
              transform: `translate(-50%, -100%) rotate(${handAngleDeg}deg)`,
            }}
          />
          <div style={styles.handCenter} />
        </div>
      </div>

      <div style={styles.footer}>
        <span>Phase: {PHASE_DEFINITIONS[currentPhase]?.label ?? "-"}</span>
        <span>
          {timeInCycle.toFixed(1)}s / {effectiveCycleLength}s
        </span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--bg-surface)",
    borderRadius: 12,
    padding: 16,
    color: "var(--text-secondary)",
    minHeight: 154,
    borderLeft: `3px solid ${LIVE_SCATS_ACCENT}`,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: LIVE_SCATS_ACCENT,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  cycleInfo: {
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "monospace",
    color: "var(--text-primary)",
    whiteSpace: "nowrap" as const,
  },
  pieWrap: {
    position: "relative" as const,
    height: 132,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pieSvg: {
    width: PIE_SIZE,
    height: PIE_SIZE,
    overflow: "visible",
  },
  handLayer: {
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "none" as const,
  },
  hand: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    width: 2,
    height: 56,
    background: LIVE_SCATS_ACCENT,
    transformOrigin: "bottom center",
    boxShadow: `0 0 6px ${LIVE_SCATS_ACCENT}`,
  },
  handCenter: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    width: 8,
    height: 8,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    background: LIVE_SCATS_ACCENT,
  },
  footer: {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-mid)",
  },
};
