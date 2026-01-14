/**
 * Dimension Layout Engine using Simulated Annealing
 * Based on D3-Labeler algorithm by Evan Wang
 * Adapted for ASME Y14.5 engineering drawing dimensions
 */

import type { Dimension, ViewType } from "../../types";
import type { ProjectedView } from "./projection";

// Layout configuration
interface LayoutConfig {
  minDimensionSpacing: number;    // Minimum space between dimension lines (mm)
  minExtensionGap: number;        // Gap between geometry and extension line
  dimensionOffset: number;        // Distance from geometry to first dimension
  stackingIncrement: number;      // Distance between stacked dimensions
  maxIterations: number;          // Simulated annealing iterations
  initialTemperature: number;     // SA initial temperature
  coolingRate: number;            // SA cooling rate
}

const DEFAULT_CONFIG: LayoutConfig = {
  minDimensionSpacing: 8,
  minExtensionGap: 2,
  dimensionOffset: 12,
  stackingIncrement: 10,
  maxIterations: 2000,
  initialTemperature: 1.0,
  coolingRate: 0.95,
};

// Energy weights for optimization
const WEIGHTS = {
  overlap: 100.0,           // Penalty for dimension overlaps
  geometryOverlap: 50.0,    // Penalty for overlapping geometry
  distance: 0.5,            // Penalty for being far from anchor
  alignment: 10.0,          // Reward for proper alignment
  spacing: 20.0,            // Penalty for dimensions too close
  outOfBounds: 200.0,       // Penalty for going outside view area
};

// Dimension with position for layout
interface LayoutDimension {
  id: string;
  type: "horizontal" | "vertical";
  value: number;
  anchorStart: { x: number; y: number };  // Where dimension should connect
  anchorEnd: { x: number; y: number };
  position: { x: number; y: number };     // Current position (center of dim line)
  width: number;                          // Text width
  height: number;                         // Text height
  view: ViewType;
  offset: number;                         // Distance from geometry
}

/**
 * Calculate bounding box for a dimension
 */
function getDimensionBounds(dim: LayoutDimension): { x1: number; y1: number; x2: number; y2: number } {
  if (dim.type === "horizontal") {
    return {
      x1: Math.min(dim.anchorStart.x, dim.anchorEnd.x),
      y1: dim.position.y - dim.height / 2,
      x2: Math.max(dim.anchorStart.x, dim.anchorEnd.x),
      y2: dim.position.y + dim.height / 2,
    };
  } else {
    return {
      x1: dim.position.x - dim.height / 2,
      y1: Math.min(dim.anchorStart.y, dim.anchorEnd.y),
      x2: dim.position.x + dim.height / 2,
      y2: Math.max(dim.anchorStart.y, dim.anchorEnd.y),
    };
  }
}

/**
 * Check if two rectangles overlap
 */
function rectsOverlap(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
): number {
  const xOverlap = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const yOverlap = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return xOverlap * yOverlap;
}

/**
 * Calculate energy for a single dimension
 */
function calculateEnergy(
  index: number,
  dimensions: LayoutDimension[],
  viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  config: LayoutConfig
): number {
  const dim = dimensions[index];
  let energy = 0;

  const dimBounds = getDimensionBounds(dim);

  // Penalty for overlaps with other dimensions
  for (let i = 0; i < dimensions.length; i++) {
    if (i === index) continue;
    if (dimensions[i].view !== dim.view) continue; // Only check same view

    const otherBounds = getDimensionBounds(dimensions[i]);
    const overlap = rectsOverlap(dimBounds, otherBounds);
    energy += overlap * WEIGHTS.overlap;

    // Penalty for dimensions of same type being too close
    if (dimensions[i].type === dim.type) {
      let spacing: number;
      if (dim.type === "horizontal") {
        spacing = Math.abs(dim.position.y - dimensions[i].position.y);
      } else {
        spacing = Math.abs(dim.position.x - dimensions[i].position.x);
      }
      if (spacing > 0 && spacing < config.minDimensionSpacing) {
        energy += (config.minDimensionSpacing - spacing) * WEIGHTS.spacing;
      }
    }
  }

  // Penalty for being outside view bounds
  const margin = 50; // Allow dimensions to be outside but not too far
  if (dim.type === "horizontal") {
    if (dim.position.y < viewBounds.minY - margin) {
      energy += (viewBounds.minY - margin - dim.position.y) * WEIGHTS.outOfBounds;
    }
    if (dim.position.y > viewBounds.maxY + margin) {
      energy += (dim.position.y - viewBounds.maxY - margin) * WEIGHTS.outOfBounds;
    }
  } else {
    if (dim.position.x < viewBounds.minX - margin) {
      energy += (viewBounds.minX - margin - dim.position.x) * WEIGHTS.outOfBounds;
    }
    if (dim.position.x > viewBounds.maxX + margin) {
      energy += (dim.position.x - viewBounds.maxX - margin) * WEIGHTS.outOfBounds;
    }
  }

  // Small penalty for distance from ideal position (encourages compact layout)
  const idealOffset = config.dimensionOffset + dim.offset * config.stackingIncrement;
  if (dim.type === "horizontal") {
    const idealY = viewBounds.maxY + idealOffset;
    energy += Math.abs(dim.position.y - idealY) * WEIGHTS.distance;
  } else {
    const idealX = viewBounds.maxX + idealOffset;
    energy += Math.abs(dim.position.x - idealX) * WEIGHTS.distance;
  }

  return energy;
}

