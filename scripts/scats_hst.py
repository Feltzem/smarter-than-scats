"""Site-independent SCATS HST event decoder, adapted from the validated decoder."""

from __future__ import annotations

from pathlib import Path

from scatslib import read_records, read_svarint, read_varint, u16le, u32be, zigzag


def _pairs(payload: bytes, first: str, second: str) -> list[dict]:
    return [{first: payload[i], second: payload[i + 1]} for i in range(0, len(payload) - 1, 2)]


def _triples(payload: bytes, a: str, b: str, c: str) -> list[dict]:
    return [{a: payload[i], b: payload[i + 1], c: payload[i + 2]} for i in range(0, len(payload) - 2, 3)]


def _nested(payload: bytes, outer: str, inner: str, first: str, second: str) -> list[dict]:
    output = []
    pos = 0
    while pos + 1 < len(payload):
        outer_id, count = payload[pos], payload[pos + 1]
        pos += 2
        states = []
        for _ in range(count):
            if pos + 1 >= len(payload):
                break
            states.append({first: payload[pos], second: payload[pos + 1]})
            pos += 2
        output.append({outer: outer_id, inner: states})
    return output


def _event_18(payload: bytes) -> dict:
    flags = payload[2 : 2 + payload[1]]
    return {
        "currentPhase": payload[0],
        "flags": flags.hex(),
        "currentPhaseStretch": bool(flags[0] & 1) if flags else False,
    }


def _event_21(payload: bytes) -> dict:
    pos = 1
    mx, size = read_varint(payload, pos)
    pos += size
    gt, size = read_varint(payload, pos)
    pos += size
    cg, _ = read_varint(payload, pos)
    return {"terminatedPhase": payload[0], "mx": zigzag(mx), "gt": gt, "cg": cg}


def _event_26(payload: bytes) -> list[dict]:
    output = []
    for pos in range(0, len(payload) - 1, 2):
        display = payload[pos + 1]
        output.append({
            "sgNumber": payload[pos],
            "off": (display & 0x1E) == 0,
            "mapped": True,
            "flashing": bool(display & 0x02),
            "red": bool(display & 0x04),
            "yellow": bool(display & 0x08),
            "green": bool(display & 0x10),
        })
    return output


def decode_event(event_type: int, timestamp_offset: int, payload: bytes) -> dict:
    result = {"eventTypeID": event_type, "timestampOffset": timestamp_offset}
    decoders = {
        2: lambda p: {"cycleLengths": _triples(p, "cycleLengthType", "cycleLengthValue", "lockOrTrimState")},
        3: lambda p: {"phaseInterval": p[0]},
        4: lambda p: {"phaseDemands": _pairs(p, "phaseNumber", "status")},
        5: lambda p: {"signalGroupStatuses": _pairs(p, "sgNumber", "status")},
        6: lambda p: {"flags": _pairs(p, "type", "state")},
        8: lambda p: {"timerEvents": _pairs(p, "approachOrLaneNumber", "expiredTimerID")},
        10: lambda p: {"alarmType": p[0], "alarmStates": _pairs(p[1:], "alarmSource", "status")},
        11: lambda p: {"planChanges": _triples(p, "planType", "planNumber", "lockOrTrimState")},
        12: lambda p: {"mode": u16le(p)},
        14: lambda p: {"flagStatuses": _nested(p, "flagTypeId", "flagStates", "flagNumber", "lockOrTrimStateId")},
        15: lambda p: {"status": p[0] & 0x0F, "oldValue": (p[0] >> 4) & 3, "newValue": (p[0] >> 6) & 3},
        17: lambda p: {"phase": p[0], "state": p[1]},
        18: _event_18,
        19: lambda p: {"nextPhase": p[0]},
        20: lambda p: {"currentPhase": p[0]},
        21: _event_21,
        22: lambda p: {"timerValue": zigzag(p[0])},
        25: lambda p: {"walkStatuses": _nested(p, "walkNumber", "states", "subtype", "state")},
        26: lambda p: {"signalGroupStatuses": _event_26(p)},
        27: lambda p: {"connectionStatus": p[0], "status": p[1]},
    }
    decoder = decoders.get(event_type)
    if decoder is None:
        result["_rawPayload"] = payload.hex()
    else:
        result.update(decoder(payload))
    return result


def decode_record(data: bytes) -> dict:
    record_type = data[0]
    if record_type == 1:
        name_length = data[10]
        return {
            "recordTypeID": 1,
            "recordCreationTimestamp": u32be(data, 1),
            "fileFormatVersion": data[5],
            "regionVersionNumber": data[6],
            "regionMajorVersionNumber": data[7],
            "regionMinorVersionNumber": data[8],
            "regionBuildNumber": data[9],
            "regionName": data[11 : 11 + name_length].decode("ascii"),
            "simulationMode": data[11 + name_length],
        }
    if record_type == 2:
        pos = 5
        time_variation = data[pos]
        bias, size = read_svarint(data, pos + 1)
        pos += 1 + size
        name_length = data[pos]
        standard_name = data[pos + 1 : pos + 1 + name_length].decode("ascii")
        pos += 1 + name_length
        standard_bias, size = read_svarint(data, pos)
        pos += size
        name_length = data[pos]
        daylight_name = data[pos + 1 : pos + 1 + name_length].decode("ascii")
        pos += 1 + name_length
        daylight_bias, size = read_svarint(data, pos)
        pos += size
        return {"recordTypeID": 2, "recordCreationTimestamp": u32be(data, 1), "timeVariation": time_variation,
                "bias": bias, "standardName": standard_name, "standardBias": standard_bias,
                "daylightName": daylight_name, "daylightBias": daylight_bias, "timeZoneID": data[pos]}
    timestamp, size = read_varint(data, 1)
    site, site_size = read_varint(data, 1 + size)
    pos = 1 + size + site_size
    events = []
    while pos < len(data):
        event_length, length_size = read_varint(data, pos)
        body_start = pos + length_size
        body = data[body_start : body_start + event_length]
        event_type, type_size = read_varint(body, 0)
        timestamp_offset, offset_size = read_varint(body, type_size)
        events.append(decode_event(event_type, timestamp_offset, body[type_size + offset_size :]))
        pos = body_start + event_length
    return {"recordTypeID": record_type, "recordCreationTimestampReference": timestamp, "siteNumber": site, "events": events}


def decode_file(path: Path) -> list[dict]:
    return [decode_record(record.data) for record in read_records(path.read_bytes())]
