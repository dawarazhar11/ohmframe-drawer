/**
 * Datum Selection System (ASME Y14.5)
 * Automatically selects datum features based on geometry analysis
 */

import type { MeshData } from "../../types";
import { Vec3, vec3Dot, vec3Cross, vec3Normalize, vec3Sub } from "./projection";

// Datum feature
export interface DatumFeature {
  id: "A" | "B" | "C";
  type: "planar" | "cylindrical" | "point";
  normal: Vec3;          // Surface normal direction
  center: Vec3;          // Center point of the feature
  area: number;          // Surface area (for ranking)
  vertices: number[];    // Indices of vertices on this feature
}

// Planar face from mesh
export interface PlanarFace {
  normal: Vec3;
  center: Vec3;
  area: number;
  triangles: number[];   // Triangle indices
  vertices: Set<number>; // Unique vertex indices
}

/**
 * Extract planar faces from mesh by grouping triangles with similar normals
 */
export function extractPlanarFaces(meshData: MeshData): PlanarFace[] {
  const positions = meshData.positions;
  const indices = meshData.indices;
  // Note: normals from meshData not used - we calculate face normals directly

  // Calculate face normals and group similar ones
  const faceGroups: Map<string, PlanarFace> = new Map();
  const NORMAL_TOLERANCE = 0.98; // cos(~10 degrees)

  for (let i = 0; i < indices.length; i += 3) {
    const triIndex = Math.floor(i / 3);

    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];

    const v0: Vec3 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const v1: Vec3 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const v2: Vec3 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

    // Calculate face normal
    const e1 = vec3Sub(v1, v0);
    const e2 = vec3Sub(v2, v0);
    const normal = vec3Normalize(vec3Cross(e1, e2));

    // Calculate triangle area
    const cross = vec3Cross(e1, e2);
    const area = 0.5 * Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);

    // Calculate centroid
    const center: Vec3 = [
      (v0[0] + v1[0] + v2[0]) / 3,
      (v0[1] + v1[1] + v2[1]) / 3,
      (v0[2] + v1[2] + v2[2]) / 3,
    ];

    // Find matching face group or create new one
    let matched = false;
    for (const [, face] of faceGroups) {
      const dot = vec3Dot(normal, face.normal);
      if (Math.abs(dot) > NORMAL_TOLERANCE) {
        // Check if coplanar (similar distance from origin)
        const d1 = vec3Dot(center, normal);
        const d2 = vec3Dot(face.center, face.normal);
        if (Math.abs(d1 - d2) < 1.0) { // 1mm tolerance
          // Add to existing group
          face.triangles.push(triIndex);
          face.area += area;
          face.vertices.add(i0);
          face.vertices.add(i1);
          face.vertices.add(i2);
          // Update center (weighted average)
          const totalTris = face.triangles.length;
          face.center = [
            (face.center[0] * (totalTris - 1) + center[0]) / totalTris,
            (face.center[1] * (totalTris - 1) + center[1]) / totalTris,
            (face.center[2] * (totalTris - 1) + center[2]) / totalTris,
          ];
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Create new face group with unique key based on normal and position
      const faceKey = `${normal[0].toFixed(2)},${normal[1].toFixed(2)},${normal[2].toFixed(2)},${center[0].toFixed(0)}_${triIndex}`;
      faceGroups.set(faceKey, {
        normal,
        center,
        area,
        triangles: [triIndex],
        vertices: new Set([i0, i1, i2]),
      });
    }
  }

  return Array.from(faceGroups.values());
}

/**
 * Check if two normals are perpendicular (within tolerance)
 */
function arePerpendicular(n1: Vec3, n2: Vec3, tolerance: number = 0.1): boolean {
  const dot = Math.abs(vec3Dot(n1, n2));
  return dot < tolerance;
}

/**
 * Select datum features according to ASME Y14.5 guidelines
 * 
 * Datum A: Primary datum - largest flat surface (most contact points)
 * Datum B: Secondary datum - perpendicular to A, next largest
 * Datum C: Tertiary datum - perpendicular to both A and B
 */
export function selectDatums(meshData: MeshData): DatumFeature[] {
  const faces = extractPlanarFaces(meshData);

  if (faces.length === 0) {
    console.warn("[datums] No planar faces found");
    return [];
  }

  // Sort faces by area (largest first)
  faces.sort((a, b) => b.area - a.area);

  const datums: DatumFeature[] = [];

  // Datum A: Largest planar face
  const datumA = faces[0];
  datums.push({
    id: "A",
    type: "planar",
    normal: datumA.normal,
    center: datumA.center,
    area: datumA.area,
    vertices: Array.from(datumA.vertices),
  });

  // Datum B: Largest face perpendicular to A
  for (const face of faces.slice(1)) {
    if (arePerpendicular(face.normal, datumA.normal)) {
      datums.push({
        id: "B",
        type: "planar",
        normal: face.normal,
        center: face.center,
        area: face.area,
        vertices: Array.from(face.vertices),
      });
      break;
    }
  }

  // Datum C: Largest face perpendicular to both A and B
  if (datums.length >= 2) {
    const datumB = datums[1];
    for (const face of faces.slice(1)) {
      if (
        arePerpendicular(face.normal, datumA.normal) &&
        arePerpendicular(face.normal, datumB.normal)
      ) {
        datums.push({
          id: "C",
          type: "planar",
          normal: face.normal,
          center: face.center,
          area: face.area,
          vertices: Array.from(face.vertices),
        });
        break;
      }
    }
  }

  console.log("[datums] Selected datums:", datums.map(d => ({
    id: d.id,
    normal: d.normal.map(n => n.toFixed(2)),
    area: d.area.toFixed(1),
  })));

  return datums;
}

/**
 * Calculate distance from a point to a datum plane
 */
export function distanceFromDatum(point: Vec3, datum: DatumFeature): number {
  // Distance from point to plane: d = (P - P0) · n
  const diff = vec3Sub(point, datum.center);
  return Math.abs(vec3Dot(diff, datum.normal));
}

/**
 * Project a point onto a datum plane
 */
export function projectOntoDatum(point: Vec3, datum: DatumFeature): Vec3 {
  const dist = vec3Dot(vec3Sub(point, datum.center), datum.normal);
  return [
    point[0] - dist * datum.normal[0],
    point[1] - dist * datum.normal[1],
    point[2] - dist * datum.normal[2],
  ];
}