/**
 * Perform a Monte Carlo move
 */
function mcMove(
  dimensions: LayoutDimension[],
  viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  temperature: number,
  config: LayoutConfig
): boolean {
  // Select random dimension
  const i = Math.floor(Math.random() * dimensions.length);
  const dim = dimensions[i];

  // Save old position
  const oldY = dim.position.y;
  const oldX = dim.position.x;

  // Calculate old energy
  const oldEnergy = calculateEnergy(i, dimensions, viewBounds, config);

  // Random move (only in the relevant direction)
  const moveAmount = (Math.random() - 0.5) * 10;
  if (dim.type === "horizontal") {
    dim.position.y += moveAmount;
  } else {
    dim.position.x += moveAmount;
  }

  // Calculate new energy
  const newEnergy = calculateEnergy(i, dimensions, viewBounds, config);
  const deltaEnergy = newEnergy - oldEnergy;

  // Accept or reject move
  if (deltaEnergy < 0 || Math.random() < Math.exp(-deltaEnergy / temperature)) {
    return true; // Accept
  } else {
    // Reject - restore old position
    dim.position.y = oldY;
    dim.position.x = oldX;
    return false;
  }
}

/**
 * Run simulated annealing to optimize dimension layout
 */
function simulatedAnnealing(
  dimensions: LayoutDimension[],
  viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  config: LayoutConfig
): void {
  let temperature = config.initialTemperature;

  for (let iter = 0; iter < config.maxIterations; iter++) {
    // Perform moves for each dimension
    for (let j = 0; j < dimensions.length; j++) {
      mcMove(dimensions, viewBounds, temperature, config);
    }

    // Cool down
    temperature *= config.coolingRate;
  }
}

/**
 * Convert dimensions to layout format and assign initial positions
 */
function initializeLayout(
  dimensions: Dimension[],
  viewBounds: Map<ViewType, { minX: number; minY: number; maxX: number; maxY: number }>,
  config: LayoutConfig
): LayoutDimension[] {
  const layoutDims: LayoutDimension[] = [];

  // Group dimensions by view and type
  const byViewAndType = new Map<string, Dimension[]>();
  for (const dim of dimensions) {
    const isHorizontal = Math.abs(dim.position.start_y - dim.position.end_y) < 
                         Math.abs(dim.position.start_x - dim.position.end_x);
    const key = `${dim.view}-${isHorizontal ? "h" : "v"}`;
    if (!byViewAndType.has(key)) {
      byViewAndType.set(key, []);
    }
    byViewAndType.get(key)!.push(dim);
  }

  // Assign initial stacked positions
  for (const [key, dims] of byViewAndType) {
    const [viewStr, typeStr] = key.split("-");
    const view = viewStr as ViewType;
    const isHorizontal = typeStr === "h";
    const bounds = viewBounds.get(view);

    if (!bounds) continue;

    // Sort by position to stack consistently
    dims.sort((a, b) => {
      if (isHorizontal) {
        return a.position.start_x - b.position.start_x;
      } else {
        return a.position.start_y - b.position.start_y;
      }
    });

    dims.forEach((dim, index) => {
      const offset = index;
      const stackDistance = config.dimensionOffset + offset * config.stackingIncrement;

      let posX: number, posY: number;
      if (isHorizontal) {
        posX = (dim.position.start_x + dim.position.end_x) / 2;
        posY = bounds.maxY + stackDistance; // Below the view
      } else {
        posX = bounds.maxX + stackDistance; // Right of the view
        posY = (dim.position.start_y + dim.position.end_y) / 2;
      }

      layoutDims.push({
        id: dim.id,
        type: isHorizontal ? "horizontal" : "vertical",
        value: dim.value,
        anchorStart: { x: dim.position.start_x, y: dim.position.start_y },
        anchorEnd: { x: dim.position.end_x, y: dim.position.end_y },
        position: { x: posX, y: posY },
        width: String(dim.value.toFixed(2)).length * 2.5 + 4, // Approximate text width
        height: 4, // Approximate text height
        view: dim.view,
        offset: offset,
      });
    });
  }

  return layoutDims;
}

/**
 * Convert layout dimensions back to standard dimensions
 */
