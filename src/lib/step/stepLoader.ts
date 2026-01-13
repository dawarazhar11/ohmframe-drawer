// STEP file loader using occt-import-js
import occtimportjs from "occt-import-js";
import { resolveResource } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";

let occtInstance: any = null;
let initPromise: Promise<any> | null = null;

// Check if we're running in Tauri production mode
const isTauriProduction = window.__TAURI__ && !window.location.href.includes('localhost');

// Load WASM file as ArrayBuffer
async function loadWasmFile(): Promise<ArrayBuffer> {
  try {
    if (isTauriProduction) {
      // In Tauri production, load from resources directory
      console.log("[stepLoader] Loading WASM from Tauri resources...");
      const resourcePath = await resolveResource("occt-import-js.wasm");
      console.log("[stepLoader] Resource path:", resourcePath);
      const wasmBytes = await readFile(resourcePath);
      return wasmBytes.buffer;
    } else {
      // In dev mode, fetch from local server
      console.log("[stepLoader] Loading WASM from dev server...");
      const response = await fetch("/occt-import-js.wasm");
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`);
      }
      return await response.arrayBuffer();
    }
  } catch (err) {
    console.error("[stepLoader] Failed to load WASM file:", err);
    throw err;
  }
}

// Initialize OCCT (singleton)
async function initOcct(): Promise<any> {
  if (occtInstance) return occtInstance;

  // Prevent multiple simultaneous initializations
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log("[stepLoader] Initializing OCCT...");
      console.log("[stepLoader] isTauriProduction:", isTauriProduction);

      // Pre-load the WASM file
      const wasmBuffer = await loadWasmFile();
      console.log("[stepLoader] WASM loaded, size:", wasmBuffer.byteLength);

      // Initialize with custom WASM instantiation
      occtInstance = await occtimportjs({
        locateFile: (name: string) => {
          // This is called to locate the WASM file
          // In dev mode, return the URL; in prod, we use instantiateWasm
          console.log("[stepLoader] locateFile called for:", name);
          return `/${name}`;
        },
        instantiateWasm: async (imports: WebAssembly.Imports, receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
          try {
            console.log("[stepLoader] Instantiating WASM...");
            const result = await WebAssembly.instantiate(wasmBuffer, imports);
            receiveInstance(result.instance, result.module);
            return result.instance.exports;
          } catch (err) {
            console.error("[stepLoader] WASM instantiation failed:", err);
            throw err;
          }
        }
      });

      console.log("[stepLoader] OCCT initialized successfully");
      return occtInstance;
    } catch (err) {
      console.error("[stepLoader] OCCT initialization failed:", err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

export interface OcctFaceGroup {
  face_id: number;
  face_type: string;  // "planar", "cylindrical", "curved"
  start_index: number;
  triangle_count: number;
  center: [number, number, number];
  color?: [number, number, number];
}

export interface OcctMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  faceCount: number;
  faceGroups: OcctFaceGroup[];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

// Load STEP file content and convert to mesh
export async function loadStepToMesh(stepContent: string): Promise<OcctMeshData | null> {
  try {
    console.log("[stepLoader] Initializing OCCT...");
    const occt = await initOcct();
    console.log("[stepLoader] OCCT initialized successfully");

    // Convert string to Uint8Array
    const encoder = new TextEncoder();
    const fileBuffer = encoder.encode(stepContent);
    console.log("[stepLoader] File buffer size:", fileBuffer.length, "bytes");

    // Read STEP file
    console.log("[stepLoader] Reading STEP file...");
    const result = occt.ReadStepFile(fileBuffer, null);
    console.log("[stepLoader] ReadStepFile result:", {
      success: result.success,
      error: result.error,
      meshCount: result.meshes?.length || 0
    });

    if (!result.success || !result.meshes || result.meshes.length === 0) {
      console.error("[stepLoader] Failed to read STEP file:", result.error);
      return null;
    }

    // Combine all meshes and extract face groups
    const allVertices: number[] = [];
    const allIndices: number[] = [];
    const allNormals: number[] = [];
    const allFaceGroups: OcctFaceGroup[] = [];
    let vertexOffset = 0;
    let indexOffset = 0;
    let faceIdCounter = 0;

    // Track bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const mesh of result.meshes) {
      // Get mesh data
      const meshVertices = mesh.attributes.position.array;
      const meshNormals = mesh.attributes.normal?.array || [];
      const meshIndices = mesh.index?.array || [];
      const brepFaces = mesh.brep_faces || [];

      console.log("[stepLoader] Processing mesh with", brepFaces.length, "B-rep faces");

      // Calculate mesh bounding box first (needed for face classification)
      let meshMinX = Infinity, meshMinY = Infinity, meshMinZ = Infinity;
      let meshMaxX = -Infinity, meshMaxY = -Infinity, meshMaxZ = -Infinity;
      for (let i = 0; i < meshVertices.length; i += 3) {
        meshMinX = Math.min(meshMinX, meshVertices[i]);
        meshMinY = Math.min(meshMinY, meshVertices[i + 1]);
        meshMinZ = Math.min(meshMinZ, meshVertices[i + 2]);
        meshMaxX = Math.max(meshMaxX, meshVertices[i]);
        meshMaxY = Math.max(meshMaxY, meshVertices[i + 1]);
        meshMaxZ = Math.max(meshMaxZ, meshVertices[i + 2]);
      }
      const meshBoundingSize = Math.max(
        meshMaxX - meshMinX,
        meshMaxY - meshMinY,
        meshMaxZ - meshMinZ
      ) || 100;

      // Add vertices and update global bounding box
      for (let i = 0; i < meshVertices.length; i += 3) {
        const x = meshVertices[i];
        const y = meshVertices[i + 1];
        const z = meshVertices[i + 2];

        allVertices.push(x, y, z);

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
      }

      // Add normals (or generate default)
      if (meshNormals.length > 0) {
        allNormals.push(...meshNormals);
      } else {
        for (let i = 0; i < meshVertices.length; i += 3) {
          allNormals.push(0, 0, 1);
        }
      }

      // Add indices with offset
      for (const idx of meshIndices) {
        allIndices.push(idx + vertexOffset);
      }

      // Extract face groups from brep_faces
      for (const brepFace of brepFaces) {
        const firstTriIdx = brepFace.first;
        const lastTriIdx = brepFace.last;
        const triangleCount = lastTriIdx - firstTriIdx + 1;

        // Calculate face center by averaging triangle centroids
        let centerX = 0, centerY = 0, centerZ = 0;
        let triCount = 0;

        for (let t = firstTriIdx; t <= lastTriIdx && t * 3 + 2 < meshIndices.length; t++) {
          const i0 = meshIndices[t * 3] * 3;
          const i1 = meshIndices[t * 3 + 1] * 3;
          const i2 = meshIndices[t * 3 + 2] * 3;

          if (i0 + 2 < meshVertices.length && i1 + 2 < meshVertices.length && i2 + 2 < meshVertices.length) {
            centerX += (meshVertices[i0] + meshVertices[i1] + meshVertices[i2]) / 3;
            centerY += (meshVertices[i0 + 1] + meshVertices[i1 + 1] + meshVertices[i2 + 1]) / 3;
            centerZ += (meshVertices[i0 + 2] + meshVertices[i1 + 2] + meshVertices[i2 + 2]) / 3;
            triCount++;
          }
        }

        if (triCount > 0) {
          centerX /= triCount;
          centerY /= triCount;
          centerZ /= triCount;
        }

        // Determine face type by analyzing normals and geometry
        const faceType = determineFaceType(meshVertices, meshNormals, meshIndices, firstTriIdx, lastTriIdx, meshBoundingSize);

        allFaceGroups.push({
          face_id: faceIdCounter++,
          face_type: faceType,
          start_index: indexOffset + firstTriIdx * 3,
          triangle_count: triangleCount,
          center: [centerX, centerY, centerZ],
          color: brepFace.color || undefined,
        });
      }

      // If no brep_faces, create a single face group for the entire mesh
      if (brepFaces.length === 0 && meshIndices.length > 0) {
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const centerZ = (minZ + maxZ) / 2;

        allFaceGroups.push({
          face_id: faceIdCounter++,
          face_type: "solid",
          start_index: indexOffset,
          triangle_count: meshIndices.length / 3,
          center: [centerX, centerY, centerZ],
        });
      }

      vertexOffset += meshVertices.length / 3;
      indexOffset += meshIndices.length;
    }

    // Compute proper normals if needed
    if (allNormals.every(n => n === 0 || n === 1)) {
      computeNormals(allVertices, allIndices, allNormals);
    }

    const meshData = {
      vertices: allVertices,
      indices: allIndices,
      normals: allNormals,
      faceCount: result.meshes.length,
      faceGroups: allFaceGroups,
      boundingBox: {
        min: [minX, minY, minZ] as [number, number, number],
        max: [maxX, maxY, maxZ] as [number, number, number]
      }
    };

    console.log("[stepLoader] Mesh generated successfully:", {
      vertexCount: allVertices.length / 3,
      indexCount: allIndices.length,
      triangleCount: allIndices.length / 3,
      normalCount: allNormals.length / 3,
      faceGroupCount: allFaceGroups.length,
      boundingBox: meshData.boundingBox
    });

    return meshData;
  } catch (error) {
    console.error("[stepLoader] Error loading STEP file:", error);
    return null;
  }
}

// Feature type definitions for DFM
export type FeatureType =
  | "planar"      // Flat surface
  | "hole"        // Through or blind hole (full cylinder, normals point inward)
  | "bend"        // Bend radius (partial cylinder ~90°, connects planar faces)
  | "fillet"      // Internal corner radius (small, concave)
  | "round"       // External corner radius (small, convex)
  | "slot"        // Elongated opening (aspect ratio > 2:1)
  | "cutout"      // Non-circular internal removal
  | "cylindrical" // Generic cylindrical (when can't determine specific type)
  | "curved"      // Complex curved surface
  | "unknown";

// Analyze cylindrical face to determine specific feature type
function classifyCylindricalFeature(
  vertices: number[],
  normals: number[],
  indices: number[],
  firstTriIdx: number,
  lastTriIdx: number,
  faceArea: number,
  boundingSize: number
): FeatureType {
  if (normals.length === 0) return "cylindrical";

  // Collect normals and vertices for this face
  const faceNormals: [number, number, number][] = [];
  const faceVertices: [number, number, number][] = [];

  for (let t = firstTriIdx; t <= lastTriIdx && t * 3 + 2 < indices.length; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    for (const idx of [i0, i1, i2]) {
      const vi = idx * 3;
      const ni = idx * 3;
      if (vi + 2 < vertices.length) {
        faceVertices.push([vertices[vi], vertices[vi + 1], vertices[vi + 2]]);
      }
      if (ni + 2 < normals.length) {
        faceNormals.push([normals[ni], normals[ni + 1], normals[ni + 2]]);
      }
    }
  }

  if (faceNormals.length < 6) return "cylindrical";

  // Calculate angular spread of normals (how much of the cylinder is covered)
  // Project normals onto a plane perpendicular to the cylinder axis

  // First, estimate cylinder axis by finding the direction with least normal variation
  // For a cylinder, normals are perpendicular to the axis
  const avgNormal = [0, 0, 0];
  for (const n of faceNormals) {
    avgNormal[0] += n[0];
    avgNormal[1] += n[1];
    avgNormal[2] += n[2];
  }
  avgNormal[0] /= faceNormals.length;
  avgNormal[1] /= faceNormals.length;
  avgNormal[2] /= faceNormals.length;

  // Calculate the angular spread of normals
  let minDot = 1, maxDot = -1;
  for (let i = 0; i < faceNormals.length; i++) {
    for (let j = i + 1; j < faceNormals.length; j++) {
      const dot = faceNormals[i][0] * faceNormals[j][0] +
                  faceNormals[i][1] * faceNormals[j][1] +
                  faceNormals[i][2] * faceNormals[j][2];
      minDot = Math.min(minDot, dot);
      maxDot = Math.max(maxDot, dot);
    }
  }

  // Angular spread in radians (approximate)
  const angularSpread = Math.acos(Math.max(-1, Math.min(1, minDot)));
  const angularSpreadDegrees = angularSpread * 180 / Math.PI;

  // Calculate face dimensions for aspect ratio
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of faceVertices) {
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  }
  const dimX = maxX - minX;
  const dimY = maxY - minY;
  const dimZ = maxZ - minZ;
  const dims = [dimX, dimY, dimZ].sort((a, b) => b - a);
  const aspectRatio = dims[0] / (dims[1] || 0.001);

  // Estimate radius from face area and angular spread
  // For a cylindrical segment: area ≈ 2πr * h * (angle/2π) = r * h * angle
  const height = dims[0]; // Longest dimension is likely height
  const estimatedRadius = faceArea / (height * angularSpread || 1);
  const relativeRadius = estimatedRadius / boundingSize;

  // Classification logic:

  // HOLE: Full or nearly full cylinder (angular spread > 300°)
  // Typically small relative to part size
  if (angularSpreadDegrees > 300) {
    return "hole";
  }

  // SLOT: Elongated hole (high aspect ratio, significant angular spread)
  if (angularSpreadDegrees > 200 && aspectRatio > 2.5) {
    return "slot";
  }

  // BEND: Partial cylinder (60-120°), medium size
  // Bends typically cover about 90° and are larger features
  if (angularSpreadDegrees >= 60 && angularSpreadDegrees <= 150 && relativeRadius > 0.02) {
    return "bend";
  }

  // FILLET/ROUND: Small radius (< 5% of bounding), partial cylinder
  if (relativeRadius < 0.05 && angularSpreadDegrees < 120) {
    // Small radius feature - classify based on size
    // Fillets are typically very small (< 2% of bounding), rounds are slightly larger
    const normalMag = Math.sqrt(avgNormal[0]**2 + avgNormal[1]**2 + avgNormal[2]**2);
    if (normalMag > 0.1) {
      return relativeRadius < 0.02 ? "fillet" : "round";
    }
  }

  // Default: generic cylindrical
  return "cylindrical";
}

// Calculate approximate face area from triangles
function calculateFaceArea(
  vertices: number[],
  indices: number[],
  firstTriIdx: number,
  lastTriIdx: number
): number {
  let area = 0;

  for (let t = firstTriIdx; t <= lastTriIdx && t * 3 + 2 < indices.length; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    if (i0 + 2 >= vertices.length || i1 + 2 >= vertices.length || i2 + 2 >= vertices.length) {
      continue;
    }

    // Triangle vertices
    const v0 = [vertices[i0], vertices[i0 + 1], vertices[i0 + 2]];
    const v1 = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]];
    const v2 = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]];

    // Cross product for area
    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0]
    ];
    const triArea = 0.5 * Math.sqrt(cross[0]**2 + cross[1]**2 + cross[2]**2);
    area += triArea;
  }

  return area;
}

// Determine face type by analyzing normal variation and geometry
function determineFaceType(
  vertices: number[],
  normals: number[],
  indices: number[],
  firstTriIdx: number,
  lastTriIdx: number,
  boundingSize: number = 100
): FeatureType {
  if (normals.length === 0) return "unknown";

  // Collect normals for this face
  const faceNormals: [number, number, number][] = [];

  for (let t = firstTriIdx; t <= lastTriIdx && t * 3 + 2 < indices.length; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    if (i0 + 2 < normals.length) {
      faceNormals.push([normals[i0], normals[i0 + 1], normals[i0 + 2]]);
    }
    if (i1 + 2 < normals.length) {
      faceNormals.push([normals[i1], normals[i1 + 1], normals[i1 + 2]]);
    }
    if (i2 + 2 < normals.length) {
      faceNormals.push([normals[i2], normals[i2 + 1], normals[i2 + 2]]);
    }
  }

  if (faceNormals.length < 3) return "unknown";

  // Calculate normal variance
  let avgNx = 0, avgNy = 0, avgNz = 0;
  for (const n of faceNormals) {
    avgNx += n[0];
    avgNy += n[1];
    avgNz += n[2];
  }
  avgNx /= faceNormals.length;
  avgNy /= faceNormals.length;
  avgNz /= faceNormals.length;

  let variance = 0;
  for (const n of faceNormals) {
    const dx = n[0] - avgNx;
    const dy = n[1] - avgNy;
    const dz = n[2] - avgNz;
    variance += dx * dx + dy * dy + dz * dz;
  }
  variance /= faceNormals.length;

  // Low variance = planar face
  if (variance < 0.01) {
    return "planar";
  }

  // Medium variance = cylindrical - need further classification
  if (variance < 0.5) {
    const faceArea = calculateFaceArea(vertices, indices, firstTriIdx, lastTriIdx);
    return classifyCylindricalFeature(
      vertices, normals, indices,
      firstTriIdx, lastTriIdx,
      faceArea, boundingSize
    );
  }

  // High variance = complex curved surface
  return "curved";
}

// Compute vertex normals from face data
function computeNormals(vertices: number[], indices: number[], normals: number[]) {
  // Reset normals
  for (let i = 0; i < normals.length; i++) {
    normals[i] = 0;
  }

  // Accumulate face normals for each vertex
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    // Get vertices
    const v0x = vertices[i0], v0y = vertices[i0 + 1], v0z = vertices[i0 + 2];
    const v1x = vertices[i1], v1y = vertices[i1 + 1], v1z = vertices[i1 + 2];
    const v2x = vertices[i2], v2y = vertices[i2 + 1], v2z = vertices[i2 + 2];

    // Compute face normal (cross product of edges)
    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Add to vertex normals
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }

  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(
      normals[i] * normals[i] +
      normals[i + 1] * normals[i + 1] +
      normals[i + 2] * normals[i + 2]
    );
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }
}
