/* eslint-disable react-hooks/refs -- simulation engines are intentionally ref-backed. */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  PhaseConfig,
  PeriodKey,
  GameState,
  SimulationResult,
  PeriodData,
} from "./data/types";
import {
  getSmoothedSite36DetectorVolumes,
  loadEmbeddedSite36Data,
} from "./data/loader";
import { SimulationEngine } from "./simulation/engine";
import type { SimulationSnapshot } from "./simulation/engine";
import { FixedSignalController } from "./simulation/signalController";
import type { FixedSignalProgressInfo } from "./simulation/signalController";
import { AISignalController } from "./simulation/aiController";
import { LiveScatsController } from "./simulation/liveScatsController";
import { ScatsReplayController } from "./simulation/scatsReplayController";
import { buildDetectorCalibration } from "./simulation/detectorCalibration";
import { SimulationCanvas } from "./components/SimulationCanvas";
import type {
  ActiveModels,
  CrmMessage,
  ViewMode,
} from "./components/SimulationCanvas";
import { ControlsPanel } from "./components/ControlsPanel";
import { Scoreboard } from "./components/Scoreboard";
import { PlayerCyclePie } from "./components/PlayerCyclePie";
import { AICyclePie } from "./components/AICyclePie";
import { LiveScatsCyclePie } from "./components/LiveScatsCyclePie";
import { HelpOverlay } from "./components/HelpOverlay";
import { buildScoreVerificationCode } from "./scoring/scoreCode";
import qrCodePlaceholderUrl from "./assets/qr-code-placeholder.svg";

const CRM_WAIT_THRESHOLD_SECONDS = 65;
const MAX_CRM_MESSAGES = 5;
const MAX_CRM_COMPLAINTS_PER_QUEUE = 2;
const ZERO_PHASE_DELAYS: [number, number, number, number] = [0, 0, 0, 0];
const ZERO_PHASE_ACTIVITY: [boolean, boolean, boolean, boolean] = [
  false,
  false,
  false,
  false,
];
const USE_LEGACY_LIVE_SCATS = false;
// TEMP phase-skip test switch: set back to 1 to restore normal traffic.
const TRAFFIC_TEST_ARRIVAL_DIVISOR = 1;
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "0.0.0";
const BUILD_DATE =
  import.meta.env.VITE_BUILD_DATE || new Date().toISOString().slice(0, 10);

const CRM_NAMES = [
  "Mia",
  "Noah",
  "Hemi",
  "Aroha",
  "Tane",
  "Grace",
  "Sophie",
  "Luca",
  "Aria",
  "James",
  "Moana",
  "Wiremu",
  "Olivia",
  "Ty",
  "Sam",
  "Kiri",
  "Levi",
  "Emma",
  "Kane",
  "John",
  "Michael",
  "Dale",
  "Holly",
  "Neena",
  "James",
];

