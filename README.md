# Are You Smarter Than SCATS?

Interactive traffic signal simulation game for comparing three signal strategies side-by-side:

- `You`: fixed-time plan that you configure
- `AI`: heuristic adaptive controller
- `SCATS`: replay of a real historical day (recorded phasing + volumes)

The app simulates a four-phase signalized intersection with lane-level arrivals, queueing, signal state changes, and live KPI tracking.

## What Is Implemented

- React + TypeScript + Vite frontend
- Deterministic simulation engine (`0.1s` timestep)
- Three independently toggled models (`You`, `AI`, `SCATS`)
- Embedded Site 36 data plus optional `public/data` JSON datasets
- Live charts for phase/cycle behavior and cumulative delay
- Final comparison metrics across selected models
- Orthographic 3D intersection view with a 2D fallback and shared simulation snapshots
- Deterministic weighted vehicle catalog shared by Player, AI, and SCATS

### Renderer and vehicle identity

The `2D / 3D` control changes presentation only. Both renderers consume the
same `SimulationSnapshot`, so vehicle movement, signal behavior, pedestrians,
and scoring remain controller-independent. The 3D renderer uses one WebGL
canvas with scissored views for the active comparison panels and switches back
to the 2D canvas when WebGL initialization is unavailable.

Vehicle class, variant, and paint are assigned from `arrival.id` in
`src/vehicles/catalog.ts`. The weighted catalog currently follows the initial
32% hatchback, 30% sedan, 18% ute, 12% truck, and 8% bus mix. Catalog
dimensions are presentation metadata; the existing calibrated physics traits
remain unchanged until metre-scale calibration is explicitly revisited.

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

### Build production bundle

```bash
npm run build
```

This is the default distribution build. It writes a standalone `dist/index.html` with the app JS and CSS inlined so it can be opened directly from a file share via `file://.../index.html`.

### Build standalone single-file bundle

```bash
npm run distribute
```

This is an alias for `npm run build`.

### Build regular web bundle

```bash
npm run build:web
```

Use this only when you want the normal Vite multi-file output for serving over HTTP.

### Create named release file

```bash
npm run release
```

This builds the standalone bundle and copies it to `release/smarter-than-scats-standalone.html` so you can hand over a clearly named single file instead of relying on `dist/index.html`.

For the standalone build, any datasets listed in `public/data/manifest.json` are embedded into the bundle at build time. If the manifest is empty, the standalone file uses the embedded Site 36 CSV data or synthetic fallback data just like the normal app.

### Preview production build

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

### Score code test

```bash
npm run test:score-code
```

### Site-data and replay tests

```bash
npm run test:site36-data
npm run test:detector-calibration
npm run test:scats-replay
```

Score verification setup for Google Sheets is documented in `docs/score-verification.md`.

## Gameplay Flow

1. Choose period: `AM`, `School`, or `PM`.
2. Set green times for phases `A-D` (inter-green is fixed).
3. Choose active models (`You`, `AI`, `SCATS`).
4. Start the run and compare live delay and throughput.
5. Review final totals and verdict, then copy the verification code if adding a score to a spreadsheet.
6. Enter a name after the run to save the result to the local leaderboard and download the saved results as CSV for review.

Primary KPI: total delay (`vehicle-seconds`, also shown as `vehicle-hours`).

### Leaderboard and review export

The leaderboard is stored in the browser's local storage, so it persists on the
same device and browser across visits. It is sorted by lowest total delay and
keeps the top 100 saved runs; the visible table shows the top 10. The `Download
CSV` button exports the saved runs with phase timings, phase delays, result
metrics, timestamps, and verification codes.

GitHub Pages serves static files and cannot write a shared CSV or database. This
means each browser currently has its own leaderboard. A public cross-device
leaderboard would need a write-capable backend or a hosted form/database; the
CSV export is the review path for the current static deployment.

## Controllers

### 1) Player (`FixedSignalController`)

