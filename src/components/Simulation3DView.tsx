import { Canvas, useFrame } from "@react-three/fiber";
import { View } from "@react-three/drei";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { SimulationSnapshot } from "../simulation/engine";
import { IntersectionScene } from "../rendering3d/IntersectionScene";

type PanelKey = "player" | "ai" | "liveScats";
function ClearSharedCanvas() {
  useFrame(({ gl }) => {
    gl.setScissorTest(false);
    gl.setViewport(0, 0, gl.domElement.width, gl.domElement.height);
    gl.clear(true, true);
  }, 0);

  return null;
}

interface Panel {
  key: PanelKey;
  label: string;
  labelColor: string;
  snapshot: SimulationSnapshot | null;
}

interface Simulation3DViewProps {
  panels: Panel[];
  darkMode: boolean;
  showRoadArrows: boolean;
  onWebGLFailure: () => void;
}

function canUseWebGL(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  try {
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function WebGLUnavailable({ onFailure }: { onFailure: () => void }) {
  useEffect(() => {
    onFailure();
  }, [onFailure]);

  return (
    <div className="simulation-3d-fallback">
      3D unavailable, switched to 2D.
    </div>
  );
}

class RendererErrorBoundary extends Component<
  { onFailure: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="simulation-3d-fallback">
          3D unavailable, switched to 2D.
        </div>
      );
    }

    return this.props.children;
  }
}

function ViewPanel({
  panel,
  darkMode,
  showRoadArrows,
  cameraVersion,
}: {
  panel: Panel;
  darkMode: boolean;
  showRoadArrows: boolean;
  cameraVersion: number;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [controlsElement, setControlsElement] = useState<HTMLDivElement | null>(
    null,
  );
  const setViewRef = useCallback((element: HTMLDivElement | null) => {
    viewRef.current = element;
    setControlsElement(element);
  }, []);

  return (
    <div ref={setViewRef} className="simulation-3d-panel">
      <View track={viewRef as unknown as RefObject<HTMLElement>}>
        <IntersectionScene
          snapshot={panel.snapshot}
          darkMode={darkMode}
          showRoadArrows={showRoadArrows}
          label={panel.label}
          labelColor={panel.labelColor}
          cameraVersion={cameraVersion}
          controlsElement={controlsElement}
        />
      </View>
    </div>
  );
}

export function Simulation3DView({
  panels,
  darkMode,
  showRoadArrows,
  onWebGLFailure,
}: Simulation3DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cameraVersion, setCameraVersion] = useState(0);
  const [webglAvailable] = useState(canUseWebGL);

  if (!webglAvailable) {
    return <WebGLUnavailable onFailure={onWebGLFailure} />;
  }

  return (
    <RendererErrorBoundary onFailure={onWebGLFailure}>
      <div
        ref={containerRef}
        className={`simulation-3d-layout panels-${panels.length}`}
      >
        <Canvas
          className="simulation-3d-canvas"
          shadows="basic"
          frameloop="always"
          dpr={[1, 1.5]}
          eventSource={containerRef as unknown as RefObject<HTMLElement>}
          eventPrefix="client"
          gl={{
            antialias: true,
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
          }}
        >
          <ClearSharedCanvas />
          <View.Port />
        </Canvas>
        <div className="simulation-3d-views">
          {panels.map((panel) => (
            <ViewPanel
              key={panel.key}
              panel={panel}
              darkMode={darkMode}
              showRoadArrows={showRoadArrows}
              cameraVersion={cameraVersion}
            />
          ))}
        </div>
        <button
          type="button"
          className="simulation-3d-reset"
          onClick={() => setCameraVersion((version) => version + 1)}
          title="Reset 3D camera"
          aria-label="Reset 3D camera"
        >
          <span aria-hidden="true">⌖</span> Reset view
        </button>
      </div>
    </RendererErrorBoundary>
  );
}
