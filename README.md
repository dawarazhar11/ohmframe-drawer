# Ohmframe Drawer

AI-powered 2D engineering drawing generator from STEP files.

## Features

- **STEP File Import** - Load 3D CAD models in STEP format
- **3D Preview** - Interactive Three.js viewer with orbit controls
- **Automatic Orthographic Views** - Generate Front, Top, Right, and Isometric views
- **AI-Powered Dimensioning** - Claude API generates ASME Y14.5 compliant dimensions
- **SVG Export** - Download drawings for further editing in vector software

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Three.js
- **Backend**: Rust, Tauri 2.0
- **AI**: Claude API via sub2api
- **3D**: @react-three/fiber, @react-three/drei, occt-import-js

## Getting Started

### Prerequisites

- Node.js 20+
- Rust (latest stable)
- Sub2API key for Claude access

### Installation

```bash
npm install
```

### Development

```bash
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Usage

1. Click "Load STEP File" to import a 3D model
2. Preview the model in the 3D viewer
3. Configure sheet size and units
4. Click "Generate Drawing" to create 2D views with AI-powered dimensioning
5. Export to SVG for further editing

## License

MIT
