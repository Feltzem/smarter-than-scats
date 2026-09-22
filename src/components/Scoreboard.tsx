import { useState } from "react";
import type { SimulationResult, GameState, PeriodKey } from "../data/types";
import {
  addLeaderboardEntry,
  createLeaderboardEntry,
  leaderboardToCsv,
  loadLeaderboard,
  normalizeLeaderboardName,
} from "../scoring/leaderboard";
import type { LeaderboardEntry } from "../scoring/leaderboard";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import { PHASE_DEFINITIONS } from "../simulation/signalController";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface ScoreboardProps {
  gameState: GameState;
  playerResult: SimulationResult | null;
  playerScoreCode: string | null;
  playerPhaseGreens: [number, number, number, number];
  aiResult: SimulationResult | null;
  liveScatsResult: SimulationResult | null;
  hasAi: boolean;
  hasPlayer: boolean;
  hasLiveScats: boolean;
  livePlayerVehicles: number;
  livePlayerDelay: number;
  liveAiVehicles: number;
  liveAiDelay: number;
  liveLiveScatsVehicles: number;
  liveLiveScatsDelay: number;
  simTime: number;
  currentPhase: number;
  period: PeriodKey;
  periodDuration: number;
  livePlayerPhaseDelay: [number, number, number, number];
  liveAiPhaseDelay: [number, number, number, number];
  liveLiveScatsPhaseDelay: [number, number, number, number];
  livePlayerPhaseGrowing: [boolean, boolean, boolean, boolean];
  liveAiPhaseGrowing: [boolean, boolean, boolean, boolean];
  liveLiveScatsPhaseGrowing: [boolean, boolean, boolean, boolean];
  darkMode?: boolean;
}