- Fixed phase greens from UI sliders
- Constant inter-green (`yellow + all-red`)
- Skips a phase when no stopped/queued vehicle can use that phase

### 2) AI (`AISignalController`)

Heuristic adaptive controller (not ML training/inference).

- Within-cycle behavior includes:
- Enforces minimum green
- Uses gap-out when demand disappears
- Extends green when queue persists, subject to caps
- Between-cycle behavior includes:
- Measures queue pressure per phase
- Reallocates green splits based on demand
- Smooths changes with a learning rate

### 3) SCATS Replay (`ScatsReplayController`)

Historical SCATS replay controller operating on recorded phase logs and real
5-minute detector volumes.

- Replays HST signal-group transitions from the generated Site 36 artifact
- Uses deterministic arrivals from DET type-9 five-minute intervals
- Calibrates detector-specific vehicle headways from DET type-3/type-4
  non-occupancy, gap, green-time, and degree-of-saturation observations
- Preserves recorded cycle behavior for apples-to-apples comparison

### Legacy mode (`LiveScatsController`)

The previous SCATS-inspired adaptive controller is still in the codebase and can
be re-enabled by setting `USE_LEGACY_LIVE_SCATS = true` in `src/App.tsx`.

When enabled, it uses actuated/gap-out behavior and DS-style split adaptation.

## Simulation and Calibration

All three controllers receive the same arrivals, pedestrian runs, vehicle
physics, and detector-derived calibration. Only the signal-control strategy
changes. This preserves a fair comparison between `You`, `AI`, and the
historical `SCATS` replay.

The simulation advances in deterministic 0.1-second steps. A vehicle is spawned
from each generated arrival and follows an Intelligent Driver Model (IDM)
profile with deterministic per-driver variation. Signal-group states determine
whether it stops at the stop line. Queueing, filtered turns, pedestrian
conflicts, vehicle discharge, and path exit are simulated explicitly.

Total delay is accumulated as the speed deficit against the model's 50 km/h
free-flow reference:

```text
delay increment = max(0, 1 - vehicle speed / free-flow speed) * timestep
```

This is modelled control delay, not a direct field measurement of travel time.

### Detector-derived flow calibration

`src/simulation/detectorCalibration.ts` builds one headway calibration for each
of Site 36's eight detectors for the selected period. The generated dataset
retains several observations for each detector and five-minute interval:

- Type 3: count, green time, terminal gap, raw degree of saturation, and SCATS
  non-occupancy. The JSON property is still called `occupancy` for backwards
  compatibility, but its value is raw **non-occupancy in deciseconds**.
- Type 4: count, green time, terminal gap, and calibrated degree of saturation.
- Type 9: five-minute detector volume used to generate vehicle arrivals.

SCATS degree of saturation represents effectively used green. For a valid
type-3 observation, optimum detector space-time is estimated as:

```text
space time = (DS * green - green + non-occupancy) / count
```

where `DS` is converted from percent to a ratio and non-occupancy is converted
from deciseconds to seconds. Type-4 calibrated DS supplies a second estimate,
using detector occupancy time learned from type 3. The observed gap makes a
small low-DS adjustment; it is not treated directly as a saturation headway.

Invalid and implausible observations are excluded, detector medians are used to
limit outlier influence, and the final target headway is bounded to 0.8-2.4
seconds. Deterministic driver variation is then applied around that target.
The resulting physical profile is applied equally to all three controllers.

## Data Sources

The app currently runs the checked-in generated Site 36 artifact for
25 February 2026. The browser does not parse the binary HST, HIST, or DET files
at runtime. `npm run build:site36` decodes and validates them, then writes the
runtime JSON and TypeScript artifact.

The source contribution is:

- `HCC_20260225.hst`: phase-termination events produce the phase timeline and
  cycle records; signal-group status events produce exact red/yellow/green/off
  transitions; walk events produce pedestrian demand and signal transitions.
