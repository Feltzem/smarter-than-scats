import { site36Data } from "./site36Data.generated";
import type { DetectorInterval, IntersectionData, PeriodKey } from "./types";

export type ScatsDataSource = "generated-site36";

export interface DetectorVolumeProfile {
  labels: string[];
  detectorSeries: Record<number, number[]>;
}

const PERIOD_FILE = "36_20260225.json";

/** Load the checked-in, generated Site 36 artifact. */
export async function loadIntersectionData(
  intersection: string,
  date: string,
): Promise<IntersectionData | null> {
  if (intersection === "36" && date === "20260225") return site36Data;

  try {
    const dataPath = `${import.meta.env.BASE_URL}data/${intersection}_${date}.json`;
    const response = await fetch(dataPath);
    if (!response.ok) return null;
    return (await response.json()) as IntersectionData;
  } catch {
    return null;
  }
}

export async function loadEmbeddedSite36Data(): Promise<IntersectionData | null> {
  return loadIntersectionData("36", "20260225");
}

export async function checkScatsDataExists(): Promise<{
  exists: boolean;
  files: string[];
}> {
  return { exists: true, files: [PERIOD_FILE] };
}

export function getSmoothedSite36DetectorVolumes(
  period: PeriodKey,
): DetectorVolumeProfile {
  const rows = site36Data.periods[period].detectorIntervals;
  const starts = [...new Set(rows.map((row) => row.startTime))].sort(
    (a, b) => a - b,
  );
  const labels = starts.map((seconds) => formatSeconds(seconds));
  const detectorSeries: Record<number, number[]> = {};

  for (let detector = 1; detector <= 8; detector++) {
    const byStart = new Map<number, DetectorInterval>();
    rows
      .filter((row) => row.detectorId === detector)
      .forEach((row) => byStart.set(row.startTime, row));
    detectorSeries[detector] = starts.map(
      (start) => byStart.get(start)?.count ?? 0,
    );
  }

  return { labels, detectorSeries };
}

function formatSeconds(seconds: number): string {
  const hour = Math.floor(seconds / 3600) % 24;
  const minute = Math.floor((seconds % 3600) / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
