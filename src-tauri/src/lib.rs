use serde::{Deserialize, Serialize};
use regex::Regex;

/// Result of STEP file analysis
#[derive(Debug, Serialize, Deserialize)]
pub struct StepAnalysisResult {
    pub success: bool,
    pub error: Option<String>,
    pub filename: Option<String>,
    pub bounding_box: Option<BoundingBox>,
    pub parts_count: usize,
    pub features: Option<FeatureInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoundingBox {
    pub min_x: f64,
    pub min_y: f64,
    pub min_z: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub max_z: f64,
    pub width: f64,
    pub height: f64,
    pub depth: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeatureInfo {
    pub has_holes: bool,
    pub has_fillets: bool,
    pub has_chamfers: bool,
    pub hole_count: usize,
    pub surface_count: usize,
}

/// Analyze STEP file content and extract geometry information
#[tauri::command]
fn analyze_step_content(content: String, filename: String) -> StepAnalysisResult {
    // Parse STEP file to extract geometric information
    let cartesian_regex = Regex::new(r"CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)").ok();
    let circle_regex = Regex::new(r"CIRCLE\s*\(").ok();
    let cylindrical_regex = Regex::new(r"CYLINDRICAL_SURFACE\s*\(").ok();
    let fillet_regex = Regex::new(r"EDGE_CURVE.*CIRCLE|B_SPLINE_CURVE").ok();
    let advanced_face_regex = Regex::new(r"ADVANCED_FACE\s*\(").ok();
    
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut min_z = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    let mut max_z = f64::MIN;
    let mut points_found = 0;
    
    // Extract cartesian points for bounding box
    if let Some(regex) = &cartesian_regex {
        for cap in regex.captures_iter(&content) {
            if let (Some(x), Some(y), Some(z)) = (
                cap.get(1).and_then(|m| m.as_str().parse::<f64>().ok()),
                cap.get(2).and_then(|m| m.as_str().parse::<f64>().ok()),
                cap.get(3).and_then(|m| m.as_str().parse::<f64>().ok()),
            ) {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                min_z = min_z.min(z);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                max_z = max_z.max(z);
                points_found += 1;
            }
        }
    }
    
    // Count features
    let hole_count = circle_regex.as_ref()
        .map(|r| r.find_iter(&content).count())
        .unwrap_or(0);
    
    let has_cylindrical = cylindrical_regex.as_ref()
        .map(|r| r.is_match(&content))
        .unwrap_or(false);
    
    let has_fillets = fillet_regex.as_ref()
        .map(|r| r.is_match(&content))
        .unwrap_or(false);
    
    let surface_count = advanced_face_regex.as_ref()
        .map(|r| r.find_iter(&content).count())
        .unwrap_or(0);
    
    // Count parts (PRODUCT entities)
    let product_regex = Regex::new(r"PRODUCT\s*\(").ok();
    let parts_count = product_regex.as_ref()
        .map(|r| r.find_iter(&content).count())
        .unwrap_or(1)
        .max(1);
    
    if points_found == 0 {
        return StepAnalysisResult {
            success: false,
            error: Some("No geometry data found in STEP file".to_string()),
            filename: Some(filename),
            bounding_box: None,
            parts_count: 0,
            features: None,
        };
    }
    
    let bounding_box = BoundingBox {
        min_x,
        min_y,
        min_z,
        max_x,
        max_y,
        max_z,
        width: max_x - min_x,
        height: max_y - min_y,
        depth: max_z - min_z,
    };
    
    let features = FeatureInfo {
        has_holes: hole_count > 0 || has_cylindrical,
        has_fillets,
        has_chamfers: content.contains("CHAMFER") || content.contains("chamfer"),
        hole_count,
        surface_count,
    };
    
    StepAnalysisResult {
        success: true,
        error: None,
        filename: Some(filename),
        bounding_box: Some(bounding_box),
        parts_count,
        features: Some(features),
    }
}

/// Request structure for Claude API
#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeMessage {
    pub role: String,
    pub content: String,
}

/// Claude API request format (sub2api compatible)
#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<ClaudeMessage>,
    pub system: Option<String>,
}

/// Dimension suggestion from AI
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DimensionSuggestion {
    pub dimension_type: String,  // "linear", "diameter", "radius", "angular"
    pub value: f64,
    pub tolerance_plus: Option<f64>,
    pub tolerance_minus: Option<f64>,
    pub view: String,  // "front", "top", "right", "isometric"
    pub position: DimensionPosition,
    pub label: String,
    pub is_critical: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DimensionPosition {
    pub start_x: f64,
    pub start_y: f64,
    pub end_x: f64,
    pub end_y: f64,
}

/// Drawing generation result
#[derive(Debug, Serialize, Deserialize)]
pub struct DrawingGenerationResult {
    pub success: bool,
    pub error: Option<String>,
    pub dimensions: Vec<DimensionSuggestion>,
    pub notes: Vec<String>,
    pub title_block: Option<TitleBlock>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TitleBlock {
    pub part_name: String,
    pub part_number: String,
    pub material: String,
    pub scale: String,
    pub drawn_by: String,
    pub date: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            analyze_step_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
