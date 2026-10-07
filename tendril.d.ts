export interface TendrilOptions {
  /** Primary cursor head & rope color (any CSS color string). Default: '#10b981' (Emerald Green) */
  color?: string;
  /** Secondary tail gradient color (auto-derived if null). Default: '#06b6d4' (Cyan) */
  secondaryColor?: string | null;
  /** CSS mix-blend-mode ('difference' | 'normal' | 'screen'). Note: 'screen' is additive and best used on dark backgrounds/themes. Default: 'difference' */
  mixBlendMode?: string;
  /** Number of physical joints along the rope (10 to 40). Default: 22 */
  segments?: number;
  /** Frame-rate independent lag constant in ms. Default: 36 */
  segTau?: number;
  /** Head droplet radius in px. Default: 14 */
  headRadius?: number;
  /** Tail tip radius in px. Default: 4 */
  tailRadius?: number;
  /** Tendon thickness in px. Default: 9 */
  strokeWidth?: number;
  /** SVG gooey viscosity blur radius. Default: 7 */
  gooeyBlur?: number;
  /** Alpha contrast multiplier for gooey threshold. Default: 34 */
  gooeyContrast?: number;
  /** Alpha cutoff offset. Default: -14 */
  gooeyOffset?: number;
  /** Stillness delay before harmonic breathing begins in ms. Default: 150 */
  idleTimeout?: number;
  /** Enables sinusoidal harmonic wave drift when stationary. Default: true */
  idleWobble?: boolean;
  /** Frequency of idle respiration. Default: 0.045 */
  idleSpeed?: number;
  /** Amplitude of idle wave drift in px. Default: 6 */
  idleAmplitude?: number;
  /** Head scale multiplier when over interactive elements. Default: 1.35 */
  hoverScale?: number;
  /** CSS selector for interactive elements. Default: 'a, button, [role="button"], input, textarea, select, label, .interactive, [data-cursor-hover]' */
  hoverSelector?: string;
  /** Radial ink burst on click. Default: true */
  splashOnClick?: boolean;
  /** Number of radial burst beads. Default: 7 */
  splashCount?: number;
  /** Gravitational liquid spill on click. Default: true */
  spillOnClick?: boolean;
  /** Number of falling liquid drops per spill. Default: 14 */
  spillCount?: number;
  /** Gravitational downward acceleration in px/frame^2. Default: 0.38 */
  gravity?: number;
  /** Fast falling drops shed trailing micro-droplets. Default: true */
  dripTrail?: boolean;
  /** Default startup anchor behavior ('off' | 'multi' | 'single'). 'off' = free floating until user anchors; 'multi' = starts anchored weaving; 'single' = starts anchored with single gliding pin. Default: 'off' */
  defaultAnchor?: 'off' | 'multi' | 'single';
  /** Optional custom starting position for the default anchor. If omitted, anchors at cursor entry point. Default: null */
  defaultAnchorPos?: { x: number; y: number } | null;
  /** Triple-tap to anchor tail and sever falling ropes. Default: true */
  tripleTapAnchor?: boolean;
  /** Anchor interaction mode ('multi' | 'single' | 'off'). Default: 'multi' */
  anchorMode?: 'multi' | 'single' | 'off';
  /** In 'single' mode: gentle smooth spring pull toward new anchor point. Default: 0.016 */
  anchorFollowStiffness?: number;
  /** In 'single' mode: viscous liquid damping. Default: 0.88 */
  anchorFollowDamping?: number;
  /** Allows planting multiple sequential stop checkpoints across the screen. Default: true */
  multiCheckpoints?: boolean;
  /** Maximum ms between taps to count as a triple-tap. Default: 480 */
  tripleTapMaxInterval?: number;
  /** Automatically blocks accidental text selection during rapid multi-taps. Default: false */
  preventTextSelectOnTap?: boolean;
  /** Max rope length in px (0 = auto-calculated). Default: 0 */
  ropeLength?: number;
  /** Dynamically incorporates the full page/document scrollable length to decide max rope length. Default: true */
  usePageLength?: boolean;
  /** Multiplier factor applied to scrollable page length. Default: 1.15 */
  pageLengthRatio?: number;
  /** Extra pixel offset capacity added to page/screen rope length. Default: 6000 */
  ropeLengthOffset?: number;
  /** General offset size of the rope (alias for ropeLengthOffset or base slack offset). Default: 6000 */
  offsetSize?: number;
  /** Maximum slack fraction when cursor is close to anchor pins. Default: 0.42 */
  ropeSlack?: number;
  /** Minimum base slack offset in px so short cords droop expressively. Default: 42 */
  ropeMinSlack?: number;
  /** Sensitivity multiplier for rope tightening and loosening (0.2 = loose/sluggish, 1.0 = standard, 2.5 = hyper-reactive). Default: 1.0 */
  ropeTensionSensitivity?: number;
  /** Downward gravity pull for anchored rope joints. Default: 0.42 */
  ropeGravity?: number;
  /** Velocity retention per frame for rope physics. Default: 0.955 */
  ropeDamping?: number;
  /** Number of Verlet constraint solver passes (higher = less stretchy). Default: 14 */
  ropeIterations?: number;
  /** Gravitational acceleration for detached ropes. Default: 0.65 */
  severedRopeGravity?: number;
  /** Air resistance for detached ropes. Default: 0.985 */
  severedRopeDrag?: number;
  /** Automatically hides native mouse cursor on desktop (not on touch). Default: true */
  hideNativeCursor?: boolean;
  /** Pre-allocated particle pool size. Default: 130 */
  maxParticles?: number;
  /** Maximum simultaneous falling severed ropes. Default: 6 */
  maxSeveredRopes?: number;
  /** CSS z-index priority. Default: 999999 */
  zIndex?: number;
  /** Auto-disables wobbles if user prefers reduced motion. Default: true */
  respectReducedMotion?: boolean;
  /** Force enable on touch screens (touch drag and tap supported by default). Default: false */
  forceTouch?: boolean;
}

