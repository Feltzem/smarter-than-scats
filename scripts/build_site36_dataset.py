"""Decode the raw Site 36 SCATS exports into the browser data artifact."""

from __future__ import annotations

import hashlib
import json
import random
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scats_det import decode_record
from scats_hist import decode_file as decode_hist_file
from scats_hst import decode_record as decode_hst_record
from scatslib import read_records
from site36_decoder import parse_cis_identity, sha256_file, validate_binary_source


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
PUBLIC_DATA = ROOT / "public" / "data"
GENERATED_TS = DATA / "site36Data.generated.ts"
TIMEZONE = timezone(timedelta(hours=13))
DATE = "2026-02-25"
SITE = 36
DECODER_REVISION = "site36-raw-decoder-2"

PERIODS = {
    "AM": ("AM Peak", 7 * 3600 + 45 * 60),
    "SCHOOL": ("School", 14 * 3600 + 30 * 60),
    "PM": ("PM Peak", 16 * 3600 + 30 * 60),
}

PHASES = {1: "A", 2: "B", 3: "C", 4: "D"}
PHASE_INDEX = {label: index for index, label in enumerate(("A", "B", "C", "D"))}
PHASE_SIGNAL_GROUPS = {
    "A": [5, 6, 11, 12, 13, 14],
    "B": [1, 3, 9, 12, 15, 16],
    "C": [1, 2, 9, 10, 13, 14],
    "D": [3, 5, 7, 9, 11, 15, 16],
}
VEHICLE_SIGNAL_GROUPS = {
    "N": {"straight": 6, "left": 12, "right": 8},
    "W": {"straight": 2, "left": 10, "right": 4},
    "S": {"straight": 5, "left": 11, "right": 7},
    "E": {"straight": 1, "left": 9, "right": 3},
}
PEDESTRIAN_SIGNAL_GROUPS = {"P1": 16, "P2": 15, "P3": 14, "P4": 13}
EXPECTED_TOTALS = {
    "AM": [242, 22, 245, 23, 203, 53, 409, 74],
    "SCHOOL": [241, 27, 250, 25, 196, 54, 267, 61],
    "PM": [273, 26, 246, 25, 267, 31, 242, 54],
}


def conflict_matrix() -> list[list[int]]:
    matrix = [[0] * 17 for _ in range(17)]
    for a in range(1, 17):
        for b in range(a + 1, 17):
            together = any(a in groups and b in groups for groups in PHASE_SIGNAL_GROUPS.values())
            matrix[a][b] = matrix[b][a] = 0 if together else 1
    return matrix


CONFIGURATION = {
    "siteId": "36",
    "intersectionName": "Naylor / Galloway",
    "cisVersion": "3d",
    "timezone": "Pacific/Auckland",
    "phaseSequence": ["A", "B", "C", "D"],
    "minimumGreen": 5,
    "maximumGreen": [40, 20, 40, 20],
    "yellow": 4,
    "allRed": [1.5, 2, 2, 1.5],
    "vehicleSignalGroups": VEHICLE_SIGNAL_GROUPS,
    "pedestrianSignalGroups": PEDESTRIAN_SIGNAL_GROUPS,
    "phaseSignalGroups": PHASE_SIGNAL_GROUPS,
    "conflictMatrix": conflict_matrix(),
    "lateStartGroups": [7, 8, 9, 10, 11, 12],
    "detectorGapSettings": {"minimumGapSeconds": 3, "detectorHeadwaySeconds": 1.2, "filterRequiredGapSeconds": 4},
    "pedestrianTiming": {"walk": 6, "clearance": 9},
    "movementRules": {
        "8:right": "gap-filtered", "4:right": "gap-filtered",
        "3:right": "permissive", "7:right": "permissive",
        "9:left": "permissive", "10:left": "permissive",
        "11:left": "permissive", "12:left": "permissive",
    },
}


def local_datetime(epoch: int) -> datetime:
    return datetime.fromtimestamp(epoch, timezone.utc).astimezone(TIMEZONE)


def seconds_of_day(value: datetime) -> float:
    return value.hour * 3600 + value.minute * 60 + value.second + value.microsecond / 1_000_000


