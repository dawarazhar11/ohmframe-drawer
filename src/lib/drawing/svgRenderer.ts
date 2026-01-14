import type {
  OrthographicView,
  Dimension,
  TitleBlock,
  DrawingSheet,
  BoundingBox,
} from "../../types";
import type { ProjectedView } from "./projection";
import type { DatumFeature } from "./datums";

// SVG Namespace
const SVG_NS = "http://www.w3.org/2000/svg";

// Drawing style constants (ASME Y14.5 compliant)
const STYLES = {
  // Line weights per ASME Y14.2
  visibleLineWidth: 0.6,      // Visible object lines
  hiddenLineWidth: 0.35,      // Hidden lines
  centerLineWidth: 0.25,      // Centerlines
  dimensionLineWidth: 0.25,   // Dimension/extension lines
  borderLineWidth: 0.7,       // Border lines
  
  // Legacy (for compatibility)
  lineWidth: 0.5,
  
  // Dimension styling
  arrowSize: 3,
  extensionGap: 1.5,          // Gap between geometry and extension line
  extensionOverhang: 2.0,     // Extension past dimension line
  
  // Text
  fontSize: 3.5,
  fontFamily: "Arial, sans-serif",
  
  // Colors
  colors: {
    outline: "#000000",
    visible: "#000000",
    hidden: "#000000",        // Same color, different dash pattern
    dimension: "#0066CC",
    centerline: "#CC0000",
    datum: "#009900",
    text: "#000000",
    construction: "#999999",
  },
  
  // Dash patterns
  dashPatterns: {
    hidden: "2,1",            // Short dashes for hidden lines
    centerline: "8,2,2,2",    // Long-short-long pattern
    construction: "1,2",      // Dotted
  },
};

// Generate dimension line SVG
export function renderDimension(dim: Dimension, scale: number = 1): string {
  const { position, value, type, tolerance_plus, tolerance_minus } = dim;
  const { start_x, start_y, end_x, end_y } = position;

  // Scale coordinates
  const sx = start_x * scale;
  const sy = start_y * scale;
  const ex = end_x * scale;
  const ey = end_y * scale;

  // Calculate midpoint for text
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;

  let svg = "";

  if (type === "linear") {
    // Extension lines
    svg += `<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy - 10}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
    svg += `<line x1="${ex}" y1="${ey}" x2="${ex}" y2="${ey - 10}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;

    // Dimension line
    svg += `<line x1="${sx}" y1="${sy - 7}" x2="${ex}" y2="${ey - 7}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;

    // Arrows
    svg += renderArrow(sx, sy - 7, "right");
    svg += renderArrow(ex, ey - 7, "left");

    // Dimension text
    const displayText = formatDimensionText(value, tolerance_plus, tolerance_minus, type);
    svg += `<text x="${mx}" y="${my - 9}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${displayText}</text>`;
  } else if (type === "diameter") {
    // Diameter symbol and value
    const displayText = `Ø${formatDimensionText(value, tolerance_plus, tolerance_minus, type)}`;
    svg += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${displayText}</text>`;

    // Leader line if needed
    if (position.text_x && position.text_y) {
      svg += `<line x1="${mx}" y1="${my}" x2="${position.text_x * scale}" y2="${position.text_y * scale}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
    }
  } else if (type === "radius") {
    // Radius symbol and value
    const displayText = `R${formatDimensionText(value, tolerance_plus, tolerance_minus, type)}`;
    svg += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${displayText}</text>`;
  }

  return svg;
}

// Render arrow head
function renderArrow(x: number, y: number, direction: "left" | "right" | "up" | "down"): string {
  const size = STYLES.arrowSize;
  let points = "";

  switch (direction) {
    case "right":
      points = `${x},${y} ${x - size},${y - size / 2} ${x - size},${y + size / 2}`;
      break;
    case "left":
      points = `${x},${y} ${x + size},${y - size / 2} ${x + size},${y + size / 2}`;
      break;
    case "up":
      points = `${x},${y} ${x - size / 2},${y + size} ${x + size / 2},${y + size}`;
      break;
    case "down":
      points = `${x},${y} ${x - size / 2},${y - size} ${x + size / 2},${y - size}`;
      break;
  }

  return `<polygon points="${points}" fill="${STYLES.colors.dimension}" />`;
}

// Format dimension text with tolerances
function formatDimensionText(
  value: number,
  tolerancePlus?: number,
  toleranceMinus?: number,
  type?: string
): string {
  const formattedValue = value.toFixed(type === "angular" ? 1 : 2);

  if (tolerancePlus !== undefined && toleranceMinus !== undefined) {
    if (tolerancePlus === toleranceMinus) {
      return `${formattedValue} ±${tolerancePlus.toFixed(2)}`;
    } else {
      return `${formattedValue} +${tolerancePlus.toFixed(2)}/-${toleranceMinus.toFixed(2)}`;
    }
  }

  return formattedValue;
}

// Generate title block SVG
export function renderTitleBlock(
  titleBlock: TitleBlock,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  const rowHeight = height / 5;
  const labelWidth = width * 0.3;

  let svg = `<g transform="translate(${x}, ${y})">`;

  // Border
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${STYLES.colors.outline}" stroke-width="${STYLES.lineWidth}" />`;

  // Rows
  const rows = [
    { label: "PART NAME", value: titleBlock.part_name },
    { label: "PART NO.", value: titleBlock.part_number },
    { label: "MATERIAL", value: titleBlock.material },
    { label: "SCALE", value: titleBlock.scale },
    { label: "DRAWN BY", value: `${titleBlock.drawn_by} | ${titleBlock.date}` },
  ];

  rows.forEach((row, index) => {
    const rowY = index * rowHeight;

    // Row divider
    if (index > 0) {
      svg += `<line x1="0" y1="${rowY}" x2="${width}" y2="${rowY}" stroke="${STYLES.colors.outline}" stroke-width="${STYLES.dimensionLineWidth}" />`;
    }

    // Label column divider
    svg += `<line x1="${labelWidth}" y1="${rowY}" x2="${labelWidth}" y2="${rowY + rowHeight}" stroke="${STYLES.colors.outline}" stroke-width="${STYLES.dimensionLineWidth}" />`;

    // Label text
    svg += `<text x="${labelWidth / 2}" y="${rowY + rowHeight / 2 + 1}" text-anchor="middle" font-size="${STYLES.fontSize * 0.8}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${row.label}</text>`;

    // Value text
    svg += `<text x="${labelWidth + (width - labelWidth) / 2}" y="${rowY + rowHeight / 2 + 1}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}" font-weight="bold">${row.value}</text>`;
  });

  svg += `</g>`;

  return svg;
}

