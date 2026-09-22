"""SCATS HIST five-minute phase snapshot decoder."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from scatslib import read_records, u16le


def _date(value: int) -> tuple[int, int, int]:
    return 1970 + ((value >> 9) & 0x7F), (value >> 5) & 0x0F, value & 0x1F


def _time(value: int) -> tuple[int, int, int]:
    return (value >> 11) & 0x1F, (value >> 5) & 0x3F, value & 0x1F


def decode_snapshot(data: bytes) -> dict:
    y, month, day = _date(u16le(data, 2))
    hour, minute, second = _time(u16le(data, 4))
    y2, month2, day2 = _date(u16le(data, 8))
    hour2, minute2, second2 = _time(u16le(data, 10))
    return {"previousDateTime": datetime(y, month, day, hour, minute, second),
            "elapsedTime": u16le(data, 6),
            "currentDateTime": datetime(y2, month2, day2, hour2, minute2, second2)}


def decode_site(data: bytes) -> dict:
    states = data[2]
    terminations = []
    for pos in range(5, len(data), 2):
        value = u16le(data, pos)
        terminations.append({"phase": value & 0x07, "offset": value >> 7, "gapped": bool(value & 0x08)})
    return {"siteNumber": u16le(data), "states": [bool(states & (1 << i)) for i in range(8)],
            "currentPhase": data[3], "currentPhaseElapsedTime": data[4], "phaseTerminations": terminations}


def decode_file(path: Path) -> list[dict]:
    output = []
    for record in read_records(path.read_bytes()):
        if u16le(record.data) == 0:
            output.append(decode_snapshot(record.data))
        else:
            output.append(decode_site(record.data))
    return output
