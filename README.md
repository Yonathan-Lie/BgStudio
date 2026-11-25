# BgStudio

Lightweight, 100% client-side background remover and color changer, packaged for Alpine Docker (`nginx:1.27-alpine`).

## Features
- **Edge-connected backdrop removal**: Automatically detects the outer background color and removes connected backdrop pixels while preserving enclosed details (such as white shirts in portrait/ID photos).
- **Global color key mode**: Remove a target color everywhere for logos, icons, and text.
- **Edge refinement & defringing**: Tolerance, smoothstep edge softness, and color decontamination to eliminate white/gray halos around hair.
- **Interactive tools**: Eyedropper color picker, Magic Wand (+/-) for enclosed regions, Erase/Restore brush with undo/redo, and hold-to-peek original comparison.
- **Background & subject color changer**: Instant ID Red/Blue presets, custom hex/color picker, linear gradients, transparent PNGs, plus foreground brightness, contrast, saturation, and hue shift.
- **Zero backend / zero external requests**: Enforced via `connect-src 'none'` CSP; all image processing runs locally in the browser.

## Run with Docker (Alpine)
```bash
docker compose up --build -d
```
Open [http://localhost:8080](http://localhost:8080).

To use a custom port:
```bash
PORT=9090 docker compose up --build -d
```

## Development & Tests
```bash
npm test
```