export function Scoreboard({
  gameState,
  playerResult,
  playerScoreCode,
  playerPhaseGreens,
  aiResult,
  liveScatsResult,
  hasAi,
  hasPlayer,
  hasLiveScats,
  livePlayerVehicles,
  livePlayerDelay,
  liveAiVehicles,
  liveAiDelay,
  liveLiveScatsVehicles,
  liveLiveScatsDelay,
  simTime,
  currentPhase,
  period,
  periodDuration,
  livePlayerPhaseDelay,
  liveAiPhaseDelay,
  liveLiveScatsPhaseDelay,
  livePlayerPhaseGrowing,
  liveAiPhaseGrowing,
  liveLiveScatsPhaseGrowing,
  darkMode = true,
}: ScoreboardProps) {
  const tickColor = darkMode ? "#888" : "#6b7280";
  const gridColor = darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const legendColor = darkMode ? "#ddd" : "#374151";
  const [scoreCodeCopyState, setScoreCodeCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [leaderboardEntries, setLeaderboardEntries] = useState<
    LeaderboardEntry[]
  >(() => loadLeaderboard());
  const [playerName, setPlayerName] = useState("");
  const [submittedScoreCode, setSubmittedScoreCode] = useState<string | null>(
    null,
  );
  const [leaderboardMessage, setLeaderboardMessage] = useState("");

  const copyPlayerScoreCode = async () => {
    if (!playerScoreCode) return;

    const copied = await copyTextToClipboard(playerScoreCode);
    setScoreCodeCopyState(copied ? "copied" : "error");
    window.setTimeout(() => setScoreCodeCopyState("idle"), 1800);
  };

  const savePlayerScore = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!playerResult || !playerScoreCode) return;

    const name = normalizeLeaderboardName(playerName);
    if (!name) {
      setLeaderboardMessage("Enter a name to save this score.");
      return;
    }

    const entry = createLeaderboardEntry({
      name,
      period,
      phaseGreens: playerPhaseGreens,
      result: playerResult,
      scoreCode: playerScoreCode,
    });
    setLeaderboardEntries(addLeaderboardEntry(entry));
    setSubmittedScoreCode(playerScoreCode);
    setPlayerName("");
    setLeaderboardMessage("Score saved on this device.");
  };

  const downloadLeaderboard = () => {
    if (leaderboardEntries.length === 0) return;

    const blob = new Blob([leaderboardToCsv(leaderboardEntries)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smarter-than-scats-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const livePhaseDelayChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: {
      legend: { labels: { color: legendColor, boxWidth: 10, boxHeight: 10 } },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar">) =>
            `${ctx.dataset.label ?? ""}: ${(ctx.parsed.y ?? 0).toFixed(1)} veh-s`,
        },
      },
    },
    scales: {
      x: {
        stacked: false,
        ticks: { color: tickColor, maxRotation: 0 },
        grid: { color: gridColor },
      },
      y: {
        beginAtZero: true,
        ticks: { color: tickColor },
        grid: { color: gridColor },
        title: { display: true, text: "vehicle-seconds", color: tickColor },
      },
    },
  };

  const phaseDelayChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: legendColor } } },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: {
        beginAtZero: true,
        ticks: { color: tickColor },
        grid: { color: gridColor },
      },
    },
  };
  if (gameState === "SETUP") {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>Scoreboard</h3>
        <p style={styles.hint}>
          Set your phase timings and press Start to begin the simulation.
        </p>
      </div>
    );
  }

  if (gameState === "RUNNING" || gameState === "PAUSED") {
    const progressPct = Math.max(
      0,
      Math.min(100, (simTime / Math.max(1, periodDuration)) * 100),
    );
    const timeOfDay = formatTimeOfDay(period, simTime);

    return (
      <div style={styles.container}>
        <h3 style={styles.title}>
          {gameState === "PAUSED" ? "Live Stats (Paused)" : "Live Stats"}
        </h3>

        <div style={styles.timeOfDayBlock}>
          <div style={styles.timeOfDayLabel}>Time of Day</div>
          <div style={styles.timeOfDayValue}>{timeOfDay}</div>
        </div>

        <div style={styles.progressWrap}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>Animation Progress</span>
            <span style={styles.progressValue}>{progressPct.toFixed(0)}%</span>
          </div>
          <div style={styles.progressTrack}>
            <div
              style={{
                height: "100%",
                borderRadius: 999,
                background: "#4a9eff",
                width: `${progressPct}%`,
                minWidth: progressPct > 0 ? 2 : 0,
              }}
            />
          </div>
        </div>

        <div style={styles.liveGrid}>
          <div style={styles.liveBox}>
            <div style={styles.liveLabel}>Elapsed</div>
            <div style={styles.liveValue}>{simTime.toFixed(0)}s</div>
          </div>
          <div style={styles.liveBox}>
            <div style={styles.liveLabel}>Phase</div>
            <div style={styles.liveValue}>{currentPhase + 1}</div>
          </div>
        </div>

        <div style={styles.comparisonRow}>
          {hasPlayer && (
            <div style={styles.resultCol}>
              <div style={styles.colHeader}>You</div>
              <div style={styles.statRow}>
                <span>Vehicles:</span>
                <span style={styles.statValue}>{livePlayerVehicles}</span>
              </div>
              <div style={styles.statRow}>
                <span>Delay:</span>
                <span style={styles.statValue}>
                  {livePlayerDelay.toFixed(0)}s
                </span>
              </div>
            </div>
          )}
          {hasAi && (
            <div style={styles.resultCol}>
              <div style={{ ...styles.colHeader, color: "#c084fc" }}>AI</div>
              <div style={styles.statRow}>
                <span>Vehicles:</span>
                <span style={styles.statValue}>{liveAiVehicles}</span>
              </div>
              <div style={styles.statRow}>
                <span>Delay:</span>
                <span style={styles.statValue}>{liveAiDelay.toFixed(0)}s</span>
              </div>
            </div>
          )}
          {hasLiveScats && (
            <div style={styles.resultCol}>
              <div style={{ ...styles.colHeader, color: "#f59e0b" }}>SCATS</div>
              <div style={styles.statRow}>
                <span>Vehicles:</span>
                <span style={styles.statValue}>{liveLiveScatsVehicles}</span>
              </div>
              <div style={styles.statRow}>
                <span>Delay:</span>
                <span style={styles.statValue}>
                  {liveLiveScatsDelay.toFixed(0)}s
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={styles.liveChartBlock}>
          <div style={styles.liveChartTitle}>
            Live Delay by Phase (vehicle-seconds)
          </div>
          <div style={styles.liveChartWrap}>
            <Bar
              data={buildLivePhaseDelayChartData({
                hasPlayer,
                hasAi,
                hasLiveScats,
                livePlayerPhaseDelay,
                liveAiPhaseDelay,
                liveLiveScatsPhaseDelay,
                livePlayerPhaseGrowing,
                liveAiPhaseGrowing,
                liveLiveScatsPhaseGrowing,
              })}
              options={livePhaseDelayChartOptions}
            />
          </div>
        </div>
      </div>
    );
  }

  // COMPLETE
  const allResults: Array<{
    key: string;
    label: string;
    color: string;
    result: SimulationResult;
  }> = [];
  if (hasPlayer && playerResult)
    allResults.push({
      key: "player",
      label: "Your Timing",
      color: "#ff6b6b",
      result: playerResult,
    });
  if (hasAi && aiResult)
    allResults.push({
      key: "ai",
      label: "AI",
      color: "#c084fc",
      result: aiResult,
    });
  if (hasLiveScats && liveScatsResult)
    allResults.push({
      key: "liveScats",
      label: "SCATS",
      color: "#f59e0b",
      result: liveScatsResult,
    });

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Final Results</h3>

      {allResults.length > 0 && (
        <div
          style={{
            ...styles.summaryGrid,
            gridTemplateColumns: `repeat(${allResults.length}, 1fr)`,
          }}
        >
          {allResults.map((r) => (
            <div key={r.key} style={styles.summaryCard}>
              <div style={styles.summaryLabel}>{r.label} Delay</div>
              <div style={{ ...styles.summaryValue, color: r.color }}>
                {r.result.totalDelayHours.toFixed(2)}h
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.comparisonRow}>
        {allResults.map((r) => (
          <div key={r.key} style={styles.resultCol}>
            <div style={{ ...styles.colHeader, color: r.color }}>{r.label}</div>
            <div style={styles.finalStat}>
              <div style={styles.finalLabel}>Total Delay</div>
              <div style={styles.finalValue}>
                {r.result.totalDelay.toFixed(0)}s (
                {(r.result.totalDelay / 3600).toFixed(1)}hrs)
              </div>
            </div>
            <div style={styles.finalStat}>
              <div style={styles.finalLabel}>Avg Delay/Veh</div>
              <div style={styles.finalValue}>
                {r.result.averageDelay.toFixed(1)}s
              </div>
            </div>
            <div style={styles.finalStat}>
              <div style={styles.finalLabel}>Vehicles Served</div>
              <div style={styles.finalValue}>{r.result.vehiclesServed}</div>
            </div>
            <div style={styles.finalStat}>
              <div style={styles.finalLabel}>Pedestrians Crossed</div>
              <div style={styles.finalValue}>{r.result.pedestriansCrossed}</div>
            </div>
            <div style={styles.finalStat}>
              <div style={styles.finalLabel}>Peak Cars In-Network</div>
              <div style={styles.finalValue}>
                {r.result.maxVehiclesInNetwork}
              </div>
            </div>
          </div>
        ))}
      </div>

      {allResults.length > 0 && (
        <div style={styles.phaseChartBlock}>
          <div style={styles.chartTitle}>Delay by Phase (vehicle-seconds)</div>
          <div style={styles.chartWrap}>
            <Bar
              data={buildPhaseDelayChartData(allResults)}
              options={phaseDelayChartOptions}
            />
          </div>
        </div>
      )}

      {allResults.length >= 2 && (
        <div style={styles.verdict}>{renderVerdict(allResults)}</div>
      )}

      {allResults.length >= 2 && (
        <div style={styles.barContainer}>
          {(() => {
            const maxDelay = Math.max(
              ...allResults.map((r) => r.result.totalDelay),
            );
            return allResults.map((r) => (
              <div key={r.key}>
                <div style={styles.barLabel}>{r.label}</div>
                <div style={styles.barTrack}>
                  <div
                    style={{
                      ...styles.barFill,
                      width: `${Math.min(100, (r.result.totalDelay / maxDelay) * 100)}%`,
                      background: r.color,
                    }}
                  />
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {playerScoreCode && (
        <div style={styles.scoreCodeBlock}>
          <div style={styles.scoreCodeHeader}>
            <div>
              <div style={styles.scoreCodeLabel}>Verification Code</div>
              <div style={styles.scoreCodeHint}>Paste into the score sheet</div>
            </div>
            <button
              type="button"
              onClick={copyPlayerScoreCode}
              style={{
                ...styles.copyScoreCodeButton,
                ...(scoreCodeCopyState === "copied"
                  ? styles.copyScoreCodeButtonCopied
                  : {}),
                ...(scoreCodeCopyState === "error"
                  ? styles.copyScoreCodeButtonError
                  : {}),
              }}
            >
              {scoreCodeCopyState === "copied"
                ? "Copied"
                : scoreCodeCopyState === "error"
                  ? "Copy failed"
                  : "Copy"}
            </button>
          </div>
          <div style={styles.scoreCodeValue}>{playerScoreCode}</div>
        </div>
      )}

      <div style={styles.leaderboardBlock}>
        <div style={styles.leaderboardHeader}>
          <div>
            <div style={styles.scoreCodeLabel}>Leaderboard</div>
            <div style={styles.leaderboardHint}>
              Lowest total delay ranks highest. Saved on this device.
            </div>
          </div>
          <button
            type="button"
            onClick={downloadLeaderboard}
            disabled={leaderboardEntries.length === 0}
            style={styles.leaderboardButtonSecondary}
          >
            Download CSV
          </button>
        </div>

        {hasPlayer && playerResult && playerScoreCode && (
          submittedScoreCode === playerScoreCode ? (
            <div style={styles.leaderboardMessage}>{leaderboardMessage}</div>
          ) : (
            <form onSubmit={savePlayerScore} style={styles.leaderboardForm}>
              <label htmlFor="leaderboard-name" style={styles.leaderboardLabel}>
                Enter your name
              </label>
              <div style={styles.leaderboardFormRow}>
                <input
                  id="leaderboard-name"
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Your name"
                  maxLength={24}
                  autoComplete="nickname"
                  style={styles.leaderboardInput}
                />
                <button type="submit" style={styles.leaderboardButton}>
                  Save score
                </button>
              </div>
              {leaderboardMessage && (
                <div style={styles.leaderboardMessage}>
                  {leaderboardMessage}
                </div>
              )}
            </form>
          )
        )}

        {leaderboardEntries.length === 0 ? (
          <div style={styles.leaderboardEmpty}>No scores saved yet.</div>
        ) : (
          <div style={styles.leaderboardList}>
            {leaderboardEntries.slice(0, 10).map((entry, index) => (
              <div key={entry.id} style={styles.leaderboardRow}>
                <span style={styles.leaderboardRank}>{index + 1}</span>
                <span style={styles.leaderboardName}>{entry.name}</span>
                <span style={styles.leaderboardPeriod}>{entry.period}</span>
                <span style={styles.leaderboardScore}>
                  {entry.totalDelay.toFixed(0)}s
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function buildPhaseDelayChartData(
  results: Array<{ label: string; color: string; result: SimulationResult }>,
) {
  return {
    labels: PHASE_DEFINITIONS.map((p) => p.label),
    datasets: results.map((r) => ({
      label: r.label,
      data: r.result.phaseDelaySeconds,
      backgroundColor: r.color + "b3",
      borderColor: r.color,
      borderWidth: 1,
    })),
  };
}

function buildLivePhaseDelayChartData(cfg: {
  hasPlayer: boolean;
  hasAi: boolean;
  hasLiveScats: boolean;
  livePlayerPhaseDelay: [number, number, number, number];
  liveAiPhaseDelay: [number, number, number, number];
  liveLiveScatsPhaseDelay: [number, number, number, number];
  livePlayerPhaseGrowing: [boolean, boolean, boolean, boolean];
  liveAiPhaseGrowing: [boolean, boolean, boolean, boolean];
  liveLiveScatsPhaseGrowing: [boolean, boolean, boolean, boolean];
}) {
  const labels = PHASE_DEFINITIONS.map((p) => p.label);

  const datasets: Array<{
    label: string;
    data: [number, number, number, number];
    backgroundColor: string[];
    borderColor: string[];
    borderWidth: number[];
    borderRadius: number;
  }> = [];

  const pushModeDataset = (
    enabled: boolean,
    label: string,
    baseColor: string,
    values: [number, number, number, number],
    growing: [boolean, boolean, boolean, boolean],
  ) => {
    if (!enabled) return;
    datasets.push({
      label,
      data: values,
      backgroundColor: values.map(() => toRgba(baseColor, 0.58)),
      borderColor: values.map((_, i) =>
        growing[i] ? "#ffffff" : toRgba(baseColor, 1),
      ),
      borderWidth: values.map((_, i) => (growing[i] ? 2.8 : 1.2)),
      borderRadius: 4,
    });
  };

  pushModeDataset(
    cfg.hasPlayer,
    "You",
    "#ff6b6b",
    cfg.livePlayerPhaseDelay,
    cfg.livePlayerPhaseGrowing,
  );
  pushModeDataset(
    cfg.hasAi,
    "AI",
    "#c084fc",
    cfg.liveAiPhaseDelay,
    cfg.liveAiPhaseGrowing,
  );
  pushModeDataset(
    cfg.hasLiveScats,
    "SCATS",
    "#f59e0b",
    cfg.liveLiveScatsPhaseDelay,
    cfg.liveLiveScatsPhaseGrowing,
  );

  return { labels, datasets };
}

function toRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy copy path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function formatTimeOfDay(period: PeriodKey, elapsed: number): string {
  const starts: Record<PeriodKey, number> = {
    AM: 7 * 3600 + 45 * 60,
    SCHOOL: 14 * 3600 + 30 * 60,
    PM: 16 * 3600 + 30 * 60,
  };
  const t = starts[period] + Math.max(0, elapsed);
  return `${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

function renderVerdict(
  allResults: Array<{
    key: string;
    label: string;
    color: string;
    result: SimulationResult;
  }>,
) {
  const sorted = [...allResults].sort(
    (a, b) => a.result.totalDelay - b.result.totalDelay,
  );
  const winner = sorted[0];
  const runnerUp = sorted[1];
  const diff = runnerUp.result.totalDelay - winner.result.totalDelay;

  if (diff < 10) {
    return (
      <div style={{ ...styles.verdictText, color: "#ffd93d" }}>
        Tie between {winner.label} and {runnerUp.label}! (within 10 veh-seconds)
      </div>
    );
  }
  return (
    <>
      <div style={{ ...styles.verdictText, color: winner.color }}>
        {winner.label} wins by {diff.toFixed(0)} vehicle-seconds!
      </div>
      <div style={styles.verdictSubtext}>
        {winner.key === "player"
          ? "Impressive! Your fixed timing beat the adaptive systems."
          : winner.key === "ai"
            ? "The AI camera system found optimal splits by watching queue lengths in real time."
            : "The SCATS replay followed the recorded day-of-operation phase plan."}
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--bg-surface)",
    borderRadius: 12,
    padding: 20,
    color: "var(--text-secondary)",
    minWidth: 300,
    maxWidth: 400,
  },
  title: {
    margin: "0 0 12px 0",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  hint: { color: "var(--text-faint)", fontSize: 13, lineHeight: 1.5 },
  timeOfDayBlock: {
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 10,
  },
  timeOfDayLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  timeOfDayValue: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: 800,
    fontFamily: "monospace",
    color: "var(--text-primary)",
  },
  progressWrap: { marginBottom: 12 },
  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  progressValue: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    fontFamily: "monospace",
    fontWeight: 700,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    background: "var(--bg-surface-2)",
    overflow: "hidden",
  },
  liveGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 12,
  },
  liveBox: {
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
    textAlign: "center" as const,
  },
  liveLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  liveValue: {
    fontSize: 22,
    fontWeight: 700,
    fontFamily: "monospace",
    color: "var(--text-primary)",
  },
  comparisonRow: { display: "flex", gap: 8, flexWrap: "wrap" as const },
  liveChartBlock: {
    marginTop: 10,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
  },
  liveChartTitle: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 6,
    fontWeight: 700,
  },
  liveChartWrap: { height: 120 },
  resultCol: {
    flex: 1,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
    minWidth: 85,
  },
  colHeader: {
    fontSize: 11,
    fontWeight: 700,
    color: "#4a9eff",
    marginBottom: 8,
    textTransform: "uppercase" as const,
  },
  statRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 4,
  },
  statValue: {
    fontWeight: 700,
    color: "var(--text-primary)",
    fontFamily: "monospace",
  },
  finalStat: { marginBottom: 6 },
  finalLabel: {
    fontSize: 9,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
  },
  finalValue: {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "monospace",
    color: "var(--text-primary)",
  },
  verdict: {
    marginTop: 16,
    padding: 16,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    textAlign: "center" as const,
  },
  verdictText: { fontSize: 16, fontWeight: 700 },
  verdictSubtext: {
    fontSize: 12,
    color: "var(--text-faint)",
    marginTop: 6,
    lineHeight: 1.4,
  },
  barContainer: { marginTop: 12 },
  summaryGrid: { display: "grid", gap: 8, marginBottom: 12 },
  summaryCard: {
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
  },
  summaryLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  summaryValue: {
    marginTop: 3,
    fontSize: 18,
    fontFamily: "monospace",
    fontWeight: 800,
  },
  scoreCodeBlock: {
    marginTop: 28,
    marginBottom: 12,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
    border: "1px solid var(--border-color)",
  },
  scoreCodeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  scoreCodeLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    fontWeight: 700,
  },
  scoreCodeHint: {
    marginTop: 2,
    fontSize: 11,
    color: "var(--text-muted)",
  },
  scoreCodeValue: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--text-primary)",
    background: "rgba(0,0,0,0.22)",
    borderRadius: 6,
    padding: 8,
    overflowWrap: "anywhere" as const,
  },
  copyScoreCodeButton: {
    flexShrink: 0,
    padding: "7px 10px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "#4a9eff",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  },
  copyScoreCodeButtonCopied: {
    background: "#00a85a",
    borderColor: "#00a85a",
  },
  copyScoreCodeButtonError: {
    background: "#dc2626",
    borderColor: "#dc2626",
  },
  leaderboardBlock: {
    marginTop: 16,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
    border: "1px solid var(--border-color)",
  },
  leaderboardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  leaderboardHint: {
    marginTop: 2,
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.35,
  },
  leaderboardForm: {
    padding: "10px 0",
    borderTop: "1px solid var(--border-color)",
    borderBottom: "1px solid var(--border-color)",
  },
  leaderboardLabel: {
    display: "block",
    marginBottom: 5,
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    fontWeight: 700,
  },
  leaderboardFormRow: {
    display: "flex",
    gap: 6,
  },
  leaderboardInput: {
    minWidth: 0,
    flex: 1,
    padding: "7px 8px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 12,
  },
  leaderboardButton: {
    flexShrink: 0,
    padding: "7px 9px",
    border: "1px solid #00a85a",
    borderRadius: 6,
    background: "#00a85a",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  },
  leaderboardButtonSecondary: {
    flexShrink: 0,
    padding: "6px 8px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
  },
  leaderboardMessage: {
    marginTop: 6,
    color: "var(--text-muted)",
    fontSize: 11,
  },
  leaderboardEmpty: {
    padding: "12px 0 4px",
    color: "var(--text-faint)",
    fontSize: 12,
  },
  leaderboardList: {
    display: "grid",
    gap: 4,
    marginTop: 10,
  },
  leaderboardRow: {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) 44px auto",
    alignItems: "center",
    gap: 6,
    padding: "6px 0",
    borderTop: "1px solid var(--border-color)",
    fontSize: 12,
  },
  leaderboardRank: {
    color: "var(--text-faint)",
    fontFamily: "monospace",
    textAlign: "right" as const,
  },
  leaderboardName: {
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  leaderboardPeriod: {
    color: "var(--text-muted)",
    fontSize: 10,
    fontWeight: 700,
  },
  leaderboardScore: {
    color: "var(--text-primary)",
    fontFamily: "monospace",
    fontWeight: 700,
  },
  phaseChartBlock: {
    marginTop: 12,
    background: "var(--bg-surface-2)",
    borderRadius: 8,
    padding: 10,
  },
  chartTitle: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 6,
    fontWeight: 700,
  },
  chartWrap: { height: 180 },
  barLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 3,
    marginTop: 6,
  },
  barTrack: {
    height: 16,
    background: "var(--bg-surface-2)",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 4, transition: "width 0.3s ease" },
};
