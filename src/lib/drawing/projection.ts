/**
 * Orthographic View Projection System
 * Projects 3D mesh geometry to 2D views for engineering drawings
 */

import type { MeshData } from "../../types";

// 3D Vector type
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

// Edge representation
export interface Edge2D {
  start: Vec2;
  end: Vec2;
  type: "visible" | "hidden" | "centerline";
}

// Circle (projected hole/cylinder)
export interface Circle2D {
  center: Vec2;
  radius: number;
  type: "hole" | "boss" | "fillet";
}

// Projected 2D View
export interface ProjectedView {
  type: "front" | "top" | "right" | "left" | "back" | "bottom" | "isometric";
  edges: Edge2D[];
  circles: Circle2D[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  scale: number;
}

// View direction vectors (looking AT the object FROM this direction)
export const VIEW_DIRECTIONS: Record<string, Vec3> = {
  front: [0, 0, -1],    // Looking from +Z toward -Z (XY plane)
  back: [0, 0, 1],      // Looking from -Z toward +Z
  top: [0, -1, 0],      // Looking from +Y toward -Y (XZ plane)
  bottom: [0, 1, 0],    // Looking from -Y toward +Y
  right: [-1, 0, 0],    // Looking from +X toward -X (YZ plane)
  left: [1, 0, 0],      // Looking from -X toward +X
};

// Up vectors for each view (defines the "up" direction in 2D)
export const VIEW_UP: Record<string, Vec3> = {
  front: [0, 1, 0],
  back: [0, 1, 0],
  top: [0, 0, -1],
  bottom: [0, 0, 1],
  right: [0, 1, 0],
  left: [0, 1, 0],
};

/**
 * Vector math utilities
 */
export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec2Distance(a: Vec2, b: Vec2): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

/**
 * Project a 3D point onto a 2D view plane
 */
export function projectPoint(
  point: Vec3,
  viewDir: Vec3,
  upDir: Vec3
): Vec2 {
  // Calculate right vector (perpendicular to view and up)
  const right = vec3Normalize(vec3Cross(upDir, viewDir));
  // Recalculate up to ensure orthogonality
  const up = vec3Normalize(vec3Cross(viewDir, right));

  // Project point onto 2D plane
  const x = vec3Dot(point, right);
  const y = vec3Dot(point, up);

  return [x, y];
}

/**
 * Extract unique edges from mesh triangles
 */
export function extractEdges(meshData: MeshData): Array<{ v1: Vec3; v2: Vec3; faces: number[] }> {
  const edgeMap = new Map<string, { v1: Vec3; v2: Vec3; faces: number[] }>();

  const positions = meshData.positions;
  const indices = meshData.indices;

  // Process each triangle
  for (let i = 0; i < indices.length; i += 3) {
    const faceIndex = Math.floor(i / 3);

    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];

    const v0: Vec3 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const v1: Vec3 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const v2: Vec3 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

    // Add three edges of the triangle
    const edges: Array<[Vec3, Vec3]> = [
      [v0, v1],
      [v1, v2],
      [v2, v0],
    ];

    for (const [a, b] of edges) {
      // Create canonical edge key (sorted to avoid duplicates)
      const keyA = `${a[0].toFixed(6)},${a[1].toFixed(6)},${a[2].toFixed(6)}`;
      const keyB = `${b[0].toFixed(6)},${b[1].toFixed(6)},${b[2].toFixed(6)}`;
      const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;

      if (edgeMap.has(edgeKey)) {
        edgeMap.get(edgeKey)!.faces.push(faceIndex);
      } else {
        edgeMap.set(edgeKey, { v1: a, v2: b, faces: [faceIndex] });
      }
    }
  }

  return Array.from(edgeMap.values());
}

/**
 * Calculate face normal from triangle vertices
 */
export function calculateFaceNormal(v0: Vec3, v1: Vec3, v2: Vec3): Vec3 {
  const e1 = vec3Sub(v1, v0);
  const e2 = vec3Sub(v2, v0);
  return vec3Normalize(vec3Cross(e1, e2));
}

/**
 * Determine if an edge is visible, hidden, or a silhouette edge
 */
