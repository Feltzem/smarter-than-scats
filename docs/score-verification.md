# Score Verification Codes

Completed player runs can copy a verification code into a spreadsheet. The code is a readable payload plus a short SHA-256 checksum. It is designed to catch typos and casual score edits, not to stop someone who reverse-engineers the app.

Example:

```text
STS1|S=site36-v1|P=AM|G=10201040|IG=05|DIV=50|TD=12345|AD=287|VE=512|VS=508|PED=44|MAX=31|PD=120,341,90,220|CHK=59E8B0866CD0
```

Fields:

- `STS1`: code version.
- `S`: scenario identifier.
- `P`: period.
- `G`: phase green timings, two digits per phase.
- `IG`: inter-green seconds.
- `DIV`: traffic test divisor. Normal scoring should be `1`; the current phase-skip test mode is `50`.
- `TD`: total delay, rounded vehicle-seconds.
- `AD`: average delay per vehicle, in tenths of seconds.
- `VE` / `VS`: vehicles entered / served.
- `PED`: pedestrians crossed.
- `MAX`: peak vehicles in network.
- `PD`: per-phase delay, rounded vehicle-seconds.
- `CHK`: first 12 uppercase hex characters of `SHA-256(PUBLIC_SALT + "|" + payload)`.

## Google Apps Script

In Google Sheets, open **Extensions > Apps Script**, paste this code, and save. Then use formulas such as `=VERIFY_STS_CODE(A2)` or `=STS_FIELD(A2, "G")`.

```js
const STS_PUBLIC_SCORE_SALT = "smarter-than-scats-score-v1";
const STS_CHECKSUM_LENGTH = 12;

function VERIFY_STS_CODE(code) {
  if (!code || typeof code !== "string") return false;

  const trimmed = code.trim();
  const parts = trimmed.split("|");
  if (parts.length < 2 || parts[0] !== "STS1") return false;

  const checksumPart = parts[parts.length - 1];
  if (!checksumPart || !checksumPart.startsWith("CHK=")) return false;

  const supplied = checksumPart.slice(4).toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(supplied)) return false;

  const payload = parts.slice(0, -1).join("|");
  return supplied === stsChecksum_(payload);
}

function STS_FIELD(code, fieldName) {
  if (!code || typeof code !== "string") return "";

  const key = `${fieldName}=`;
  const parts = code.trim().split("|");
  for (const part of parts) {
    if (part.startsWith(key)) return part.slice(key.length);
  }

  return "";
}

function stsChecksum_(payload) {
  const input = `${STS_PUBLIC_SCORE_SALT}|${payload}`;
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    input,
    Utilities.Charset.UTF_8,
  );

  return bytes
    .map((value) => {
      const unsigned = value < 0 ? value + 256 : value;
      return unsigned.toString(16).padStart(2, "0");
    })
    .join("")
    .toUpperCase()
    .slice(0, STS_CHECKSUM_LENGTH);
}
```
