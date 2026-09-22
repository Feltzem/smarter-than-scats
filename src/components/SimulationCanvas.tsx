import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createRoadLayer, CANVAS_SIZE } from "../rendering/road";
import { drawDynamicLayer } from "../rendering/dynamic";
import { SimulationEngine } from "../simulation/engine";
import type { SimulationSnapshot } from "../simulation/engine";
import { CENTER, ROAD_HALF_WIDTH } from "../simulation/paths";
import { Simulation3DView } from "./Simulation3DView";

const HOVER_REFRESH_INTERVAL_S = 0.5;
const PANEL_DIVIDER = 20;

type PanelKey = "player" | "ai" | "liveScats";

type LaneHover = {
  approach: "N" | "S" | "E" | "W";
  lane: 0 | 1;
  panel: PanelKey;
  waitingVehicles: number;
  cumulativeDelayHours: number;
  x: number;
  y: number;
};

type LaneHoverAnchor = {
  approach: "N" | "S" | "E" | "W";
  lane: 0 | 1;
  panel: PanelKey;
  x: number;
  y: number;
};

type VisiblePanel = {
  key: PanelKey;
  label: string;
  labelColor: string;
  engine: SimulationEngine | null;
};

type PanelSnapshots = Record<PanelKey, SimulationSnapshot | null>;

export type ActiveModels = {
  player: boolean;
  ai: boolean;
  liveScats: boolean;
};

export type ViewMode = "2d" | "3d";

export interface CrmMessage {
  id: string;
  sender: string;
  text: string;
  simTime: number;
  timestamp: string;
  modelLabel: string;
}

interface SimulationCanvasProps {
  playerEngine: SimulationEngine | null;
  aiEngine: SimulationEngine | null;
  liveScatsEngine: SimulationEngine | null;
  isRunning: boolean;
  showSetupFrame: boolean;
  speedMultiplier: number;
  activeModels: ActiveModels;
  simulationDuration: number;
  crmMessages: CrmMessage[];
  showCrmInbox: boolean;
  darkMode: boolean;
  showRoadArrows: boolean;
  viewMode: ViewMode;
  on3DUnavailable: () => void;
  onTick: (
    playerSnap: SimulationSnapshot | null,
    aiSnap: SimulationSnapshot | null,
    liveScatsSnap: SimulationSnapshot | null,
  ) => void;
  onComplete: () => void;
}

function getCanvasLayout(panelCount: number) {
  const safePanelCount = Math.max(1, panelCount);
  const topRowCount = Math.min(safePanelCount, 2);
  const hasBottomRow = safePanelCount > 2;
  const topRowWidth =
    topRowCount * CANVAS_SIZE + Math.max(0, topRowCount - 1) * PANEL_DIVIDER;

  return {
    topRowCount,
    hasBottomRow,
    totalWidth: Math.max(topRowWidth, CANVAS_SIZE),
    totalHeight: hasBottomRow ? CANVAS_SIZE * 2 + PANEL_DIVIDER : CANVAS_SIZE,
  };
}

function getPanelOffset(index: number, totalWidth: number) {
  if (index < 2) {
    return {
      offsetX: index * (CANVAS_SIZE + PANEL_DIVIDER),
      offsetY: 0,
    };
  }

  return {
    offsetX: (totalWidth - CANVAS_SIZE) / 2,
    offsetY: CANVAS_SIZE + PANEL_DIVIDER,
  };
}