// Generate view border with label
export function renderViewBorder(
  view: OrthographicView,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  let svg = `<g transform="translate(${x}, ${y})">`;

  // View border (thin dashed line)
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${STYLES.colors.hidden}" stroke-width="${STYLES.dimensionLineWidth}" stroke-dasharray="5,3" />`;

  // View label
  svg += `<text x="${width / 2}" y="${height + 8}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${view.label.toUpperCase()} VIEW</text>`;

  // Scale indicator
  svg += `<text x="${width / 2}" y="${height + 14}" text-anchor="middle" font-size="${STYLES.fontSize * 0.8}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.hidden}">SCALE ${view.scale}:1</text>`;

  svg += `</g>`;

  return svg;
}

// Generate complete drawing sheet SVG
export function renderDrawingSheet(sheet: DrawingSheet): string {
  const sheetDims = {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    A2: { width: 420, height: 594 },
    A1: { width: 594, height: 841 },
    A0: { width: 841, height: 1189 },
    ANSI_A: { width: 216, height: 279 },
    ANSI_B: { width: 279, height: 432 },
    ANSI_C: { width: 432, height: 559 },
    ANSI_D: { width: 559, height: 864 },
  }[sheet.size] || { width: 297, height: 420 };

  const { width, height } = sheetDims;
  const margin = 10;
  const titleBlockHeight = 40;
  const titleBlockWidth = 100;

  let svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}mm" height="${height}mm">`;

  // Background
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="white" />`;

  // Border
  svg += `<rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" fill="none" stroke="${STYLES.colors.outline}" stroke-width="${STYLES.lineWidth}" />`;

  // Title block (bottom right)
  svg += renderTitleBlock(
    sheet.title_block,
    width - margin - titleBlockWidth,
    height - margin - titleBlockHeight,
    titleBlockWidth,
    titleBlockHeight
  );

  // Drawing notes (bottom left)
  if (sheet.notes.length > 0) {
    let notesY = height - margin - 5;
    sheet.notes.forEach((note, index) => {
      svg += `<text x="${margin + 5}" y="${notesY - index * 5}" font-size="${STYLES.fontSize * 0.9}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${index + 1}. ${note}</text>`;
    });
  }

  // TODO: Render actual orthographic projections from mesh data
  // View area for future use:
  // x: margin + 5, y: margin + 5
  // width: width - margin * 2 - titleBlockWidth - 20
  // height: height - margin * 2 - titleBlockHeight - 20

  // Render dimensions
  sheet.dimensions.forEach((dim) => {
    svg += renderDimension(dim);
  });

  svg += `</svg>`;

  return svg;
}