function layoutToPositions(layoutDims: LayoutDimension[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  for (const dim of layoutDims) {
    positions.set(dim.id, { x: dim.position.x, y: dim.position.y });
  }
  return positions;
}

/**
 * Main function: Optimize dimension layout for a drawing
 */
export function optimizeDimensionLayout(
  dimensions: Dimension[],
  views: ProjectedView[],
  config: Partial<LayoutConfig> = {}
): Dimension[] {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Build view bounds map
  const viewBounds = new Map<ViewType, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const view of views) {
    viewBounds.set(view.type as ViewType, view.bounds);
  }

  // If no views, return original
  if (viewBounds.size === 0) {
    return dimensions;
  }

  // Initialize layout
  const layoutDims = initializeLayout(dimensions, viewBounds, fullConfig);

  if (layoutDims.length === 0) {
    return dimensions;
  }

  // Get combined bounds for optimization
  let globalBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const bounds of viewBounds.values()) {
    globalBounds.minX = Math.min(globalBounds.minX, bounds.minX);
    globalBounds.minY = Math.min(globalBounds.minY, bounds.minY);
    globalBounds.maxX = Math.max(globalBounds.maxX, bounds.maxX);
    globalBounds.maxY = Math.max(globalBounds.maxY, bounds.maxY);
  }

  // Run simulated annealing
  simulatedAnnealing(layoutDims, globalBounds, fullConfig);

  // Update dimensions with optimized positions
  const optimizedPositions = layoutToPositions(layoutDims);
  
  return dimensions.map(dim => {
    const layoutDim = layoutDims.find(ld => ld.id === dim.id);
    if (!layoutDim) return dim;

    const newPos = optimizedPositions.get(dim.id);
    if (!newPos) return dim;

    // Update position based on type
    const isHorizontal = layoutDim.type === "horizontal";
    
    if (isHorizontal) {
      // Horizontal dimension - update Y position (dimension line position)
      return {
        ...dim,
        position: {
          ...dim.position,
          start_y: newPos.y,
          end_y: newPos.y,
          text_y: newPos.y - 3,
        },
      };
    } else {
      // Vertical dimension - update X position
      return {
        ...dim,
        position: {
          ...dim.position,
          start_x: newPos.x,
          end_x: newPos.x,
          text_x: newPos.x + 3,
        },
      };
    }
  });
}

/**
 * Simple rule-based layout (fallback if SA is too slow)
 * Assigns dimensions to fixed stacking positions
 */
export function stackDimensions(
  dimensions: Dimension[],
  viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  config: Partial<LayoutConfig> = {}
): Dimension[] {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Separate horizontal and vertical dimensions
  const horizontal: Dimension[] = [];
  const vertical: Dimension[] = [];

  for (const dim of dimensions) {
    const isHorizontal = Math.abs(dim.position.start_y - dim.position.end_y) < 
                         Math.abs(dim.position.start_x - dim.position.end_x);
    if (isHorizontal) {
      horizontal.push(dim);
    } else {
      vertical.push(dim);
    }
  }

  // Sort and stack horizontal dimensions (below view)
  horizontal.sort((a, b) => {
    // Sort by extent - larger dimensions go further out
    const extentA = Math.abs(a.position.end_x - a.position.start_x);
    const extentB = Math.abs(b.position.end_x - b.position.start_x);
    return extentB - extentA;
  });

  const stackedHorizontal = horizontal.map((dim, index) => {
    const yPos = viewBounds.maxY + fullConfig.dimensionOffset + index * fullConfig.stackingIncrement;
    return {
      ...dim,
      position: {
        ...dim.position,
        start_y: yPos,
        end_y: yPos,
        text_y: yPos - 3,
      },
    };
  });

  // Sort and stack vertical dimensions (right of view)
  vertical.sort((a, b) => {
    const extentA = Math.abs(a.position.end_y - a.position.start_y);
    const extentB = Math.abs(b.position.end_y - b.position.start_y);
    return extentB - extentA;
  });

  const stackedVertical = vertical.map((dim, index) => {
    const xPos = viewBounds.maxX + fullConfig.dimensionOffset + index * fullConfig.stackingIncrement;
    return {
      ...dim,
      position: {
        ...dim.position,
        start_x: xPos,
        end_x: xPos,
        text_x: xPos + 3,
      },
    };
  });

  return [...stackedHorizontal, ...stackedVertical];
}

/**
 * Remove overlapping/duplicate dimensions
 */
export function deduplicateDimensions(dimensions: Dimension[]): Dimension[] {
  const seen = new Map<string, Dimension>();

  for (const dim of dimensions) {
    // Create key based on value and approximate position
    const key = `${dim.view}-${dim.type}-${dim.value.toFixed(1)}`;
    
    if (!seen.has(key)) {
      seen.set(key, dim);
    }
  }

  return Array.from(seen.values());
}

/**
 * Filter dimensions to keep only essential ones
 */
export function filterEssentialDimensions(
  dimensions: Dimension[],
  maxPerView: number = 8
): Dimension[] {
  const byView = new Map<ViewType, Dimension[]>();

  for (const dim of dimensions) {
    if (!byView.has(dim.view)) {
      byView.set(dim.view, []);
    }
    byView.get(dim.view)!.push(dim);
  }

  const filtered: Dimension[] = [];

  for (const [, dims] of byView) {
    // Sort by priority: critical first, then by value (larger first)
    dims.sort((a, b) => {
      if (a.is_critical !== b.is_critical) {
        return a.is_critical ? -1 : 1;
      }
      return b.value - a.value;
    });

    // Keep only top N dimensions per view
    filtered.push(...dims.slice(0, maxPerView));
  }

  return filtered;
}
