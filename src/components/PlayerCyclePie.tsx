import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { PHASE_DEFINITIONS, getInterGreenForPhase } from "../simulation/signalController";
import type { FixedSignalProgressInfo } from "../simulation/signalController";
import type { PhaseConfig } from "../data/types";
import {
  getFixedCycleHandTime,
  getPhaseBlockDurations,
  getUnwrappedCycleHandAngle,
} from "./cyclePieMath";

ChartJS.register(ArcElement, Tooltip, Legend);

interface PlayerCyclePieProps {
  phaseConfig: PhaseConfig;
  simTime: number;
  currentPhase: number;
  signalProgress: FixedSignalProgressInfo | null;
  isSimulationActive: boolean;
}

const PHASE_COLORS = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d"];
const PLAYER_ACCENT = "#ff6b6b";

export function PlayerCyclePie({
  phaseConfig,
  simTime,
  currentPhase,
  signalProgress,
  isSimulationActive,
}: PlayerCyclePieProps) {
  const cycleLength =
    phaseConfig.greens.reduce((a, b) => a + b, 0) +
    [0, 1, 2, 3].reduce((sum, phase) => sum + getInterGreenForPhase(phase), 0);
  const effectiveCycleLength = Math.max(1, cycleLength);
  const interGreens = [0, 1, 2, 3].map((phase) =>
    getInterGreenForPhase(phase),
  );
  const phaseBlocks = getPhaseBlockDurations(phaseConfig.greens, interGreens);
  const skippedPhases = signalProgress?.skippedPhases ?? [
    false,
    false,
    false,
    false,
  ];
  const activePhase = signalProgress?.currentPhase ?? currentPhase;
  const activeGreen = phaseConfig.greens[activePhase] ?? 0;
  const handTimeOnCycle =
    isSimulationActive && signalProgress
      ? getFixedCycleHandTime(
          phaseConfig.greens,
          interGreens,
          signalProgress,
        )
      : 0;
  const cycleCount =
    isSimulationActive && signalProgress
      ? signalProgress.cycleCount
      : isSimulationActive
        ? Math.floor(simTime / effectiveCycleLength) + 1
        : 0;
  const handAngleDeg = getUnwrappedCycleHandAngle(
    cycleCount,
    handTimeOnCycle,
    effectiveCycleLength,
  );
  const phaseStatusLabel = getPhaseStatusLabel(
    signalProgress,
    activeGreen,
    handTimeOnCycle,
    effectiveCycleLength,
  );

  const pieData = {
    labels: PHASE_DEFINITIONS.map(
      (p, i) => `${p.label} (${phaseConfig.greens[i]}s)`,
    ),
    datasets: [
      {
        data: phaseBlocks,
        backgroundColor: phaseBlocks.map((_, i) =>
          skippedPhases[i] ? "#c4c9d1" : PHASE_COLORS[i],
        ),
        borderColor: PHASE_COLORS.map((c, i) =>
          i === activePhase &&
          isSimulationActive &&
          signalProgress &&
          !signalProgress.isIdle
            ? "#ffffff"
            : skippedPhases[i]
              ? "#8d96a3"
              : c + "99",
        ),
        borderWidth: phaseBlocks.map((_, i) =>
          i === activePhase &&
          isSimulationActive &&
          signalProgress &&
          !signalProgress.isIdle
            ? 3
            : 1.5,
        ),
      },
    ],
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; raw: unknown; dataIndex: number }) => {
            const duration = (ctx.raw as number) ?? 0;
            const pct = ((duration / effectiveCycleLength) * 100).toFixed(0);
            const skipped = skippedPhases[ctx.dataIndex] ? " skipped" : "";
            const transition = interGreens[ctx.dataIndex] ?? 0;
            return `${ctx.label}: ${duration}s block (${transition}s transition, ${pct}% cycle)${skipped}`;
          },
        },
      },
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Your Cycle</span>
        <span style={styles.cycleInfo}>
          {isSimulationActive
            ? `${effectiveCycleLength}s${cycleCount > 0 ? ` (Cycle #${cycleCount})` : ""}`
            : `${effectiveCycleLength}s`}
        </span>
      </div>

      <div style={styles.pieWrap}>
        <Pie data={pieData} options={pieOptions} />
        {isSimulationActive && (
          <div style={styles.handLayer}>
            <div
              style={{
                ...styles.hand,
                transform: `translate(-50%, -100%) rotate(${handAngleDeg}deg)`,
              }}
            />
            <div style={styles.handCenter} />
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <span>
          Phase:{" "}
          {isSimulationActive
            ? (PHASE_DEFINITIONS[activePhase]?.label ?? "-")
            : "-"}
        </span>
        <span>{isSimulationActive ? phaseStatusLabel : "Ready"}</span>
      </div>
    </div>
  );
}

function getPhaseStatusLabel(
  signalProgress: FixedSignalProgressInfo | null,
  activeGreen: number,
  handTimeOnCycle: number,
  cycleLength: number,
): string {
  if (!signalProgress) {
    return `${handTimeOnCycle.toFixed(1)}s / ${cycleLength}s cycle`;
  }
  if (signalProgress.isIdle) return "Waiting for demand";
  if (signalProgress.inInterGreen) return "Inter-green";

  return `${Math.min(activeGreen, signalProgress.phaseElapsed).toFixed(1)}s / ${activeGreen}s`;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--bg-surface)",
    borderRadius: 12,
    padding: 16,
    color: "var(--text-secondary)",
    minHeight: 154,
    borderLeft: `3px solid ${PLAYER_ACCENT}`,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: PLAYER_ACCENT,
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
    background: PLAYER_ACCENT,
    transformOrigin: "bottom center",
    boxShadow: `0 0 6px ${PLAYER_ACCENT}`,
  },
  handCenter: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    width: 8,
    height: 8,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    background: PLAYER_ACCENT,
  },
  footer: {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-mid)",
  },
};