// Generate orthographic projection from bounding box (simplified)
export function generateOrthographicViews(
  bbox: BoundingBox,
  scale: number = 1
): OrthographicView[] {
  const views: OrthographicView[] = [];

  // Front view (XY plane, looking at -Z)
  views.push({
    type: "front",
    label: "Front",
    svgContent: generateRectView(bbox.width, bbox.height, scale),
    width: bbox.width * scale,
    height: bbox.height * scale,
    scale,
  });

  // Top view (XZ plane, looking at -Y)
  views.push({
    type: "top",
    label: "Top",
    svgContent: generateRectView(bbox.width, bbox.depth, scale),
    width: bbox.width * scale,
    height: bbox.depth * scale,
    scale,
  });

  // Right view (YZ plane, looking at +X)
  views.push({
    type: "right",
    label: "Right",
    svgContent: generateRectView(bbox.depth, bbox.height, scale),
    width: bbox.depth * scale,
    height: bbox.height * scale,
    scale,
  });

  return views;
}

// Generate simple rectangular view (placeholder)
function generateRectView(width: number, height: number, scale: number): string {
  const w = width * scale;
  const h = height * scale;

  return `<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="${STYLES.colors.outline}" stroke-width="${STYLES.lineWidth}" />`;
}

/**
 * Render a projected view with actual edges (visible and hidden)
 */
export function renderProjectedView(
  view: ProjectedView,
  offsetX: number = 0,
  offsetY: number = 0,
  scale: number = 1,
  flipY: boolean = true // SVG Y is inverted from CAD
): string {
  let svg = `<g class="projected-view ${view.type}" transform="translate(${offsetX}, ${offsetY})">`;
  
  const { edges, circles, bounds } = view;
  
  // Note: View dimensions available via bounds for future use
  // viewWidth = (bounds.maxX - bounds.minX) * scale
  // viewHeight = (bounds.maxY - bounds.minY) * scale
  
  // Render visible edges first (on top)
  const visibleEdges = edges.filter(e => e.type === "visible");
  const hiddenEdges = edges.filter(e => e.type === "hidden");
  const centerlines = edges.filter(e => e.type === "centerline");
  
  // Hidden edges (dashed, drawn first so visible lines overlay)
  for (const edge of hiddenEdges) {
    const [sx, sy] = transformPoint(edge.start, bounds, scale, flipY);
    const [ex, ey] = transformPoint(edge.end, bounds, scale, flipY);
    
    svg += `<line 
      x1="${sx}" y1="${sy}" 
      x2="${ex}" y2="${ey}" 
      stroke="${STYLES.colors.hidden}" 
      stroke-width="${STYLES.hiddenLineWidth}" 
      stroke-dasharray="${STYLES.dashPatterns.hidden}"
    />`;
  }
  
  // Centerlines (if any)
  for (const edge of centerlines) {
    const [sx, sy] = transformPoint(edge.start, bounds, scale, flipY);
    const [ex, ey] = transformPoint(edge.end, bounds, scale, flipY);
    
    svg += `<line 
      x1="${sx}" y1="${sy}" 
      x2="${ex}" y2="${ey}" 
      stroke="${STYLES.colors.centerline}" 
      stroke-width="${STYLES.centerLineWidth}" 
      stroke-dasharray="${STYLES.dashPatterns.centerline}"
    />`;
  }
  
  // Visible edges (solid)
  for (const edge of visibleEdges) {
    const [sx, sy] = transformPoint(edge.start, bounds, scale, flipY);
    const [ex, ey] = transformPoint(edge.end, bounds, scale, flipY);
    
    svg += `<line 
      x1="${sx}" y1="${sy}" 
      x2="${ex}" y2="${ey}" 
      stroke="${STYLES.colors.visible}" 
      stroke-width="${STYLES.visibleLineWidth}"
    />`;
  }
  
  // Render circles (holes, bosses)
  for (const circle of circles) {
    const [cx, cy] = transformPoint(circle.center, bounds, scale, flipY);
    const r = circle.radius * scale;
    
    // Circle outline
    svg += `<circle 
      cx="${cx}" cy="${cy}" r="${r}" 
      fill="none" 
      stroke="${STYLES.colors.visible}" 
      stroke-width="${STYLES.visibleLineWidth}"
    />`;
    
    // Centerlines for holes
    if (circle.type === "hole") {
      const crossSize = r * 1.3;
      svg += `<line 
        x1="${cx - crossSize}" y1="${cy}" 
        x2="${cx + crossSize}" y2="${cy}" 
        stroke="${STYLES.colors.centerline}" 
        stroke-width="${STYLES.centerLineWidth}" 
        stroke-dasharray="${STYLES.dashPatterns.centerline}"
      />`;
      svg += `<line 
        x1="${cx}" y1="${cy - crossSize}" 
        x2="${cx}" y2="${cy + crossSize}" 
        stroke="${STYLES.colors.centerline}" 
        stroke-width="${STYLES.centerLineWidth}" 
        stroke-dasharray="${STYLES.dashPatterns.centerline}"
      />`;
    }
  }
  
  svg += `</g>`;
  return svg;
}

