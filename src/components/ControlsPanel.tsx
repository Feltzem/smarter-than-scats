import { useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
} from "chart.js";
import type { PhaseConfig, PeriodKey, GameState } from "../data/types";
import type { DetectorVolumeProfile } from "../data/loader";
import { PHASE_DEFINITIONS, getInterGreenForPhase } from "../simulation/signalController";
import {
  PHASE_BOXES,
  PHASE_DIAGRAM_NATIVE_HEIGHT,
  PHASE_DIAGRAM_NATIVE_WIDTH,
  PHASE_ID_BY_INDEX,
} from "../rendering/phaseDiagram";
import type { ActiveModels } from "./SimulationCanvas";
import phaseDiagramImgSrc from "../data/phase_diagrams.jpg";

ChartJS.register(
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
);

interface ControlsPanelProps {
  phaseConfig: PhaseConfig;
  onPhaseChange: (index: number, value: number) => void;
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  speedMultiplier: number;
  onSpeedChange: (speed: number) => void;
  gameState: GameState;
  onStart: () => void;
  onReset: () => void;
  onPauseToggle: () => void;
  detectorVolumeProfile: DetectorVolumeProfile;
  activeModels: ActiveModels;
  darkMode?: boolean;
}

const PHASE_COLORS = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d"];
const DETECTOR_COLORS = [
  "#4a9eff",
  "#7ab8ff",
  "#4ecdc4",
  "#7ee0d8",
  "#ffd93d",
  "#ffe780",
  "#ff8a5b",
  "#ffb095",
];
const SPEED_OPTIONS = [1, 5, 10, 20, 50];
const SLIDER_MIN = 5;
const SLIDER_MAX = 40;
const PHASE_THUMBNAIL_HEIGHT = 82;

function sliderTrackBackground(value: number, max: number): string {
  const pct =
    ((Math.min(max, Math.max(SLIDER_MIN, value)) - SLIDER_MIN) /
      (max - SLIDER_MIN)) *
    100;

  return `linear-gradient(to right, var(--slider-fill) 0%, var(--slider-fill) ${pct}%, var(--slider-track) ${pct}%, var(--slider-track) 100%)`;
}

function phaseThumbnailCrop(index: number) {
  const phaseId = PHASE_ID_BY_INDEX[index] ?? "A";
  const box = PHASE_BOXES[phaseId];
  const scale = PHASE_THUMBNAIL_HEIGHT / box.h;

  return {
    frame: {
      width: box.w * scale,
      height: box.h * scale,
    },
    image: {
      width: PHASE_DIAGRAM_NATIVE_WIDTH * scale,
      height: PHASE_DIAGRAM_NATIVE_HEIGHT * scale,
      left: -box.x * scale,
      top: -box.y * scale,
    },
  };
}

