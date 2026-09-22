"""
Extract SCATS data from SQL Server for the traffic signal timing game.

Queries detector volumes and phase green times, then outputs a JSON file
per intersection per day for the web app to consume.

Usage:
    python extract_scats.py --intersection 1234 --date 2024-03-15 --server SQLSERVER --db SCATS

Output is written to ../public/data/<intersection>_<date>.json
and the manifest.json is updated to include the new file.
"""

import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    import pyodbc
except ImportError:
    print("pyodbc not installed. Install with: pip install pyodbc")
    print("This script requires a connection to the SCATS SQL Server database.")
    sys.exit(1)


# Peak period definitions (times relative to midnight, in seconds)
PERIODS = {
    "AM": {"label": "AM Peak", "start": 7 * 3600 + 45 * 60, "end": 8 * 3600 + 45 * 60},
    "SCHOOL": {"label": "School", "start": 14 * 3600 + 30 * 60, "end": 15 * 3600 + 30 * 60},
    "PM": {"label": "PM Peak", "start": 16 * 3600 + 30 * 60, "end": 17 * 3600 + 30 * 60},
}

# Approach mapping — maps SCATS detector IDs to approach directions
# Detector numbering (left|right):
# North 1|2, West 3|4, South 5|6, East 7|8
# This may still need to be configured per intersection.
APPROACH_MAP = {
    1: "N",
    2: "N",
    3: "W",
    4: "W",
    5: "S",
    6: "S",
    7: "E",
    8: "E",
}

# Phase-to-approach mapping
# Phase 1: N↔S Right Turns, Phase 2: N↔S Through+Left
# Phase 3: E↔W Right Turns, Phase 4: E↔W Through+Left
PHASE_APPROACHES = {
    1: [("N", "right"), ("S", "right")],
    2: [("N", "straight"), ("N", "left"), ("S", "straight"), ("S", "left")],
    3: [("E", "right"), ("W", "right")],
    4: [("E", "straight"), ("E", "left"), ("W", "straight"), ("W", "left")],
}


def connect_db(server: str, database: str) -> "pyodbc.Connection":
    """Connect to SQL Server using Windows authentication."""
    conn_str = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={server};DATABASE={database};Trusted_Connection=yes;"
    return pyodbc.connect(conn_str)


def fetch_volumes(conn, intersection: str, date: str) -> list[dict]:
    """
    Fetch 5-minute detector volumes.
    Returns list of {time_seconds, approach, lane, volume}.
    """
    query = """
    SELECT
        DATEDIFF(SECOND, CAST(QT_INTERVAL_START AS DATE), QT_INTERVAL_START) as time_seconds,
        NB_DETECTOR as detector_id,
        NB_LANE as lane,
        NB_VOLUME as volume
    FROM dbo.VSDATA
    WHERE NB_SITE_NO = ?
      AND CAST(QT_INTERVAL_START AS DATE) = ?
    ORDER BY QT_INTERVAL_START, NB_DETECTOR
    """
    cursor = conn.cursor()
    cursor.execute(query, (intersection, date))

    volumes = []
    for row in cursor.fetchall():
        time_sec = row.time_seconds
        detector_id = row.detector_id
        approach = APPROACH_MAP.get(detector_id, None)
        if approach is None:
            continue
        volumes.append(
            {
                "time_seconds": time_sec,
                "approach": approach,
                "lane": row.lane,
                "volume": row.volume,
            }
        )

    return volumes


def fetch_phase_data(conn, intersection: str, date: str) -> list[dict]:
    """
    Fetch SCATS phase green times per cycle.
    Returns list of {cycle_start, cycle_length, phase_greens: [p1, p2, p3, p4]}.
    """
    query = """
    SELECT
        DATEDIFF(SECOND, CAST(QT_CYCLE_START AS DATE), QT_CYCLE_START) as cycle_start,
        NB_CYCLE_LENGTH as cycle_length,
        NB_PHASE_1_GREEN as p1_green,
        NB_PHASE_2_GREEN as p2_green,
        NB_PHASE_3_GREEN as p3_green,
        NB_PHASE_4_GREEN as p4_green
    FROM dbo.PHASE_DATA
    WHERE NB_SITE_NO = ?
      AND CAST(QT_CYCLE_START AS DATE) = ?
    ORDER BY QT_CYCLE_START
    """
    cursor = conn.cursor()
    cursor.execute(query, (intersection, date))

    cycles = []
    for row in cursor.fetchall():
        cycles.append(
            {
                "cycle_start": row.cycle_start,
                "cycle_length": row.cycle_length,
                "phase_greens": [row.p1_green, row.p2_green, row.p3_green, row.p4_green],
            }
        )

    return cycles


