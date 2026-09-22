export type VehicleClass = "hatchback" | "sedan" | "ute" | "truck" | "bus";

export interface VehicleDefinition {
  id: string;
  make?: string;
  model?: string;
  vehicleClass: VehicleClass;
  weight: number;
  dimensions: { length: number; width: number; height: number };
  modelAsset?: string;
}

export interface VehicleAssignment {
  definition: VehicleDefinition;
  vehicleVariant: string;
  paintColor: string;
}

type CatalogEntry = VehicleDefinition & { vehicleVariant: string };

export const VEHICLE_CATALOG: CatalogEntry[] = [
  {
    id: "hatchback-compact",
    vehicleVariant: "compact",
    vehicleClass: "hatchback",
    weight: 16,
    dimensions: { length: 4.1, width: 1.8, height: 1.5 },
  },
  {
    id: "hatchback-standard",
    vehicleVariant: "standard",
    vehicleClass: "hatchback",
    weight: 16,
    dimensions: { length: 4.4, width: 1.8, height: 1.5 },
  },
  {
    id: "sedan-compact",
    vehicleVariant: "compact",
    vehicleClass: "sedan",
    weight: 15,
    dimensions: { length: 4.6, width: 1.8, height: 1.45 },
  },
  {
    id: "sedan-large",
    vehicleVariant: "large",
    vehicleClass: "sedan",
    weight: 15,
    dimensions: { length: 4.9, width: 1.85, height: 1.5 },
  },
  {
    id: "ute-single-cab",
    vehicleVariant: "single-cab",
    vehicleClass: "ute",
    weight: 9,
    dimensions: { length: 5.2, width: 1.9, height: 1.85 },
  },
  {
    id: "ute-double-cab",
    vehicleVariant: "double-cab",
    vehicleClass: "ute",
    weight: 9,
    dimensions: { length: 5.4, width: 1.9, height: 1.85 },
  },
  {
    id: "truck-rigid",
    vehicleVariant: "rigid-truck",
    vehicleClass: "truck",
    weight: 6,
    dimensions: { length: 8.5, width: 2.45, height: 3.4 },
  },
  {
    id: "truck-box",
    vehicleVariant: "box-truck",
    vehicleClass: "truck",
    weight: 6,
    dimensions: { length: 10, width: 2.5, height: 3.6 },
  },
  {
    id: "bus-city",
    vehicleVariant: "city-bus",
    vehicleClass: "bus",
    weight: 8,
    dimensions: { length: 12, width: 2.5, height: 3.2 },
  },
];

const PAINT_COLORS = [
  "#e45756",
  "#2e86ab",
  "#f3c969",
  "#5b8e7d",
  "#f28f3b",
  "#7b6d8d",
  "#d9d9d9",
  "#252525",
];

function hashSeed(value: number, salt: number): number {
  let hash = (value + salt * 374761393) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function weightedEntry(id: number): CatalogEntry {
  const totalWeight = VEHICLE_CATALOG.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  let target = (hashSeed(id, 11) / 0x100000000) * totalWeight;

  for (const entry of VEHICLE_CATALOG) {
    target -= entry.weight;
    if (target < 0) return entry;
  }

  return VEHICLE_CATALOG[VEHICLE_CATALOG.length - 1];
}

export function assignVehicle(id: number): VehicleAssignment {
  const entry = weightedEntry(id);
  return {
    definition: entry,
    vehicleVariant: entry.vehicleVariant,
    paintColor: PAINT_COLORS[hashSeed(id, 23) % PAINT_COLORS.length],
  };
}
