/**
 * Automatic Dimension Placement System (ASME Y14.5)
 * Calculates and positions dimensions based on projected views and datums
 */

import type { MeshData, BoundingBox, Dimension, DimensionPosition, ViewType } from "../../types";
import type { ProjectedView, Vec2 } from "./projection";
import type { DatumFeature } from "./datums";

// Dimension placement options
export interface DimensionPlacementOptions {
  unit: "mm" | "in";
  extensionGap: number;      // Gap between geometry and extension line start
  extensionOverhang: number; // How far extension line goes past dimension line
  dimensionOffset: number;   // Distance from geometry to dimension line
  stackingOffset: number;    // Distance between stacked dimensions
  minDimensionSpacing: number; // Minimum space between dimension values
}

// Default options (ASME Y14.5 standard)
const DEFAULT_OPTIONS: DimensionPlacementOptions = {
  unit: "mm",
  extensionGap: 1.5,
  extensionOverhang: 2.0,
  dimensionOffset: 10,
  stackingOffset: 8,
  minDimensionSpacing: 5,
};

// Dimension candidate (before final placement)
interface DimensionCandidate {
  type: "overall" | "feature" | "hole" | "datum-reference";
  value: number;
  direction: "horizontal" | "vertical";
  viewType: ViewType;
  startPoint: Vec2;
  endPoint: Vec2;
  priority: number; // Higher = more important
  label: string;
}

/**
 * Calculate overall dimensions from bounding box
 */
export function calculateOverallDimensions(
  bbox: BoundingBox,
  viewType: ViewType
): DimensionCandidate[] {
  const candidates: DimensionCandidate[] = [];

  // Map view types to bbox dimensions
  const viewDimensions: Record<ViewType, { width: number; height: number; wDir: "x" | "z"; hDir: "y" | "z" }> = {
    front: { width: bbox.width, height: bbox.height, wDir: "x", hDir: "y" },
    top: { width: bbox.width, height: bbox.depth, wDir: "x", hDir: "z" },
    right: { width: bbox.depth, height: bbox.height, wDir: "z", hDir: "y" },
    isometric: { width: bbox.width, height: bbox.height, wDir: "x", hDir: "y" },
    section: { width: bbox.width, height: bbox.height, wDir: "x", hDir: "y" },
  };

  const dims = viewDimensions[viewType];
  if (!dims) return candidates;

  // Width dimension (bottom, horizontal)
  candidates.push({
    type: "overall",
    value: dims.width,
    direction: "horizontal",
    viewType,
    startPoint: [0, 0],
    endPoint: [dims.width, 0],
    priority: 100,
    label: `Overall Width (${dims.wDir.toUpperCase()})`,
  });

  // Height dimension (right side, vertical)
  candidates.push({
    type: "overall",
    value: dims.height,
    direction: "vertical",
    viewType,
    startPoint: [dims.width, 0],
    endPoint: [dims.width, dims.height],
    priority: 100,
    label: `Overall Height (${dims.hDir.toUpperCase()})`,
  });

  return candidates;
}

/**
 * Calculate feature dimensions from projected view edges
 */
export function calculateFeatureDimensions(
  view: ProjectedView,
  _datums: DatumFeature[],
  _meshData: MeshData
): DimensionCandidate[] {
  const candidates: DimensionCandidate[] = [];
  const { bounds, edges } = view;

  // Find significant edge clusters that might represent features
  const horizontalEdges = edges.filter(e => 
    Math.abs(e.start[1] - e.end[1]) < 0.1 && // Nearly horizontal
    e.type === "visible"
  );

  const verticalEdges = edges.filter(e => 
    Math.abs(e.start[0] - e.end[0]) < 0.1 && // Nearly vertical
    e.type === "visible"
  );

  // Find step features (changes in profile)
  const uniqueYs = [...new Set(horizontalEdges.map(e => e.start[1]))].sort((a, b) => a - b);
  const uniqueXs = [...new Set(verticalEdges.map(e => e.start[0]))].sort((a, b) => a - b);

  // Add intermediate horizontal dimensions (steps)
  for (let i = 0; i < uniqueYs.length - 1; i++) {
    const stepHeight = Math.abs(uniqueYs[i + 1] - uniqueYs[i]);
    if (stepHeight > 1) { // Ignore tiny steps
      candidates.push({
        type: "feature",
        value: stepHeight,
        direction: "vertical",
        viewType: view.type as ViewType,
        startPoint: [bounds.maxX + 5, uniqueYs[i]],
        endPoint: [bounds.maxX + 5, uniqueYs[i + 1]],
        priority: 50,
        label: `Step Height ${i + 1}`,
      });
    }
  }

  // Add intermediate vertical dimensions (steps)
  for (let i = 0; i < uniqueXs.length - 1; i++) {
    const stepWidth = Math.abs(uniqueXs[i + 1] - uniqueXs[i]);
    if (stepWidth > 1) { // Ignore tiny steps
      candidates.push({
        type: "feature",
        value: stepWidth,
        direction: "horizontal",
        viewType: view.type as ViewType,
        startPoint: [uniqueXs[i], bounds.minY - 5],
        endPoint: [uniqueXs[i + 1], bounds.minY - 5],
        priority: 50,
        label: `Step Width ${i + 1}`,
      });
    }
  }

  return candidates;
}

/**
 * Calculate datum reference dimensions
 * Dimensions from datum planes to features
 */
