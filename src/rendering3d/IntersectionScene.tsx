import {
  Html,
  OrbitControls,
  OrthographicCamera,
  RoundedBox,
  Text,
} from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { CarState, PedestrianState, SignalState } from "../data/types";
import { allCrosswalks, getCrosswalkPosition } from "../simulation/pedestrians";
import type { SimulationSnapshot } from "../simulation/engine";
import { VEHICLE_CATALOG } from "../vehicles/catalog";
import {
  ALL_PATHS,
  getWorldPositionOnPath,
  pathPointToWorld,
} from "../simulation/paths";

const ROAD_HALF_WIDTH_METRES = 8;
const ROAD_LENGTH_METRES = 160;
const WORLD_SCALE = 1 / 5;
const GRASS_COLOR = "#315a32";
const ROAD_COLOR = "#363b40";
const ROAD_EDGE_COLOR = "#d6d9d2";
const MARKING_COLOR = "#f4f1df";
const CROSSWALK_LINE_COLOR = "#d5d9d6";
const HOLD_COLOR = "#efbd55";
const WAIT_COLOR_CAP_SECONDS = 180;

interface IntersectionSceneProps {
  snapshot: SimulationSnapshot | null;
  darkMode: boolean;
  showRoadArrows: boolean;
  label: string;
  labelColor: string;
  cameraVersion: number;
  controlsElement: HTMLElement | null;
}

function worldCrosswalkPosition(pedestrian: PedestrianState) {
  return pathPointToWorld(
    getCrosswalkPosition(
      pedestrian.signalGroup,
      pedestrian.direction,
      pedestrian.progress,
    ),
  );
}

function MaterialBox({
  args,
  position,
  color,
  emissive,
  opacity = 1,
}: {
  args: [number, number, number];
  position: [number, number, number];
  color: string;
  emissive?: string;
  opacity?: number;
}) {
  return (
    <mesh position={position} receiveShadow castShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial
        color={color}
        emissive={emissive ?? "#000000"}
        emissiveIntensity={emissive ? 1.7 : 0}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.8}
      />
    </mesh>
  );
}

function RoadMarkings({ showRoadArrows }: { showRoadArrows: boolean }) {
  const dashedMarkings: ReactNode[] = [];
  const dashPositions = [-68, -56, -44, -32, 32, 44, 56, 68];
  for (const coordinate of dashPositions) {
    dashedMarkings.push(
      <MaterialBox
        key={`north-${coordinate}`}
        args={[0.18, 0.04, 6]}
        position={[-4, 0.08, coordinate]}
        color={MARKING_COLOR}
      />,
      <MaterialBox
        key={`south-${coordinate}`}
        args={[0.18, 0.04, 6]}
        position={[4, 0.08, coordinate]}
        color={MARKING_COLOR}
      />,
      <MaterialBox
        key={`east-${coordinate}`}
        args={[6, 0.04, 0.18]}
        position={[coordinate, 0.08, 4]}
        color={MARKING_COLOR}
      />,
      <MaterialBox
        key={`west-${coordinate}`}
        args={[6, 0.04, 0.18]}
        position={[coordinate, 0.08, -4]}
        color={MARKING_COLOR}
      />,
    );
  }

  const arrows = showRoadArrows
    ? [
        [6, -26, Math.PI],
        [2, -26, Math.PI],
        [-6, 26, 0],
        [-2, 26, 0],
        [-26, -6, -Math.PI / 2],
        [-26, -2, -Math.PI / 2],
        [26, 6, Math.PI / 2],
        [26, 2, Math.PI / 2],
      ].map(([x, z, rotation], index) => (
        <mesh
          key={`arrow-${index}`}
          position={[x, 0.1, z]}
          rotation={[-Math.PI / 2, rotation, 0]}
        >
          <coneGeometry args={[0.85, 2.2, 3]} />
          <meshBasicMaterial color={MARKING_COLOR} />
        </mesh>
      ))
    : null;

  return (
    <group>
      {dashedMarkings}
      <MaterialBox
        args={[0.18, 0.04, 72]}
        position={[0, 0.08, -44]}
        color={MARKING_COLOR}
      />
      <MaterialBox
        args={[0.18, 0.04, 72]}
        position={[0, 0.08, 44]}
        color={MARKING_COLOR}
      />
      <MaterialBox
        args={[72, 0.04, 0.18]}
        position={[-44, 0.08, 0]}
        color={MARKING_COLOR}
      />
      <MaterialBox
        args={[72, 0.04, 0.18]}
        position={[44, 0.08, 0]}
        color={MARKING_COLOR}
      />
      {arrows}
    </group>
  );
}

