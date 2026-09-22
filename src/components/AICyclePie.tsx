import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { PHASE_DEFINITIONS } from "../simulation/signalController";

ChartJS.register(ArcElement, Tooltip, Legend);

interface AICyclePieProps {
  phaseGreens: [number, number, number, number];
  cycleLength: number;
  cycleCount: number;
  simTime: number;
  cycleStartTime: number;
  currentPhase: number;
}

const PHASE_COLORS = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d"];
const AI_ACCENT = "#c084fc"; // purple accent for AI

export function AICyclePie({
  phaseGreens,
  cycleLength,
  cycleCount,
  simTime,
  cycleStartTime,
  currentPhase,
}: AICyclePieProps) {
  const effectiveCycleLength = Math.max(1, cycleLength);
  const timeInCycle = Math.max(
    0,
    Math.min(effectiveCycleLength, simTime - cycleStartTime),
  );
  const handAngleDeg = (timeInCycle / effectiveCycleLength) * 360 - 90;

  const pieData = {
    labels: PHASE_DEFINITIONS.map((p, i) => `${p.label} (${phaseGreens[i]}s)`),
    datasets: [
      {
        data: phaseGreens,
        backgroundColor: PHASE_COLORS,
        borderColor: PHASE_COLORS.map((c, i) =>
          i === currentPhase ? "#ffffff" : c + "99",
        ),
        borderWidth: phaseGreens.map((_, i) => (i === currentPhase ? 3 : 1.5)),
      },
    ],
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; raw: unknown }) => {
            const duration = (ctx.raw as number) ?? 0;
            const pct = ((duration / effectiveCycleLength) * 100).toFixed(0);
            return `${ctx.label}: ${duration}s (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>AI Cycle</span>
        <span style={styles.cycleLen}>
          {effectiveCycleLength}s
          <span style={styles.cycleNum}> (#{cycleCount})</span>
        </span>
      </div>

      <div style={styles.pieWrap}>
        <Pie data={pieData} options={pieOptions} />
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
    borderLeft: `3px solid ${AI_ACCENT}`,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: AI_ACCENT,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  cycleLen: {
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "monospace",
    color: "var(--text-primary)",
  },
  cycleNum: {
    fontSize: 10,
    color: "var(--text-faint)",
    fontWeight: 400,
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
    background: AI_ACCENT,
    transformOrigin: "bottom center",
    boxShadow: `0 0 6px ${AI_ACCENT}`,
  },
  handCenter: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    width: 8,
    height: 8,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    background: AI_ACCENT,
  },
  footer: {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-mid)",
  },
};
