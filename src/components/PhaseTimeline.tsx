import type { PhaseConfig } from "../data/types";
import { PHASE_DEFINITIONS, getInterGreenForPhase } from "../simulation/signalController";

interface PhaseTimelineProps {
  phaseConfig: PhaseConfig;
  currentPhase?: number;
  isRunning: boolean;
}

const PHASE_COLORS = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d"];
const INTER_GREEN_COLOR = "#cc8800";

function phaseLetter(phaseIndex: number): string {
  return String.fromCharCode(65 + phaseIndex);
}

export function PhaseTimeline({
  phaseConfig,
  currentPhase,
  isRunning,
}: PhaseTimelineProps) {
  const cycleLength =
    phaseConfig.greens.reduce((a, b) => a + b, 0) +
    [0, 1, 2, 3].reduce((sum, phase) => sum + getInterGreenForPhase(phase), 0);

  // Build segments
  const segments: Array<{
    label: string;
    duration: number;
    color: string;
    isInterGreen: boolean;
    phaseIndex: number;
  }> = [];

  for (let i = 0; i < 4; i++) {
    segments.push({
      label: `P${i + 1}: ${phaseConfig.greens[i]}s`,
      duration: phaseConfig.greens[i],
      color: PHASE_COLORS[i],
      isInterGreen: false,
      phaseIndex: i,
    });
    segments.push({
      label: "",
      duration: getInterGreenForPhase(i),
      color: INTER_GREEN_COLOR,
      isInterGreen: true,
      phaseIndex: i,
    });
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Sequence</span>
        <span style={styles.cycleLen}>{cycleLength}s</span>
      </div>
      <div style={styles.timeline}>
        {segments.map((seg, i) => {
          const widthPct = (seg.duration / cycleLength) * 100;
          const isActive =
            isRunning && !seg.isInterGreen && seg.phaseIndex === currentPhase;
          return (
            <div
              key={i}
              style={{
                ...styles.segment,
                width: `${widthPct}%`,
                background: seg.color,
                opacity: seg.isInterGreen ? 0.6 : 1,
                boxShadow: isActive ? `0 0 8px ${seg.color}` : "none",
                border: isActive
                  ? "2px solid #fff"
                  : "1px solid rgba(0,0,0,0.2)",
              }}
              title={
                seg.isInterGreen
                  ? `CIS transition: ${seg.duration}s (4s yellow + phase all-red)`
                  : `${PHASE_DEFINITIONS[seg.phaseIndex].description}: ${seg.duration}s`
              }
            >
              {!seg.isInterGreen && widthPct > 8 && (
                <span style={styles.segLabel}>
                  {phaseLetter(seg.phaseIndex)} {seg.duration}s
                </span>
              )}
              {!seg.isInterGreen && widthPct <= 8 && widthPct > 4 && (
                <span style={styles.segLabel}>
                  {phaseLetter(seg.phaseIndex)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={styles.legend}>
        {PHASE_DEFINITIONS.map((phase, i) => (
          <div key={i} style={styles.legendItem}>
            <span
              style={{ ...styles.legendDot, background: PHASE_COLORS[i] }}
            />
            <span style={styles.legendText}>{phase.description}</span>
          </div>
        ))}
        <div style={styles.legendItem}>
          <span
            style={{ ...styles.legendDot, background: INTER_GREEN_COLOR }}
          />
          <span style={styles.legendText}>Inter-green</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    color: "#eee",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: "#aaa",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  cycleLen: {
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "monospace",
    color: "#fff",
  },
  timeline: {
    display: "flex",
    height: 32,
    borderRadius: 6,
    overflow: "hidden",
  },
  segment: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
    minWidth: 2,
    boxSizing: "border-box" as const,
  },
  segLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#000",
    textShadow: "0 0 2px rgba(255,255,255,0.5)",
  },
  legend: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 10,
    marginTop: 8,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 10,
    color: "#888",
  },
};
