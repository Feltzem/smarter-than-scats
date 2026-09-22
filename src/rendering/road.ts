import { CENTER, ROAD_HALF_WIDTH } from "../simulation/paths";
import { allCrosswalks } from "../simulation/pedestrians";

const CANVAS_SIZE = 800;
const ROAD_COLOR = "#555";
const INTERSECTION_COLOR = "#4a4a4a";
const LINE_COLOR = "#fff";
const DARK_GRASS_COLOR = "#2d5a1e";
const LIGHT_GRASS_COLOR = "#276221";
const HOLD_LINE_COLOR = "#ffd166";

type RoadLayerOptions = {
  darkMode?: boolean;
  showDirectionalArrows?: boolean;
};

/**
 * Draw the static road layer to an offscreen canvas.
 * Returns the canvas for compositing.
 */
export function createRoadLayer({
  darkMode = true,
  showDirectionalArrows = false,
}: RoadLayerOptions = {}): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d")!;

  // Background (grass/surroundings)
  ctx.fillStyle = darkMode ? DARK_GRASS_COLOR : LIGHT_GRASS_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Draw road surfaces
  drawRoads(ctx);

  // Draw intersection box
  drawIntersectionBox(ctx);

  // Draw lane markings
  drawLaneMarkings(ctx);

  // Draw stop lines
  drawStopLines(ctx);

  // Draw pedestrian crossing zones
  drawPedestrianCrosswalks(ctx);

  if (showDirectionalArrows) {
    drawDirectionalArrows(ctx);
  }

  drawDetectorLabels(ctx);

  // Draw compass
  drawCompass(ctx);

  return canvas;
}

function drawRoads(ctx: CanvasRenderingContext2D) {
  const roadWidth = ROAD_HALF_WIDTH * 2;

  // North-South road
  ctx.fillStyle = ROAD_COLOR;
  ctx.fillRect(CENTER - ROAD_HALF_WIDTH, 0, roadWidth, CANVAS_SIZE);

  // East-West road
  ctx.fillRect(0, CENTER - ROAD_HALF_WIDTH, CANVAS_SIZE, roadWidth);
}

function drawIntersectionBox(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = INTERSECTION_COLOR;
  ctx.fillRect(
    CENTER - ROAD_HALF_WIDTH,
    CENTER - ROAD_HALF_WIDTH,
    ROAD_HALF_WIDTH * 2,
    ROAD_HALF_WIDTH * 2,
  );
}

function drawLaneMarkings(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;

  // N-S road edges - north arm
  ctx.beginPath();
  ctx.moveTo(CENTER - ROAD_HALF_WIDTH, 0);
  ctx.lineTo(CENTER - ROAD_HALF_WIDTH, CENTER - ROAD_HALF_WIDTH);
  ctx.moveTo(CENTER + ROAD_HALF_WIDTH, 0);
  ctx.lineTo(CENTER + ROAD_HALF_WIDTH, CENTER - ROAD_HALF_WIDTH);
  ctx.stroke();

  // N-S road edges - south arm
  ctx.beginPath();
  ctx.moveTo(CENTER - ROAD_HALF_WIDTH, CENTER + ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER - ROAD_HALF_WIDTH, CANVAS_SIZE);
  ctx.moveTo(CENTER + ROAD_HALF_WIDTH, CENTER + ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER + ROAD_HALF_WIDTH, CANVAS_SIZE);
  ctx.stroke();

  // E-W road edges - west arm
  ctx.beginPath();
  ctx.moveTo(0, CENTER - ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER - ROAD_HALF_WIDTH, CENTER - ROAD_HALF_WIDTH);
  ctx.moveTo(0, CENTER + ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER + ROAD_HALF_WIDTH, CENTER + ROAD_HALF_WIDTH);
  ctx.stroke();

  // E-W road edges - east arm
  ctx.beginPath();
  ctx.moveTo(CENTER + ROAD_HALF_WIDTH, CENTER - ROAD_HALF_WIDTH);
  ctx.lineTo(CANVAS_SIZE, CENTER - ROAD_HALF_WIDTH);
  ctx.moveTo(CENTER + ROAD_HALF_WIDTH, CENTER + ROAD_HALF_WIDTH);
  ctx.lineTo(CANVAS_SIZE, CENTER + ROAD_HALF_WIDTH);
  ctx.stroke();

  // Directional separator lines (solid centerline between opposing directions)
  ctx.beginPath();
  ctx.moveTo(CENTER, 0);
  ctx.lineTo(CENTER, CENTER - ROAD_HALF_WIDTH);
  ctx.moveTo(CENTER, CENTER + ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER, CANVAS_SIZE);
  ctx.moveTo(0, CENTER);
  ctx.lineTo(CENTER - ROAD_HALF_WIDTH, CENTER);
  ctx.moveTo(CENTER + ROAD_HALF_WIDTH, CENTER);
  ctx.lineTo(CANVAS_SIZE, CENTER);
  ctx.stroke();

  // Same-direction lane separators (dashed)
  ctx.lineWidth = 1.5;

  // N-S road dashed separators on each carriageway
  drawDashedLine(
    ctx,
    CENTER - ROAD_HALF_WIDTH / 2,
    0,
    CENTER - ROAD_HALF_WIDTH / 2,
    CENTER - ROAD_HALF_WIDTH,
    8,
    8,
  );
  drawDashedLine(
    ctx,
    CENTER - ROAD_HALF_WIDTH / 2,
    CENTER + ROAD_HALF_WIDTH,
    CENTER - ROAD_HALF_WIDTH / 2,
    CANVAS_SIZE,
    8,
    8,
  );
  drawDashedLine(
    ctx,
    CENTER + ROAD_HALF_WIDTH / 2,
    0,
    CENTER + ROAD_HALF_WIDTH / 2,
    CENTER - ROAD_HALF_WIDTH,
    8,
    8,
  );
  drawDashedLine(
    ctx,
    CENTER + ROAD_HALF_WIDTH / 2,
    CENTER + ROAD_HALF_WIDTH,
    CENTER + ROAD_HALF_WIDTH / 2,
    CANVAS_SIZE,
    8,
    8,
  );

  // E-W road dashed separators on each carriageway
  drawDashedLine(
    ctx,
    0,
    CENTER - ROAD_HALF_WIDTH / 2,
    CENTER - ROAD_HALF_WIDTH,
    CENTER - ROAD_HALF_WIDTH / 2,
    8,
    8,
  );
  drawDashedLine(
    ctx,
    CENTER + ROAD_HALF_WIDTH,
    CENTER - ROAD_HALF_WIDTH / 2,
    CANVAS_SIZE,
    CENTER - ROAD_HALF_WIDTH / 2,
    8,
    8,
  );
  drawDashedLine(
    ctx,
    0,
    CENTER + ROAD_HALF_WIDTH / 2,
    CENTER - ROAD_HALF_WIDTH,
    CENTER + ROAD_HALF_WIDTH / 2,
    8,
    8,
  );
  drawDashedLine(
    ctx,
    CENTER + ROAD_HALF_WIDTH,
    CENTER + ROAD_HALF_WIDTH / 2,
    CANVAS_SIZE,
    CENTER + ROAD_HALF_WIDTH / 2,
    8,
    8,
  );
}

