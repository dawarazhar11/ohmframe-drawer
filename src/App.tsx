import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Center } from "@react-three/drei";
import * as THREE from "three";

import { generateDimensions } from "./lib/ai/claude";
import { loadStepToMesh } from "./lib/step/stepLoader";
import {
  renderDrawingSheet,
  renderDrawingSheetWithViews,
  generateOrthographicViews,
} from "./lib/drawing/svgRenderer";
import { generateAllViews, type ProjectedView } from "./lib/drawing/projection";
import { selectDatums, type DatumFeature } from "./lib/drawing/datums";
import { generateAllDimensions } from "./lib/drawing/dimensions";
import {
  optimizeDimensionLayout,
  deduplicateDimensions,
  filterEssentialDimensions,
} from "./lib/drawing/dimensionLayout";
import {
  reviewDrawing,
  applyCorrections,
  quickQualityCheck,
  type DrawingReviewResult,
} from "./lib/ai/drawingReview";
import type {
  StepAnalysisResult,
  DrawingSheet,
  TitleBlock,
  SheetSize,
  MeshData,
  Dimension,
  BoundingBox,
} from "./types";

import "./App.css";

// 3D Mesh Viewer Component
function MeshViewer({ meshData }: { meshData: MeshData | null }) {
  const geometry = useMemo(() => {
    if (!meshData) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(meshData.positions, 3)
    );
    geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    if (meshData.normals) {
      geo.setAttribute(
        "normal",
        new THREE.BufferAttribute(meshData.normals, 3)
      );
    } else {
      geo.computeVertexNormals();
    }
    return geo;
  }, [meshData]);

  if (!geometry) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#444" wireframe />
      </mesh>
    );
  }

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#4a9eff" side={THREE.DoubleSide} />
    </mesh>
  );
}

// Generate basic dimensions from bounding box (fallback when API unavailable)
function generateBasicDimensions(bbox: BoundingBox, unit: "mm" | "in"): Dimension[] {
  const dims: Dimension[] = [];
  
  // Front view - width and height
  dims.push({
    id: "basic_width",
    type: "linear",
    value: bbox.width,
    unit,
    view: "front",
    position: { start_x: 0, start_y: -15, end_x: bbox.width, end_y: -15 },
    label: `${bbox.width.toFixed(2)}`,
    is_critical: true,
  });
  
  dims.push({
    id: "basic_height",
    type: "linear",
    value: bbox.height,
    unit,
    view: "front",
    position: { start_x: bbox.width + 15, start_y: 0, end_x: bbox.width + 15, end_y: bbox.height },
    label: `${bbox.height.toFixed(2)}`,
    is_critical: true,
  });
  
  // Top view - width and depth
  dims.push({
    id: "basic_depth",
    type: "linear",
    value: bbox.depth,
    unit,
    view: "top",
    position: { start_x: bbox.width + 15, start_y: 0, end_x: bbox.width + 15, end_y: bbox.depth },
    label: `${bbox.depth.toFixed(2)}`,
    is_critical: true,
  });
  
  return dims;
}