export interface SpillOptions {
  /** X coordinate (defaults to current cursor position) */
  x?: number;
  /** Y coordinate (defaults to current cursor position) */
  y?: number;
  /** Number of drops to spawn. Default: 14 */
  count?: number;
  /** Launch velocity. Default: 5.0 */
  speed?: number;
  /** Drop radius scale multiplier. Default: 1.0 */
  size?: number;
  /** Gravity override */
  gravity?: number;
}

export interface CheckpointData {
  count: number;
  checkpoints: Array<{ x: number; y: number; el: SVGElement }>;
}

export class Tendril {
  constructor(options?: TendrilOptions);

  /** Initialize the cursor engine (called automatically in constructor) */
  init(): void;

  /** Set cursor colors dynamically */
  setColor(primary: string, secondary?: string | null): void;

  /** Set blend mode dynamically ('difference' | 'normal' | 'screen'). Note: 'screen' is additive cyber glow, best viewed in dark mode. */
  setBlendMode(mode: string): void;

  /** Set anchor mode dynamically ('multi' | 'single' | 'off') */
  setAnchorMode(mode: 'multi' | 'single' | 'off'): void;

  /** Get current anchor mode */
  getAnchorMode(): 'multi' | 'single' | 'off';

  /** Set default anchor mode dynamically ('off' | 'multi' | 'single') with optional starting coordinates */
  setDefaultAnchor(mode: 'off' | 'multi' | 'single', pos?: { x: number; y: number }): void;

  /** Get current default anchor mode */
  getDefaultAnchor(): 'off' | 'multi' | 'single';

  /** Update runtime configuration parameters live */
  setOptions(options: Partial<TendrilOptions>): void;

  /** Programmatically trigger a liquid spill */
  spill(options?: SpillOptions): void;
  spill(x?: number, y?: number, options?: SpillOptions): void;

  /** Plant a checkpoint / waypoint pin at coordinates (or cursor position) */
  addCheckpoint(x?: number, y?: number): void;

  /** Detach rope from all checkpoints and sever into falling Verlet gravity */
  releaseAllAndDrop(): void;

  /** Clear all checkpoints without dropping a severed rope */
  clearCheckpoints(): void;

  /** Toggle anchor mode shorthand (maintains backward compatibility) */
  toggleAnchor(x?: number, y?: number): void;

  /** Trigger bug report email to mauryanishant2005@gmail.com with attached diagnostics */
  reportBug(extraNote?: string): void;

  /** Callback fired when anchor / waypoint state changes */
  onAnchorChange?: (isAnchored: boolean, data: CheckpointData) => void;

  /** Clean up all DOM nodes, style elements, and event listeners */
  destroy(): void;

  static defaults: TendrilOptions;

  /** Static helper to launch bug report email to mauryanishant2005@gmail.com */
  static reportBug(extraNote?: string): void;
}

export default Tendril;