export function SimulationCanvas({
  playerEngine,
  aiEngine,
  liveScatsEngine,
  isRunning,
  showSetupFrame,
  speedMultiplier,
  activeModels,
  simulationDuration,
  crmMessages,
  showCrmInbox,
  darkMode,
  showRoadArrows,
  viewMode,
  on3DUnavailable,
  onTick,
  onComplete,
}: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roadLayerRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const animateRef = useRef<() => void>(() => undefined);
  const playerSnapshotRef = useRef<SimulationSnapshot | null>(null);
  const aiSnapshotRef = useRef<SimulationSnapshot | null>(null);
  const liveScatsSnapshotRef = useRef<SimulationSnapshot | null>(null);
  const hoverAnchorRef = useRef<LaneHoverAnchor | null>(null);
  const lastHoverRefreshSimTimeRef = useRef<number>(-Infinity);
  const [laneHover, setLaneHover] = useState<LaneHover | null>(null);
  const [renderSnapshots, setRenderSnapshots] = useState<PanelSnapshots>({
    player: null,
    ai: null,
    liveScats: null,
  });

  const visiblePanels = useMemo<VisiblePanel[]>(() => {
    const panels: VisiblePanel[] = [];
    if (activeModels.player) {
      panels.push({
        key: "player",
        label: "YOUR TIMING",
        labelColor: "#fff",
        engine: playerEngine,
      });
    }
    if (activeModels.ai) {
      panels.push({
        key: "ai",
        label: "AI TIMING",
        labelColor: "#c084fc",
        engine: aiEngine,
      });
    }
    if (activeModels.liveScats) {
      panels.push({
        key: "liveScats",
        label: "SCATS",
        labelColor: "#f59e0b",
        engine: liveScatsEngine,
      });
    }
    return panels;
  }, [
    activeModels.player,
    activeModels.ai,
    activeModels.liveScats,
    playerEngine,
    aiEngine,
    liveScatsEngine,
  ]);

  const panelCount = visiblePanels.length;

  const refreshLaneHoverFromSnapshots = useCallback(() => {
    const anchor = hoverAnchorRef.current;
    if (!anchor) return;

    let snapshot: SimulationSnapshot | null = null;
    if (anchor.panel === "ai") snapshot = aiSnapshotRef.current;
    else if (anchor.panel === "liveScats")
      snapshot = liveScatsSnapshotRef.current;
    else snapshot = playerSnapshotRef.current;

    const laneKey = `${anchor.approach}-${anchor.lane}`;
    const stats = snapshot?.laneStats.get(laneKey);
    if (!stats) return;

    setLaneHover({
      ...anchor,
      waitingVehicles: stats.waitingVehicles,
      cumulativeDelayHours: stats.cumulativeDelayHours,
    });
  }, []);

  useEffect(() => {
    roadLayerRef.current = createRoadLayer({
      darkMode,
      showDirectionalArrows: showRoadArrows,
    });
  }, [darkMode, showRoadArrows]);

  const drawPanel = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      panel: VisiblePanel,
      snapshot: SimulationSnapshot | null,
      offsetX: number,
      offsetY: number,
    ) => {
      const roadLayer = roadLayerRef.current;
      if (!roadLayer) return;

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.drawImage(roadLayer, 0, 0);
      if (snapshot) drawDynamicLayer(ctx, snapshot);

      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(CANVAS_SIZE / 2 - 60, CANVAS_SIZE - 30, 120, 25);
      ctx.fillStyle = panel.labelColor;
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(panel.label, CANVAS_SIZE / 2, CANVAS_SIZE - 13);
      ctx.restore();
    },
    [],
  );

  const drawSimulationFrame = useCallback(
    (snapshots: PanelSnapshots) => {
      const canvas = canvasRef.current;
      if (!canvas || !roadLayerRef.current || visiblePanels.length === 0) {
        return;
      }

      const ctx = canvas.getContext("2d")!;
      const layout = getCanvasLayout(panelCount);

      canvas.width = layout.totalWidth;
      canvas.height = layout.totalHeight;
      ctx.clearRect(0, 0, layout.totalWidth, layout.totalHeight);

      for (let i = 0; i < visiblePanels.length; i++) {
        const panel = visiblePanels[i];
        const { offsetX, offsetY } = getPanelOffset(i, layout.totalWidth);
        drawPanel(ctx, panel, snapshots[panel.key], offsetX, offsetY);
      }

      if (layout.topRowCount > 1) {
        ctx.fillStyle = "#333";
        ctx.fillRect(CANVAS_SIZE, 0, PANEL_DIVIDER, CANVAS_SIZE);
        ctx.fillStyle = "#666";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate(CANVAS_SIZE + PANEL_DIVIDER / 2, CANVAS_SIZE / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("VS", 0, 4);
        ctx.restore();
      }

      if (layout.hasBottomRow) {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, CANVAS_SIZE, layout.totalWidth, PANEL_DIVIDER);
        ctx.fillStyle = "#666";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "VS",
          layout.totalWidth / 2,
          CANVAS_SIZE + PANEL_DIVIDER / 2 + 4,
        );
      }
    },
    [drawPanel, panelCount, visiblePanels],
  );

  const scheduleAnimationFrame = useCallback(() => {
    animFrameRef.current = requestAnimationFrame(() => animateRef.current());
  }, []);

  const animate = useCallback(() => {
    if ((viewMode === "2d" && !canvasRef.current) || !roadLayerRef.current)
      return;
    if (visiblePanels.length === 0) return;

    const primaryEngine = visiblePanels[0].engine;
    if (!primaryEngine) return;

    const ticksPerFrame = Math.max(1, Math.round(speedMultiplier));

    const finish = () => {
      const pSnap = playerEngine?.getSnapshot() ?? null;
      const aSnap = aiEngine?.getSnapshot() ?? null;
      const lsSnap = liveScatsEngine?.getSnapshot() ?? null;
      playerSnapshotRef.current = pSnap;
      aiSnapshotRef.current = aSnap;
      liveScatsSnapshotRef.current = lsSnap;
      setRenderSnapshots({ player: pSnap, ai: aSnap, liveScats: lsSnap });
      onTick(pSnap, aSnap, lsSnap);
      drawSimulationFrame({
        player: pSnap,
        ai: aSnap,
        liveScats: lsSnap,
      });
      onComplete();
    };

    for (let i = 0; i < ticksPerFrame; i++) {
      if (primaryEngine.time >= simulationDuration) {
        finish();
        return;
      }
      if (activeModels.player && playerEngine) playerEngine.tick();
      if (activeModels.ai && aiEngine) aiEngine.tick();
      if (activeModels.liveScats && liveScatsEngine) liveScatsEngine.tick();
      if (primaryEngine.time >= simulationDuration) {
        finish();
        return;
      }
    }

    const pSnap =
      activeModels.player && playerEngine ? playerEngine.getSnapshot() : null;
    const aSnap = activeModels.ai && aiEngine ? aiEngine.getSnapshot() : null;
    const lsSnap =
      activeModels.liveScats && liveScatsEngine
        ? liveScatsEngine.getSnapshot()
        : null;
    playerSnapshotRef.current = pSnap;
    aiSnapshotRef.current = aSnap;
    liveScatsSnapshotRef.current = lsSnap;
    setRenderSnapshots({ player: pSnap, ai: aSnap, liveScats: lsSnap });

    const shouldRefreshHover =
      !!hoverAnchorRef.current &&
      primaryEngine.time - lastHoverRefreshSimTimeRef.current >=
        HOVER_REFRESH_INTERVAL_S;
    if (shouldRefreshHover) {
      refreshLaneHoverFromSnapshots();
      lastHoverRefreshSimTimeRef.current = primaryEngine.time;
    }
    onTick(pSnap, aSnap, lsSnap);
    drawSimulationFrame({
      player: pSnap,
      ai: aSnap,
      liveScats: lsSnap,
    });

    scheduleAnimationFrame();
  }, [
    playerEngine,
    aiEngine,
    liveScatsEngine,
    speedMultiplier,
    activeModels.player,
    activeModels.ai,
    activeModels.liveScats,
    simulationDuration,
    visiblePanels,
    onTick,
    onComplete,
    drawSimulationFrame,
    refreshLaneHoverFromSnapshots,
    scheduleAnimationFrame,
    viewMode,
  ]);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  useEffect(() => {
    if (isRunning) {
      scheduleAnimationFrame();
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isRunning, scheduleAnimationFrame]);

  // Redraw non-running states so setup, pause, and completion stay current.
  useEffect(() => {
    if (isRunning) return;
    if (showSetupFrame) {
      playerSnapshotRef.current = null;
      aiSnapshotRef.current = null;
      liveScatsSnapshotRef.current = null;
      hoverAnchorRef.current = null;
      lastHoverRefreshSimTimeRef.current = -Infinity;
    }

    drawSimulationFrame({
      player: showSetupFrame ? null : playerSnapshotRef.current,
      ai: showSetupFrame ? null : aiSnapshotRef.current,
      liveScats: showSetupFrame ? null : liveScatsSnapshotRef.current,
    });
  }, [
    isRunning,
    showSetupFrame,
    playerEngine,
    aiEngine,
    liveScatsEngine,
    activeModels.player,
    activeModels.ai,
    activeModels.liveScats,
    darkMode,
    showRoadArrows,
    drawSimulationFrame,
    viewMode,
  ]);

  const getLaneFromCanvasPoint = useCallback(
    (
      x: number,
      y: number,
    ): { approach: "N" | "S" | "E" | "W"; lane: 0 | 1 } | null => {
      if (
        x >= CENTER &&
        x <= CENTER + ROAD_HALF_WIDTH &&
        y >= 0 &&
        y <= CENTER - ROAD_HALF_WIDTH
      )
        return {
          approach: "N",
          lane: x >= CENTER + ROAD_HALF_WIDTH / 2 ? 0 : 1,
        };
      if (
        x >= CENTER - ROAD_HALF_WIDTH &&
        x <= CENTER &&
        y >= CENTER + ROAD_HALF_WIDTH &&
        y <= CANVAS_SIZE
      )
        return {
          approach: "S",
          lane: x < CENTER - ROAD_HALF_WIDTH / 2 ? 0 : 1,
        };
      if (
        x >= CENTER + ROAD_HALF_WIDTH &&
        x <= CANVAS_SIZE &&
        y >= CENTER &&
        y <= CENTER + ROAD_HALF_WIDTH
      )
        return {
          approach: "E",
          lane: y >= CENTER + ROAD_HALF_WIDTH / 2 ? 0 : 1,
        };
      if (
        x >= 0 &&
        x <= CENTER - ROAD_HALF_WIDTH &&
        y >= CENTER - ROAD_HALF_WIDTH &&
        y <= CENTER
      )
        return {
          approach: "W",
          lane: y < CENTER - ROAD_HALF_WIDTH / 2 ? 0 : 1,
        };
      return null;
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      // Determine panel
      let panelKey: PanelKey = visiblePanels[0]?.key ?? "player";
      let localX = x;
      let localY = y;

      const hasBottomRow = panelCount > 2;
      if (y < CANVAS_SIZE) {
        if (
          panelCount >= 2 &&
          x > CANVAS_SIZE &&
          x < CANVAS_SIZE + PANEL_DIVIDER
        ) {
          hoverAnchorRef.current = null;
          setLaneHover(null);
          return;
        }
        if (panelCount >= 2 && x >= CANVAS_SIZE + PANEL_DIVIDER) {
          panelKey = visiblePanels[1]?.key ?? "player";
          localX = x - CANVAS_SIZE - PANEL_DIVIDER;
        } else {
          panelKey = visiblePanels[0]?.key ?? "player";
        }
      } else if (hasBottomRow) {
        const bottomOffsetX = (canvas.width - CANVAS_SIZE) / 2;
        panelKey = visiblePanels[2]?.key ?? "player";
        localX = x - bottomOffsetX;
        localY = y - CANVAS_SIZE - PANEL_DIVIDER;
      }

      const hit = getLaneFromCanvasPoint(localX, localY);
      if (!hit) {
        hoverAnchorRef.current = null;
        setLaneHover(null);
        return;
      }

      let snapshot: SimulationSnapshot | null = null;
      if (panelKey === "ai") snapshot = aiSnapshotRef.current;
      else if (panelKey === "liveScats")
        snapshot = liveScatsSnapshotRef.current;
      else snapshot = playerSnapshotRef.current;

      const laneKey = `${hit.approach}-${hit.lane}`;
      const stats = snapshot?.laneStats.get(laneKey);
      if (!stats) {
        hoverAnchorRef.current = null;
        setLaneHover(null);
        return;
      }

      const anchor: LaneHoverAnchor = {
        approach: hit.approach,
        lane: hit.lane,
        panel: panelKey,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      hoverAnchorRef.current = anchor;
      lastHoverRefreshSimTimeRef.current = -Infinity;
      setLaneHover({
        ...anchor,
        waitingVehicles: stats.waitingVehicles,
        cumulativeDelayHours: stats.cumulativeDelayHours,
      });
    },
    [getLaneFromCanvasPoint, panelCount, visiblePanels],
  );

  const handleMouseLeave = useCallback(() => {
    hoverAnchorRef.current = null;
    lastHoverRefreshSimTimeRef.current = -Infinity;
    setLaneHover(null);
  }, []);

  const laneDetector = (
    approach: "N" | "S" | "E" | "W",
    lane: 0 | 1,
  ): number => {
    if (approach === "N") return lane === 0 ? 1 : 2;
    if (approach === "W") return lane === 0 ? 3 : 4;
    if (approach === "S") return lane === 0 ? 5 : 6;
    return lane === 0 ? 7 : 8;
  };

  const laneName = (lane: 0 | 1): string =>
    lane === 0 ? "left/straight lane" : "right-turn lane";

  const panelLabel = (panel: PanelKey): string => {
    if (panel === "ai") return "AI timing";
    if (panel === "liveScats") return "SCATS timing";
    return "Your timing";
  };

  const visibleLaneHover = showSetupFrame ? null : laneHover;
  const threeDPanels = visiblePanels.map((panel) => ({
    key: panel.key,
    label: panel.label,
    labelColor: panel.labelColor,
    snapshot: showSetupFrame ? null : renderSnapshots[panel.key],
  }));

  return (
    <div style={{ overflowX: "auto", maxWidth: "100%", position: "relative" }}>
      {viewMode === "3d" ? (
        <Simulation3DView
          panels={threeDPanels}
          darkMode={darkMode}
          showRoadArrows={showRoadArrows}
          onWebGLFailure={on3DUnavailable}
        />
      ) : (
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            border: "2px solid #333",
            borderRadius: 8,
            display: "block",
            maxWidth: "100%",
            height: "auto",
          }}
        />
      )}
      {visibleLaneHover && (
        <div
          style={{
            position: "absolute",
            left: visibleLaneHover.x + 14,
            top: visibleLaneHover.y + 14,
            background: "rgba(10, 14, 26, 0.95)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8,
            padding: "8px 10px",
            color: "#fff",
            fontSize: 12,
            lineHeight: 1.4,
            pointerEvents: "none",
            zIndex: 5,
            minWidth: 220,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {panelLabel(visibleLaneHover.panel)} · D
            {laneDetector(visibleLaneHover.approach, visibleLaneHover.lane)} (
            {visibleLaneHover.approach} {laneName(visibleLaneHover.lane)})
          </div>
          <div>Waiting vehicles: {visibleLaneHover.waitingVehicles}</div>
          <div>
            Cumulative delay: {visibleLaneHover.cumulativeDelayHours.toFixed(3)}{" "}
            h
          </div>
        </div>
      )}
      {showCrmInbox && crmMessages.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 320,
            background: "rgba(11, 18, 32, 0.94)",
            border: "1px solid rgba(74, 158, 255, 0.45)",
            borderRadius: 10,
            padding: "10px 10px 8px 10px",
            color: "#d7e4ff",
            boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
            zIndex: 6,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#8fc1ff",
              marginBottom: 8,
            }}
          >
            HCC CRM Inbox
          </div>
          {crmMessages.map((msg) => (
            <div
              key={msg.id}
              style={{
                borderTop: "1px solid rgba(255,255,255,0.08)",
                paddingTop: 7,
                marginTop: 7,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#9aa8bf",
                  marginBottom: 3,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span>{msg.sender}</span>
                <span>{msg.timestamp}</span>
              </div>
              <div style={{ fontSize: 10, color: "#7f8ea6", marginBottom: 3 }}>
                {msg.modelLabel}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.35 }}>{msg.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
