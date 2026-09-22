import type { CarState } from "../data/types";
import type { PedestrianState } from "../data/types";
import { ALL_PATHS, getPositionOnPath } from "../simulation/paths";
import type { SimulationSnapshot } from "../simulation/engine";
import { VEHICLE_CATALOG } from "../vehicles/catalog";
import { CANVAS_SIZE } from "./road";
import phaseDiagramImgSrc from "../data/phase_diagrams.jpg";
import {
  getCrosswalkGeometry,
  getCrosswalkPosition,
} from "../simulation/pedestrians";
import {
  PHASE_BOXES,
  PHASE_DIAGRAM_NATIVE_HEIGHT,
  PHASE_DIAGRAM_NATIVE_WIDTH,
  PHASE_ID_BY_INDEX,
} from "./phaseDiagram";

const WAIT_COLOR_CAP_SECONDS = 180; // 3 minutes
const PEDESTRIAN_WALKER_SCALE = 1.3;

// Pixel scale: road half-width is 40px representing ~7m real world
// So 1m ≈ 5.7px. We'll use a simpler scale factor.
const SCALE = 5; // pixels per meter for car size

/**
 * Draw the dynamic layer (cars, signals) for a simulation snapshot.
 */
export function drawDynamicLayer(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
) {
  const activeGroups = getActivePedestrianGroups(snapshot.pedestrians);

  drawActiveCrosswalkFlash(ctx, snapshot.time, activeGroups);

  // Draw pedestrians first so queued vehicles can remain visually dominant.
  for (const pedestrian of snapshot.pedestrians) {
    drawPedestrian(ctx, pedestrian, snapshot.time);
  }

  // Draw cars
  for (const car of snapshot.cars) {
    drawCar(ctx, car);
  }

  // Draw time and stats overlay
  drawOverlay(ctx, snapshot);

  // Draw phase-reference diagram and highlight active phase
  drawPhaseDiagramOverlay(ctx, snapshot.currentPhase);
}