function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLen: number,
  gapLen: number,
) {
  ctx.setLineDash([dashLen, gapLen]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawStopLines(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 3;

  const offset = ROAD_HALF_WIDTH + 16; // hold line before crosswalk area

  // Left-hand traffic inbound lanes:
  // N inbound on east half, S inbound on west half,
  // E inbound on south half, W inbound on north half.

  // North approach stop line (toward south)
  ctx.beginPath();
  ctx.moveTo(CENTER, CENTER - offset);
  ctx.lineTo(CENTER + ROAD_HALF_WIDTH, CENTER - offset);
  ctx.stroke();

  // South approach stop line
  ctx.beginPath();
  ctx.moveTo(CENTER - ROAD_HALF_WIDTH, CENTER + offset);
  ctx.lineTo(CENTER, CENTER + offset);
  ctx.stroke();

  // East approach stop line
  ctx.beginPath();
  ctx.moveTo(CENTER + offset, CENTER);
  ctx.lineTo(CENTER + offset, CENTER + ROAD_HALF_WIDTH);
  ctx.stroke();

  // West approach stop line
  ctx.beginPath();
  ctx.moveTo(CENTER - offset, CENTER - ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER - offset, CENTER);
  ctx.stroke();

  // Emphasized hold bars for turning traffic behind each crossing area.
  ctx.strokeStyle = HOLD_LINE_COLOR;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(CENTER, CENTER - offset - 4);
  ctx.lineTo(CENTER + ROAD_HALF_WIDTH, CENTER - offset - 4);
  ctx.moveTo(CENTER - ROAD_HALF_WIDTH, CENTER + offset + 4);
  ctx.lineTo(CENTER, CENTER + offset + 4);
  ctx.moveTo(CENTER + offset + 4, CENTER);
  ctx.lineTo(CENTER + offset + 4, CENTER + ROAD_HALF_WIDTH);
  ctx.moveTo(CENTER - offset - 4, CENTER - ROAD_HALF_WIDTH);
  ctx.lineTo(CENTER - offset - 4, CENTER);
  ctx.stroke();
}

function drawPedestrianCrosswalks(ctx: CanvasRenderingContext2D) {
  for (const crosswalk of allCrosswalks()) {
    ctx.fillStyle = "rgba(240, 240, 240, 0.22)";
    ctx.fillRect(
      crosswalk.rect.x,
      crosswalk.rect.y,
      crosswalk.rect.width,
      crosswalk.rect.height,
    );

    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      crosswalk.rect.x,
      crosswalk.rect.y,
      crosswalk.rect.width,
      crosswalk.rect.height,
    );
  }
}

function drawDetectorLabels(ctx: CanvasRenderingContext2D) {
  const offset = ROAD_HALF_WIDTH + 5;
  const laneInset = ROAD_HALF_WIDTH / 4;
  const nearLane = laneInset;
  const farLane = laneInset * 3;
  const pad = 12;

  // North leg (detectors 1|2 = left|right lane)
  drawDetectorPaint(ctx, CENTER + farLane, CENTER - offset - pad, "1", Math.PI);
  drawDetectorPaint(
    ctx,
    CENTER + nearLane,
    CENTER - offset - pad,
    "2",
    Math.PI,
  );

  // South leg (detectors 5|6 = left|right lane)
  drawDetectorPaint(ctx, CENTER - farLane, CENTER + offset + pad, "5", 0);
  drawDetectorPaint(ctx, CENTER - nearLane, CENTER + offset + pad, "6", 0);

  // West leg (detectors 3|4 = left|right lane)
  drawDetectorPaint(
    ctx,
    CENTER - offset - pad,
    CENTER - farLane,
    "3",
    -Math.PI / 2,
  );
  drawDetectorPaint(
    ctx,
    CENTER - offset - pad,
    CENTER - nearLane,
    "4",
    -Math.PI / 2,
  );

  // East leg (detectors 7|8 = left|right lane)
  drawDetectorPaint(
    ctx,
    CENTER + offset + pad,
    CENTER + farLane,
    "7",
    Math.PI / 2,
  );
  drawDetectorPaint(
    ctx,
    CENTER + offset + pad,
    CENTER + nearLane,
    "8",
    Math.PI / 2,
  );
}

function drawDetectorPaint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  rotation: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(18, 24, 22, 0.8)";
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = "#f6c453";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawDirectionalArrows(ctx: CanvasRenderingContext2D) {
  const laneInset = ROAD_HALF_WIDTH / 4;
  const nearLane = laneInset;
  const farLane = laneInset * 3;
  const arrowOffset = ROAD_HALF_WIDTH + 64;

  // North approach (vehicles travel south): lane 0 = outer (farLane), lane 1 = inner
  drawLaneArrow(ctx, CENTER + farLane, CENTER - arrowOffset, "N", 0);
  drawLaneArrow(ctx, CENTER + nearLane, CENTER - arrowOffset, "N", 1);

  // South approach (vehicles travel north)
  drawLaneArrow(ctx, CENTER - farLane, CENTER + arrowOffset, "S", 0);
  drawLaneArrow(ctx, CENTER - nearLane, CENTER + arrowOffset, "S", 1);

  // West approach (vehicles travel east): lane 0 = outer (farLane), lane 1 = inner
  drawLaneArrow(ctx, CENTER - arrowOffset, CENTER - farLane, "W", 0);
  drawLaneArrow(ctx, CENTER - arrowOffset, CENTER - nearLane, "W", 1);

  // East approach (vehicles travel west)
  drawLaneArrow(ctx, CENTER + arrowOffset, CENTER + farLane, "E", 0);
  drawLaneArrow(ctx, CENTER + arrowOffset, CENTER + nearLane, "E", 1);
}

// Draws a small road-marking arrow in the correct orientation for an approach/lane.
// lane 0 = left + straight (Y-arrow), lane 1 = right-turn only.
// Local coordinate system: travel = negative-y (up). Rotated to match approach.
function drawLaneArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  approach: "N" | "S" | "E" | "W",
  lane: 0 | 1,
) {
  const rotations: Record<string, number> = {
    S: 0, // travel north = up, no rotation
    N: Math.PI, // travel south = rotate 180°
    W: Math.PI / 2, // travel east = rotate 90° CW
    E: -Math.PI / 2, // travel west = rotate 90° CCW
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotations[approach]);

  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(0, -4);
  ctx.stroke();

  if (lane === 0) {
    // Straight-through branch.
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(0, -13);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-4.5, -10.5);
    ctx.lineTo(4.5, -10.5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.quadraticCurveTo(-3, -7, -8, -8.5);
    ctx.lineTo(-13.5, -8.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-18, -8.5);
    ctx.lineTo(-11, -12.5);
    ctx.lineTo(-11, -4.5);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.quadraticCurveTo(3, -7, 8, -8.5);
    ctx.lineTo(13.5, -8.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(18, -8.5);
    ctx.lineTo(11, -12.5);
    ctx.lineTo(11, -4.5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawCompass(ctx: CanvasRenderingContext2D) {
  const cx = CANVAS_SIZE - 52;
  const cy = CANVAS_SIZE - 52;
  const r = 20;

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "#fff";

  // N arrow
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx - 5, cy - r + 12);
  ctx.lineTo(cx + 5, cy - r + 12);
  ctx.closePath();
  ctx.fill();

  // Stem
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 10);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", cx, cy - r - 2);
}

export { CANVAS_SIZE };