export function ControlsPanel({
  phaseConfig,
  onPhaseChange,
  period,
  onPeriodChange,
  speedMultiplier,
  onSpeedChange,
  gameState,
  onStart,
  onReset,
  onPauseToggle,
  detectorVolumeProfile,
  activeModels,
  darkMode = true,
}: ControlsPanelProps) {
  const [selectedDetectors, setSelectedDetectors] = useState<number[]>([1, 2]);

  const cycleLength =
    phaseConfig.greens.reduce((a, b) => a + b, 0) +
    [0, 1, 2, 3].reduce((sum, phase) => sum + getInterGreenForPhase(phase), 0);

  const isSetup = gameState === "SETUP";
  const canPause = gameState === "RUNNING" || gameState === "PAUSED";
  const isLiveRun = gameState === "RUNNING";

  const detectorLineData = useMemo(() => {
    const labels = detectorVolumeProfile.labels.map((label, idx) =>
      idx % 3 === 0 ? label : "",
    );

    return {
      labels,
      datasets: selectedDetectors.map((detector) => ({
        label: `D${detector}`,
        data: detectorVolumeProfile.detectorSeries[detector] ?? [],
        borderColor: DETECTOR_COLORS[detector - 1],
        backgroundColor: DETECTOR_COLORS[detector - 1],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.35,
      })),
    };
  }, [detectorVolumeProfile, selectedDetectors]);

  const tickColor = darkMode ? "#888" : "#6b7280";
  const gridColor = darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const legendColor = darkMode ? "#ccc" : "#374151";

  const detectorLineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest" as const,
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top" as const,
          labels: {
            color: legendColor,
            boxWidth: 8,
            boxHeight: 8,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) => {
              const val = ctx.raw as number;
              return `${ctx.dataset.label}: ${val.toFixed(1)} veh/5 min (smoothed)`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: tickColor, maxRotation: 0 },
          grid: { color: gridColor },
        },
        y: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
      },
    }),
    [gridColor, legendColor, tickColor],
  );

  const toggleDetector = (detector: number) => {
    setSelectedDetectors((prev) => {
      if (prev.includes(detector)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== detector);
      }
      return [...prev, detector].sort((a, b) => a - b);
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.primaryActionWrap}>
        <div style={styles.primaryActionRow}>
          {gameState === "SETUP" ? (
            <button onClick={onStart} style={styles.startButton}>
              Start Simulation
            </button>
          ) : (
            <button onClick={onReset} style={styles.resetButton}>
              Reset
            </button>
          )}
          <button
            onClick={onPauseToggle}
            disabled={!canPause}
            style={{
              ...styles.pauseButton,
              ...(gameState === "PAUSED" ? styles.resumeButton : {}),
              ...(!canPause ? styles.pauseButtonDisabled : {}),
            }}
          >
            {gameState === "PAUSED" ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <h2 style={styles.title}>Signal Timing Controls</h2>

      <div style={styles.section}>
        <label style={styles.label}>Peak Period</label>
        <div style={styles.buttonGroup}>
          {(["AM", "SCHOOL", "PM"] as PeriodKey[]).map((p) => (
            <button
              key={p}
              onClick={() => isSetup && onPeriodChange(p)}
              disabled={!isSetup}
              style={{
                ...styles.periodButton,
                ...(period === p ? styles.periodButtonActive : {}),
                ...(period === p && isLiveRun
                  ? styles.periodButtonActiveLive
                  : {}),
              }}
            >
              {p === "SCHOOL" ? "School" : p}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Phase Green Times</label>
        {PHASE_DEFINITIONS.map((phase, i) => (
          <div key={i} style={styles.sliderRow}>
            <div style={styles.sliderMain}>
              <div style={styles.sliderLabel}>
                <span
                  style={{
                    ...styles.phaseIndicator,
                    backgroundColor: PHASE_COLORS[i],
                  }}
                />
                <span style={styles.phaseText}>
                  {phase.label}: {phase.description}
                </span>
                <span style={styles.phaseValue}>{phaseConfig.greens[i]}s</span>
              </div>
              <input
                className="timing-slider"
                type="range"
                min={SLIDER_MIN}
                max={i % 2 === 0 ? 40 : 20}
                step={1}
                value={phaseConfig.greens[i]}
                onChange={(e) => onPhaseChange(i, parseInt(e.target.value, 10))}
                disabled={!isSetup}
                style={{
                  ...styles.slider,
                  background: sliderTrackBackground(
                    phaseConfig.greens[i],
                    i % 2 === 0 ? SLIDER_MAX : 20,
                  ),
                }}
              />
            </div>
            <div
              style={{
                ...styles.phaseThumbnail,
                ...phaseThumbnailCrop(i).frame,
              }}
              title={`${phase.label} movements`}
            >
              <img
                src={phaseDiagramImgSrc}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{
                  ...styles.phaseThumbnailImage,
                  ...phaseThumbnailCrop(i).image,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={styles.cycleDisplay}>
        <span>Cycle Length:</span>
        <span style={styles.cycleValue}>
          {cycleLength}s
          <span style={styles.cycleBreakdown}>
            ({phaseConfig.greens.reduce((a, b) => a + b, 0)}s green +{" "}
            {"CIS yellow/all-red transitions"})
          </span>
        </span>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Simulation Speed</label>
        <div style={styles.buttonGroup}>
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              onClick={() => onSpeedChange(speed)}
              style={{
                ...styles.speedButton,
                ...(speedMultiplier === speed ? styles.speedButtonActive : {}),
              }}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Typical Traffic Volumes (Smoothed)</label>
        <div style={styles.detectorGrid}>
          {Array.from({ length: 8 }, (_, i) => i + 1).map((detector) => {
            const isSelected = selectedDetectors.includes(detector);
            return (
              <button
                key={detector}
                onClick={() => toggleDetector(detector)}
                style={{
                  ...styles.detectorButton,
                  ...(isSelected ? styles.detectorButtonActive : {}),
                  borderColor: DETECTOR_COLORS[detector - 1],
                }}
              >
                D{detector}
              </button>
            );
          })}
        </div>
        <div style={styles.volumeChartWrap}>
          <Line data={detectorLineData} options={detectorLineOptions} />
        </div>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Active Models</label>
        <div style={styles.buttonGroup}>
          {[
            { key: "player" as const, label: "You", color: "#ff6b6b" },
            { key: "liveScats" as const, label: "SCATS", color: "#f59e0b" },
          ].map(({ key, label, color }) => {
            const active = activeModels[key];
            return (
              <button
                key={key}
                type="button"
                disabled
                style={{
                  ...styles.modelToggle,
                  borderColor: active ? color : "var(--border-color)",
                  background: active ? color + "22" : "var(--bg-surface-2)",
                  color: active ? color : "var(--text-faint)",
                  cursor: "default",
                  opacity: active ? 1 : 0.7,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--bg-surface)",
    borderRadius: 12,
    padding: 20,
    color: "var(--text-secondary)",
    minWidth: 300,
    maxWidth: 360,
  },
  primaryActionWrap: {
    marginBottom: 16,
  },
  primaryActionRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
    gap: 8,
  },
  title: {
    margin: "0 0 16px 0",
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  section: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    marginBottom: 8,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  buttonGroup: {
    display: "flex",
    gap: 6,
  },
  periodButton: {
    flex: 1,
    padding: "8px 12px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-surface-2)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  periodButtonActive: {
    background: "#4a9eff",
    color: "#fff",
    borderColor: "#4a9eff",
  },
  periodButtonActiveLive: {
    background: "rgba(74, 158, 255, 0.48)",
    borderColor: "rgba(74, 158, 255, 0.55)",
    color: "rgba(255,255,255,0.92)",
  },
  sliderRow: {
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sliderMain: {
    flex: 1,
    minWidth: 0,
  },
  phaseThumbnail: {
    flexShrink: 0,
    position: "relative",
    background: "#000",
    borderRadius: 4,
    border: "1px solid var(--border-color)",
    overflow: "hidden" as const,
  },
  phaseThumbnailImage: {
    position: "absolute",
    display: "block",
    maxWidth: "none",
    pointerEvents: "none",
  },
  sliderLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  phaseIndicator: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  phaseText: {
    flex: 1,
    fontSize: 12,
    color: "var(--text-tertiary)",
  },
  phaseValue: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
    fontFamily: "monospace",
    minWidth: 30,
    textAlign: "right" as const,
  },
  slider: {
    width: "100%",
  },
  cycleDisplay: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
    color: "var(--text-tertiary)",
  },
  cycleValue: {
    fontWeight: 700,
    color: "var(--text-primary)",
    fontSize: 16,
    fontFamily: "monospace",
  },
  cycleBreakdown: {
    fontSize: 10,
    color: "var(--text-faint)",
    marginLeft: 4,
  },
  speedButton: {
    flex: 1,
    padding: "6px 10px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-surface-2)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  speedButtonActive: {
    background: "#ffd93d",
    color: "#000",
    borderColor: "#ffd93d",
  },
  startButton: {
    width: "100%",
    padding: "12px",
    border: "none",
    borderRadius: 8,
    background: "#00cc00",
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  resetButton: {
    width: "100%",
    padding: "12px",
    border: "none",
    borderRadius: 8,
    background: "#ff6b6b",
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  pauseButton: {
    width: "100%",
    padding: "12px",
    border: "1px solid rgba(245, 158, 11, 0.35)",
    borderRadius: 8,
    background: "rgba(245, 158, 11, 0.14)",
    color: "#fbbf24",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },
  resumeButton: {
    borderColor: "rgba(34, 197, 94, 0.4)",
    background: "rgba(34, 197, 94, 0.14)",
    color: "#86efac",
  },
  pauseButtonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  detectorGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 6,
    marginBottom: 8,
  },
  detectorButton: {
    padding: "6px 0",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-surface-2)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
  },
  detectorButtonActive: {
    background: "var(--active-bg)",
    color: "var(--text-primary)",
  },
  modelToggle: {
    flex: 1,
    padding: "8px 10px",
    border: "2px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-surface-2)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  volumeChartWrap: {
    height: 140,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 8,
  },
};
