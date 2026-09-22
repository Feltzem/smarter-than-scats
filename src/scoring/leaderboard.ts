import type { PhaseConfig, PeriodKey, SimulationResult } from "../data/types";

export const LEADERBOARD_STORAGE_KEY = "smarter-than-scats:leaderboard:v1";
export const MAX_LEADERBOARD_ENTRIES = 100;

export interface LeaderboardEntry {
  id: string;
  name: string;
  period: PeriodKey;
  phaseGreens: PhaseConfig["greens"];
  totalDelay: number;
  totalDelayHours: number;
  averageDelay: number;
  vehiclesServed: number;
  vehiclesEntered: number;
  pedestriansCrossed: number;
  maxVehiclesInNetwork: number;
  phaseDelaySeconds: SimulationResult["phaseDelaySeconds"];
  scoreCode: string;
  createdAt: string;
}

export interface LeaderboardEntryInput {
  name: string;
  period: PeriodKey;
  phaseGreens: PhaseConfig["greens"];
  result: SimulationResult;
  scoreCode: string;
  createdAt?: string;
}

export function normalizeLeaderboardName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 24);
}

export function createLeaderboardEntry({
  name,
  period,
  phaseGreens,
  result,
  scoreCode,
  createdAt = new Date().toISOString(),
}: LeaderboardEntryInput): LeaderboardEntry {
  const normalizedName = normalizeLeaderboardName(name);
  if (!normalizedName) {
    throw new Error("A leaderboard name is required");
  }

  return {
    id: createEntryId(),
    name: normalizedName,
    period,
    phaseGreens: [...phaseGreens] as PhaseConfig["greens"],
    totalDelay: result.totalDelay,
    totalDelayHours: result.totalDelayHours,
    averageDelay: result.averageDelay,
    vehiclesServed: result.vehiclesServed,
    vehiclesEntered: result.vehiclesEntered,
    pedestriansCrossed: result.pedestriansCrossed,
    maxVehiclesInNetwork: result.maxVehiclesInNetwork,
    phaseDelaySeconds: [...result.phaseDelaySeconds] as SimulationResult["phaseDelaySeconds"],
    scoreCode,
    createdAt,
  };
}

export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    const delayDifference = a.totalDelay - b.totalDelay;
    if (delayDifference !== 0) return delayDifference;

    const timeDifference = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (Number.isFinite(timeDifference) && timeDifference !== 0) {
      return timeDifference;
    }

    return a.id.localeCompare(b.id);
  });
}

export function loadLeaderboard(): LeaderboardEntry[] {
  if (!canUseLocalStorage()) return [];

  try {
    const raw = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return sortLeaderboard(parsed.filter(isLeaderboardEntry)).slice(
      0,
      MAX_LEADERBOARD_ENTRIES,
    );
  } catch {
    return [];
  }
}

export function addLeaderboardEntry(entry: LeaderboardEntry): LeaderboardEntry[] {
  const entries = sortLeaderboard([...loadLeaderboard(), entry]).slice(
    0,
    MAX_LEADERBOARD_ENTRIES,
  );

  if (canUseLocalStorage()) {
    try {
      window.localStorage.setItem(
        LEADERBOARD_STORAGE_KEY,
        JSON.stringify(entries),
      );
    } catch {
      // Keep the current session's leaderboard in memory if storage is blocked.
    }
  }

  return entries;
}

export function leaderboardToCsv(entries: LeaderboardEntry[]): string {
  const headers = [
    "rank",
    "name",
    "period",
    "total_delay_seconds",
    "total_delay_hours",
    "average_delay_seconds_per_vehicle",
    "vehicles_served",
    "vehicles_entered",
    "pedestrians_crossed",
    "max_vehicles_in_network",
    "phase_a_green_seconds",
    "phase_b_green_seconds",
    "phase_c_green_seconds",
    "phase_d_green_seconds",
    "phase_a_delay_seconds",
    "phase_b_delay_seconds",
    "phase_c_delay_seconds",
    "phase_d_delay_seconds",
    "score_code",
    "created_at",
  ];
  const sorted = sortLeaderboard(entries);
  const rows = sorted.map((entry, index) => [
    index + 1,
    entry.name,
    entry.period,
    entry.totalDelay,
    entry.totalDelayHours,
    entry.averageDelay,
    entry.vehiclesServed,
    entry.vehiclesEntered,
    entry.pedestriansCrossed,
    entry.maxVehiclesInNetwork,
    ...entry.phaseGreens,
    ...entry.phaseDelaySeconds,
    entry.scoreCode,
    entry.createdAt,
  ]);

  return [headers, ...rows]
    .map((row) => row.map((value) => csvCell(String(value))).join(","))
    .join("\r\n")
    .concat("\r\n");
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function createEntryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== "object") return false;

  const entry = value as Partial<LeaderboardEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    (entry.period === "AM" ||
      entry.period === "SCHOOL" ||
      entry.period === "PM") &&
    Array.isArray(entry.phaseGreens) &&
    entry.phaseGreens.length === 4 &&
    entry.phaseGreens.every((value) => typeof value === "number") &&
    typeof entry.totalDelay === "number" &&
    typeof entry.totalDelayHours === "number" &&
    typeof entry.averageDelay === "number" &&
    typeof entry.vehiclesServed === "number" &&
    typeof entry.vehiclesEntered === "number" &&
    typeof entry.pedestriansCrossed === "number" &&
    typeof entry.maxVehiclesInNetwork === "number" &&
    Array.isArray(entry.phaseDelaySeconds) &&
    entry.phaseDelaySeconds.length === 4 &&
    entry.phaseDelaySeconds.every((value) => typeof value === "number") &&
    typeof entry.scoreCode === "string" &&
    typeof entry.createdAt === "string"
  );
}