export function classifyEdge(
  edge: { v1: Vec3; v2: Vec3; faces: number[] },
  meshData: MeshData,
  viewDir: Vec3
): "visible" | "hidden" | "silhouette" | "internal" {
  const positions = meshData.positions;
  const indices = meshData.indices;

  if (edge.faces.length === 1) {
    // Boundary edge (only one face) - always visible as silhouette
    return "silhouette";
  }

  if (edge.faces.length !== 2) {
    // Non-manifold edge
    return "internal";
  }

  // Get normals of both adjacent faces
  const face1Idx = edge.faces[0] * 3;
  const face2Idx = edge.faces[1] * 3;

  const f1i0 = indices[face1Idx];
  const f1i1 = indices[face1Idx + 1];
  const f1i2 = indices[face1Idx + 2];

  const f2i0 = indices[face2Idx];
  const f2i1 = indices[face2Idx + 1];
  const f2i2 = indices[face2Idx + 2];

  const f1v0: Vec3 = [positions[f1i0 * 3], positions[f1i0 * 3 + 1], positions[f1i0 * 3 + 2]];
  const f1v1: Vec3 = [positions[f1i1 * 3], positions[f1i1 * 3 + 1], positions[f1i1 * 3 + 2]];
  const f1v2: Vec3 = [positions[f1i2 * 3], positions[f1i2 * 3 + 1], positions[f1i2 * 3 + 2]];

  const f2v0: Vec3 = [positions[f2i0 * 3], positions[f2i0 * 3 + 1], positions[f2i0 * 3 + 2]];
  const f2v1: Vec3 = [positions[f2i1 * 3], positions[f2i1 * 3 + 1], positions[f2i1 * 3 + 2]];
  const f2v2: Vec3 = [positions[f2i2 * 3], positions[f2i2 * 3 + 1], positions[f2i2 * 3 + 2]];

  const n1 = calculateFaceNormal(f1v0, f1v1, f1v2);
  const n2 = calculateFaceNormal(f2v0, f2v1, f2v2);

  const dot1 = vec3Dot(n1, viewDir);
  const dot2 = vec3Dot(n2, viewDir);

  // Check if this is a sharp edge (angle between faces > threshold)
  const faceDot = vec3Dot(n1, n2);
  const isSharpEdge = faceDot < 0.9; // ~25 degrees

  // Silhouette edge: one face toward viewer, one away
  if ((dot1 > 0 && dot2 <= 0) || (dot1 <= 0 && dot2 > 0)) {
    return "silhouette";
  }

  // Both faces visible - show if sharp edge
  if (dot1 > 0 && dot2 > 0) {
    return isSharpEdge ? "visible" : "internal";
  }

  // Both faces hidden - show if sharp edge
  if (dot1 <= 0 && dot2 <= 0) {
    return isSharpEdge ? "hidden" : "internal";
  }

  return "internal";
}

/**
 * Generate a 2D projected view from 3D mesh
 */
export function generateProjectedView(
  meshData: MeshData,
  viewType: "front" | "top" | "right" | "left" | "back" | "bottom"
): ProjectedView {
  const viewDir = VIEW_DIRECTIONS[viewType];
  const upDir = VIEW_UP[viewType];

  // Extract and classify edges
  const edges3D = extractEdges(meshData);
  const edges2D: Edge2D[] = [];

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const edge of edges3D) {
    const classification = classifyEdge(edge, meshData, viewDir);

    if (classification === "internal") continue;

    // Project edge to 2D
    const start = projectPoint(edge.v1, viewDir, upDir);
    const end = projectPoint(edge.v2, viewDir, upDir);

    // Skip zero-length edges
    if (vec2Distance(start, end) < 0.001) continue;

    edges2D.push({
      start,
      end,
      type: classification === "hidden" ? "hidden" : "visible",
    });

    // Update bounds
    minX = Math.min(minX, start[0], end[0]);
    minY = Math.min(minY, start[1], end[1]);
    maxX = Math.max(maxX, start[0], end[0]);
    maxY = Math.max(maxY, start[1], end[1]);
  }

  // Detect circles (holes) - simplified: look for closed loops of edges
  const circles = detectCircles(edges2D);

  // Calculate appropriate scale
  const width = maxX - minX;
  const height = maxY - minY;
  const maxDim = Math.max(width, height);
  const scale = maxDim > 0 ? 100 / maxDim : 1; // Normalize to ~100mm

  return {
    type: viewType,
    edges: edges2D,
    circles,
    bounds: { minX, minY, maxX, maxY },
    scale,
  };
}

/**
 * Detect circular features from edges (simplified)
 */
function detectCircles(_edges: Edge2D[]): Circle2D[] {
  // This is a simplified implementation
  // A proper implementation would use arc fitting algorithms
  const circles: Circle2D[] = [];

  // Group edges that might form circles
  // Look for edges that form closed loops with consistent curvature
  // For now, return empty - will be enhanced later with:
  // - Arc fitting from edge segments
  // - Hole detection from mesh topology
  // - Cylinder detection in 3D then projection

  return circles;
}

/**
 * Generate all standard orthographic views
 */
export function generateAllViews(meshData: MeshData): ProjectedView[] {
  return [
    generateProjectedView(meshData, "front"),
    generateProjectedView(meshData, "top"),
    generateProjectedView(meshData, "right"),
  ];
}
