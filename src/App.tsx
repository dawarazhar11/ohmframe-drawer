import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Center } from "@react-three/drei";
import * as THREE from "three";

import { generateDimensions } from "./lib/ai/claude";
import {
  renderDrawingSheet,
  generateOrthographicViews,
} from "./lib/drawing/svgRenderer";
import type {
  StepAnalysisResult,
  DrawingSheet,
  TitleBlock,
  SheetSize,
  MeshData,
} from "./types";

import "./App.css";

// Simple 3D Mesh Viewer
function MeshViewer({ meshData }: { meshData: MeshData | null }) {
  if (!meshData) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#666" wireframe />
      </mesh>
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(meshData.positions, 3)
  );
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
  if (meshData.normals) {
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(meshData.normals, 3)
    );
  } else {
    geometry.computeVertexNormals();
  }

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#4a9eff" side={THREE.DoubleSide} />
    </mesh>
  );
}

function App() {
  // State
  const [stepData, setStepData] = useState<StepAnalysisResult | null>(null);
  const [meshData, setMeshData] = useState<MeshData | null>(null);
  const [drawing, setDrawing] = useState<DrawingSheet | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  // Settings - use same key as ohmframe-copilot for shared auth
  const STORAGE_KEY = "ohmframe_api_key";
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [showSettings, setShowSettings] = useState(false);
  const [sheetSize, setSheetSize] = useState<SheetSize>("A3");
  const [unit, setUnit] = useState<"mm" | "in">("mm");

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

      // Create placeholder mesh from bounding box
      if (result.bounding_box) {
        const bbox = result.bounding_box;
        const positions = new Float32Array([
          // Front face
          bbox.min_x, bbox.min_y, bbox.max_z,
          bbox.max_x, bbox.min_y, bbox.max_z,
          bbox.max_x, bbox.max_y, bbox.max_z,
          bbox.min_x, bbox.max_y, bbox.max_z,
          // Back face
          bbox.min_x, bbox.min_y, bbox.min_z,
          bbox.min_x, bbox.max_y, bbox.min_z,
          bbox.max_x, bbox.max_y, bbox.min_z,
          bbox.max_x, bbox.min_y, bbox.min_z,
        ]);
        const indices = new Uint32Array([
          0, 1, 2, 0, 2, 3, // front
          4, 5, 6, 4, 6, 7, // back
          0, 3, 5, 0, 5, 4, // left
          1, 7, 6, 1, 6, 2, // right
          3, 2, 6, 3, 6, 5, // top
          0, 4, 7, 0, 7, 1, // bottom
        ]);
        setMeshData({ positions, indices });
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

      // Generate dimensions via Claude API
      const response = await generateDimensions(
        apiKey,
        stepData,
        ["front", "top", "right"],
        "ASME",
        unit
      );

      if (!response.success) {
        setError(response.error || "Failed to generate dimensions");
        setIsGenerating(false);
        return;
      }

      // Create drawing sheet
      const titleBlock: TitleBlock = {
        part_name: filename?.replace(/\.(step|stp)$/i, "") || "PART",
        part_number: `PN-${Date.now().toString(36).toUpperCase()}`,
        material: response.title_block_suggestions.material || "SEE SPEC",
        scale: response.title_block_suggestions.scale || "1:1",
        drawn_by: "AI GENERATED",
        date: new Date().toISOString().split("T")[0],
      };

      const views = generateOrthographicViews(stepData.bounding_box, 1);

      const sheet: DrawingSheet = {
        id: `sheet-${Date.now()}`,
        name: "Sheet 1",
        size: sheetSize,
        views,
        dimensions: response.dimensions,
        notes: response.notes,
        title_block: titleBlock,
      };

      setDrawing(sheet);
      setIsGenerating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate drawing");
      setIsGenerating(false);
    }
  }, [stepData, apiKey, filename, sheetSize, unit]);

  // Export SVG
  const handleExportSvg = useCallback(() => {
    if (!drawing) return;

    const svg = renderDrawingSheet(drawing);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${drawing.title_block.part_name}_drawing.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [drawing]);

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
                dangerouslySetInnerHTML={{ __html: renderDrawingSheet(drawing) }}
              />
            ) : (
              <div className="drawing-placeholder">
                <p>Load a STEP file and click "Generate Drawing" to create a 2D drawing</p>
                <ul>
                  <li>Automatic orthographic views (Front, Top, Right)</li>
                  <li>AI-powered ASME Y14.5 dimensioning</li>
                  <li>Standard title block and notes</li>
                  <li>Export to SVG for further editing</li>
                </ul>
              </div>
            )}
          </div>

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
