import { fetch } from "@tauri-apps/plugin-http";
import type {
  StepAnalysisResult,
  Dimension,
  DimensioningResponse,
  ViewType,
} from "../../types";

// Ohmframe Portal API URL
const PORTAL_API_URL = "https://ai.ohmframe.com/api";

export async function generateDimensions(
  apiKey: string,
  stepData: StepAnalysisResult,
  views: ViewType[] = ["front", "top", "right"],
  standard: "ASME" | "ISO" = "ASME",
  unit: "mm" | "in" = "mm"
): Promise<DimensioningResponse> {
  if (!apiKey) {
    return {
      success: false,
      error: "API key is required. Get one from ai.ohmframe.com",
      dimensions: [],
      notes: [],
      title_block_suggestions: {},
    };
  }

  if (!apiKey.startsWith("ohm_")) {
    return {
      success: false,
      error: "Invalid API key format. Keys should start with 'ohm_'",
      dimensions: [],
      notes: [],
      title_block_suggestions: {},
    };
  }

  if (!stepData.success || !stepData.bounding_box) {
    return {
      success: false,
      error: "Invalid STEP data - no geometry found",
      dimensions: [],
      notes: [],
      title_block_suggestions: {},
    };
  }

  try {
    const response = await fetch(`${PORTAL_API_URL}/drawing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        stepData,
        views,
        standard,
        unit,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { error?: string }).error || `API error (${response.status})`;
      
      if (response.status === 401) {
        return {
          success: false,
          error: "Invalid or expired API key. Please check your key at ai.ohmframe.com",
          dimensions: [],
          notes: [],
          title_block_suggestions: {},
        };
      }
      
      return {
        success: false,
        error: errorMessage,
        dimensions: [],
        notes: [],
        title_block_suggestions: {},
      };
    }

    const data = await response.json() as DimensioningResponse;

    if (!data.success) {
      return {
        success: false,
        error: data.error || "Failed to generate dimensions",
        dimensions: [],
        notes: [],
        title_block_suggestions: {},
      };
    }

    return {
      success: true,
      dimensions: data.dimensions || [],
      notes: data.notes || [],
      title_block_suggestions: data.title_block_suggestions || {},
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error - please check your connection",
      dimensions: [],
      notes: [],
      title_block_suggestions: {},
    };
  }
}

// Generate automatic dimension layout suggestions
export function suggestDimensionLayout(
  dimensions: Dimension[],
  _viewWidth: number,
  _viewHeight: number
): Dimension[] {
  // Sort dimensions by type and criticality
  const sorted = [...dimensions].sort((a, b) => {
    if (a.is_critical !== b.is_critical) {
      return a.is_critical ? -1 : 1;
    }
    return a.type.localeCompare(b.type);
  });

  // Offset dimensions to avoid overlap
  const OFFSET = 15; // mm
  const currentOffset = OFFSET;

  return sorted.map((dim, index) => {
    const offset = currentOffset + index * OFFSET;

    // Adjust position based on dimension type
    if (dim.type === "linear") {
      return {
        ...dim,
        position: {
          ...dim.position,
          text_x: (dim.position.start_x + dim.position.end_x) / 2,
          text_y: dim.position.start_y - offset,
        },
      };
    }

    return dim;
  });
}