- `HCC_20260225.hist`: independently decoded phase terminations are compared
  with HST within one second. HIST validates the replay but does not directly
  control the runtime simulation.
- `HCC_20260225.det`: type-9 volumes produce arrivals; type-3/type-4 count,
  non-occupancy, gap, green-time, and DS fields calibrate vehicle headways.
- `Site 36 Naylor Galloway CIS V3d.xlsx`: identifies the site/configuration;
  checked-in Site 36 configuration supplies signal groups, phase mappings,
  inter-greens, movement rules, pedestrian groups, and detector settings.

### Embedded files

- `src/data/HCC_20260225.hst`
- `src/data/HCC_20260225.hist`
- `src/data/HCC_20260225.det`
- `src/data/Site 36 Naylor Galloway CIS V3d.xlsx`
- `public/data/36_20260225.json`

### Public JSON files

- `public/data/manifest.json`
- `public/data/<intersection>_<date>.json`

The current app entry point explicitly loads generated Site 36 data. The loader
also supports `public/data/<intersection>_<date>.json` for future callers, and
standalone builds embed generated data into the output bundle.

Expected JSON shape follows `IntersectionData` with `AM`, `SCHOOL`, and `PM` period blocks.

Regenerate the checked-in Site 36 artifact with `npm run build:site36`. The
normal web and standalone builds consume the generated artifact and do not
invoke Python or parse the binary source files.

## SQL Extraction Script

`scripts/extract_scats.py` pulls detector volumes and phase cycle data from SQL Server and writes JSON files for the web app.

Example:

```bash
python scripts/extract_scats.py --intersection 36 --date 2024-03-15 --server <SERVER> --db <DB>
```

Script behavior:

- Connects with Windows integrated authentication
- Writes `public/data/<intersection>_<date>.json`
- Updates `public/data/manifest.json`

Requirements:

- `pyodbc`
- SQL Server ODBC driver (script is configured for `ODBC Driver 17 for SQL Server`)

## Project Structure

- `src/App.tsx`: app orchestration, model selection, run lifecycle
- `src/simulation/engine.ts`: core simulation loop and metrics
- `src/simulation/signalController.ts`: fixed controller and signal definitions
- `src/simulation/aiController.ts`: heuristic adaptive AI logic
- `src/simulation/scatsReplayController.ts`: historical SCATS replay logic
- `src/simulation/liveScatsController.ts`: legacy SCATS-inspired adaptive logic
- `src/data/loader.ts`: generated Site 36 and optional JSON loading
- `src/simulation/detectorCalibration.ts`: type-3/type-4 flow calibration
- `scripts/build_site36_dataset.py`: HST/HIST/DET/CIS decoding and artifact build
- `src/components/`: controls, canvas, charts, scoreboard, help
- `scripts/extract_scats.py`: SQL extraction pipeline

## Current Limitations

- AI remains a heuristic implementation with hand-tuned constants
- Detector and phase mapping assumptions are currently tailored to the Site 36 setup
- SCATS replay quality depends on phase log completeness and alignment
- Type-9 counts are deterministically disaggregated within five-minute periods;
  they are not observed vehicle timestamps or platoon trajectories
- Through/left movement splits are inferred rather than measured turning counts
- Detector-derived headways improve discharge-flow calibration, but the model
  has not yet been validated against observed approach travel times or queues
- Reported delay is simulated speed-deficit delay and should be interpreted as
  a comparative KPI until field travel-time/queue validation is added

## To-Do

- Fix queueing
- Signal displays
- fix road arrows
- fix phase diagrams not being in sync. get nice diagrams.
- Arrows in the lane in front of the detector numbers that light up when people are making that movement
- Global leaderboard, let people copy their timings at the end
- make info panel bigger - time etc.
- Time slider?

## Nice to have

- Fix up animating cars (left turn, normal queue distances etc) deck.gl?
- Add actual buses that went through
- Aerial basemap and/or 3D
- People not on the detectors
- Red light running
- Change timings and phase while it's running
