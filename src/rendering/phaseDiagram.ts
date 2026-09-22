export type PhaseId = "A" | "B" | "C" | "D";

export const PHASE_DIAGRAM_NATIVE_WIDTH = 225;
export const PHASE_DIAGRAM_NATIVE_HEIGHT = 561;

export const PHASE_ID_BY_INDEX: PhaseId[] = ["A", "B", "C", "D"];

export const PHASE_BOXES: Record<
  PhaseId,
  { x: number; y: number; w: number; h: number }
> = {
  // Pixel-space boxes measured against phase_diagrams.jpg.
  A: { x: 0, y: 40, w: 110, h: 172 },
  D: { x: 110, y: 40, w: 113, h: 172 },
  B: { x: 0, y: 212, w: 110, h: 172 },
  C: { x: 0, y: 384, w: 110, h: 173 },
};