function App() {
  // State
  const [stepData, setStepData] = useState<StepAnalysisResult | null>(null);
  const [meshData, setMeshData] = useState<MeshData | null>(null);
  const [drawing, setDrawing] = useState<DrawingSheet | null>(null);
  const [projectedViews, setProjectedViews] = useState<ProjectedView[]>([]);
  const [datums, setDatums] = useState<DatumFeature[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  
  // Review state
  const [reviewResult, setReviewResult] = useState<DrawingReviewResult | null>(null);
  const [reviewIteration, setReviewIteration] = useState(0);
  const [useAdvancedRendering, setUseAdvancedRendering] = useState(true);

  // Settings - use same key as ohmframe-copilot for shared auth
  const STORAGE_KEY = "ohmframe_api_key";
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [showSettings, setShowSettings] = useState(false);
  const [sheetSize, setSheetSize] = useState<SheetSize>("A3");
  const [unit, setUnit] = useState<"mm" | "in">("mm");
  const [enableReview, setEnableReview] = useState(true);

  // Refs
  const svgContainerRef = useRef<HTMLDivElement>(null);

  // Save API key
  useEffect(() => {
    if (apiKey) {
      localStorage.setItem(STORAGE_KEY, apiKey);
    }
  }, [apiKey]);

  // Load STEP file
  const handleLoadStep = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const selected = await open({
        multiple: false,
        filters: [
          { name: "STEP Files", extensions: ["step", "stp", "STEP", "STP"] },
        ],
      });

      if (!selected) {
        setIsLoading(false);
        return;
      }

      const filePath = typeof selected === "string" ? selected : selected;
      const fileContent = await readFile(filePath);
      const content = new TextDecoder().decode(fileContent);
      const name = filePath.split("/").pop() || filePath.split("\\").pop() || "model.step";

      setFilename(name);

      // Analyze STEP file via Rust backend
      const result = await invoke<StepAnalysisResult>("analyze_step_content", {
        content,
        filename: name,
      });

      if (!result.success) {
        setError(result.error || "Failed to analyze STEP file");
        setIsLoading(false);
        return;
      }

      setStepData(result);

      // Load actual mesh using occt-import-js WASM
      try {
        console.log("[App] Loading mesh from STEP content...");
        const occtMesh = await loadStepToMesh(content);
        
        if (occtMesh) {
          console.log("[App] Mesh loaded successfully:", {
            vertices: occtMesh.vertices.length / 3,
            indices: occtMesh.indices.length,
          });
          setMeshData({
            positions: new Float32Array(occtMesh.vertices),
            indices: new Uint32Array(occtMesh.indices),
            normals: new Float32Array(occtMesh.normals),
          });
        } else {
          console.warn("[App] OCCT mesh loading failed, using bounding box fallback");
          // Fallback to bounding box if OCCT fails
          if (result.bounding_box) {
            const bbox = result.bounding_box;
            const positions = new Float32Array([
              bbox.min_x, bbox.min_y, bbox.max_z,
              bbox.max_x, bbox.min_y, bbox.max_z,
              bbox.max_x, bbox.max_y, bbox.max_z,
              bbox.min_x, bbox.max_y, bbox.max_z,
              bbox.min_x, bbox.min_y, bbox.min_z,
              bbox.min_x, bbox.max_y, bbox.min_z,
              bbox.max_x, bbox.max_y, bbox.min_z,
              bbox.max_x, bbox.min_y, bbox.min_z,
            ]);
            const indices = new Uint32Array([
              0, 1, 2, 0, 2, 3,
              4, 5, 6, 4, 6, 7,
              0, 3, 5, 0, 5, 4,
              1, 7, 6, 1, 6, 2,
              3, 2, 6, 3, 6, 5,
              0, 4, 7, 0, 7, 1,
            ]);
            setMeshData({ positions, indices });
          }
        }
      } catch (meshError) {
        console.error("[App] Mesh loading error:", meshError);
        // Continue without mesh - analysis data is still valid
      }

      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load STEP file");
      setIsLoading(false);
    }
  }, []);

  // Generate drawing with AI dimensions
  const handleGenerateDrawing = useCallback(async () => {
    if (!stepData || !stepData.bounding_box) {
      setError("Please load a STEP file first");
      return;
    }

    if (!apiKey) {
      setShowSettings(true);
      setError("Please enter your Ohmframe API key");
      return;
    }

    try {
      setError(null);
      setIsGenerating(true);
      setReviewResult(null);
      setReviewIteration(0);

      let generatedDimensions: Dimension[] = [];
      let notes: string[] = [];
      let titleBlockSuggestions: Partial<TitleBlock> = {};
      let views = generateOrthographicViews(stepData.bounding_box, 1);
      let localProjectedViews: ProjectedView[] = [];
      let localDatums: DatumFeature[] = [];

      // Use advanced rendering if mesh data is available
      if (useAdvancedRendering && meshData) {
        console.log("[App] Using advanced projection system...");
        
        // Generate projected views from actual mesh
        localProjectedViews = generateAllViews(meshData);
        setProjectedViews(localProjectedViews);
        console.log("[App] Generated projected views:", localProjectedViews.map(v => v.type));
        
        // Select datums from mesh geometry
        localDatums = selectDatums(meshData);
        setDatums(localDatums);
        console.log("[App] Selected datums:", localDatums.map(d => d.id));
        
        // Generate automatic dimensions based on geometry
        const allDimensions = generateAllDimensions(
          localProjectedViews,
          stepData.bounding_box,
          localDatums,
          meshData,
          { unit }
        );
        
        // Flatten dimensions from all views
        for (const [, dims] of allDimensions) {
          generatedDimensions.push(...dims);
        }
        
        console.log("[App] Generated", generatedDimensions.length, "automatic dimensions");
        
        // Still call AI for additional insights and notes (with error handling for 502)
        try {
          const response = await generateDimensions(
            apiKey,
            stepData,
            ["front", "top", "right"],
            "ASME",
            unit
          );
          
          if (response.success) {
            // Merge AI dimensions with auto-generated (AI might add feature-specific ones)
            const aiDims = response.dimensions.filter(aiDim => 
              !generatedDimensions.some(autoDim => 
                Math.abs(autoDim.value - aiDim.value) < 0.1 && autoDim.view === aiDim.view
              )
            );
            generatedDimensions.push(...aiDims);
            notes = response.notes;
            titleBlockSuggestions = response.title_block_suggestions;
          } else if (response.error?.includes("502") || response.error?.includes("503")) {
            console.warn("[App] API temporarily unavailable, using auto-generated dimensions");
          }
        } catch (aiError) {
          console.warn("[App] AI dimension generation failed, using auto-generated only:", aiError);
        }
        
        // Set default notes if not from AI
        if (notes.length === 0) {
          notes = [
            "ALL DIMENSIONS IN " + (unit === "mm" ? "MILLIMETERS" : "INCHES"),
            "TOLERANCES PER ASME Y14.5",
            "BREAK SHARP EDGES 0.5 MAX",
          ];
        }

        // IMPORTANT: Clean up and optimize dimension layout
        console.log("[App] Optimizing dimension layout...");
        
        // Step 1: Remove duplicates
        generatedDimensions = deduplicateDimensions(generatedDimensions);
        console.log("[App] After dedup:", generatedDimensions.length, "dimensions");
        
        // Step 2: Filter to essential dimensions only (max 6 per view)
        generatedDimensions = filterEssentialDimensions(generatedDimensions, 6);
        console.log("[App] After filter:", generatedDimensions.length, "dimensions");
        
        // Step 3: Optimize layout using simulated annealing
        if (localProjectedViews.length > 0) {
          generatedDimensions = optimizeDimensionLayout(generatedDimensions, localProjectedViews);
          console.log("[App] Layout optimized");
        }
      } else {
        // Fallback to AI-only dimensioning
        console.log("[App] Using AI-only dimension generation...");
        
        try {
          const response = await generateDimensions(
            apiKey,
            stepData,
            ["front", "top", "right"],
            "ASME",
            unit
          );

          if (!response.success) {
            // Handle 502/503 errors gracefully - use basic dimensions
            if (response.error?.includes("502") || response.error?.includes("503")) {
              console.warn("[App] API temporarily unavailable, generating basic dimensions");
              generatedDimensions = generateBasicDimensions(stepData.bounding_box, unit);
              notes = [
                "ALL DIMENSIONS IN " + (unit === "mm" ? "MILLIMETERS" : "INCHES"),
                "BASIC DIMENSIONS ONLY - API UNAVAILABLE",
              ];
            } else {
              setError(response.error || "Failed to generate dimensions");
              setIsGenerating(false);
              return;
            }
          } else {
            generatedDimensions = response.dimensions;
            notes = response.notes;
            titleBlockSuggestions = response.title_block_suggestions;
          }
        } catch (apiError) {
          console.warn("[App] API error, generating basic dimensions:", apiError);
          generatedDimensions = generateBasicDimensions(stepData.bounding_box, unit);
          notes = [
            "ALL DIMENSIONS IN " + (unit === "mm" ? "MILLIMETERS" : "INCHES"),
            "BASIC DIMENSIONS ONLY - API ERROR",
          ];
        }
        
        // Clean up AI dimensions too
        generatedDimensions = deduplicateDimensions(generatedDimensions);
        generatedDimensions = filterEssentialDimensions(generatedDimensions, 6);
      }

      // Create drawing sheet
      const titleBlock: TitleBlock = {
        part_name: filename?.replace(/\.(step|stp)$/i, "") || "PART",
        part_number: `PN-${Date.now().toString(36).toUpperCase()}`,
        material: titleBlockSuggestions.material || "SEE SPEC",
        scale: titleBlockSuggestions.scale || "1:1",
        drawn_by: "AI GENERATED",
        date: new Date().toISOString().split("T")[0],
      };

      const sheet: DrawingSheet = {
        id: `sheet-${Date.now()}`,
        name: "Sheet 1",
        size: sheetSize,
        views,
        dimensions: generatedDimensions,
        notes,
        title_block: titleBlock,
      };

      setDrawing(sheet);
      
      // Run quick local quality check
      const quickIssues = quickQualityCheck(generatedDimensions);
      if (quickIssues.length > 0) {
        console.log("[App] Quick check found issues:", quickIssues);
      }

      // Run Vision API review if enabled
      if (enableReview && apiKey) {
        setIsReviewing(true);
        await runVisionReview(sheet, localProjectedViews, localDatums);
        setIsReviewing(false);
      }

      setIsGenerating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate drawing");
      setIsGenerating(false);
      setIsReviewing(false);
    }
  }, [stepData, meshData, apiKey, filename, sheetSize, unit, useAdvancedRendering, enableReview]);

  // Run Vision API review and apply corrections
  const runVisionReview = useCallback(async (
    sheet: DrawingSheet,
    views: ProjectedView[],
    datumFeatures: DatumFeature[]
  ) => {
    if (!apiKey || !sheet) return;

    try {
      console.log("[App] Running Vision API review...");
      setReviewIteration(prev => prev + 1);

      // Generate SVG for review
      const svgContent = views.length > 0
        ? renderDrawingSheetWithViews(sheet, views, datumFeatures)
        : renderDrawingSheet(sheet);

      // Call Vision API to review
      const review = await reviewDrawing(
        apiKey,
        svgContent,
        sheet,
        stepData?.bounding_box ? {
          boundingBox: {
            width: stepData.bounding_box.width,
            height: stepData.bounding_box.height,
            depth: stepData.bounding_box.depth,
          },
        } : undefined
      );

      setReviewResult(review);
      console.log("[App] Review result:", {
        acceptable: review.isAcceptable,
        score: review.overallScore,
        issues: review.issues.length,
        corrections: review.corrections.length,
      });

      // Apply corrections if needed and score is below threshold
      if (!review.isAcceptable && review.corrections.length > 0 && reviewIteration < 3) {
        console.log("[App] Applying", review.corrections.length, "corrections...");
        const correctedDimensions = applyCorrections(sheet.dimensions, review.corrections);
        
        const updatedSheet: DrawingSheet = {
          ...sheet,
          dimensions: correctedDimensions,
        };
        
        setDrawing(updatedSheet);

        // Optionally run another review iteration
        if (review.overallScore < 60) {
          await runVisionReview(updatedSheet, views, datumFeatures);
        }
      }
    } catch (err) {
      console.error("[App] Vision review error:", err);
      // Don't fail the whole process if review fails
    }
  }, [apiKey, stepData, reviewIteration]);

  // Export SVG
  const handleExportSvg = useCallback(() => {
    if (!drawing) return;

    // Use advanced rendering if we have projected views
    const svg = projectedViews.length > 0
      ? renderDrawingSheetWithViews(drawing, projectedViews, datums)
      : renderDrawingSheet(drawing);
      
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${drawing.title_block.part_name}_drawing.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [drawing, projectedViews, datums]);

  // Get rendered SVG for display
  const renderedSvg = useMemo(() => {
    if (!drawing) return "";
    return projectedViews.length > 0
      ? renderDrawingSheetWithViews(drawing, projectedViews, datums)
      : renderDrawingSheet(drawing);
  }, [drawing, projectedViews, datums]);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">Ohmframe Drawer</h1>
          <span className="subtitle">AI-Powered 2D Drawing Generator</span>
        </div>
        <div className="header-right">
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Left Panel - 3D Preview */}
        <section className="panel panel-3d">
          <div className="panel-header">
            <h2>3D Model Preview</h2>
            <button
              className="btn btn-primary"
              onClick={handleLoadStep}
              disabled={isLoading}
            >
              {isLoading ? "Loading..." : "Load STEP File"}
            </button>
          </div>

          <div className="canvas-container">
            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 10, 5]} intensity={1} />
              <Center>
                <MeshViewer meshData={meshData} />
              </Center>
              <OrbitControls />
              <gridHelper args={[20, 20, "#444", "#222"]} />
            </Canvas>
          </div>

          {/* STEP Info */}
          {stepData && stepData.success && (
            <div className="step-info">
              <h3>{filename}</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="label">Dimensions</span>
                  <span className="value">
                    {stepData.bounding_box?.width.toFixed(1)} x{" "}
                    {stepData.bounding_box?.height.toFixed(1)} x{" "}
                    {stepData.bounding_box?.depth.toFixed(1)} {unit}
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">Parts</span>
                  <span className="value">{stepData.parts_count}</span>
                </div>
                <div className="info-item">
                  <span className="label">Holes</span>
                  <span className="value">
                    {stepData.features?.hole_count || 0}
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">Surfaces</span>
                  <span className="value">
                    {stepData.features?.surface_count || 0}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Panel - 2D Drawing */}
        <section className="panel panel-2d">
          <div className="panel-header">
            <h2>2D Drawing Output</h2>
            <div className="panel-actions">
              <select
                value={sheetSize}
                onChange={(e) => setSheetSize(e.target.value as SheetSize)}
                className="select"
              >
                <option value="A4">A4</option>
                <option value="A3">A3</option>
                <option value="A2">A2</option>
                <option value="ANSI_B">ANSI B</option>
                <option value="ANSI_C">ANSI C</option>
              </select>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as "mm" | "in")}
                className="select"
              >
                <option value="mm">Metric (mm)</option>
                <option value="in">Imperial (in)</option>
              </select>
              <button
                className="btn btn-primary"
                onClick={handleGenerateDrawing}
                disabled={!stepData || isGenerating}
              >
                {isGenerating ? "Generating..." : "Generate Drawing"}
              </button>
              {drawing && (
                <button className="btn btn-secondary" onClick={handleExportSvg}>
                  Export SVG
                </button>
              )}
            </div>
          </div>

          <div className="drawing-container" ref={svgContainerRef}>
            {drawing ? (
              <div
                className="drawing-preview"
                dangerouslySetInnerHTML={{ __html: renderedSvg }}
              />
            ) : (
              <div className="drawing-placeholder">
                <p>Load a STEP file and click "Generate Drawing" to create a 2D drawing</p>
                <ul>
                  <li>Automatic orthographic views (Front, Top, Right)</li>
                  <li>AI-powered ASME Y14.5 dimensioning</li>
                  <li>Vision API quality review and auto-correction</li>
                  <li>Standard title block and notes</li>
                  <li>Export to SVG for further editing</li>
                </ul>
              </div>
            )}
          </div>

          {/* Review Status */}
          {isReviewing && (
            <div className="review-status">
              <span className="spinner"></span>
              <span>Reviewing drawing quality (iteration {reviewIteration})...</span>
            </div>
          )}

          {reviewResult && (
            <div className={`review-result ${reviewResult.isAcceptable ? "acceptable" : "needs-work"}`}>
              <div className="review-header">
                <span className="review-score">Quality Score: {reviewResult.overallScore}/100</span>
                <span className={`review-badge ${reviewResult.isAcceptable ? "pass" : "fail"}`}>
                  {reviewResult.isAcceptable ? "PASSED" : "NEEDS REVIEW"}
                </span>
              </div>
              {reviewResult.issues.length > 0 && (
                <div className="review-issues">
                  <h4>Issues Found ({reviewResult.issues.length})</h4>
                  <ul>
                    {reviewResult.issues.slice(0, 5).map((issue, i) => (
                      <li key={i} className={`issue-${issue.severity}`}>
                        <span className="issue-severity">{issue.severity.toUpperCase()}</span>
                        <span className="issue-desc">{issue.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {reviewResult.suggestions.length > 0 && (
                <div className="review-suggestions">
                  <h4>Suggestions</h4>
                  <ul>
                    {reviewResult.suggestions.slice(0, 3).map((sug, i) => (
                      <li key={i}>{sug}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Dimensions List */}
          {drawing && drawing.dimensions.length > 0 && (
            <div className="dimensions-list">
              <h3>Generated Dimensions ({drawing.dimensions.length})</h3>
              <div className="dim-grid">
                {drawing.dimensions.slice(0, 10).map((dim, index) => (
                  <div key={dim.id || index} className={`dim-item ${dim.is_critical ? "critical" : ""}`}>
                    <span className="dim-type">{dim.type.toUpperCase()}</span>
                    <span className="dim-value">{dim.label}</span>
                    <span className="dim-view">{dim.view}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Error Toast */}
      {error && (
        <div className="toast toast-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Settings</h2>
            <div className="form-group">
              <label>Ohmframe API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ohm_xxxxxxxx..."
              />
              <p className="help-text">
                Get your API key from{" "}
                <a href="https://ai.ohmframe.com/dashboard" target="_blank" rel="noreferrer">
                  ai.ohmframe.com
                </a>
                {" "}(Enterprise tier required)
              </p>
            </div>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useAdvancedRendering}
                  onChange={(e) => setUseAdvancedRendering(e.target.checked)}
                />
                Use Advanced Edge Projection
              </label>
              <p className="help-text">
                Projects actual 3D geometry to 2D views with hidden lines. 
                Disable for simpler bounding box rendering.
              </p>
            </div>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enableReview}
                  onChange={(e) => setEnableReview(e.target.checked)}
                />
                Enable Vision API Review
              </label>
              <p className="help-text">
                Uses Claude Vision to review generated drawings and suggest corrections.
                May increase generation time.
              </p>
            </div>
            
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowSettings(false)}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
