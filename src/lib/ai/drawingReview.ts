/**
 * Drawing Review System using Claude Vision API
 * Analyzes generated SVG drawings and provides feedback for corrections
 */

import { fetch } from "@tauri-apps/plugin-http";
import type { Dimension, DrawingSheet, ViewType } from "../../types";

// Ohmframe Portal API URL
const PORTAL_API_URL = "https://ai.ohmframe.com/api";

// Review result types
export interface DrawingReviewResult {
  success: boolean;
  isAcceptable: boolean;
  overallScore: number; // 0-100
  issues: DrawingIssue[];
  suggestions: string[];
  corrections: DimensionCorrection[];
}

export interface DrawingIssue {
  severity: "critical" | "major" | "minor";
  category: "dimension" | "layout" | "standard" | "clarity" | "missing";
  description: string;
  location?: string; // e.g., "Front View, top-left"
  affectedDimensionId?: string;
}

export interface DimensionCorrection {
  dimensionId: string;
  currentValue: number;
  suggestedValue?: number;
  action: "move" | "delete" | "add" | "modify" | "reposition";
  reason: string;
  newPosition?: {
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
  };
}

// System prompt for drawing review
const REVIEW_SYSTEM_PROMPT = `You are an expert mechanical design engineer and drawing checker specializing in ASME Y14.5 standards.

Your task is to review 2D engineering drawings and identify issues, providing specific corrections.

REVIEW CRITERIA:

1. DIMENSION COMPLETENESS
   - All overall dimensions present (length, width, height per view)
   - Feature dimensions (holes, slots, steps)
   - Critical functional dimensions
   - Reference dimensions where needed

2. DIMENSION PLACEMENT (ASME Y14.5)
   - Dimensions outside the view outline
   - No crossing dimension lines
   - Proper spacing between stacked dimensions (min 6mm)
   - Extension lines with proper gaps
   - Text readable (not overlapping geometry)

3. STANDARD COMPLIANCE
   - Correct dimension line terminators (arrows)
   - Proper tolerance notation
   - Diameter symbol (Ø) for holes/circles
   - Radius symbol (R) for arcs
   - Units consistent

4. VIEW CLARITY
   - Hidden lines dashed correctly
   - Centerlines for cylindrical features
   - Clear view labeling
   - Appropriate scale

5. COMMON ISSUES TO CHECK
   - Overlapping dimensions
   - Dimensions pointing to wrong features
   - Missing critical dimensions
   - Redundant/duplicate dimensions
   - Incorrect tolerance values

OUTPUT FORMAT (JSON):
{
  "isAcceptable": true/false,
  "overallScore": 85,
  "issues": [
    {
      "severity": "major",
      "category": "dimension",
      "description": "Overall width dimension missing in Front View",
      "location": "Front View"
    }
  ],
  "suggestions": [
    "Add overall width dimension below Front View",
    "Move overlapping dimensions apart"
  ],
  "corrections": [
    {
      "dimensionId": "dim_3",
      "action": "reposition",
      "reason": "Overlaps with dim_4",
      "newPosition": { "start_x": 10, "start_y": -25, "end_x": 60, "end_y": -25 }
    }
  ]
}`;

/**
 * Convert SVG to base64 for Vision API
 */
export function svgToBase64(svgContent: string): string {
  // Encode SVG to base64
  const encoded = btoa(unescape(encodeURIComponent(svgContent)));
  return `data:image/svg+xml;base64,${encoded}`;
}

/**
 * Convert SVG to PNG using canvas (for better Vision API compatibility)
 */
export async function svgToPngBase64(svgContent: string, width: number = 1200, height: number = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // White background
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);

      // Draw SVG
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to base64 PNG
      const pngBase64 = canvas.toDataURL("image/png");
      URL.revokeObjectURL(url);
      resolve(pngBase64);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG image"));
    };

    img.src = url;
  });
}

/**
 * Review a generated drawing using Claude Vision API
 */
