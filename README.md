# Laser Kitten Defense - Project Overview

Web game that uses face tracking to control eye lasers for defending kittens from ghosts.

[Video](https://youtu.be/nviYIfiYd24) | [Live Demo](https://www.funwithcomputervision.com/laser-kitten/)

<img src="assets/laser-kitten.png">

## Tech Stack

- **Three.js** - 3D graphics and rendering
- **MediaPipe Face Mesh** - Real-time face landmark detection
- **Tone.js** - Audio synthesis for sound effects
- **WebGL Shaders** - Custom laser and particle effects
- **WebRTC** - Camera access via getUserMedia

## Core Components

### 1. Face Tracking Setup
- Uses MediaPipe to detect 468 facial landmarks
- Tracks left and right eye positions in real-time
- Calibrates head center position on game start
- Falls back to mouse control if face tracking fails

### 2. Game Mechanics
- **Kittens**: 3 sprites positioned on player's forehead that move with face
- **Ghosts**: Enemy sprites that spawn from screen edges and target kittens
- **Lasers**: Dual eye beams fired automatically toward gaze direction
- **Health System**: Ghosts take multiple hits, kittens die in one hit

### 3. Visual Effects

#### Custom Shaders
- **Laser Beam**: Animated beam with sine wave distortion and pulsing
- **Laser Tip**: Swirling energy effect at gaze target
- **Particles**: Explosion effects when enemies are hit

### 4. Game Flow
1. **Initialization**: Load sprites, setup face tracking, calibrate camera
2. **Game Loop**: 
   - Update face positions
   - Spawn enemies at increasing difficulty
   - Auto-fire lasers every 180ms
   - Check collisions between lasers/enemies and enemies/kittens
3. **Game Over**: Triggered when all kittens are captured

### 5. Audio System
- **Ghost Pop**: Membrane synth for enemy hits
- **Kitten Alert**: Sawtooth synth sequence for kitten capture
- All sounds generated procedurally with Tone.js

### 6. Responsive Design
- Adapts gaze sensitivity for portrait vs landscape
- Mobile-optimized enemy speeds and UI scaling
- Fallback textures generated via Canvas API if sprites fail to load

## File Structure

- `index.html` - Main HTML structure and meta tags
- `main.js` - Core game logic and Three.js setup
- `sound.js` - Tone.js audio synthesis
- `styles.css` - Retro pixel-art themed styling
- `assets/` - Sprite images (ghost.png, kitten.png)

The game combines computer vision, 3D graphics, and procedural audio into a cohesive augmented reality experience that runs entirely in the browser.