function Crosswalks({ activeGroups }: { activeGroups: Set<number> }) {
  return (
    <group>
      {allCrosswalks().map((crosswalk) => {
        const { rect } = crosswalk;
        const centre = pathPointToWorld({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
        const width = rect.width * WORLD_SCALE;
        const depth = rect.height * WORLD_SCALE;
        const active = activeGroups.has(crosswalk.signalGroup);
        const lineThickness = 0.18;
        const roadWidth = ROAD_HALF_WIDTH_METRES * 2;
        const lineColor = CROSSWALK_LINE_COLOR;
        const lineEmissive = active ? "#277d50" : undefined;

        return (
          <group key={crosswalk.signalGroup}>
            <MaterialBox
              args={
                crosswalk.orientation === "vertical"
                  ? [roadWidth, 0.07, lineThickness]
                  : [lineThickness, 0.07, roadWidth]
              }
              position={
                crosswalk.orientation === "vertical"
                  ? [centre.x, 0.13, centre.z - depth / 2 + lineThickness / 2]
                  : [centre.x - width / 2 + lineThickness / 2, 0.13, centre.z]
              }
              color={lineColor}
              emissive={lineEmissive}
            />
            <MaterialBox
              args={
                crosswalk.orientation === "vertical"
                  ? [roadWidth, 0.07, lineThickness]
                  : [lineThickness, 0.07, roadWidth]
              }
              position={
                crosswalk.orientation === "vertical"
                  ? [centre.x, 0.13, centre.z + depth / 2 - lineThickness / 2]
                  : [centre.x + width / 2 - lineThickness / 2, 0.13, centre.z]
              }
              color={lineColor}
              emissive={lineEmissive}
            />
          </group>
        );
      })}
    </group>
  );
}

const LANE_HIT_AREAS = [
  {
    key: "N-0",
    position: [4, 0.2, -28] as [number, number, number],
    size: [2, 40] as [number, number],
  },
  {
    key: "N-1",
    position: [2, 0.2, -28] as [number, number, number],
    size: [2, 40] as [number, number],
  },
  {
    key: "S-0",
    position: [-4, 0.2, 28] as [number, number, number],
    size: [2, 40] as [number, number],
  },
  {
    key: "S-1",
    position: [-2, 0.2, 28] as [number, number, number],
    size: [2, 40] as [number, number],
  },
  {
    key: "E-0",
    position: [28, 0.2, 4] as [number, number, number],
    size: [40, 2] as [number, number],
  },
  {
    key: "E-1",
    position: [28, 0.2, 2] as [number, number, number],
    size: [40, 2] as [number, number],
  },
  {
    key: "W-0",
    position: [-28, 0.2, -4] as [number, number, number],
    size: [40, 2] as [number, number],
  },
  {
    key: "W-1",
    position: [-28, 0.2, -2] as [number, number, number],
    size: [40, 2] as [number, number],
  },
] as const;

function LaneHoverTarget({
  lane,
  snapshot,
}: {
  lane: (typeof LANE_HIT_AREAS)[number];
  snapshot: SimulationSnapshot | null;
}) {
  const [hovered, setHovered] = useState(false);
  const stats = snapshot?.laneStats.get(lane.key);
  const [approach, laneIndex] = lane.key.split("-");

  return (
    <group>
      <mesh
        position={lane.position}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <planeGeometry args={lane.size} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hovered && stats && (
        <Html position={[lane.position[0], 1.2, lane.position[2]]} center>
          <div className="scene-lane-tooltip">
            <strong>
              {approach} lane {laneIndex}
            </strong>
            <span>Waiting: {stats.waitingVehicles}</span>
            <span>Delay: {stats.cumulativeDelayHours.toFixed(3)} h</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function LaneHoverTargets({
  snapshot,
}: {
  snapshot: SimulationSnapshot | null;
}) {
  return (
    <group>
      {LANE_HIT_AREAS.map((lane) => (
        <LaneHoverTarget key={lane.key} lane={lane} snapshot={snapshot} />
      ))}
    </group>
  );
}

function StopLines() {
  const stopLineOffset = 11.2;
  const holdLineOffset = 12;

  return (
    <group>
      <MaterialBox
        args={[8, 0.06, 0.35]}
        position={[4, 0.13, -stopLineOffset]}
        color={ROAD_EDGE_COLOR}
      />
      <MaterialBox
        args={[8, 0.06, 0.35]}
        position={[-4, 0.13, stopLineOffset]}
        color={ROAD_EDGE_COLOR}
      />
      <MaterialBox
        args={[0.35, 0.06, 8]}
        position={[stopLineOffset, 0.13, 4]}
        color={ROAD_EDGE_COLOR}
      />
      <MaterialBox
        args={[0.35, 0.06, 8]}
        position={[-stopLineOffset, 0.13, -4]}
        color={ROAD_EDGE_COLOR}
      />
      <MaterialBox
        args={[8, 0.05, 0.18]}
        position={[4, 0.2, -holdLineOffset]}
        color={HOLD_COLOR}
      />
      <MaterialBox
        args={[8, 0.05, 0.18]}
        position={[-4, 0.2, holdLineOffset]}
        color={HOLD_COLOR}
      />
      <MaterialBox
        args={[0.18, 0.05, 8]}
        position={[holdLineOffset, 0.2, 4]}
        color={HOLD_COLOR}
      />
      <MaterialBox
        args={[0.18, 0.05, 8]}
        position={[-holdLineOffset, 0.2, -4]}
        color={HOLD_COLOR}
      />
    </group>
  );
}

function DetectorMarkers() {
  const markers = [
    [6, -11.4, "1", Math.PI],
    [2, -11.4, "2", Math.PI],
    [-11.4, -6, "3", -Math.PI / 2],
    [-11.4, -2, "4", -Math.PI / 2],
    [-6, 11.4, "5", 0],
    [-2, 11.4, "6", 0],
    [11.4, 6, "7", Math.PI / 2],
    [11.4, 2, "8", Math.PI / 2],
  ] as const;

  return (
    <group>
      {markers.map(([x, z, label, rotation]) => (
        <Text
          key={label}
          position={[x, 0.14, z]}
          rotation={[-Math.PI / 2, 0, rotation]}
          anchorX="center"
          anchorY="middle"
          fontSize={1.5}
          color="#f6c453"
          outlineColor="#18201d"
          outlineWidth={0.12}
          depthOffset={-1}
        >
          {label}
        </Text>
      ))}
    </group>
  );
}

function Compass() {
  return (
    <group>
      <Html position={[-70, 0.15, -70]} center>
        <div className="scene-compass" aria-label="North-up compass">
          <strong>N</strong>
          <span>+</span>
          <span>E</span>
          <span>S</span>
          <span>W</span>
        </div>
      </Html>
    </group>
  );
}

function signalAspect(
  snapshot: SimulationSnapshot | null,
  approach: "N" | "S" | "E" | "W",
): SignalState {
  return snapshot?.signalStates.get(`${approach}-straight`) ?? "red";
}

function SignalPole({
  position,
  aspect,
}: {
  position: [number, number, number];
  aspect: SignalState;
}) {
  const colors: Record<SignalState, string> = {
    green: "#4ade80",
    yellow: "#facc15",
    red: "#f87171",
    off: "#4b5563",
  };
  return (
    <group position={position}>
      <mesh position={[0, 3, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 6, 8]} />
        <meshStandardMaterial
          color="#252a2e"
          metalness={0.65}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 6.05, 0]}>
        <boxGeometry args={[0.55, 1.9, 0.4]} />
        <meshStandardMaterial color="#17191b" roughness={0.45} />
      </mesh>
      {(["red", "yellow", "green"] as SignalState[]).map((state, index) => (
        <mesh key={state} position={[0, 6.55 - index * 0.5, 0.22]}>
          <sphereGeometry args={[0.14, 12, 8]} />
          <meshStandardMaterial
            color={colors[state]}
            emissive={state === aspect ? colors[state] : "#000000"}
            emissiveIntensity={state === aspect ? 2.4 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

function vehicleDimensions(car: CarState) {
  const catalogVehicle = VEHICLE_CATALOG.find(
    (vehicle) =>
      vehicle.vehicleClass === car.vehicleClass &&
      vehicle.vehicleVariant === car.vehicleVariant,
  );
  const dimensions = {
    length: car.length,
    width: catalogVehicle?.dimensions.width ?? 1.8,
    height: catalogVehicle?.dimensions.height ?? 1.5,
  };
  return dimensions;
}

function RoundedVehiclePart({
  args,
  position,
  color,
  radius = 0.08,
  opacity = 1,
  emissive,
  metalness = 0,
}: {
  args: [number, number, number];
  position: [number, number, number];
  color: string;
  radius?: number;
  opacity?: number;
  emissive?: string;
  metalness?: number;
}) {
  return (
    <RoundedBox
      args={args}
      position={position}
      radius={radius}
      smoothness={2}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        emissive={emissive ?? "#000000"}
        emissiveIntensity={emissive ? 1.8 : 0}
        metalness={metalness}
        roughness={0.58}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </RoundedBox>
  );
}

function SideWindow({
  side,
  dimensions,
  bodyWidth = dimensions.width,
  y,
  z,
  length,
  height,
}: {
  side: -1 | 1;
  dimensions: { width: number };
  bodyWidth?: number;
  y: number;
  z: number;
  length: number;
  height: number;
}) {
  return (
    <RoundedVehiclePart
      args={[0.035, height, length]}
      position={[side * (bodyWidth / 2 + 0.012), y, z]}
      color="#273d4a"
      radius={0.025}
      opacity={0.92}
      metalness={0.12}
    />
  );
}

function VehicleBody({ car }: { car: CarState }) {
  const color = car.paintColor;
  const windowColor = "#273d4a";
  const dimensions = vehicleDimensions(car);
  const baseHeight = Math.min(1.15, dimensions.height * 0.5);
  const upperHeight = Math.max(0.45, dimensions.height - baseHeight);
  const wheelRadius = Math.min(0.42, dimensions.height * 0.19);
  const wheelX = Math.max(0.55, dimensions.width / 2 - 0.14);
  const wheelZ = Math.max(0.6, dimensions.length / 2 - 0.75);
  const roofColor = new THREE.Color(color).multiplyScalar(0.82).getStyle();
  const trimColor = "#20282d";
  const body: ReactNode =
    car.vehicleClass === "truck" ? (
      <>
        <RoundedVehiclePart
          args={[dimensions.width, baseHeight, dimensions.length]}
          position={[0, baseHeight / 2, 0]}
          color={color}
          radius={0.22}
        />
        <RoundedVehiclePart
          args={[
            dimensions.width * 0.96,
            upperHeight * 0.92,
            dimensions.length * 0.62,
          ]}
          position={[
            0,
            baseHeight + (upperHeight * 0.92) / 2,
            -dimensions.length * 0.12,
          ]}
          color={roofColor}
          radius={0.18}
        />
        <RoundedVehiclePart
          args={[
            dimensions.width * 0.9,
            upperHeight * 0.88,
            dimensions.length * 0.28,
          ]}
          position={[
            0,
            baseHeight + (upperHeight * 0.88) / 2,
            dimensions.length * 0.3,
          ]}
          color={color}
          radius={0.15}
        />
        <SideWindow
          side={-1}
          dimensions={dimensions}
          bodyWidth={dimensions.width * 0.9}
          y={baseHeight + upperHeight * 0.68}
          z={dimensions.length * 0.3}
          length={dimensions.length * 0.2}
          height={upperHeight * 0.34}
        />
        <SideWindow
          side={1}
          dimensions={dimensions}
          bodyWidth={dimensions.width * 0.9}
          y={baseHeight + upperHeight * 0.68}
          z={dimensions.length * 0.3}
          length={dimensions.length * 0.2}
          height={upperHeight * 0.34}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.76, upperHeight * 0.34, 0.04]}
          position={[
            0,
            baseHeight + upperHeight * 0.68,
            dimensions.length * 0.445,
          ]}
          color={windowColor}
          radius={0.02}
          opacity={0.94}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.88, 0.12, dimensions.length * 0.58]}
          position={[0, dimensions.height + 0.02, -dimensions.length * 0.12]}
          color={trimColor}
          radius={0.04}
        />
      </>
    ) : car.vehicleClass === "bus" ? (
      <>
        <RoundedVehiclePart
          args={[dimensions.width, dimensions.height * 0.9, dimensions.length]}
          position={[0, dimensions.height * 0.45, 0]}
          color={color}
          radius={0.28}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.9, 0.12, dimensions.length * 0.86]}
          position={[0, dimensions.height * 0.91, 0]}
          color={roofColor}
          radius={0.05}
        />
        {([-1, 1] as const).map((side) => (
          <SideWindow
            key={side}
            side={side}
            dimensions={dimensions}
            bodyWidth={dimensions.width}
            y={dimensions.height * 0.67}
            z={0}
            length={dimensions.length * 0.72}
            height={dimensions.height * 0.3}
          />
        ))}
        <RoundedVehiclePart
          args={[dimensions.width * 0.78, dimensions.height * 0.3, 0.04]}
          position={[
            0,
            dimensions.height * 0.67,
            dimensions.length / 2 + 0.015,
          ]}
          color={windowColor}
          radius={0.025}
          opacity={0.94}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.82, 0.14, dimensions.length * 0.08]}
          position={[0, dimensions.height * 0.28, dimensions.length / 2 + 0.05]}
          color="#fff4c2"
          emissive="#ffdb75"
          radius={0.04}
        />
      </>
    ) : car.vehicleClass === "ute" ? (
      <>
        <RoundedVehiclePart
          args={[dimensions.width, baseHeight, dimensions.length]}
          position={[0, baseHeight / 2, 0]}
          color={color}
          radius={0.2}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.9, upperHeight, dimensions.length * 0.38]}
          position={[0, baseHeight + upperHeight / 2, dimensions.length * 0.14]}
          color={color}
          radius={0.15}
        />
        <RoundedVehiclePart
          args={[
            dimensions.width * 0.86,
            upperHeight * 0.2,
            dimensions.length * 0.43,
          ]}
          position={[
            0,
            baseHeight + upperHeight * 0.12,
            -dimensions.length * 0.2,
          ]}
          color="#4e5557"
          radius={0.04}
        />
        {([-1, 1] as const).map((side) => (
          <SideWindow
            key={side}
            side={side}
            dimensions={dimensions}
            bodyWidth={dimensions.width * 0.9}
            y={baseHeight + upperHeight * 0.68}
            z={dimensions.length * 0.14}
            length={dimensions.length * 0.22}
            height={upperHeight * 0.4}
          />
        ))}
        <RoundedVehiclePart
          args={[dimensions.width * 0.78, upperHeight * 0.4, 0.04]}
          position={[
            0,
            baseHeight + upperHeight * 0.68,
            dimensions.length * 0.34,
          ]}
          color={windowColor}
          radius={0.025}
          opacity={0.94}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.86, 0.1, dimensions.length * 0.4]}
          position={[
            0,
            baseHeight + upperHeight * 0.3,
            -dimensions.length * 0.2,
          ]}
          color={roofColor}
          radius={0.04}
        />
      </>
    ) : (
      <>
        <RoundedVehiclePart
          args={[dimensions.width, baseHeight, dimensions.length]}
          position={[0, baseHeight / 2, 0]}
          color={color}
          radius={0.2}
        />
        <RoundedVehiclePart
          args={[
            dimensions.width * 0.86,
            upperHeight * 0.78,
            dimensions.length * 0.54,
          ]}
          position={[
            0,
            baseHeight + upperHeight * 0.39,
            -dimensions.length * 0.04,
          ]}
          color={color}
          radius={0.14}
        />
        {([-1, 1] as const).map((side) => (
          <SideWindow
            key={side}
            side={side}
            dimensions={dimensions}
            bodyWidth={dimensions.width * 0.86}
            y={baseHeight + upperHeight * 0.61}
            z={-dimensions.length * 0.04}
            length={dimensions.length * 0.34}
            height={upperHeight * 0.34}
          />
        ))}
        <RoundedVehiclePart
          args={[dimensions.width * 0.72, upperHeight * 0.34, 0.04]}
          position={[
            0,
            baseHeight + upperHeight * 0.61,
            dimensions.length * 0.245,
          ]}
          color={windowColor}
          radius={0.025}
          opacity={0.94}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.72, upperHeight * 0.27, 0.04]}
          position={[
            0,
            baseHeight + upperHeight * 0.58,
            -dimensions.length * 0.29,
          ]}
          color={windowColor}
          radius={0.025}
          opacity={0.9}
        />
        <RoundedVehiclePart
          args={[dimensions.width * 0.76, 0.1, dimensions.length * 0.48]}
          position={[
            0,
            baseHeight + upperHeight * 0.79,
            -dimensions.length * 0.04,
          ]}
          color={roofColor}
          radius={0.04}
        />
      </>
    );

  const wheels = [
    { x: -wheelX, z: -wheelZ, outerX: -wheelX - 0.1 },
    { x: wheelX, z: -wheelZ, outerX: wheelX + 0.1 },
    { x: -wheelX, z: wheelZ, outerX: -wheelX - 0.1 },
    { x: wheelX, z: wheelZ, outerX: wheelX + 0.1 },
  ];

  return (
    <group>
      {body}
      {wheels.map(({ x, z, outerX }) => (
        <group key={`${x}-${z}`}>
          <mesh
            position={[x, wheelRadius + 0.02, z]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[wheelRadius, wheelRadius, 0.22, 12]} />
            <meshStandardMaterial color="#17191b" roughness={0.88} />
          </mesh>
          <mesh
            position={[outerX, wheelRadius + 0.02, z]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry
              args={[wheelRadius * 0.42, wheelRadius * 0.42, 0.035, 10]}
            />
            <meshStandardMaterial
              color="#aab6ba"
              metalness={0.65}
              roughness={0.28}
            />
          </mesh>
        </group>
      ))}
      <RoundedVehiclePart
        args={[dimensions.width * 0.72, 0.12, 0.12]}
        position={[
          0,
          Math.min(0.72, baseHeight * 0.68),
          dimensions.length / 2 + 0.05,
        ]}
        color="#fff2b2"
        emissive="#ffcf55"
        radius={0.04}
      />
      <RoundedVehiclePart
        args={[dimensions.width * 0.62, 0.1, 0.1]}
        position={[
          0,
          Math.min(0.68, baseHeight * 0.64),
          -dimensions.length / 2 - 0.05,
        ]}
        color="#d74747"
        emissive="#8f2020"
        radius={0.035}
      />
      <RoundedVehiclePart
        args={[dimensions.width * 0.78, 0.12, 0.12]}
        position={[0, 0.32, dimensions.length / 2 + 0.035]}
        color={trimColor}
        radius={0.04}
      />
      <RoundedVehiclePart
        args={[dimensions.width * 0.78, 0.12, 0.12]}
        position={[0, 0.32, -dimensions.length / 2 - 0.035]}
        color={trimColor}
        radius={0.04}
      />
      {([-1, 1] as const).map((side) => (
        <RoundedVehiclePart
          key={`mirror-${side}`}
          args={[0.14, 0.09, 0.2]}
          position={[
            side * (dimensions.width * 0.45 + 0.1),
            baseHeight + upperHeight * 0.52,
            dimensions.length * 0.2,
          ]}
          color={trimColor}
          radius={0.04}
        />
      ))}
    </group>
  );
}

