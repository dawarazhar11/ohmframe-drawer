import type {
  OrthographicView,
  Dimension,
  TitleBlock,
  DrawingSheet,
  BoundingBox,
} from "../../types";

// SVG Namespace
const SVG_NS = "http://www.w3.org/2000/svg";

// Drawing style constants
const STYLES = {
  lineWidth: 0.5,
  dimensionLineWidth: 0.25,
  arrowSize: 3,
  fontSize: 3.5,
  fontFamily: "Arial, sans-serif",
  colors: {
    outline: "#000000",
    dimension: "#0066CC",
    centerline: "#CC0000",
    hidden: "#666666",
    text: "#000000",
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