/**
 * Transform a 2D point from view coordinates to SVG coordinates
 */
function transformPoint(
  point: [number, number],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  scale: number,
  flipY: boolean
): [number, number] {
  const x = (point[0] - bounds.minX) * scale;
  const y = flipY 
    ? (bounds.maxY - point[1]) * scale  // Flip Y for SVG
    : (point[1] - bounds.minY) * scale;
  return [x, y];
}

/**
 * Render a datum feature symbol
 */
export function renderDatumSymbol(
  datum: DatumFeature,
  x: number,
  y: number,
  scale: number = 1
): string {
  const boxSize = 6 * scale;
  const triangleSize = 4 * scale;
  
  let svg = `<g class="datum-symbol" transform="translate(${x}, ${y})">`;
  
  // Datum triangle pointing to surface
  svg += `<polygon 
    points="0,0 ${-triangleSize},${triangleSize} ${triangleSize},${triangleSize}" 
    fill="none" 
    stroke="${STYLES.colors.datum}" 
    stroke-width="${STYLES.dimensionLineWidth}"
  />`;
  
  // Datum label box
  svg += `<rect 
    x="${-boxSize/2}" y="${triangleSize}" 
    width="${boxSize}" height="${boxSize}" 
    fill="white" 
    stroke="${STYLES.colors.datum}" 
    stroke-width="${STYLES.dimensionLineWidth}"
  />`;
  
  // Datum letter
  svg += `<text 
    x="0" y="${triangleSize + boxSize * 0.75}" 
    text-anchor="middle" 
    font-size="${STYLES.fontSize}" 
    font-family="${STYLES.fontFamily}" 
    font-weight="bold"
    fill="${STYLES.colors.datum}"
  >${datum.id}</text>`;
  
  svg += `</g>`;
  return svg;
}

/**
 * Layout configuration for third-angle projection
 */
export interface ViewLayout {
  front: { x: number; y: number };
  top: { x: number; y: number };
  right: { x: number; y: number };
  isometric?: { x: number; y: number };
}

/**
 * Calculate view layout for third-angle projection
 */