function waitingColor(waitingSeconds: number): string {
  const amount = Math.min(1, waitingSeconds / WAIT_COLOR_CAP_SECONDS);
  return new THREE.Color("#ffd166")
    .lerp(new THREE.Color("#ef4444"), amount)
    .getStyle();
}

function VehicleModel({ car }: { car: CarState }) {
  const groupRef = useRef<THREE.Group>(null);
  const targetRef = useRef(new THREE.Vector3());
  const targetRotationRef = useRef(0);
  const initializedRef = useRef(false);
  const dimensions = vehicleDimensions(car);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const path = ALL_PATHS[car.pathIndex];
    if (!group || !path) return;

    const position = getWorldPositionOnPath(path, car.distance);
    const frontOffset = car.length / 2;
    targetRef.current.set(
      position.x - Math.sin(position.heading) * frontOffset,
      0.15,
      position.z - Math.cos(position.heading) * frontOffset,
    );
    targetRotationRef.current = position.heading;

    if (!initializedRef.current) {
      group.position.copy(targetRef.current);
      group.rotation.y = targetRotationRef.current;
      initializedRef.current = true;
      return;
    }

    const blend = 1 - Math.exp(-14 * Math.min(delta, 0.1));
    group.position.lerp(targetRef.current, blend);
    const rotationDelta = THREE.MathUtils.euclideanModulo(
      targetRotationRef.current - group.rotation.y + Math.PI,
      Math.PI * 2,
    ) - Math.PI;
    group.rotation.y += rotationDelta * blend;
  });

  return (
    <group ref={groupRef}>
      <VehicleBody car={car} />
      <MaterialBox
        args={[dimensions.width * 0.75, 0.07, 0.14]}
        position={[0, dimensions.height + 0.15, 0]}
        color={waitingColor(car.waitingTimeSeconds)}
        emissive={waitingColor(car.waitingTimeSeconds)}
      />
    </group>
  );
}