export function calculateDatumReferenceDimensions(
  view: ProjectedView,
  datums: DatumFeature[],
  _positions: Float32Array
): DimensionCandidate[] {
  const candidates: DimensionCandidate[] = [];

  if (datums.length === 0) return candidates;

  // Get datum A (primary) reference point
  const datumA = datums.find(d => d.id === "A");
  // datumB and datumC available for future feature-to-datum dimensioning
  // const datumB = datums.find(d => d.id === "B");
  // const datumC = datums.find(d => d.id === "C");

  // If we have Datum A, add reference dimension from it
  if (datumA) {
    // Simplified: Add datum reference symbol location
    // Future: Calculate distances from datum planes to features
    const normalDir = datumA.normal;
    candidates.push({
      type: "datum-reference",
      value: 0, // Reference only, no value
      direction: Math.abs(normalDir[1]) > Math.abs(normalDir[0]) ? "horizontal" : "vertical",
      viewType: view.type as ViewType,
      startPoint: [datumA.center[0], datumA.center[1]],
      endPoint: [datumA.center[0], datumA.center[1]],
      priority: 90,
      label: "DATUM A",
    });
  }

  return candidates;
}

/**
 * Convert dimension candidates to final positioned dimensions
 */
export function placeDimensions(
  candidates: DimensionCandidate[],
  viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: Partial<DimensionPlacementOptions> = {}
): Dimension[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dimensions: Dimension[] = [];

  // Sort candidates by priority (highest first)
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);

  // Track placed dimensions for stacking
  let horizontalOffset = opts.dimensionOffset;
  let verticalOffset = opts.dimensionOffset;

  for (const candidate of sorted) {
    // Skip datum references for now (need special rendering)
    if (candidate.type === "datum-reference") continue;

    let position: DimensionPosition;

    if (candidate.direction === "horizontal") {
      // Place below the view
      position = {
        start_x: candidate.startPoint[0],
        start_y: viewBounds.minY - horizontalOffset,
        end_x: candidate.endPoint[0],
        end_y: viewBounds.minY - horizontalOffset,
        text_x: (candidate.startPoint[0] + candidate.endPoint[0]) / 2,
        text_y: viewBounds.minY - horizontalOffset - 3,
      };
      horizontalOffset += opts.stackingOffset;
    } else {
      // Place to the right of the view
      position = {
        start_x: viewBounds.maxX + verticalOffset,
        start_y: candidate.startPoint[1],
        end_x: viewBounds.maxX + verticalOffset,
        end_y: candidate.endPoint[1],
        text_x: viewBounds.maxX + verticalOffset + 3,
        text_y: (candidate.startPoint[1] + candidate.endPoint[1]) / 2,
      };
      verticalOffset += opts.stackingOffset;
    }

    const dimension: Dimension = {
      id: `dim_${dimensions.length + 1}`,
      type: "linear",
      value: Math.abs(candidate.value),
      unit: opts.unit,
      view: candidate.viewType,
      position,
      label: candidate.label,
      is_critical: candidate.type === "overall",
    };

    dimensions.push(dimension);
  }

  return dimensions;
}

/**
 * Generate all dimensions for a view
 */
export function generateViewDimensions(
  view: ProjectedView,
  bbox: BoundingBox,
  datums: DatumFeature[],
  meshData: MeshData,
  options?: Partial<DimensionPlacementOptions>
): Dimension[] {
  const viewType = view.type as ViewType;

  // Collect all dimension candidates
  const candidates: DimensionCandidate[] = [
    ...calculateOverallDimensions(bbox, viewType),
    ...calculateFeatureDimensions(view, datums, meshData),
    ...calculateDatumReferenceDimensions(view, datums, meshData.positions),
  ];

  // Place dimensions with proper spacing
  return placeDimensions(candidates, view.bounds, options);
}

/**
 * Generate dimensions for all standard views
 */
export function generateAllDimensions(
  views: ProjectedView[],
  bbox: BoundingBox,
  datums: DatumFeature[],
  meshData: MeshData,
  options?: Partial<DimensionPlacementOptions>
): Map<ViewType, Dimension[]> {
  const allDimensions = new Map<ViewType, Dimension[]>();

  for (const view of views) {
    const viewDims = generateViewDimensions(view, bbox, datums, meshData, options);
    allDimensions.set(view.type as ViewType, viewDims);
  }

  return allDimensions;
}

/**
 * Add hole/circle dimensions
 */
export function addHoleDimensions(
  view: ProjectedView,
  dimensions: Dimension[]
): Dimension[] {
  const holeDimensions: Dimension[] = [];
  let holeIndex = 0;

  for (const circle of view.circles) {
    holeIndex++;
    const dim: Dimension = {
      id: `hole_${holeIndex}`,
      type: circle.type === "hole" ? "diameter" : "radius",
      value: circle.type === "hole" ? circle.radius * 2 : circle.radius,
      unit: "mm",
      view: view.type as ViewType,
      position: {
        start_x: circle.center[0] - circle.radius,
        start_y: circle.center[1],
        end_x: circle.center[0] + circle.radius,
        end_y: circle.center[1],
        text_x: circle.center[0] + circle.radius + 5,
        text_y: circle.center[1],
      },
      label: circle.type === "hole" ? `Hole ${holeIndex}` : `Radius ${holeIndex}`,
      is_critical: circle.type === "hole",
    };
    holeDimensions.push(dim);
  }

  return [...dimensions, ...holeDimensions];
}