export function calculateViewLayout(
  views: ProjectedView[],
  sheetWidth: number,
  sheetHeight: number,
  margin: number = 30,
  spacing: number = 20
): ViewLayout {
  // Find views
  const frontView = views.find(v => v.type === "front");
  const topView = views.find(v => v.type === "top");
  const rightView = views.find(v => v.type === "right");
  
  // Calculate view sizes
  const frontWidth = frontView ? (frontView.bounds.maxX - frontView.bounds.minX) : 50;
  const frontHeight = frontView ? (frontView.bounds.maxY - frontView.bounds.minY) : 50;
  const topHeight = topView ? (topView.bounds.maxY - topView.bounds.minY) : 30;
  const rightWidth = rightView ? (rightView.bounds.maxX - rightView.bounds.minX) : 30;
  
  // Third-angle projection layout:
  // TOP view above FRONT view (aligned vertically)
  // RIGHT view to the right of FRONT view (aligned horizontally)
  
  const drawingAreaWidth = sheetWidth - margin * 2 - 100; // Leave space for title block
  const drawingAreaHeight = sheetHeight - margin * 2 - 50; // Leave space for notes
  
  // Calculate scale to fit all views
  const totalWidth = frontWidth + spacing + rightWidth;
  const totalHeight = topHeight + spacing + frontHeight;
  
  const scaleX = drawingAreaWidth / totalWidth;
  const scaleY = drawingAreaHeight / totalHeight;
  const scale = Math.min(scaleX, scaleY, 2); // Max 2:1 scale
  
  // Calculate positions (third-angle projection)
  const startX = margin + 20;
  const startY = margin + 20;
  
  return {
    front: {
      x: startX,
      y: startY + (topHeight * scale) + spacing,
    },
    top: {
      x: startX,
      y: startY,
    },
    right: {
      x: startX + (frontWidth * scale) + spacing,
      y: startY + (topHeight * scale) + spacing,
    },
    isometric: {
      x: startX + (frontWidth * scale) + spacing + (rightWidth * scale) + spacing,
      y: startY,
    },
  };
}

/**
 * Render complete drawing sheet with projected views
 */
export function renderDrawingSheetWithViews(
  sheet: DrawingSheet,
  projectedViews: ProjectedView[],
  datums?: DatumFeature[]
): string {
  const sheetDims = {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    A2: { width: 420, height: 594 },
    A1: { width: 594, height: 841 },
    A0: { width: 841, height: 1189 },
    ANSI_A: { width: 216, height: 279 },
    ANSI_B: { width: 279, height: 432 },
    ANSI_C: { width: 432, height: 559 },
    ANSI_D: { width: 559, height: 864 },
  }[sheet.size] || { width: 297, height: 420 };

  const { width, height } = sheetDims;
  const margin = 10;
  const titleBlockHeight = 40;
  const titleBlockWidth = 100;

  let svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}mm" height="${height}mm">`;
  
  // Definitions (for arrowheads, etc.)
  svg += `<defs>
    <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="0" refY="3" orient="auto">
      <path d="M10,0 L0,3 L10,6 Z" fill="${STYLES.colors.dimension}" />
    </marker>
    <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto">
      <path d="M0,0 L10,3 L0,6 Z" fill="${STYLES.colors.dimension}" />
    </marker>
  </defs>`;

  // Background
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="white" />`;

  // Border
  svg += `<rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" fill="none" stroke="${STYLES.colors.outline}" stroke-width="${STYLES.borderLineWidth}" />`;

  // Calculate view layout
  const layout = calculateViewLayout(projectedViews, width, height, margin + 5, 15);
  
  // Calculate scale based on available space
  const frontView = projectedViews.find(v => v.type === "front");
  const scale = frontView ? frontView.scale : 1;
  
  // Render each projected view
  for (const view of projectedViews) {
    const position = layout[view.type as keyof ViewLayout];
    if (position) {
      svg += renderProjectedView(view, position.x, position.y, scale);
      
      // Add view label - calculate view dimensions for positioning
      const vw = (view.bounds.maxX - view.bounds.minX) * scale;
      const vh = (view.bounds.maxY - view.bounds.minY) * scale;
      svg += `<text 
        x="${position.x + vw / 2}" 
        y="${position.y + vh + 10}" 
        text-anchor="middle" 
        font-size="${STYLES.fontSize}" 
        font-family="${STYLES.fontFamily}" 
        fill="${STYLES.colors.text}"
      >${view.type.toUpperCase()} VIEW</text>`;
    }
  }
  
  // Render datum symbols if provided
  if (datums && datums.length > 0) {
    const frontPos = layout.front;
    for (const datum of datums) {
      // Position datum symbols near the front view
      // This is simplified - should be placed on actual datum features
      const datumX = frontPos.x - 15;
      const datumY = frontPos.y + 20 + (datum.id.charCodeAt(0) - 65) * 20;
      svg += renderDatumSymbol(datum, datumX, datumY, 1);
    }
  }

  // Title block (bottom right)
  svg += renderTitleBlock(
    sheet.title_block,
    width - margin - titleBlockWidth,
    height - margin - titleBlockHeight,
    titleBlockWidth,
    titleBlockHeight
  );

  // Drawing notes (bottom left)
  if (sheet.notes.length > 0) {
    let notesY = height - margin - 5;
    sheet.notes.forEach((note, index) => {
      svg += `<text x="${margin + 5}" y="${notesY - index * 5}" font-size="${STYLES.fontSize * 0.9}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${index + 1}. ${note}</text>`;
    });
  }

  // Render dimensions with proper positioning relative to views
  for (const dim of sheet.dimensions) {
    const viewPosition = layout[dim.view as keyof ViewLayout];
    if (viewPosition) {
      svg += renderDimensionWithOffset(dim, viewPosition.x, viewPosition.y, scale);
    } else {
      svg += renderDimension(dim, 1);
    }
  }

  svg += `</svg>`;

  return svg;
}

