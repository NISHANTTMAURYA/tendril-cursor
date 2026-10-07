# 💧 Tendril.js — Liquid Rope & Ink Physics Engine

> **A production-ready, zero-dependency physics-based cursor engine synthesizing Ricardo Mendieta's Gooey Ink Dynamics and Difference Lens with Motion Bench's Frame-Rate Independent Verlet Kinematics.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Netlify Status](https://img.shields.io/badge/Netlify-Live%20Demo-00C7B7.svg?logo=netlify&logoColor=white)](https://tendril-cursor.netlify.app)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg)](#)
[![Performance](https://img.shields.io/badge/GC%20Allocation-0%20bytes%20per%20click-purple.svg)](#)
[![Default Palette](https://img.shields.io/badge/Default-Emerald%20Green-10b981.svg)](#)

🎮 **Live Playground**: [https://tendril-cursor.netlify.app](https://tendril-cursor.netlify.app)  
📦 **GitHub Repo**: [https://github.com/NISHANTTMAURYA/tendril-cursor](https://github.com/NISHANTTMAURYA/tendril-cursor)

---

## 🌟 Core Concepts & Innovations

**Tendril.js** merges advanced creative coding techniques into a 60fps GPU-accelerated simulation:

### 1. 📜 Page-Aware Rope Physics & Dynamic Length Scaling
- **Full Page Traversal (`usePageLength: true`)**: Unlike traditional cursor trails that cap rope length strictly to the viewport diagonal (`window.innerHeight`), Tendril dynamically inspects the total scrollable document height (`document.documentElement.scrollHeight` / `document.body.scrollHeight`).
- **Zero Snapping on Scroll**: You can plant anchor pins at the very top of your landing page (Hero section), scroll down thousands of pixels through features, galleries, and footers, and the rope stretches and weaves continuously across the entire document length!
- **Poisson Necking / Elastic Thinning**: As the total chord distance increases along the page, the tendon organically stretches and thins down like molten rubber while preserving physical continuity.

### 2. 📏 Enlarged Offset Size & Expressive Catenary Sag
- **Generous Offset Capacity (`offsetSize: 6000`, `ropeLengthOffset: 6000`)**: Adds an expansive pixel buffer on top of the page diagonal, giving you massive weaving capacity before FIFO anchor conservation limits are reached.
- **Deep Catenary Sag & Slack (`ropeSlack: 0.42`, `ropeMinSlack: 42`)**: When moving close to anchor pins or easing pointer speed, the cord hangs with rich catenary droop under simulated gravity. As you pull away or accelerate, global tension builds up smoothly and pulls all connected spans taut.

### 3. 📍 Waypoint Weaving & Single-Anchor Modes
- **`'multi'` Mode (Sequential Checkpoints)**: Triple-click to enter anchor mode; single-click anywhere across the screen to plant sequential stop pins. The liquid cord threads between every waypoint.
- **`'single'` Mode (Elastic Follower)**: Maintains a single anchor pin. Clicking anywhere new glides the anchor to the new destination on a damped viscous spring without breaking or detaching the cord!
- **Stage 3 Sever & Drop (✂️)**: Triple-click again (or call `cursor.releaseAllAndDrop()`). The entire threaded cord severs from the cursor, becoming independent physical ropes that fall and coil under Verlet gravity and air drag!

### 4. 🔍 The Liquid Lens: Ricardo Mendieta's Inversion Lens
- **`'difference'` (Default)**: Inverts background colors and text underneath the cursor for high contrast readability.
- **`'normal'`**: Solid viscous ink rendering.
- **`'screen'`**: Additive luminous cyber glow (*recommended for dark themes*).

### 5. 💧 Gravitational Liquid Spills & Splashes
- Clicking or tapping erupts pressurized liquid beads that launch upward and cascade down under gravity (`vy += gravity`).
- **Adaptive Droplet Mass**: Droplet sizes scale with `gooeyBlur` so viscous blur never swallows or dissolves beads.
- **Micro-Droplet Dripping**: Rapid drops shed trailing micro-droplets as they fall.

### 6. 📱 Full Touchscreen & Mobile Device Support
- Dragging your finger across mobile screens draws the fluid rope trail with zero latency.
- Tapping triggers pressurized liquid spills.
- Native multi-finger scrolling remains unaffected with passive non-blocking listeners.

---

## 🚀 Quick Start

### 1-Line HTML Integration (Auto-Init)

```html
<script src="tendril.js" data-tendril></script>
```

### Vanilla JavaScript (UMD / Modular)

```html
<script src="tendril.js"></script>
<script>
  const cursor = new Tendril({
    color: '#10b981',              // Primary head & rope color
    secondaryColor: '#06b6d4',     // Tail gradient color
    mixBlendMode: 'difference',    // Text reveal lens
    usePageLength: true,           // Factor full scrollable page length into rope capacity
    offsetSize: 6000,              // Generous extra offset capacity (px)
    ropeSlack: 0.42,               // Expressive catenary sag offset
    ropeMinSlack: 42,              // Baseline droop offset (px)
    spillOnClick: true,            // Pressurized liquid spill on clicks
    tripleTapAnchor: true,         // Waypoint weaving & severed falling rope
    anchorMode: 'multi'            // 'multi' (checkpoints) | 'single' (gliding pin)
  });
</script>
```

### React / Next.js

```tsx
import React, { useEffect, useRef } from 'react';
import Tendril from './tendril'; // or npm package

export function LiquidCursor() {
  const cursorRef = useRef<Tendril | null>(null);

  useEffect(() => {
    cursorRef.current = new Tendril({
      color: '#ec4899',
      secondaryColor: '#f472b6',
      usePageLength: true,
      offsetSize: 6000,
      strokeWidth: 10,
      segments: 24,
      spillOnClick: true,
      hoverSelector: 'a, button, [role="button"], input, textarea, .interactive'
    });

    return () => {
      cursorRef.current?.destroy();
    };
  }, []);

  return null;
}
```

### Vue 3 / Nuxt 3 (Composition API)

```vue
<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import Tendril from './tendril';

const cursor = ref(null);

onMounted(() => {
  cursor.value = new Tendril({
    color: '#10b981',
    usePageLength: true,
    offsetSize: 6000,
    tripleTapAnchor: true
  });
});

onUnmounted(() => {
  cursor.value?.destroy();
});
</script>
```

---

## ⚙️ Complete Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `color` | `string` | `'#10b981'` | Primary head circle and rope color (any CSS color string). |
| `secondaryColor` | `string \| null` | `null` | Secondary tail gradient color (auto-derived if null). |
| `mixBlendMode` | `string` | `'difference'` | CSS blend mode: `'difference'` (text-inverting lens), `'normal'`, or `'screen'` (additive dark mode glow). |
| `usePageLength` | `boolean` | `true` | **New:** Dynamically incorporates the full document scroll length (`scrollHeight`) to decide max rope length across page scrolling. |
| `pageLengthRatio` | `number` | `1.15` | **New:** Multiplier factor applied to scrollable page length when calculating rope limits. |
| `offsetSize` | `number` | `6000` | **New:** Extra pixel offset capacity added to the rope length to allow continuous weaving across tall pages. |
| `ropeLengthOffset`| `number` | `6000` | Extra pixel offset buffer added to the page diagonal. |
| `ropeLength` | `number` | `0` | Explicit maximum rope length in px (`0` = auto-calculated using page/screen dimensions + offset). |
| `ropeSlack` | `number` | `0.42` | Maximum slack fraction when cursor is close to anchor pins (controls catenary sag depth). |
| `ropeMinSlack` | `number` | `42` | Minimum base droop offset in px so even short cord spans sag organically. |
| `ropeTensionSensitivity` | `number` | `1.0` | Sensitivity multiplier for rope tightening and loosening (`0.2` = loose/sluggish, `1.0` = standard, `2.5` = hyper-reactive). |
| `anchorMode` | `string` | `'multi'` | Anchor mode: `'multi'` (sequential waypoint weaving), `'single'` (1 pin glides on damped spring), or `'off'`. |
| `tripleTapAnchor` | `boolean` | `true` | Triple-tap to anchor tail and sever falling ropes. |
| `multiCheckpoints`| `boolean` | `true` | Allows planting multiple sequential stop checkpoints across the screen in `'multi'` mode. |
| `tripleTapMaxInterval` | `number` | `480` | Maximum milliseconds across 3 taps to trigger anchor/sever actions. |
| `strokeWidth` | `number` | `9` | Base tendon thickness in px. |
| `segments` | `number` | `22` | Number of physical joints along the rope (10–36). |
| `segTau` | `number` | `36` | Lag time constant in ms (frame-rate independent follow speed). |
| `gooeyBlur` | `number` | `7` | SVG `feGaussianBlur` radius (viscosity). |
| `gooeyContrast` | `number` | `34` | Alpha contrast multiplier for SVG gooey threshold. |
| `hoverScale` | `number` | `1.35` | Scale factor for head droplet when hovering over interactive elements. |
| `hoverSelector` | `string` | `'a, button, ...'` | CSS selector for interactive elements. |
| `splashOnClick` | `boolean` | `true` | Radial ink burst on click. |
| `splashCount` | `number` | `7` | Number of radial burst beads. |
| `spillOnClick` | `boolean` | `true` | Gravitational liquid drops spill on click. |
| `spillCount` | `number` | `14` | Number of drops spawned per spill. |
| `gravity` | `number` | `0.38` | Downward gravity acceleration for falling drops (px/frame²). |
| `severedRopeGravity` | `number` | `0.65` | Gravitational downward pull for detached falling ropes. |
| `severedRopeDrag` | `number` | `0.985` | Air resistance for detached falling ropes. |
| `hideNativeCursor` | `boolean` | `true` | Automatically hides OS mouse cursor on desktop devices. |
| `preventTextSelectOnTap` | `boolean` | `false` | When `false` (default), native double-click / triple-click text selection works naturally. |
| `forceTouch` | `boolean` | `false` | Force enables cursor trail and gestures on touch/tablet devices. |

---

## 🕹️ Interactive API Methods

```javascript
// Add sequential checkpoint pins:
cursor.addCheckpoint();       // At current pointer position
cursor.addCheckpoint(x, y);   // At explicit (x, y) coordinates

// Release all checkpoints and drop severed cord with Verlet physics:
cursor.releaseAllAndDrop();

// Clear checkpoints without dropping a falling cord:
cursor.clearCheckpoints();

// Toggle anchor state (backward compatible):
cursor.toggleAnchor(x, y);

// Programmatic liquid spill:
cursor.spill(); // At cursor
cursor.spill({ x: 300, y: 400, count: 24, speed: 6.5, gravity: 0.42 });

// Switch blend modes dynamically:
cursor.setBlendMode('difference'); // Inversion lens
cursor.setBlendMode('normal');     // Solid ink
cursor.setBlendMode('screen');     // Cyber luminous glow (dark mode)

// Change colors dynamically:
cursor.setColor('#ec4899', '#f472b6');

// Live option update:
cursor.setOptions({ offsetSize: 8000, ropeSlack: 0.50 });

// Clean teardown:
cursor.destroy();
```

---

## 🐞 Support & Diagnostics

Developer Contact: **[mauryanishant2005@gmail.com](mailto:mauryanishant2005@gmail.com)**

Call `cursor.reportBug()` in code or click **"Report Bug"** in the playground to automatically package full technical browser, viewport, and scroll diagnostics.

---

## 📄 License

MIT License © 2026 Nishant Maurya
