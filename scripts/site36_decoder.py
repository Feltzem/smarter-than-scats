"""Integrity checks and source manifest helpers for the Site 36 extraction.

The raw SCATS field decoders live in the sibling ``scats_*`` modules. This
module keeps the shared envelope, CIS identity, and source-hash checks in one
place; the browser receives only the generated compact projection.
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"


def sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def decode_varint(data: bytes, offset: int) -> tuple[int, int]:
    """Decode the unsigned base-128 integer used by SCATS timestamps."""
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
        if shift > 63:
            raise ValueError("SCATS varint exceeds 64 bits")
    raise ValueError("truncated SCATS varint")


def validate_binary_source(path: Path) -> None:
    data = path.read_bytes()
    if len(data) < 16:
        raise ValueError(f"{path.name}: invalid SCATS file envelope")
    if path.suffix == ".hist":
        if data[:2] != b"\x0c\x00":
            raise ValueError(f"{path.name}: invalid HIST envelope")
        return
    if data[:2] != b"\x0f\x01":
        raise ValueError(f"{path.name}: invalid SCATS file envelope")
    if b"HCC\x00" not in data[:256]:
        raise ValueError(f"{path.name}: missing HCC region identity")


def parse_cis_identity(path: Path) -> dict[str, str]:
    with ZipFile(path) as workbook:
        strings = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
        values = ["".join(node.itertext()) for node in strings]

    if "3d" not in values:
        raise ValueError("CIS identity is not version 3d")
    # The site number is stored as a numeric worksheet cell and therefore is
    # not present in sharedStrings.xml.  Inspect worksheet XML as well.
    sheet_text = ""
    with ZipFile(path) as workbook:
        for name in workbook.namelist():
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
                sheet_text += workbook.read(name).decode("utf-8", errors="replace")
    if 'v>36</v>' not in sheet_text or "Naylor / Galloway" not in values:
        raise ValueError("CIS identity is not Site 36")
    return {"site": "36", "intersection": "Naylor / Galloway", "version": "3d"}


def source_manifest() -> list[dict[str, str]]:
    names = [
        "HCC_20260225.hst",
        "HCC_20260225.hist",
        "HCC_20260225.det",
        "Site 36 Naylor Galloway CIS V3d.xlsx",
    ]
    for name in names:
        validate_binary_source(DATA / name) if name.endswith((".hst", ".hist", ".det")) else None
    parse_cis_identity(DATA / names[-1])
    return [{"name": name, "sha256": sha256_file(DATA / name)} for name in names]
