// STEP File Analysis Types
export interface StepAnalysisResult {
  success: boolean;
  error?: string;
  filename?: string;
  bounding_box?: BoundingBox;
  parts_count: number;
  features?: FeatureInfo;
}

export interface BoundingBox {
  min_x: number;
  min_y: number;
  min_z: number;
  max_x: number;
  max_y: number;
  max_z: number;
  width: number;
  height: number;
  depth: number;
}

export interface FeatureInfo {
  has_holes: boolean;
  has_fillets: boolean;
  has_chamfers: boolean;
  hole_count: number;
  surface_count: number;
}

// Drawing Types
export type ViewType = "front" | "top" | "right" | "isometric" | "section";

export interface OrthographicView {
  type: ViewType;
  label: string;
  svgContent: string;
  width: number;
  height: number;
  scale: number;
}

export interface Dimension {
  id: string;
  type: DimensionType;
  value: number;
  tolerance_plus?: number;
  tolerance_minus?: number;
  unit: "mm" | "in";
  view: ViewType;
  position: DimensionPosition;
  label: string;
  is_critical: boolean;
}

export type DimensionType = 
  | "linear" 
  | "diameter" 
  | "radius" 
  | "angular" 
  | "ordinate"
  | "arc_length";

export interface DimensionPosition {
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  text_x?: number;
  text_y?: number;
}

// Title Block
export interface TitleBlock {
  part_name: string;
  part_number: string;
  material: string;
  scale: string;
  drawn_by: string;
  date: string;
  revision?: string;
  sheet?: string;
}

// Drawing Sheet
export interface DrawingSheet {
  id: string;
  name: string;
  size: SheetSize;
  views: OrthographicView[];
  dimensions: Dimension[];
  notes: string[];
  title_block: TitleBlock;
}

export type SheetSize = "A4" | "A3" | "A2" | "A1" | "A0" | "ANSI_A" | "ANSI_B" | "ANSI_C" | "ANSI_D";

export const SHEET_DIMENSIONS: Record<SheetSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
  A0: { width: 841, height: 1189 },
  ANSI_A: { width: 216, height: 279 },
  ANSI_B: { width: 279, height: 432 },
  ANSI_C: { width: 432, height: 559 },
  ANSI_D: { width: 559, height: 864 },
};

// Claude API Types (sub2api format)
export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// AI Dimensioning Request
export interface DimensioningRequest {
  step_data: StepAnalysisResult;
  views: ViewType[];
  standard: "ASME" | "ISO";
  unit: "mm" | "in";
}

export interface DimensioningResponse {
  success: boolean;
  error?: string;
  dimensions: Dimension[];
  notes: string[];
  title_block_suggestions: Partial<TitleBlock>;
}

// App State
export interface AppState {
  stepFile: File | null;
  stepData: StepAnalysisResult | null;
  meshData: MeshData | null;
  drawing: DrawingSheet | null;
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
}

// Mesh data from OCCT
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
}