def interval_start(epoch: int) -> int:
    local = local_datetime(epoch)
    seconds = local.hour * 3600 + local.minute * 60 + local.second
    return (seconds // 300) * 300 - 300


def iter_decoded(path: Path, decoder):
    for record in read_records(path.read_bytes(), strict=True):
        yield decoder(record.data)


def load_hst() -> tuple[list[dict], list[dict], list[dict]]:
    terminations = []
    signal_events = []
    walk_events = []
    for record in iter_decoded(DATA / "HCC_20260225.hst", decode_hst_record):
        if record.get("recordTypeID") != 3 or record.get("siteNumber") != SITE:
            continue
        reference = record["recordCreationTimestampReference"]
        for event in record["events"]:
            event = {**event, "timestamp": reference + event["timestampOffset"]}
            if event["eventTypeID"] == 21:
                terminations.append(event)
            elif event["eventTypeID"] == 26:
                signal_events.append(event)
            elif event["eventTypeID"] == 25:
                walk_events.append(event)
    terminations.sort(key=lambda event: event["timestamp"])
    signal_events.sort(key=lambda event: event["timestamp"])
    walk_events.sort(key=lambda event: event["timestamp"])
    if len(terminations) != 3586:
        raise ValueError(f"expected 3,586 Site 36 HST phase terminations, got {len(terminations)}")
    return terminations, signal_events, walk_events


def load_hist() -> list[dict]:
    decoded = decode_hist_file(DATA / "HCC_20260225.hist")
    output = []
    current = None
    for record in decoded:
        if "currentDateTime" in record:
            current = record["currentDateTime"].replace(tzinfo=TIMEZONE)
        elif record.get("siteNumber") == SITE and current is not None:
            for termination in record["phaseTerminations"]:
                output.append({**termination, "timestamp": int((current + timedelta(seconds=termination["offset"])).timestamp())})
    return output


def load_det() -> tuple[dict[tuple[int, int], int], dict[tuple[int, int], list[dict]], int]:
    volumes: dict[tuple[int, int], int] = defaultdict(int)
    metrics: dict[tuple[int, int], list[dict]] = defaultdict(list)
    type9_count = 0
    for record in iter_decoded(DATA / "HCC_20260225.det", decode_record):
        if record.get("siteNumber") != SITE:
            continue
        timestamp = record.get("recordCreationTimestampReference")
        if timestamp is None or local_datetime(timestamp).date().isoformat() != DATE:
            continue
        start = interval_start(timestamp)
        if record["recordTypeID"] == 9:
            type9_count += 1
            for entry in record.get("trafficCountEntries", []):
                detector = entry["detNumber"]
                if 1 <= detector <= 8:
                    volumes[(start, detector)] += entry["volume"]
        elif record["recordTypeID"] == 3:
            for entry in record.get("detectorDataEntries", []):
                if 1 <= entry["detNumber"] <= 8:
                    metrics[(start, entry["detNumber"])].append({
                        "collectionType": "type-3", "count": entry["volume"],
                        "occupancy": entry["nonOccupancy"], "green": entry["collectionGreenTime"],
                        "gap": entry["gapTime"], "degreeOfSaturation": entry["rawDs"],
                    })
        elif record["recordTypeID"] == 4:
            for entry in record.get("detectorDsEntries", []):
                if 1 <= entry["detNumber"] <= 8:
                    metrics[(start, entry["detNumber"])].append({
                        "collectionType": "type-4", "count": entry["volume"],
                        "green": entry["greenTime"], "gap": entry["gapTime"],
                        "degreeOfSaturation": entry["calibratedDs"],
                    })
    return volumes, metrics, type9_count


def phase_rows(terminations: list[dict]) -> list[dict]:
    rows = []
    previous = None
    for termination in terminations:
        phase = PHASES[termination["terminatedPhase"]]
        timestamp = termination["timestamp"]
        if previous is not None and timestamp > previous["timestamp"]:
            # A termination names the phase that occupied the interval ending
            # at this timestamp, not the phase that starts after it.
            rows.append({"phase": phase, "start": previous["timestamp"], "end": timestamp,
                         "duration": timestamp - previous["timestamp"]})
        previous = {"timestamp": timestamp}
    return rows


def phase_events_for_period(phases: list[dict], start_epoch: int, end_epoch: int) -> list[dict]:
    events = []
    for row in phases:
        clipped_start = max(row["start"], start_epoch)
        clipped_end = min(row["end"], end_epoch)
        if clipped_end <= clipped_start:
            continue
        events.append({
            "phase": row["phase"],
            "phaseIndex": PHASE_INDEX[row["phase"]],
            "startTime": round(clipped_start - start_epoch, 2),
            "duration": round(clipped_end - clipped_start, 2),
        })
    return events


def aspect(status: dict) -> str:
    if status["off"]:
        return "off"
    if status["green"]:
        return "green"
    if status["yellow"]:
        return "yellow"
    if status["red"]:
        return "red"
    return "off"


def signal_transitions(events: list[dict], start_epoch: int, end_epoch: int) -> list[dict]:
    current = {group: "off" for group in range(1, 17)}
    ordered_events = sorted(events, key=lambda event: event["timestamp"])

    # Establish the state at the boundary before processing any in-period
    # transitions. Events exactly on the boundary belong to the snapshot.
    for event in ordered_events:
        timestamp = event["timestamp"]
        if timestamp > start_epoch:
            break
        for status in event["signalGroupStatuses"]:
            group = status["sgNumber"]
            if 1 <= group <= 16:
                current[group] = aspect(status)

    initial = [{"time": 0, "signalGroup": group, "aspect": value} for group, value in current.items()]
    transitions = []
    for event in ordered_events:
        timestamp = event["timestamp"]
        if timestamp <= start_epoch:
            continue
        if timestamp >= end_epoch:
            break
        for status in event["signalGroupStatuses"]:
            group = status["sgNumber"]
            if not 1 <= group <= 16:
                continue
            value = aspect(status)
            if current[group] == value:
                continue
            transitions.append({"time": round(timestamp - start_epoch, 2), "signalGroup": group, "aspect": value})
            current[group] = value
    return initial + transitions


def pedestrian_data(events: list[dict], start_epoch: int, end_epoch: int) -> tuple[list[dict], list[dict]]:
    starts: list[dict] = []
    transitions: list[dict] = []
    for event in events:
        timestamp = event["timestamp"]
        if timestamp < start_epoch or timestamp >= end_epoch:
            continue
        time = round(timestamp - start_epoch, 2)
        for walk in event["walkStatuses"]:
            group = 17 - walk["walkNumber"]
            if group not in (13, 14, 15, 16):
                continue
            for state in walk["states"]:
                if state["subtype"] == 1 and state["state"] == 1:
                    permitted = [PHASE_INDEX[p] for p, groups in PHASE_SIGNAL_GROUPS.items() if group in groups]
                    starts.append({"id": len(starts), "time": time, "signalGroup": group, "permittedPhases": permitted})
                    transitions.append({"time": time, "signalGroup": group, "state": "walk"})
                elif state["subtype"] == 1 and state["state"] == 0:
                    transitions.append({"time": time, "signalGroup": group, "state": "clearance"})
                elif state["subtype"] == 2 and state["state"] == 4:
                    transitions.append({"time": time, "signalGroup": group, "state": "stop"})
                elif state["subtype"] == 2 and state["state"] in (1, 2, 3):
                    transitions.append({"time": time, "signalGroup": group, "state": "clearance"})
    return starts, transitions


def movement(detector: int, rank: int, count: int) -> tuple[str, str, int]:
    approach = ("N", "N", "W", "W", "S", "S", "E", "E")[detector - 1]
    if detector in (2, 4, 6, 8):
        return approach, "right", 1
    return approach, ("straight" if (rank + 1) / (count + 1) <= 0.65 / 0.85 else "left"), 0


def build_period(key: str, start: int, label: str, volumes: dict, metrics: dict, phases: list, signal_events: list, walks: list) -> dict:
    end = start + 3600
    base_epoch = int(datetime(2026, 2, 25, tzinfo=TIMEZONE).timestamp())
    start_epoch = base_epoch + start
    end_epoch = base_epoch + end
    intervals = []
    arrivals = []
    for interval in range(start, end, 300):
        for detector in range(1, 9):
            count = volumes.get((interval, detector), 0)
            interval_metrics = [{"collectionType": "type-9", "count": count}, *metrics.get((interval, detector), [])]
            intervals.append({"startTime": interval - start, "endTime": interval - start + 300,
                              "detectorId": detector, "count": count, "metrics": interval_metrics})
            for rank in range(count):
                seed = hashlib.sha256(f"{key}:{interval}:{detector}:{rank}".encode()).digest()
                rng = random.Random(int.from_bytes(seed[:8], "big"))
                offset = ((rank + 1) / (count + 1)) * 300 + (rng.random() - 0.5) * 2
                approach, move, lane = movement(detector, rank, count)
                arrivals.append({"id": 0, "time": round(max(0, min(3599.99, interval - start + offset)), 2),
                                 "approach": approach, "movement": move, "lane": lane, "detectorId": detector})
    arrivals.sort(key=lambda item: (item["time"], item["detectorId"]))
    for index, arrival in enumerate(arrivals):
        arrival["id"] = index
    phase_events = phase_events_for_period(phases, start_epoch, end_epoch)
    cycles = []
    for index, row in enumerate(phase_events):
        if row["phase"] != "A":
            continue
        next_a = next((j for j in range(index + 1, len(phase_events)) if phase_events[j]["phase"] == "A"), None)
        cycle_rows = phase_events[index:next_a]
        greens = [0, 0, 0, 0]
        for phase in cycle_rows:
            greens[phase["phaseIndex"]] += phase["duration"]
        cycle_length = (phase_events[next_a]["startTime"] - row["startTime"]) if next_a is not None else sum(greens)
        cycles.append({"cycleStart": row["startTime"], "cycleLength": cycle_length, "phaseGreens": greens})
    demands, ped_transitions = pedestrian_data(walks, start_epoch, end_epoch)
    runs = [{"id": demand["id"], "startTime": demand["time"], "signalGroup": demand["signalGroup"],
             "phaseIndex": demand["permittedPhases"][0] if demand["permittedPhases"] else 0,
             "pedestrianDirections": ["N-S" if demand["signalGroup"] in (13, 14) else "W-E"]} for demand in demands]
    return {"label": label, "startTime": 0, "endTime": 3600, "arrivals": arrivals, "scatsCycles": cycles,
            "scatsPhaseTimeline": phase_events, "pedestrianRuns": runs, "detectorIntervals": intervals,
            "detectorMetrics": [metric for interval in intervals for metric in interval["metrics"]],
            "signalGroupTransitions": signal_transitions(signal_events,
                                                           start_epoch, end_epoch),
            "pedestrianDemands": demands, "pedestrianSignalTransitions": ped_transitions}


def main() -> int:
    source_names = ["HCC_20260225.hst", "HCC_20260225.hist", "HCC_20260225.det", "Site 36 Naylor Galloway CIS V3d.xlsx"]
    for name in source_names[:3]:
        validate_binary_source(DATA / name)
    identity = parse_cis_identity(DATA / source_names[-1])
    terminations, signal_events, walk_events = load_hst()
    hist_terms = load_hist()
    volumes, metrics, type9_count = load_det()
    phase_schedule = phase_rows(terminations)
    hst_term_times = [(event["timestamp"], event["terminatedPhase"]) for event in terminations]
    hist_term_times = [(event["timestamp"], event["phase"]) for event in hist_terms if event["phase"] in PHASES]
    hist_matches = sum(
        1 for timestamp, phase in hst_term_times
        if any(hist_phase == phase and abs(hist_timestamp - timestamp) <= 1
               for hist_timestamp, hist_phase in hist_term_times)
    )
    if hist_matches < 3500:
        raise ValueError(f"HIST/HST validation failed: only {hist_matches} matching terminations")
    periods = {key: build_period(key, start, label, volumes, metrics, phase_schedule, signal_events, walk_events)
               for key, (label, start) in PERIODS.items()}
    totals = {key: [sum(row["count"] for row in period["detectorIntervals"] if row["detectorId"] == detector)
                    for detector in range(1, 9)] for key, period in periods.items()}
    if totals != EXPECTED_TOTALS:
        raise ValueError(f"raw DET totals do not match acceptance values: {totals}")
    source_files = [{"name": name, "sha256": sha256_file(DATA / name)} for name in source_names]
    source_metadata = {"timezone": "Pacific/Auckland", "decoderRevision": DECODER_REVISION, "cisVersion": identity["version"],
                       "sourceFiles": source_files,
                       "extractionCounts": {"phaseTerminations": len(terminations), "hstPhaseTerminations": len(terminations),
                                             "histPhaseTerminations": len(hist_terms), "detectorIntervals": 288,
                                             "detectorType9Records": type9_count,
                                             "pedestrianCalls": sum(len(p["pedestrianDemands"]) for p in periods.values())},
                       "validation": {"site": "36", "hstHistOrder": hist_matches >= 3500, "histWithinOneSecond": True,
                                      "selectedPeriodsCovered": all(all((start, detector) in volumes for start in range(period_start, period_start + 3600, 300)
                                                                         for detector in range(1, 9)) for _, period_start in PERIODS.values()),
                                      "detectorTotals": totals, "cisIdentity": identity}}
    result = {"intersection": "36", "date": DATE, "siteConfiguration": CONFIGURATION,
              "sourceMetadata": source_metadata, "periods": periods}
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA / "36_20260225.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    GENERATED_TS.write_text("import type { IntersectionData } from \"./types\";\n\nexport const site36Data: IntersectionData = " +
                            json.dumps(result, indent=2) + ";\n", encoding="utf-8")
    (PUBLIC_DATA / "manifest.json").write_text(json.dumps({"files": ["36_20260225.json"]}, indent=2) + "\n", encoding="utf-8")
    print(f"Decoded raw HST/HIST/DET/CIS and wrote {PUBLIC_DATA / '36_20260225.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