export async function reviewDrawing(
  apiKey: string,
  svgContent: string,
  drawingSheet: DrawingSheet,
  geometryContext?: {
    boundingBox?: { width: number; height: number; depth: number };
    featureCount?: number;
  }
): Promise<DrawingReviewResult> {
  if (!apiKey || !apiKey.startsWith("ohm_")) {
    return {
      success: false,
      isAcceptable: false,
      overallScore: 0,
      issues: [{
        severity: "critical",
        category: "missing",
        description: "Invalid API key - cannot perform review",
      }],
      suggestions: [],
      corrections: [],
    };
  }

  try {
    // Convert SVG to PNG for better Vision API analysis
    let imageBase64: string;
    try {
      imageBase64 = await svgToPngBase64(svgContent);
    } catch {
      // Fallback to SVG base64 if PNG conversion fails
      imageBase64 = svgToBase64(svgContent);
    }

    // Build context about the drawing
    const dimensionSummary = drawingSheet.dimensions.map(d => ({
      id: d.id,
      type: d.type,
      value: d.value,
      view: d.view,
      isCritical: d.is_critical,
    }));

    const reviewPrompt = `Review this engineering drawing for ASME Y14.5 compliance and quality.

DRAWING CONTEXT:
- Sheet Size: ${drawingSheet.size}
- Views Included: ${drawingSheet.views.map(v => v.type).join(", ")}
- Total Dimensions: ${drawingSheet.dimensions.length}
- Part Name: ${drawingSheet.title_block.part_name}
${geometryContext?.boundingBox ? `- Part Size: ${geometryContext.boundingBox.width.toFixed(1)} x ${geometryContext.boundingBox.height.toFixed(1)} x ${geometryContext.boundingBox.depth.toFixed(1)} mm` : ""}

CURRENT DIMENSIONS:
${JSON.stringify(dimensionSummary, null, 2)}

Please analyze the drawing image and:
1. Check for completeness of dimensions
2. Verify ASME Y14.5 compliance
3. Identify any overlapping or unclear elements
4. Check proper view arrangement
5. Verify dimension placement (outside views, proper spacing)

Respond with JSON only, using the format specified in your instructions.`;

    // Call the Vision API with the image
    const response = await fetch(`${PORTAL_API_URL}/vision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: reviewPrompt,
        mode: "analyze",
        context: REVIEW_SYSTEM_PROMPT,
        image: imageBase64,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      return {
        success: false,
        isAcceptable: false,
        overallScore: 0,
        issues: [{
          severity: "critical",
          category: "missing",
          description: `API error: ${errorData.error || response.status}`,
        }],
        suggestions: [],
        corrections: [],
      };
    }

    const data = await response.json() as { success?: boolean; response?: string; message?: string; error?: string };

    if (!data.success || data.error) {
      return {
        success: false,
        isAcceptable: false,
        overallScore: 0,
        issues: [{
          severity: "critical",
          category: "missing",
          description: data.error || "Unknown API error",
        }],
        suggestions: [],
        corrections: [],
      };
    }

    // Parse the AI response
    const aiResponse = data.response || data.message || "";
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // If no JSON, try to extract feedback as text
      return {
        success: true,
        isAcceptable: true, // Assume acceptable if parsing fails
        overallScore: 70,
        issues: [],
        suggestions: [aiResponse.slice(0, 500)],
        corrections: [],
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<DrawingReviewResult>;
      return {
        success: true,
        isAcceptable: parsed.isAcceptable ?? true,
        overallScore: parsed.overallScore ?? 75,
        issues: parsed.issues || [],
        suggestions: parsed.suggestions || [],
        corrections: parsed.corrections || [],
      };
    } catch {
      return {
        success: true,
        isAcceptable: true,
        overallScore: 70,
        issues: [],
        suggestions: ["Review completed but response parsing failed"],
        corrections: [],
      };
    }
  } catch (error) {
    return {
      success: false,
      isAcceptable: false,
      overallScore: 0,
      issues: [{
        severity: "critical",
        category: "missing",
        description: error instanceof Error ? error.message : "Network error",
      }],
      suggestions: [],
      corrections: [],
    };
  }
}

/**
 * Apply corrections to dimensions based on review feedback
 */
export function applyCorrections(
  dimensions: Dimension[],
  corrections: DimensionCorrection[]
): Dimension[] {
  const result = [...dimensions];

  for (const correction of corrections) {
    const index = result.findIndex(d => d.id === correction.dimensionId);

    switch (correction.action) {
      case "delete":
        if (index !== -1) {
          result.splice(index, 1);
        }
        break;

      case "modify":
        if (index !== -1 && correction.suggestedValue !== undefined) {
          result[index] = {
            ...result[index],
            value: correction.suggestedValue,
          };
        }
        break;

      case "reposition":
      case "move":
        if (index !== -1 && correction.newPosition) {
          result[index] = {
            ...result[index],
            position: {
              ...result[index].position,
              ...correction.newPosition,
            },
          };
        }
        break;

      case "add":
        // New dimension would need full specification
        // This is handled separately in the generation pipeline
        break;
    }
  }

  return result;
}

/**
 * Run the full review and correction loop
 * Returns improved dimensions after up to maxIterations reviews
 */
export async function reviewAndCorrectLoop(
  apiKey: string,
  svgGenerator: (dimensions: Dimension[]) => string,
  initialDimensions: Dimension[],
  drawingSheet: DrawingSheet,
  maxIterations: number = 3,
  acceptableScore: number = 80
): Promise<{
  finalDimensions: Dimension[];
  finalSvg: string;
  reviews: DrawingReviewResult[];
  iterationCount: number;
}> {
  let currentDimensions = [...initialDimensions];
  let currentSvg = svgGenerator(currentDimensions);
  const reviews: DrawingReviewResult[] = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[reviewLoop] Iteration ${iteration}/${maxIterations}`);

    // Generate current SVG
    currentSvg = svgGenerator(currentDimensions);

    // Review the drawing
    const sheetWithCurrentDims: DrawingSheet = {
      ...drawingSheet,
      dimensions: currentDimensions,
    };

    const review = await reviewDrawing(apiKey, currentSvg, sheetWithCurrentDims);
    reviews.push(review);

    console.log(`[reviewLoop] Score: ${review.overallScore}, Issues: ${review.issues.length}`);

    // Check if acceptable
    if (review.isAcceptable && review.overallScore >= acceptableScore) {
      console.log(`[reviewLoop] Drawing accepted with score ${review.overallScore}`);
      break;
    }

    // Apply corrections
    if (review.corrections.length > 0) {
      console.log(`[reviewLoop] Applying ${review.corrections.length} corrections`);
      currentDimensions = applyCorrections(currentDimensions, review.corrections);
    } else if (review.issues.length > 0) {
      // No specific corrections but issues exist - log for manual review
      console.log(`[reviewLoop] ${review.issues.length} issues found but no auto-corrections available`);
      break; // Exit if we can't auto-correct
    }
  }

  return {
    finalDimensions: currentDimensions,
    finalSvg: currentSvg,
    reviews,
    iterationCount: iteration,
  };
}