/**
 * Render dimension with view offset
 */
function renderDimensionWithOffset(
  dim: Dimension,
  offsetX: number,
  offsetY: number,
  scale: number
): string {
  const { position, value, type, tolerance_plus, tolerance_minus } = dim;
  
  // Apply offset to position
  const sx = offsetX + position.start_x * scale;
  const sy = offsetY + position.start_y * scale;
  const ex = offsetX + position.end_x * scale;
  const ey = offsetY + position.end_y * scale;
  
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  
  let svg = `<g class="dimension ${type}">`;
  
  const isHorizontal = Math.abs(sy - ey) < Math.abs(sx - ex);
  
  if (type === "linear") {
    if (isHorizontal) {
      // Horizontal dimension (below view)
      const extY = Math.max(sy, ey) + 3;
      const dimY = extY + 5;
      
      // Extension lines
      svg += `<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${dimY}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
      svg += `<line x1="${ex}" y1="${ey}" x2="${ex}" y2="${dimY}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
      
      // Dimension line with arrows
      svg += `<line x1="${sx}" y1="${dimY - 2}" x2="${ex}" y2="${dimY - 2}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" marker-start="url(#arrow-start)" marker-end="url(#arrow-end)" />`;
      
      // Dimension text
      const displayText = formatDimensionText(value, tolerance_plus, tolerance_minus, type);
      svg += `<text x="${mx}" y="${dimY - 4}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${displayText}</text>`;
    } else {
      // Vertical dimension (to right of view)
      const extX = Math.max(sx, ex) + 3;
      const dimX = extX + 5;
      
      // Extension lines
      svg += `<line x1="${sx}" y1="${sy}" x2="${dimX}" y2="${sy}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
      svg += `<line x1="${ex}" y1="${ey}" x2="${dimX}" y2="${ey}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
      
      // Dimension line with arrows
      svg += `<line x1="${dimX - 2}" y1="${sy}" x2="${dimX - 2}" y2="${ey}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" marker-start="url(#arrow-start)" marker-end="url(#arrow-end)" />`;
      
      // Dimension text (rotated for vertical)
      const displayText = formatDimensionText(value, tolerance_plus, tolerance_minus, type);
      svg += `<text x="${dimX + 2}" y="${my}" text-anchor="middle" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}" transform="rotate(-90, ${dimX + 2}, ${my})">${displayText}</text>`;
    }
  } else if (type === "diameter") {
    const displayText = `Ø${formatDimensionText(value, tolerance_plus, tolerance_minus, type)}`;
    svg += `<text x="${mx + 5}" y="${my}" text-anchor="start" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${displayText}</text>`;
    
    // Leader line
    svg += `<line x1="${mx}" y1="${my}" x2="${mx + 4}" y2="${my}" stroke="${STYLES.colors.dimension}" stroke-width="${STYLES.dimensionLineWidth}" />`;
  } else if (type === "radius") {
    const displayText = `R${formatDimensionText(value, tolerance_plus, tolerance_minus, type)}`;
    svg += `<text x="${mx + 5}" y="${my}" text-anchor="start" font-size="${STYLES.fontSize}" font-family="${STYLES.fontFamily}" fill="${STYLES.colors.text}">${displayText}</text>`;
  }
  
  svg += `</g>`;
  return svg;
}