function VehicleFleet({ snapshot }: { snapshot: SimulationSnapshot | null }) {
  return (
    <group>
      {(snapshot?.cars ?? []).map((car) => (
        <VehicleModel key={car.id} car={car} />
      ))}
    </group>
  );
}

function Pedestrians({ snapshot }: { snapshot: SimulationSnapshot | null }) {
  return (
    <group>
      {(snapshot?.pedestrians ?? []).map((pedestrian) => {
        const position = worldCrosswalkPosition(pedestrian);
        return (
          <group key={pedestrian.id} position={[position.x, 0.3, position.z]}>
            <mesh position={[0, 0.9, 0]} castShadow>
              <sphereGeometry args={[0.3, 10, 8]} />
              <meshStandardMaterial color="#f6c98d" />
            </mesh>
            <mesh position={[0, 0.35, 0]}>
              <capsuleGeometry args={[0.18, 0.8, 4, 8]} />
              <meshStandardMaterial color="#f2f4f5" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function SceneHud({
  snapshot,
  label,
  labelColor,
}: Pick<IntersectionSceneProps, "snapshot" | "label" | "labelColor">) {
  return (
    <Html fullscreen pointerEvents="none">
      <div className="scene-hud">
        <div className="scene-hud-title" style={{ color: labelColor }}>
          {label}
        </div>
        <div>TIME {snapshot?.time.toFixed(1) ?? "0.0"}s</div>
        <div>THROUGH {snapshot?.vehiclesServed ?? 0}</div>
        <div>DELAY {snapshot?.totalDelay.toFixed(0) ?? "0"}s</div>
        <div className="scene-hud-phase">
          PHASE {String.fromCharCode(65 + (snapshot?.currentPhase ?? 0))}
        </div>
      </div>
    </Html>
  );
}

function FixedIsometricCamera({
  cameraVersion,
  controlsElement,
}: Pick<IntersectionSceneProps, "cameraVersion" | "controlsElement">) {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.set(105, 120, 105);
    camera.zoom = 1;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [cameraVersion]);

  return (
    <>
      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        position={[105, 120, 105]}
        left={-82}
        right={82}
        top={82}
        bottom={-82}
        manual
        near={0.1}
        far={500}
      />
      {controlsElement ? (
        <OrbitControls
          key={cameraVersion}
          domElement={controlsElement}
          target={[0, 0, 0]}
          enableRotate={false}
          enablePan
          enableZoom
          minZoom={0.8}
          maxZoom={6}
          zoomSpeed={0.8}
          panSpeed={0.8}
          enableDamping
          dampingFactor={0.12}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />
      ) : null}
    </>
  );
}

export function IntersectionScene({
  snapshot,
  darkMode,
  showRoadArrows,
  label,
  labelColor,
  cameraVersion,
  controlsElement,
}: IntersectionSceneProps) {
  const activeGroups = new Set(
    (snapshot?.pedestrians ?? []).map((pedestrian) => pedestrian.signalGroup),
  );

  return (
    <>
      <FixedIsometricCamera
        cameraVersion={cameraVersion}
        controlsElement={controlsElement}
      />
      <ambientLight intensity={darkMode ? 1.2 : 1.5} />
      <directionalLight
        position={[35, 90, 20]}
        intensity={darkMode ? 2 : 2.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <MaterialBox
        args={[ROAD_LENGTH_METRES, 0.1, ROAD_LENGTH_METRES]}
        position={[0, -0.12, 0]}
        color={GRASS_COLOR}
      />
      <MaterialBox
        args={[ROAD_HALF_WIDTH_METRES * 2, 0.08, ROAD_LENGTH_METRES]}
        position={[0, 0, 0]}
        color={ROAD_COLOR}
      />
      <MaterialBox
        args={[ROAD_LENGTH_METRES, 0.08, ROAD_HALF_WIDTH_METRES * 2]}
        position={[0, 0.01, 0]}
        color={ROAD_COLOR}
      />
      <RoadMarkings showRoadArrows={showRoadArrows} />
      <StopLines />
      <Crosswalks activeGroups={activeGroups} />
      <DetectorMarkers />
      <Compass />
      <SignalPole
        position={[-11, 0, -11]}
        aspect={signalAspect(snapshot, "W")}
      />
      <SignalPole
        position={[11, 0, -11]}
        aspect={signalAspect(snapshot, "N")}
      />
      <SignalPole position={[11, 0, 11]} aspect={signalAspect(snapshot, "E")} />
      <SignalPole
        position={[-11, 0, 11]}
        aspect={signalAspect(snapshot, "S")}
      />
      <LaneHoverTargets snapshot={snapshot} />
      <VehicleFleet snapshot={snapshot} />
      <Pedestrians snapshot={snapshot} />
      <SceneHud snapshot={snapshot} label={label} labelColor={labelColor} />
    </>
  );
}
