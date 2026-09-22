"""Dependency-free framing and primitive readers for SCATS binary exports."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterator


def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    value = 0
    shift = 0
    start = pos
    while pos < len(buf):
        byte = buf[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, pos - start
        shift += 7
        if shift > 63:
            raise ValueError("SCATS varint exceeds 64 bits")
    raise ValueError("truncated SCATS varint")


def zigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def read_svarint(buf: bytes, pos: int) -> tuple[int, int]:
    value, length = read_varint(buf, pos)
    return zigzag(value), length


@dataclass(frozen=True)
class Record:
    index: int
    pos: int
    length: int
    data: bytes

    @property
    def type(self) -> int | None:
        return self.data[0] if self.data else None


def read_records(buf: bytes, *, strict: bool = True) -> Iterator[Record]:
    """Yield [length][payload][length] records using varint lengths."""
    pos = 0
    index = 0
    while pos < len(buf):
        length, length_bytes = read_varint(buf, pos)
        data_start = pos + length_bytes
        end = data_start + length
        if end >= len(buf):
            if strict:
                raise ValueError(f"truncated SCATS record at {pos}")
            return
        repeated, repeated_bytes = read_varint(buf, end)
        if repeated != length:
            if strict:
                raise ValueError(f"SCATS framing mismatch at {pos}: {length} != {repeated}")
            return
        yield Record(index, pos, length, buf[data_start:end])
        pos = end + repeated_bytes
        index += 1


def u16le(buf: bytes, offset: int = 0) -> int:
    return struct.unpack_from("<H", buf, offset)[0]


def u32be(buf: bytes, offset: int = 0) -> int:
    return struct.unpack_from(">I", buf, offset)[0]