def disaggregate_volumes(volumes: list[dict], period_start: int, period_end: int) -> list[dict]:
    """
    Convert 5-minute volume counts into individual vehicle arrivals
    using a Poisson process.

    Each vehicle gets:
    - arrival time (relative to period start)
    - approach (N/S/E/W)
    - movement (straight/left/right) — randomly assigned
    - lane (0 = through+left, 1 = right-turn)
    """
    arrivals = []
    vehicle_id = 0

    # Filter volumes to the period
    period_volumes = [v for v in volumes if period_start <= v["time_seconds"] < period_end]

    for vol in period_volumes:
        interval_start = vol["time_seconds"] - period_start
        count = vol["volume"]
        approach = vol["approach"]

        if count <= 0:
            continue

        # Poisson process: generate inter-arrival times
        rate = count / 300.0  # vehicles per second over 5-min interval
        t = interval_start

        for _ in range(count):
            u = random.random()
            if u == 0:
                u = 1e-10
            inter_arrival = -math.log(u) / rate
            t += inter_arrival

            # Clamp to interval
            if t >= interval_start + 300:
                break

            # Assign movement randomly
            movement_roll = random.random()
            if movement_roll < 0.65:
                movement = "straight"
            elif movement_roll < 0.85:
                movement = "left"
            else:
                movement = "right"

            lane = 1 if movement == "right" else 0

            arrivals.append(
                {
                    "id": vehicle_id,
                    "time": round(t, 2),
                    "approach": approach,
                    "movement": movement,
                    "lane": lane,
                }
            )
            vehicle_id += 1

    # Sort by time and re-assign sequential IDs
    arrivals.sort(key=lambda a: a["time"])
    for i, a in enumerate(arrivals):
        a["id"] = i

    return arrivals


def build_period_data(
    volumes: list[dict],
    cycles: list[dict],
    period_key: str,
) -> dict:
    """Build a period data block for the JSON output."""
    period_def = PERIODS[period_key]
    start = period_def["start"]
    end = period_def["end"]

    arrivals = disaggregate_volumes(volumes, start, end)

    # Filter cycles to this period, adjust times relative to period start
    period_cycles = []
    for c in cycles:
        if start <= c["cycle_start"] < end:
            period_cycles.append(
                {
                    "cycleStart": round(c["cycle_start"] - start, 2),
                    "cycleLength": c["cycle_length"],
                    "phaseGreens": c["phase_greens"],
                }
            )

    return {
        "label": period_def["label"],
        "startTime": 0,
        "endTime": end - start,
        "arrivals": arrivals,
        "scatsCycles": period_cycles,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract SCATS data for traffic signal game")
    parser.add_argument("--intersection", required=True, help="SCATS site number")
    parser.add_argument("--date", required=True, help="Date (YYYY-MM-DD)")
    parser.add_argument("--server", required=True, help="SQL Server name")
    parser.add_argument("--db", required=True, help="Database name")
    parser.add_argument("--output-dir", default=None, help="Output directory (default: ../public/data/)")
    args = parser.parse_args()

    # Output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = Path(__file__).parent.parent / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Connecting to {args.server}/{args.db}...")
    conn = connect_db(args.server, args.db)

    print(f"Fetching volumes for intersection {args.intersection} on {args.date}...")
    volumes = fetch_volumes(conn, args.intersection, args.date)
    print(f"  Found {len(volumes)} volume records")

    print("Fetching phase data...")
    cycles = fetch_phase_data(conn, args.intersection, args.date)
    print(f"  Found {len(cycles)} cycle records")

    conn.close()

    # Build output
    output = {
        "intersection": args.intersection,
        "date": args.date,
        "periods": {},
    }

    for period_key in ["AM", "SCHOOL", "PM"]:
        print(f"Processing {period_key} period...")
        output["periods"][period_key] = build_period_data(volumes, cycles, period_key)
        n_arrivals = len(output["periods"][period_key]["arrivals"])
        n_cycles = len(output["periods"][period_key]["scatsCycles"])
        print(f"  {n_arrivals} arrivals, {n_cycles} SCATS cycles")

    # Write JSON
    filename = f"{args.intersection}_{args.date}.json"
    filepath = output_dir / filename
    with open(filepath, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Written to {filepath}")

    # Update manifest
    manifest_path = output_dir / "manifest.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            manifest = json.load(f)
    else:
        manifest = {"files": []}

    if filename not in manifest["files"]:
        manifest["files"].append(filename)
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)
        print(f"Updated manifest.json")

    print("Done!")


if __name__ == "__main__":
    main()