function drawPedestrian(
  ctx: CanvasRenderingContext2D,
  pedestrian: PedestrianState,
  simTime: number,
) {
  const pos = getCrosswalkPosition(
    pedestrian.signalGroup,
    pedestrian.direction,
    pedestrian.progress,
  );
  const crosswalk = getCrosswalkGeometry(pedestrian.signalGroup);
  const heading =
    crosswalk.orientation === "horizontal"
      ? pedestrian.direction === "W-E"
        ? 0
        : Math.PI
      : pedestrian.direction === "N-S"
        ? Math.PI / 2
        : -Math.PI / 2;

  const phase = simTime * 8 + pedestrian.id * 0.7;
  const swing = Math.sin(phase) * 0.45;
  const bob = Math.sin(phase * 2) * 1.2;
  const alpha = 0.82 + 0.18 * (1 - pedestrian.progress);

  ctx.save();
  ctx.translate(pos.x, pos.y + bob);
  ctx.rotate(heading);
  ctx.scale(PEDESTRIAN_WALKER_SCALE, PEDESTRIAN_WALKER_SCALE);
  ctx.globalAlpha = alpha;

  // body
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(0, 5);
  ctx.stroke();

  // head
  ctx.fillStyle = "#ffd79a";
  ctx.beginPath();
  ctx.arc(0, -5, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#c8843a";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // arms
  ctx.strokeStyle = "#f5c16f";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(3.1, 0.8 + swing);
  ctx.moveTo(0, 0);
  ctx.lineTo(-3.1, 0.8 - swing);
  ctx.stroke();

  // legs
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.lineTo(2.8, 9 + swing);
  ctx.moveTo(0, 5);
  ctx.lineTo(-2.8, 9 - swing);
  ctx.stroke();

  // outline halo for visibility over light road markings
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function getActivePedestrianGroups(
  pedestrians: PedestrianState[],
): Set<number> {
  const groups = new Set<number>();
  for (const ped of pedestrians) {
    groups.add(ped.signalGroup);
  }
  return groups;
}

function drawActiveCrosswalkFlash(
  ctx: CanvasRenderingContext2D,
  simTime: number,
  activeGroups: Set<number>,
): void {
  if (activeGroups.size === 0) return;

  const pulse = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(simTime * 10));

  for (const group of activeGroups) {
    const crosswalk = getCrosswalkGeometry(group as 13 | 14 | 15 | 16);
    const { x, y, width, height } = crosswalk.rect;

    ctx.fillStyle = `rgba(60, 230, 100, ${pulse.toFixed(3)})`;
    ctx.fillRect(x, y, width, height);

    // Zebra stripes perpendicular to crossing direction
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    const stripeCount = 4;
    if (crosswalk.orientation === "vertical") {
      const stripeH = height / (stripeCount * 2 - 1);
      for (let i = 0; i < stripeCount; i++) {
        ctx.fillRect(x, y + i * stripeH * 2, width, stripeH);
      }
    } else {
      const stripeW = width / (stripeCount * 2 - 1);
      for (let i = 0; i < stripeCount; i++) {
        ctx.fillRect(x + i * stripeW * 2, y, stripeW, height);
      }
    }

    ctx.strokeStyle = "rgba(180, 255, 200, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, width, height);
  }
}

const phaseDiagramImage = new Image();
phaseDiagramImage.src = phaseDiagramImgSrc;

function drawPhaseDiagramOverlay(
  ctx: CanvasRenderingContext2D,
  currentPhaseIndex: number,
) {
  const sourceW = phaseDiagramImage.naturalWidth || PHASE_DIAGRAM_NATIVE_WIDTH;
  const sourceH =
    phaseDiagramImage.naturalHeight || PHASE_DIAGRAM_NATIVE_HEIGHT;
  const panelH = 270;
  const panelW = (panelH * sourceW) / sourceH;
  const originX = CANVAS_SIZE - panelW - 10;
  const originY = 10;

  ctx.save();
  ctx.translate(originX, originY);

  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(0, 0, panelW, panelH);

  if (phaseDiagramImage.complete) {
    ctx.drawImage(phaseDiagramImage, 0, 0, panelW, panelH);
  }

  const activePhase = PHASE_ID_BY_INDEX[currentPhaseIndex] ?? "D";
  const box = PHASE_BOXES[activePhase];
  const scaleX = panelW / sourceW;
  const scaleY = panelH / sourceH;
  const hx = box.x * scaleX;
  const hy = box.y * scaleY;
  const hw = box.w * scaleX;
  const hh = box.h * scaleY;

  ctx.fillStyle = "rgba(30, 64, 255, 0.24)";
  ctx.fillRect(hx + 2, hy + 2, hw - 4, hh - 4);
  ctx.strokeStyle = "#77d4ff";
  ctx.lineWidth = 2;
  ctx.strokeRect(hx + 3, hy + 3, hw - 6, hh - 6);

  ctx.strokeStyle = "#1e40ff";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, panelW, panelH);

  ctx.restore();
}
function drawCar(ctx: CanvasRenderingContext2D, car: CarState) {
  const path = ALL_PATHS[car.pathIndex];
  if (!path) return;

  const pos = getPositionOnPath(path, car.distance);
  const redness = getWaitingRedness(car.waitingTimeSeconds);
  const bodyColor = getWaitingColorFromRedness(redness);
  const catalogVehicle = VEHICLE_CATALOG.find(
    (vehicle) =>
      vehicle.vehicleClass === car.vehicleClass &&
      vehicle.vehicleVariant === car.vehicleVariant,
  );
  const w = (catalogVehicle?.dimensions.width ?? 1.8) * SCALE;
  const h = car.length * SCALE;
  const frontOffset = (car.length * SCALE) / 2;
  const heading = pos.rotation - Math.PI / 2;

  ctx.save();
  ctx.translate(
    pos.x - Math.cos(heading) * frontOffset,
    pos.y - Math.sin(heading) * frontOffset,
  );
  ctx.rotate(heading);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w, h);

  // Car body
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  // Windshield (front portion)
  ctx.fillStyle = "rgba(200,220,255,0.5)";
  ctx.fillRect(w / 4, -h / 2 + 1, w / 4 - 1, h - 2);

  ctx.restore();
}

function getWaitingRedness(waitingSeconds: number): number {
  return Math.max(0, Math.min(1, waitingSeconds / WAIT_COLOR_CAP_SECONDS));
}

function getWaitingColorFromRedness(redness: number): string {
  // White -> dark red
  const r = Math.round(255 + (120 - 255) * redness);
  const g = Math.round(255 + (0 - 255) * redness);
  const b = Math.round(255 + (0 - 255) * redness);

  return `rgb(${r}, ${g}, ${b})`;
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  snapshot: SimulationSnapshot,
) {
  const scale = 1.5;

  ctx.fillStyle = "rgba(0,0,0,0.68)";
  const boxX = 6;
  const boxY = 6;
  const boxW = 220 * scale;
  const boxH = 100 * scale;
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = "#fff";
  ctx.font = `${14 * scale}px monospace`;
  ctx.textAlign = "left";
  const textX = boxX + 8 * scale;
  const lineHeight = 20 * scale;
  const firstLineY = boxY + 20 * scale;
  ctx.fillText(`Time: ${snapshot.time.toFixed(1)}s`, textX, firstLineY);
  ctx.fillText(
    `Vehicles through: ${snapshot.vehiclesServed}`,
    textX,
    firstLineY + lineHeight,
  );
  ctx.fillText(
    `Pedestrians: ${snapshot.pedestriansCrossed}`,
    textX,
    firstLineY + lineHeight * 2,
  );
  ctx.fillText(
    `Delay: ${snapshot.totalDelay.toFixed(0)}s`,
    textX,
    firstLineY + lineHeight * 3,
  );
}