function deterministicUnit(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const x = Math.sin(hash * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function approachLabel(approach: "N" | "S" | "E" | "W"): string {
  if (approach === "N") return "northbound";
  if (approach === "S") return "southbound";
  if (approach === "E") return "eastbound";
  return "westbound";
}

function movementLabel(movement: "left" | "right" | "straight"): string {
  if (movement === "left") return "turn left";
  if (movement === "right") return "turn right";
  return "go straight";
}

function perceivedWaitSeconds(actualWait: number, seed: string): number {
  const base = deterministicUnit(seed);
  const exaggerationBias = deterministicUnit(`${seed}-bias`);
  const multiplier =
    exaggerationBias < 0.85 ? 1.2 + base * 0.9 : 0.95 + base * 0.2;
  return Math.max(actualWait, actualWait * multiplier + 8 + base * 12);
}

function pickName(seed: string): string {
  const i = Math.floor(deterministicUnit(`${seed}-name`) * CRM_NAMES.length);
  return CRM_NAMES[i] ?? "Resident";
}

function roundedPerceivedMinutes(perceivedSeconds: number): number {
  const minuteBuckets = [2, 3, 4, 5, 6, 8, 10, 12];
  const mins = perceivedSeconds / 60;
  let best = minuteBuckets[0];
  let bestDist = Math.abs(mins - best);
  for (const bucket of minuteBuckets) {
    const d = Math.abs(mins - bucket);
    if (d < bestDist) {
      best = bucket;
      bestDist = d;
    }
  }
  return best;
}

function perceivedWaitPhrase(seed: string, perceivedSeconds: number): string {
  const p = deterministicUnit(`${seed}-phrase`);
  if (p < 0.32) return "ages";

  const mins = roundedPerceivedMinutes(perceivedSeconds);
  const minuteLabel = mins === 1 ? "minute" : "minutes";

  if (p < 0.55) return `about ${mins} ${minuteLabel}`;
  if (p < 0.78) return `like ${mins} mins`;
  return `${mins}+ minutes`;
}

function applyTrafficTestDivisor(
  arrivals: PeriodData["arrivals"],
): PeriodData["arrivals"] {
  if (TRAFFIC_TEST_ARRIVAL_DIVISOR <= 1) return arrivals;

  return arrivals.filter(
    (_arrival, index) => index % TRAFFIC_TEST_ARRIVAL_DIVISOR === 0,
  );
}

function buildComplaintText(
  seed: string,
  movement: string,
  approach: string,
  perceivedPhrase: string,
  lastTemplateKey: string | null,
): { text: string; templateKey: string } {
  const templateBuilders = [
    () =>
      `Hi, trying to ${movement} from ${approach}. I've been waiting ${perceivedPhrase}.`,
    () =>
      `Can someone check this please? ${movement} from ${approach} and it's felt like ${perceivedPhrase}.`,
    () =>
      `lights are cooked. trying to ${movement} ${approach}. been waiting ${perceivedPhrase}`,
    () =>
      `Been stuck here ${perceivedPhrase}. Need to ${movement} from ${approach}.`,
    () =>
      `Queue's barely moving ${approach}. Just trying to ${movement} and it's been ${perceivedPhrase}.`,
    () =>
      `Heads up: ${approach} is jammed. Waiting ${perceivedPhrase} to ${movement}.`,
    () =>
      `This phase feels way too short. ${movement} from ${approach} after ${perceivedPhrase} waiting.`,
    () =>
      `Anyone else stuck on ${approach}? I'm trying to ${movement} and it feels like ${perceivedPhrase}.`,
  ];

  let templateIndex = Math.floor(
    deterministicUnit(`${seed}-style`) * templateBuilders.length,
  );
  let templateKey = `template-${templateIndex}`;

  if (templateKey === lastTemplateKey) {
    const offset =
      1 +
      Math.floor(
        deterministicUnit(`${seed}-style-reroll`) *
          (templateBuilders.length - 1),
      );
    templateIndex = (templateIndex + offset) % templateBuilders.length;
    templateKey = `template-${templateIndex}`;
  }

  return {
    text: templateBuilders[templateIndex](),
    templateKey,
  };
}

function shouldEmitComplaintForQueue(
  complaintId: string,
  queueComplaintCount: number,
  actualWaitSeconds: number,
): boolean {
  if (queueComplaintCount <= 0) return true;
  if (queueComplaintCount >= MAX_CRM_COMPLAINTS_PER_QUEUE) return false;

  const waitSeverity = Math.min(
    1,
    Math.max(0, (actualWaitSeconds - CRM_WAIT_THRESHOLD_SECONDS) / 90),
  );
  const emitChance = 0.22 + waitSeverity * 0.28;

  return deterministicUnit(`${complaintId}-emit`) < emitChance;
}

function chatTimestamp(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function detectPhaseGrowth(
  previous: [number, number, number, number],
  next: [number, number, number, number],
): [boolean, boolean, boolean, boolean] {
  return [
    next[0] > previous[0] + 1e-4,
    next[1] > previous[1] + 1e-4,
    next[2] > previous[2] + 1e-4,
    next[3] > previous[3] + 1e-4,
  ];
}

function App() {
  // Data state
  const [periods, setPeriods] = useState<Record<string, PeriodData> | null>(
    null,
  );

  // Theme
  const [darkMode, setDarkMode] = useState(false);
  const [showRoadArrows, setShowRoadArrows] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      darkMode ? "dark" : "light",
    );
  }, [darkMode]);

  // Game state
  const [gameState, setGameState] = useState<GameState>("SETUP");
  const [period, setPeriod] = useState<PeriodKey>("AM");
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [showHelp, setShowHelp] = useState(false);
  const [showCrmInbox, setShowCrmInbox] = useState(false);

  // Phase config
  const [phaseConfig, setPhaseConfig] = useState<PhaseConfig>({
    greens: [10, 20, 10, 20],
  });

  const activeModels = useMemo<ActiveModels>(
    () => ({ player: true, ai: false, liveScats: true }),
    [],
  );

  // Simulation engines
  const playerEngineRef = useRef<SimulationEngine | null>(null);
  const aiEngineRef = useRef<SimulationEngine | null>(null);
  const aiControllerRef = useRef<AISignalController | null>(null);
  const liveScatsEngineRef = useRef<SimulationEngine | null>(null);
  const liveScatsControllerRef = useRef<
    LiveScatsController | ScatsReplayController | null
  >(null);

  // Results
  const [playerResult, setPlayerResult] = useState<SimulationResult | null>(
    null,
  );
  const [aiResult, setAiResult] = useState<SimulationResult | null>(null);
  const [liveScatsResult, setLiveScatsResult] =
    useState<SimulationResult | null>(null);

  // Live stats
  const [livePlayerVehicles, setLivePlayerVehicles] = useState(0);
  const [livePlayerDelay, setLivePlayerDelay] = useState(0);
  const [liveAiVehicles, setLiveAiVehicles] = useState(0);
  const [liveAiDelay, setLiveAiDelay] = useState(0);
  const [liveLiveScatsVehicles, setLiveLiveScatsVehicles] = useState(0);
  const [liveLiveScatsDelay, setLiveLiveScatsDelay] = useState(0);
  const [simTime, setSimTime] = useState(0);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [playerSignalProgress, setPlayerSignalProgress] =
    useState<FixedSignalProgressInfo | null>(null);
  const [aiSimTime, setAiSimTime] = useState(0);
  const [aiCurrentPhase, setAiCurrentPhase] = useState(0);
  const [liveScatsSimTime, setLiveScatsSimTime] = useState(0);
  const [liveScatsCurrentPhase, setLiveScatsCurrentPhase] = useState(0);
  const [liveScatsCycleInfo, setLiveScatsCycleInfo] = useState<{
    phaseGreens: [number, number, number, number];
    cycleLength: number;
    cycleCount: number;
    cycleStartTime: number;
  } | null>(null);
  const [aiCycleInfo, setAiCycleInfo] = useState<{
    phaseGreens: [number, number, number, number];
    cycleLength: number;
    cycleCount: number;
    cycleStartTime: number;
  } | null>(null);
  const [livePlayerPhaseDelay, setLivePlayerPhaseDelay] =
    useState<[number, number, number, number]>(ZERO_PHASE_DELAYS);
  const [liveAiPhaseDelay, setLiveAiPhaseDelay] =
    useState<[number, number, number, number]>(ZERO_PHASE_DELAYS);
  const [liveLiveScatsPhaseDelay, setLiveLiveScatsPhaseDelay] =
    useState<[number, number, number, number]>(ZERO_PHASE_DELAYS);
  const [livePlayerPhaseGrowing, setLivePlayerPhaseGrowing] =
    useState<[boolean, boolean, boolean, boolean]>(ZERO_PHASE_ACTIVITY);
  const [liveAiPhaseGrowing, setLiveAiPhaseGrowing] =
    useState<[boolean, boolean, boolean, boolean]>(ZERO_PHASE_ACTIVITY);
  const [liveLiveScatsPhaseGrowing, setLiveLiveScatsPhaseGrowing] =
    useState<[boolean, boolean, boolean, boolean]>(ZERO_PHASE_ACTIVITY);
  const [crmMessages, setCrmMessages] = useState<CrmMessage[]>([]);
  const crmReportedRef = useRef<Set<string>>(new Set());
  const crmQueueCountsRef = useRef<Map<string, number>>(new Map());
  const crmLastTemplateRef = useRef<string | null>(null);
  const prevPlayerPhaseDelayRef =
    useRef<[number, number, number, number]>(ZERO_PHASE_DELAYS);
  const prevAiPhaseDelayRef =
    useRef<[number, number, number, number]>(ZERO_PHASE_DELAYS);
  const prevLiveScatsPhaseDelayRef =
    useRef<[number, number, number, number]>(ZERO_PHASE_DELAYS);
  const detectorVolumeProfile = useMemo(
    () => getSmoothedSite36DetectorVolumes(period),
    [period],
  );
  const playerScoreCode = useMemo(() => {
    if (!playerResult) return null;

    return buildScoreVerificationCode({
      period,
      phaseConfig,
      result: playerResult,
      trafficDivisor: TRAFFIC_TEST_ARRIVAL_DIVISOR,
    });
  }, [period, phaseConfig, playerResult]);

  // SCATS preview cycle for SETUP state (first cycle of selected period)
  const scatsPreviewCycle = useMemo(() => {
    if (!periods) return null;
    const pData = periods[period];
    if (!pData?.scatsCycles?.length) return null;
    const first = pData.scatsCycles[0];
    if (!first) return null;
    const g = first.phaseGreens;
    return {
      phaseGreens: [g[0] ?? 20, g[1] ?? 30, g[2] ?? 20, g[3] ?? 30] as [
        number,
        number,
        number,
        number,
      ],
      cycleLength: first.cycleLength,
    };
  }, [periods, period]);

  // Load data on mount and whenever source changes
  useEffect(() => {
    async function init() {
      const data = await loadEmbeddedSite36Data();
      if (data) {
        setPeriods(data.periods);
      } else {
        console.error("Site 36 generated dataset is unavailable");
      }
    }
    init();
  }, []);

  const handlePhaseChange = useCallback((index: number, value: number) => {
    setPhaseConfig((prev) => {
      const greens = [...prev.greens] as [number, number, number, number];
      greens[index] = Math.max(5, Math.min(index % 2 === 0 ? 40 : 20, value));
      return { ...prev, greens };
    });
  }, []);

  const handleStart = useCallback(() => {
    if (!periods) return;

    const periodData = periods[period];
    if (!periodData) return;
    const arrivals = applyTrafficTestDivisor(periodData.arrivals);
    const detectorCalibration = buildDetectorCalibration(
      periodData.detectorIntervals,
    );

    // Create player engine with fixed timing
    if (activeModels.player) {
      const playerController = new FixedSignalController(phaseConfig);
      const playerEngine = new SimulationEngine(
        arrivals,
        playerController,
        periodData.pedestrianRuns ?? [],
        detectorCalibration ?? undefined,
      );
      playerEngineRef.current = playerEngine;
    } else {
      playerEngineRef.current = null;
    }

    // Create AI engine
    if (activeModels.ai) {
      const aiController = new AISignalController();
      aiControllerRef.current = aiController;
      const aiEngine = new SimulationEngine(
        arrivals,
        aiController,
        periodData.pedestrianRuns ?? [],
        detectorCalibration ?? undefined,
      );
      aiEngineRef.current = aiEngine;
    } else {
      aiEngineRef.current = null;
      aiControllerRef.current = null;
    }

    // Create SCATS engine (historical replay by default).
    if (activeModels.liveScats) {
      const liveScatsController = USE_LEGACY_LIVE_SCATS
        ? new LiveScatsController()
        : new ScatsReplayController(
            periodData.scatsPhaseTimeline ?? [],
            periodData.scatsCycles ?? [],
            periodData.signalGroupTransitions ?? [],
          );
      liveScatsControllerRef.current = liveScatsController;
      const liveScatsEngine = new SimulationEngine(
        arrivals,
        liveScatsController,
        periodData.pedestrianRuns ?? [],
        detectorCalibration ?? undefined,
      );
      liveScatsEngineRef.current = liveScatsEngine;
    } else {
      liveScatsEngineRef.current = null;
      liveScatsControllerRef.current = null;
    }

    setPlayerResult(null);
    setAiResult(null);
    setLiveScatsResult(null);
    setCrmMessages([]);
    crmReportedRef.current = new Set();
    crmQueueCountsRef.current = new Map();
    crmLastTemplateRef.current = null;
    setLivePlayerPhaseDelay(ZERO_PHASE_DELAYS);
    setPlayerSignalProgress(null);
    setLiveAiPhaseDelay(ZERO_PHASE_DELAYS);
    setLiveLiveScatsPhaseDelay(ZERO_PHASE_DELAYS);
    setLivePlayerPhaseGrowing(ZERO_PHASE_ACTIVITY);
    setLiveAiPhaseGrowing(ZERO_PHASE_ACTIVITY);
    setLiveLiveScatsPhaseGrowing(ZERO_PHASE_ACTIVITY);
    prevPlayerPhaseDelayRef.current = ZERO_PHASE_DELAYS;
    prevAiPhaseDelayRef.current = ZERO_PHASE_DELAYS;
    prevLiveScatsPhaseDelayRef.current = ZERO_PHASE_DELAYS;
    setGameState("RUNNING");
  }, [periods, period, phaseConfig, activeModels]);

  const handleReset = useCallback(() => {
    playerEngineRef.current = null;
    aiEngineRef.current = null;
    aiControllerRef.current = null;
    liveScatsEngineRef.current = null;
    liveScatsControllerRef.current = null;
    setPlayerResult(null);
    setAiResult(null);
    setLiveScatsResult(null);
    setLivePlayerVehicles(0);
    setLivePlayerDelay(0);
    setLiveAiVehicles(0);
    setLiveAiDelay(0);
    setLiveLiveScatsVehicles(0);
    setLiveLiveScatsDelay(0);
    setSimTime(0);
    setCurrentPhase(0);
    setPlayerSignalProgress(null);
    setAiSimTime(0);
    setAiCurrentPhase(0);
    setAiCycleInfo(null);
    setLiveScatsSimTime(0);
    setLiveScatsCurrentPhase(0);
    setLiveScatsCycleInfo(null);
    setLivePlayerPhaseDelay(ZERO_PHASE_DELAYS);
    setLiveAiPhaseDelay(ZERO_PHASE_DELAYS);
    setLiveLiveScatsPhaseDelay(ZERO_PHASE_DELAYS);
    setLivePlayerPhaseGrowing(ZERO_PHASE_ACTIVITY);
    setLiveAiPhaseGrowing(ZERO_PHASE_ACTIVITY);
    setLiveLiveScatsPhaseGrowing(ZERO_PHASE_ACTIVITY);
    prevPlayerPhaseDelayRef.current = ZERO_PHASE_DELAYS;
    prevAiPhaseDelayRef.current = ZERO_PHASE_DELAYS;
    prevLiveScatsPhaseDelayRef.current = ZERO_PHASE_DELAYS;
    setCrmMessages([]);
    crmReportedRef.current = new Set();
    crmQueueCountsRef.current = new Map();
    crmLastTemplateRef.current = null;
    setGameState("SETUP");
  }, []);

  const handlePauseToggle = useCallback(() => {
    setGameState((prev) => {
      if (prev === "RUNNING") return "PAUSED";
      if (prev === "PAUSED") return "RUNNING";
      return prev;
    });
  }, []);

  const handleTick = useCallback(
    (
      playerSnap: SimulationSnapshot | null,
      aiSnap: SimulationSnapshot | null,
      liveScatsSnap: SimulationSnapshot | null,
    ) => {
      const freshMessages: CrmMessage[] = [];

      const scanSnapshotForComplaints = (
        snap: SimulationSnapshot | null,
        modelKey: "player" | "ai" | "liveScats",
        modelLabel: string,
      ) => {
        if (!snap) return;

        for (const car of snap.cars) {
          if (car.waitingTimeSeconds < CRM_WAIT_THRESHOLD_SECONDS) continue;

          const complaintId = `${modelKey}-${car.id}`;
          if (crmReportedRef.current.has(complaintId)) continue;
          crmReportedRef.current.add(complaintId);

          const queueId = `${modelKey}-${car.approach}-${car.movement}`;
          const queueComplaintCount =
            crmQueueCountsRef.current.get(queueId) ?? 0;

          if (
            !shouldEmitComplaintForQueue(
              complaintId,
              queueComplaintCount,
              car.waitingTimeSeconds,
            )
          ) {
            continue;
          }

          const actual = car.waitingTimeSeconds;
          const perceived = perceivedWaitSeconds(actual, complaintId);
          const movement = movementLabel(car.movement);
          const approach = approachLabel(car.approach);
          const sender = pickName(complaintId);
          const perceivedPhrase = perceivedWaitPhrase(complaintId, perceived);
          const { text, templateKey } = buildComplaintText(
            complaintId,
            movement,
            approach,
            perceivedPhrase,
            crmLastTemplateRef.current,
          );
          crmLastTemplateRef.current = templateKey;
          crmQueueCountsRef.current.set(queueId, queueComplaintCount + 1);

          freshMessages.push({
            id: `${complaintId}-${Math.round(snap.time)}`,
            simTime: snap.time,
            modelLabel,
            sender,
            timestamp: chatTimestamp(),
            text,
          });
        }
      };

      scanSnapshotForComplaints(playerSnap, "player", "Your Timing");
      scanSnapshotForComplaints(aiSnap, "ai", "AI Timing");
      scanSnapshotForComplaints(liveScatsSnap, "liveScats", "SCATS");

      if (freshMessages.length > 0) {
        setCrmMessages((prev) =>
          [...freshMessages.reverse(), ...prev].slice(0, MAX_CRM_MESSAGES),
        );
      }

      if (playerSnap) {
        setLivePlayerVehicles(playerSnap.vehiclesServed);
        setLivePlayerDelay(playerSnap.totalDelay);
        setPlayerSignalProgress(playerSnap.fixedSignalProgress ?? null);
        setLivePlayerPhaseDelay(playerSnap.phaseDelaySeconds);
        setLivePlayerPhaseGrowing(
          detectPhaseGrowth(
            prevPlayerPhaseDelayRef.current,
            playerSnap.phaseDelaySeconds,
          ),
        );
        prevPlayerPhaseDelayRef.current = playerSnap.phaseDelaySeconds;
      } else {
        setPlayerSignalProgress(null);
        setLivePlayerPhaseGrowing(ZERO_PHASE_ACTIVITY);
      }

      if (aiSnap) {
        setLiveAiVehicles(aiSnap.vehiclesServed);
        setLiveAiDelay(aiSnap.totalDelay);
        setAiSimTime(aiSnap.time);
        setAiCurrentPhase(aiSnap.currentPhase);
        setLiveAiPhaseDelay(aiSnap.phaseDelaySeconds);
        setLiveAiPhaseGrowing(
          detectPhaseGrowth(
            prevAiPhaseDelayRef.current,
            aiSnap.phaseDelaySeconds,
          ),
        );
        prevAiPhaseDelayRef.current = aiSnap.phaseDelaySeconds;
      } else {
        setLiveAiPhaseGrowing(ZERO_PHASE_ACTIVITY);
      }

      if (liveScatsSnap) {
        setLiveLiveScatsVehicles(liveScatsSnap.vehiclesServed);
        setLiveLiveScatsDelay(liveScatsSnap.totalDelay);
        setLiveScatsSimTime(liveScatsSnap.time);
        setLiveScatsCurrentPhase(liveScatsSnap.currentPhase);
        setLiveLiveScatsPhaseDelay(liveScatsSnap.phaseDelaySeconds);
        setLiveLiveScatsPhaseGrowing(
          detectPhaseGrowth(
            prevLiveScatsPhaseDelayRef.current,
            liveScatsSnap.phaseDelaySeconds,
          ),
        );
        prevLiveScatsPhaseDelayRef.current = liveScatsSnap.phaseDelaySeconds;
      } else {
        setLiveLiveScatsPhaseGrowing(ZERO_PHASE_ACTIVITY);
      }

      const primarySnap = playerSnap ?? aiSnap ?? liveScatsSnap;
      if (primarySnap) {
        setSimTime(primarySnap.time);
        setCurrentPhase(primarySnap.currentPhase);
      }

      // Update AI cycle info from the controller
      if (aiControllerRef.current && aiSnap) {
        const info = aiControllerRef.current.getCurrentCycleInfo(aiSnap.time);
        setAiCycleInfo({
          phaseGreens: info.phaseGreens as [number, number, number, number],
          cycleLength: info.cycleLength,
          cycleCount: aiControllerRef.current.getCycleCount(),
          cycleStartTime: info.cycleStart,
        });
      }

      // Update SCATS cycle info from the controller
      if (liveScatsControllerRef.current && liveScatsSnap) {
        const info = liveScatsControllerRef.current.getCurrentCycleInfo(
          liveScatsSnap.time,
        );
        setLiveScatsCycleInfo({
          phaseGreens: info.phaseGreens as [number, number, number, number],
          cycleLength: info.cycleLength,
          cycleCount: liveScatsControllerRef.current.getCycleCount(),
          cycleStartTime: info.cycleStart,
        });
      }
    },
    [],
  );

  const handleComplete = useCallback(() => {
    if (playerEngineRef.current) {
      setPlayerResult(playerEngineRef.current.getResult());
    }
    if (aiEngineRef.current) {
      setAiResult(aiEngineRef.current.getResult());
    }
    if (liveScatsEngineRef.current) {
      setLiveScatsResult(liveScatsEngineRef.current.getResult());
    }
    setGameState("COMPLETE");
  }, []);

  if (!periods) {
    return (
      <div style={styles.loading}>
        <div style={styles.loadingText}>Loading traffic data...</div>
      </div>
    );
  }


      <footer className="app-footer" style={styles.footer}>
        <div>
          <strong>Hamilton City Council</strong>
          <span className="app-footer-label">Traffic signal simulation demo</span>
        </div>
        <div className="app-footer-meta">
          <span>Version {APP_VERSION}</span>
          <span>Build {BUILD_DATE}</span>
        </div>
        <img
          className="app-footer-qr"
          src={qrCodePlaceholderUrl}
          alt="QR code placeholder for the conference demo"
          width="48"
          height="48"
        />
      </footer>
  const periodData = periods[period];
  const showAi = activeModels.ai;
  const showLiveScats = activeModels.liveScats;

  // Build chart row items
  const chartPanels: Array<{ key: string; node: React.ReactNode }> = [];
  if (activeModels.player) {
    chartPanels.push({
      key: "player",
      node: (
        <PlayerCyclePie
          phaseConfig={phaseConfig}
          simTime={simTime}
          currentPhase={currentPhase}
          signalProgress={playerSignalProgress}
          isSimulationActive={gameState !== "SETUP"}
        />
      ),
    });
  }
  if (showAi && aiCycleInfo) {
    chartPanels.push({
      key: "ai",
      node: (
        <AICyclePie
          phaseGreens={aiCycleInfo.phaseGreens}
          cycleLength={aiCycleInfo.cycleLength}
          cycleCount={aiCycleInfo.cycleCount}
          simTime={aiSimTime}
          cycleStartTime={aiCycleInfo.cycleStartTime}
          currentPhase={aiCurrentPhase}
        />
      ),
    });
  }
  if (showLiveScats) {
    if (liveScatsCycleInfo) {
      chartPanels.push({
        key: "liveScats",
        node: (
          <LiveScatsCyclePie
            phaseGreens={liveScatsCycleInfo.phaseGreens}
            cycleLength={liveScatsCycleInfo.cycleLength}
            cycleCount={liveScatsCycleInfo.cycleCount}
            simTime={liveScatsSimTime}
            cycleStartTime={liveScatsCycleInfo.cycleStartTime}
            currentPhase={liveScatsCurrentPhase}
            darkMode={darkMode}
          />
        ),
      });
    } else if (gameState === "SETUP" && scatsPreviewCycle) {
      chartPanels.push({
        key: "liveScats-preview",
        node: (
          <LiveScatsCyclePie
            phaseGreens={scatsPreviewCycle.phaseGreens}
            cycleLength={scatsPreviewCycle.cycleLength}
            cycleCount={0}
            simTime={0}
            cycleStartTime={0}
            currentPhase={0}
            darkMode={darkMode}
          />
        ),
      });
    }
  }

  return (
    <div style={styles.app}>
      {/* Header */}
      <header className="app-header" style={styles.header}>
        <div>
          <h1 style={styles.appTitle}>Are You Smarter Than SCATS?</h1>
          <p style={styles.appSubtitle}>
            Set your signal timings. Beat the adaptive system. (Good luck.)
          </p>
        </div>
        <div className="app-header-actions" style={styles.headerActions}>
          <div
            style={styles.viewModeControl}
            role="group"
            aria-label="View mode"
          >
            {(["2d", "3d"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                style={{
                  ...styles.viewModeButton,
                  ...(viewMode === mode ? styles.viewModeButtonActive : {}),
                }}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            style={{
              ...styles.crmToggleButton,
              background: showCrmInbox
                ? "var(--highlight-bg)"
                : "var(--bg-surface-2)",
              color: showCrmInbox
                ? "var(--highlight-text)"
                : "var(--text-muted)",
              borderColor: showCrmInbox ? "#4a9eff" : "var(--border-color)",
            }}
            onClick={() => setShowCrmInbox((prev) => !prev)}
          >
            CRM Inbox: {showCrmInbox ? "On" : "Off"}
          </button>
          <button
            style={{
              ...styles.crmToggleButton,
              background: showRoadArrows
                ? "var(--highlight-bg)"
                : "var(--bg-surface-2)",
              color: showRoadArrows
                ? "var(--highlight-text)"
                : "var(--text-muted)",
              borderColor: showRoadArrows ? "#4a9eff" : "var(--border-color)",
            }}
            onClick={() => setShowRoadArrows((prev) => !prev)}
          >
            Road Arrows: {showRoadArrows ? "On" : "Off"}
          </button>
          <button
            style={{
              ...styles.crmToggleButton,
              background: "var(--bg-surface-2)",
              color: "var(--text-muted)",
              borderColor: "var(--border-color)",
            }}
            onClick={() => setDarkMode((prev) => !prev)}
          >
            {darkMode ? "☀ Light" : "☾ Dark"}
          </button>
          <button style={styles.helpButton} onClick={() => setShowHelp(true)}>
            ? Help
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="app-main-layout" style={styles.mainLayout}>
        {/* Left sidebar: Controls */}
        <div style={styles.sidebar}>
          <ControlsPanel
            phaseConfig={phaseConfig}
            onPhaseChange={handlePhaseChange}
            period={period}
            onPeriodChange={setPeriod}
            speedMultiplier={speedMultiplier}
            onSpeedChange={setSpeedMultiplier}
            gameState={gameState}
            onStart={handleStart}
            onReset={handleReset}
            onPauseToggle={handlePauseToggle}
            detectorVolumeProfile={detectorVolumeProfile}
            activeModels={activeModels}
            darkMode={darkMode}
          />
        </div>

        {/* Center: Canvas + Timeline */}
        <div style={styles.center}>
          {chartPanels.length > 0 && (
            <div style={styles.chartRow}>
              {chartPanels.map((cp) => (
                <div key={cp.key} style={styles.chartPanel}>
                  {cp.node}
                </div>
              ))}
            </div>
          )}
          <SimulationCanvas
            playerEngine={playerEngineRef.current}
            aiEngine={aiEngineRef.current}
            liveScatsEngine={liveScatsEngineRef.current}
            isRunning={gameState === "RUNNING"}
            showSetupFrame={gameState === "SETUP"}
            speedMultiplier={speedMultiplier}
            activeModels={activeModels}
            simulationDuration={periodData.endTime}
            crmMessages={crmMessages}
            showCrmInbox={showCrmInbox}
            darkMode={darkMode}
            showRoadArrows={showRoadArrows}
            viewMode={viewMode}
            on3DUnavailable={() => setViewMode("2d")}
            onTick={handleTick}
            onComplete={handleComplete}
          />
        </div>

        {/* Right sidebar: Scoreboard */}
        <div style={styles.sidebar}>
          <Scoreboard
            gameState={gameState}
            playerResult={playerResult}
            playerScoreCode={playerScoreCode}
            aiResult={aiResult}
            liveScatsResult={liveScatsResult}
            hasAi={showAi}
            hasPlayer={activeModels.player}
            hasLiveScats={showLiveScats}
            livePlayerVehicles={livePlayerVehicles}
            livePlayerDelay={livePlayerDelay}
            liveAiVehicles={liveAiVehicles}
            liveAiDelay={liveAiDelay}
            liveLiveScatsVehicles={liveLiveScatsVehicles}
            liveLiveScatsDelay={liveLiveScatsDelay}
            simTime={simTime}
            currentPhase={currentPhase}
            period={period}
            periodDuration={periodData.endTime}
            livePlayerPhaseDelay={livePlayerPhaseDelay}
            liveAiPhaseDelay={liveAiPhaseDelay}
            liveLiveScatsPhaseDelay={liveLiveScatsPhaseDelay}
            livePlayerPhaseGrowing={livePlayerPhaseGrowing}
            liveAiPhaseGrowing={liveAiPhaseGrowing}
            liveLiveScatsPhaseGrowing={liveLiveScatsPhaseGrowing}
            darkMode={darkMode}
          />
        </div>
      </div>

      {/* Help overlay */}
      <HelpOverlay isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: "var(--bg-primary)",
    padding: 20,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "var(--bg-primary)",
  },
  loadingText: {
    color: "var(--text-faint)",
    fontSize: 18,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: "1px solid var(--header-border)",
  },
  appTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
    color: "var(--text-primary)",
    letterSpacing: -0.5,
  },
  appSubtitle: {
    margin: "4px 0 0 0",
    fontSize: 14,
    color: "var(--text-faint)",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  viewModeControl: {
    display: "flex",
    padding: 2,
    gap: 2,
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-surface-2)",
  },
  viewModeButton: {
    padding: "6px 9px",
    border: 0,
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  },
  viewModeButtonActive: {
    background: "var(--highlight-bg)",
    color: "var(--highlight-text)",
  },
  crmToggleButton: {
    padding: "8px 12px",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  helpButton: {
    padding: "8px 16px",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
  mainLayout: {
    display: "flex",
    gap: 20,
    alignItems: "flex-start",
  },
  sidebar: {
    flexShrink: 0,
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    minWidth: 0,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 24,
    paddingTop: 12,
    borderTop: "1px solid var(--header-border)",
    color: "var(--text-muted)",
    fontSize: 11,
  },
  chartRow: {
    display: "flex",
    gap: 20,
    minWidth: 0,
  },
  chartPanel: {
    flex: 1,
    minWidth: 0,
  },
};

export default App;
