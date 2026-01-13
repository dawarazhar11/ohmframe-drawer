import { fetch } from "@tauri-apps/plugin-http";
import type {
  ClaudeRequest,
  ClaudeResponse,
  ClaudeMessage,
  StepAnalysisResult,
  Dimension,
  DimensioningResponse,
  ViewType,
} from "../../types";

const SUB2API_BASE_URL = "https://api.sub2api.com/v1";

// ASME Y14.5 Dimensioning System Prompt
const DIMENSIONING_SYSTEM_PROMPT = `You are an expert mechanical design engineer specializing in ASME Y14.5 dimensioning standards.

Your task is to analyze 3D model geometry and generate appropriate dimensions for 2D engineering drawings.

ASME Y14.5 Guidelines to follow:
1. Overall dimensions first (length, width, height)
2. Feature dimensions (holes, slots, bosses)
3. Critical dimensions for fit/function
4. Tolerances based on feature criticality
5. Reference dimensions in parentheses

Dimension Types:
- LINEAR: Distance between two points
- DIAMETER: Circle/hole diameter (prefix with Ø)
- RADIUS: Arc/fillet radius (prefix with R)
- ANGULAR: Angle between surfaces

View Assignment:
- FRONT: Primary profile dimensions
- TOP: Plan view, hole patterns
- RIGHT: Depth dimensions, side features
- ISOMETRIC: Reference only

Output JSON format:
{
  "dimensions": [
    {
      "id": "dim_1",
      "type": "linear",
      "value": 50.0,
      "tolerance_plus": 0.1,
      "tolerance_minus": 0.1,
      "unit": "mm",
      "view": "front",
      "position": { "start_x": 0, "start_y": 0, "end_x": 50, "end_y": 0 },
      "label": "50 ±0.1",
      "is_critical": true
    }
  ],
  "notes": [
    "ALL DIMENSIONS IN MILLIMETERS",
    "BREAK SHARP EDGES 0.5 MAX",
    "SURFACE FINISH 3.2 Ra UNLESS OTHERWISE SPECIFIED"
  ],
  "title_block_suggestions": {
    "material": "ALUMINUM 6061-T6",
    "scale": "1:1"
  }
}`;

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
      error: "API key is required",
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

  const bbox = stepData.bounding_box;
  const features = stepData.features;

  // Build the prompt with geometry context
  const userPrompt = `Analyze this 3D model geometry and generate ${standard} standard dimensions for a 2D engineering drawing.

GEOMETRY DATA:
- Bounding Box: ${bbox.width.toFixed(2)} x ${bbox.height.toFixed(2)} x ${bbox.depth.toFixed(2)} ${unit}
- Min Point: (${bbox.min_x.toFixed(2)}, ${bbox.min_y.toFixed(2)}, ${bbox.min_z.toFixed(2)})
- Max Point: (${bbox.max_x.toFixed(2)}, ${bbox.max_y.toFixed(2)}, ${bbox.max_z.toFixed(2)})
- Parts Count: ${stepData.parts_count}

FEATURES DETECTED:
- Holes: ${features?.has_holes ? `Yes (${features.hole_count} detected)` : "No"}
- Fillets: ${features?.has_fillets ? "Yes" : "No"}
- Chamfers: ${features?.has_chamfers ? "Yes" : "No"}
- Surface Count: ${features?.surface_count || "Unknown"}

REQUIREMENTS:
1. Generate dimensions for views: ${views.join(", ")}
2. Use ${unit} as the unit of measurement
3. Apply ${standard} Y14.5 dimensioning standards
4. Include tolerances for critical dimensions
5. Add appropriate drawing notes

Respond with valid JSON only.`;

  try {
    const messages: ClaudeMessage[] = [
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const request: ClaudeRequest = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages,
      system: DIMENSIONING_SYSTEM_PROMPT,
    };

    const response = await fetch(`${SUB2API_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API error (${response.status}): ${errorText}`,
        dimensions: [],
        notes: [],
        title_block_suggestions: {},
      };
    }

    const data = (await response.json()) as ClaudeResponse;

    // Extract text content from Claude response
    const textContent = data.content.find((c) => c.type === "text");
    if (!textContent) {
      return {
        success: false,
        error: "No text content in response",
        dimensions: [],
        notes: [],
        title_block_suggestions: {},
      };
    }

    // Parse the JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: "Could not parse JSON from response",
        dimensions: [],
        notes: [],
        title_block_suggestions: {},
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as DimensioningResponse;

    return {
      success: true,
      dimensions: parsed.dimensions || [],
      notes: parsed.notes || [],
      title_block_suggestions: parsed.title_block_suggestions || {},
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
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
  let currentOffset = OFFSET;

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