/**
 * Quick quality check without full review
 * Checks for common issues locally without API call
 */
export function quickQualityCheck(dimensions: Dimension[]): DrawingIssue[] {
  const issues: DrawingIssue[] = [];

  // Check for overlapping dimensions
  const horizontalDims = dimensions.filter(d => 
    Math.abs(d.position.start_y - d.position.end_y) < 1
  );
  const verticalDims = dimensions.filter(d => 
    Math.abs(d.position.start_x - d.position.end_x) < 1
  );

  // Check horizontal dimension spacing
  horizontalDims.sort((a, b) => a.position.start_y - b.position.start_y);
  for (let i = 0; i < horizontalDims.length - 1; i++) {
    const spacing = Math.abs(horizontalDims[i].position.start_y - horizontalDims[i + 1].position.start_y);
    if (spacing < 5) {
      issues.push({
        severity: "major",
        category: "layout",
        description: `Horizontal dimensions too close together (${spacing.toFixed(1)}mm spacing)`,
        affectedDimensionId: horizontalDims[i + 1].id,
      });
    }
  }

  // Check vertical dimension spacing
  verticalDims.sort((a, b) => a.position.start_x - b.position.start_x);
  for (let i = 0; i < verticalDims.length - 1; i++) {
    const spacing = Math.abs(verticalDims[i].position.start_x - verticalDims[i + 1].position.start_x);
    if (spacing < 5) {
      issues.push({
        severity: "major",
        category: "layout",
        description: `Vertical dimensions too close together (${spacing.toFixed(1)}mm spacing)`,
        affectedDimensionId: verticalDims[i + 1].id,
      });
    }
  }

  // Check for zero or negative values
  for (const dim of dimensions) {
    if (dim.value <= 0) {
      issues.push({
        severity: "critical",
        category: "dimension",
        description: `Invalid dimension value: ${dim.value}`,
        affectedDimensionId: dim.id,
      });
    }
  }

  // Check for missing critical dimensions by view
  const viewDims = new Map<ViewType, number>();
  for (const dim of dimensions) {
    viewDims.set(dim.view, (viewDims.get(dim.view) || 0) + 1);
  }

  // Each view should have at least 2 dimensions (typically width + height)
  for (const [view, count] of viewDims) {
    if (count < 2) {
      issues.push({
        severity: "major",
        category: "missing",
        description: `${view} view has only ${count} dimension(s) - may be incomplete`,
        location: `${view} View`,
      });
    }
  }

  return issues;
}
