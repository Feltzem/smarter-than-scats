import type {
  PeriodKey,
  PhaseConfig,
  SimulationResult,
} from "../data/types";

export const SCORE_CODE_VERSION = "STS2";
export const SCORE_SCENARIO_ID = "site36-cis-3d";
export const SCORE_PUBLIC_SALT = "smarter-than-scats-score-v1";
const CHECKSUM_LENGTH = 12;

export interface ScoreVerificationInput {
  period: PeriodKey;
  phaseConfig: PhaseConfig;
  result: SimulationResult;
  trafficDivisor: number;
}

export function buildScoreVerificationCode({
  period,
  phaseConfig,
  result,
  trafficDivisor,
}: ScoreVerificationInput): string {
  const payload = buildScorePayload({
    period,
    phaseConfig,
    result,
    trafficDivisor,
  });
  const checksum = sha256Hex(`${SCORE_PUBLIC_SALT}|${payload}`).slice(
    0,
    CHECKSUM_LENGTH,
  );

  return `${payload}|CHK=${checksum}`;
}

export function verifyScoreVerificationCode(code: string): boolean {
  const parts = code.trim().split("|");
  if (parts.length < 2 || !["STS1", SCORE_CODE_VERSION].includes(parts[0])) {
    return false;
  }

  const checksumPart = parts[parts.length - 1];
  if (!checksumPart?.startsWith("CHK=")) return false;

  const suppliedChecksum = checksumPart.slice(4).toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(suppliedChecksum)) return false;

  const payload = parts.slice(0, -1).join("|");
  const expectedChecksum = sha256Hex(`${SCORE_PUBLIC_SALT}|${payload}`).slice(
    0,
    CHECKSUM_LENGTH,
  );

  return suppliedChecksum === expectedChecksum;
}

export function buildScorePayload({
  period,
  phaseConfig,
  result,
  trafficDivisor,
}: ScoreVerificationInput): string {
  const phaseTimingCode = phaseConfig.greens
    .map((seconds) => zeroPadNumber(seconds, 2))
    .join("");
  const phaseDelayCode = result.phaseDelaySeconds
    .map((seconds) => Math.round(seconds).toString())
    .join(",");

  return [
    SCORE_CODE_VERSION,
    `S=${SCORE_SCENARIO_ID}`,
    `P=${period}`,
    `G=${phaseTimingCode}`,
    "IG=CIS3D",
    `DIV=${Math.max(1, Math.round(trafficDivisor))}`,
    `TD=${Math.round(result.totalDelay)}`,
    `AD=${Math.round(result.averageDelay * 10)}`,
    `VE=${Math.round(result.vehiclesEntered)}`,
    `VS=${Math.round(result.vehiclesServed)}`,
    `PED=${Math.round(result.pedestriansCrossed)}`,
    `MAX=${Math.round(result.maxVehiclesInNetwork)}`,
    `PD=${phaseDelayCode}`,
  ].join("|");
}

function zeroPadNumber(value: number, width: number): string {
  return Math.max(0, Math.round(value)).toString().padStart(width, "0");
}

function sha256Hex(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const w = new Array<number>(64);

  for (let blockStart = 0; blockStart < paddedLength; blockStart += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(blockStart + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotateRight(w[i - 15], 7) ^
        rotateRight(w[i - 15], 18) ^
        (w[i - 15] >>> 3);
      const s1 =
        rotateRight(w[i - 2], 17) ^
        rotateRight(w[i - 2], 19) ^
        (w[i - 2] >>> 10);
      w[i] = add32(w[i - 16], s0, w[i - 7], s1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = add32(h, s1, ch, k[i], w[i]);
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add32(s0, maj);

      h = g;
      g = f;
      f = e;
      e = add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }

    h0 = add32(h0, a);
    h1 = add32(h1, b);
    h2 = add32(h2, c);
    h3 = add32(h3, d);
    h4 = add32(h4, e);
    h5 = add32(h5, f);
    h6 = add32(h6, g);
    h7 = add32(h7, h);
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")
    .toUpperCase();
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}
