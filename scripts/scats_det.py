"""SCATS DET decoder for type 3/4/9 records and calibration diagnostics."""

from __future__ import annotations

from pathlib import Path

from scatslib import read_records, read_svarint, read_varint, u32be


FIELDS = {
    3: [("dataState", 0), ("collectionStartOffsetTimestamp", 0), ("collectionDuration", 0),
        ("collectionType", 0), ("collectionGreenTime", 0), ("gapTime", 0), ("redTime", -1),
        ("volume", 0), ("nonOccupancy", 0), ("rawDs", 0), ("rawVk", 0)],
    4: [("calculationOffsetTimestamp", 0), ("dataState", 0), ("greenTime", 0), ("gapTime", 0),
        ("volume", 0), ("nonOccupancy", 0), ("initialDs", 0), ("calibratedDs", 0), ("vk", 0)],
    9: [("collectionState", 0), ("requestSentTime", 0), ("volume", 0), ("responseReceivedTime", 0)],
}


def _entries(body: bytes, fields: list[tuple[str, object]]) -> list[dict]:
    entries = []
    pos = 0
    while pos < len(body):
        detector, size = read_varint(body, pos)
        pos += size
        entry_length = body[pos]
        pos += 1
        field_bytes = body[pos : pos + entry_length]
        pos += entry_length
        entry = {"detNumber": detector}
        field_pos = 0
        for name, default in fields:
            if field_pos < len(field_bytes):
                value, value_size = read_varint(field_bytes, field_pos)
                field_pos += value_size
                entry[name] = value
            else:
                entry[name] = default
        entries.append(entry)
    return entries


def _type3_entries(body: bytes) -> list[dict]:
    entries = []
    pos = 0
    while pos < len(body):
        detector, size = read_varint(body, pos)
        pos += size
        entry_length = body[pos]
        pos += 1
        field_bytes = body[pos : pos + entry_length]
        pos += entry_length
        values = []
        field_pos = 0
        while field_pos < len(field_bytes):
            value, value_size = read_varint(field_bytes, field_pos)
            values.append(value)
            field_pos += value_size
        values += [0] * (4 - len(values))
        data_state, start, duration, collection_type = values[:4]
        field_pos = 0
        for _ in range(4):
            if field_pos < len(field_bytes):
                _, field_size = read_varint(field_bytes, field_pos)
                field_pos += field_size
        phases = None
        signal_group = -1
        timed_interval = -1
        if field_pos < len(field_bytes):
            if collection_type == 0:
                count, field_size = read_varint(field_bytes, field_pos)
                field_pos += field_size
                phases = []
                for _ in range(count):
                    value, field_size = read_varint(field_bytes, field_pos)
                    field_pos += field_size
                    phases.append(value)
            elif collection_type == 1:
                signal_group, field_size = read_varint(field_bytes, field_pos)
                field_pos += field_size
            elif collection_type == 2:
                timed_interval, field_size = read_varint(field_bytes, field_pos)
                field_pos += field_size
        def next_value(default: int) -> int:
            nonlocal field_pos
            if field_pos >= len(field_bytes):
                return default
            value, field_size = read_varint(field_bytes, field_pos)
            field_pos += field_size
            return value
        entries.append({"detNumber": detector, "dataState": data_state, "collectionStartOffsetTimestamp": start,
                        "collectionDuration": duration, "collectionType": collection_type, "phases": phases,
                        "signalGroup": signal_group, "timedInterval": timed_interval,
                        "collectionGreenTime": next_value(0), "gapTime": next_value(0), "redTime": next_value(-1),
                        "volume": next_value(0), "nonOccupancy": next_value(0), "rawDs": next_value(0),
                        "rawVk": next_value(0)})
    return entries


def decode_record(data: bytes) -> dict:
    record_type = data[0]
    if record_type == 1:
        name_length = data[10]
        return {"recordTypeID": 1, "recordCreationTimestamp": u32be(data, 1), "regionName": data[11:11 + name_length].decode("ascii")}
    if record_type == 2:
        return {"recordTypeID": 2, "recordCreationTimestamp": u32be(data, 1)}
    timestamp, size = read_varint(data, 1)
    if record_type == 12:
        return {"recordTypeID": 12, "recordCreationTimestampReference": timestamp,
                "currentDayCode": data[1 + size], "specialDayCode": data[2 + size]}
    if record_type == 14:
        values = []
        pos = 1 + size
        while pos < len(data):
            value, value_size = read_varint(data, pos)
            values.append(value)
            pos += value_size
        return {"recordTypeID": 14, "recordCreationTimestampReference": timestamp, "siteNumbers": values}
    site, site_size = read_varint(data, 1 + size)
    body = data[1 + size + site_size:]
    result = {"recordTypeID": record_type, "recordCreationTimestampReference": timestamp, "siteNumber": site}
    if record_type == 3:
        result["detectorDataEntries"] = _type3_entries(body)
    elif record_type == 4:
        result["detectorDsEntries"] = _entries(body, FIELDS[4])
    elif record_type == 9:
        result["trafficCountEntries"] = _entries(body, FIELDS[9])
    elif record_type == 5:
        result["dailyHeadwayEntries"] = _entries(body, [("calculationOffsetTimestamp", 0), ("sourceFlag", 0), ("headway", 0)])
    elif record_type == 6:
        result["dailyAverageOccupancyEntries"] = _entries(body, [("calculationOffsetTimestamp", 0), ("sourceFlag", 0), ("occupancy", 0)])
    elif record_type == 7:
        result["dailyAverageVolumeEntries"] = _entries(body, [("calculationOffsetTimestamp", 0), ("sourceFlag", 0), ("volume", 0)])
    return result


def decode_file(path: Path) -> list[dict]:
    return [decode_record(record.data) for record in read_records(path.read_bytes())]
