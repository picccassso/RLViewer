# RLViewer

RLViewer is a client-side 3D replay viewer for Rocket League built with Three.js, React, and WebAssembly.

Most replay visualizers require an account, upload your files to a remote server, or have inaccurate camera math that causes motion sickness during aerials. RLViewer parses everything locally in your browser so you can just drag and drop a replay and watch it right away.

## Features

- **100% Client-Side Parsing**: Powered by a Rust WebAssembly parser running in a Web Worker. Replays are processed directly in your browser with zero server uploads and no account needed.
- **Accurate Camera Settings**: Uses each player's real in-game camera profile (FOV, distance, height, angle, and stiffness). Camera height is anchored to the world horizon so your view stays stable during barrel rolls and aerials instead of spinning upside down.
- **Camera Modes**:
  - Player POV with toggleable Ball Cam
  - Director Cam that automatically follows the action
  - Free-fly Orbit Cam for exploring the field
  - 2D tactical minimap showing real-time player and ball positions
- **3D Stadium and Car Models**: Textured arena, goal nets, and 3D car models (Octane, Fennec, Dominus, Breakout, Mantis, Merc, X-Devil) with attached wheels and team colors.
- **Match Timeline and HUD**:
  - Interactive scrubber with markers for goals, saves, and demolitions
  - Variable playback speed (0.25x, 0.5x, 1x, 1.5x, 2x) and frame stepping
  - Live scoreboard that updates as goals happen
  - Real-time boost gauge (0 to 100) and speed meter
  - Boost pad cooldown timers on the field

## Quick Start

### Prerequisites

- Node.js 18 or newer
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/picccassso/RLViewer.git
   cd RLViewer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open the link shown in your terminal (usually `http://localhost:3000` or `http://localhost:5173`).

A sample replay is loaded automatically on launch. To watch your own match, drag and drop any `.replay` file anywhere onto the window.

## Testing and Building

Run the unit and integration tests:
```bash
npm test
```

Create a production build:
```bash
npm run build
```

Preview the production build locally:
```bash
npm run preview
```

## Tech Stack

- Three.js for 3D rendering and scene graph
- React and TypeScript for UI overlays and state
- Tailwind CSS for styling
- subtr-actor (Rust/WASM) for replay decoding
- Vitest for math invariant and integration testing
