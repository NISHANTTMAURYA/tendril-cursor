/**
 * Tendril.js (Liquid Rope & Ink Physics Engine)
 *
 * A high-performance physical cursor merging:
 *  - Ricardo Mendieta's "Ink Cursor"  → SVG gooey filter + text-inverting difference lens + harmonic idle respiration
 *  - Motion Bench's "Rope Cursor Trail" → frame-rate independent kinematics & Catmull-Rom splines
 *
 * Features:
 *  - 1st Triple-Tap: Anchors tail at that spot. As you move, the cord stretches across the screen with realistic catenary droop and Poisson thinning.
 *  - 2nd Triple-Tap: The stretched cord severs from cursor, becomes an independent physical rope, and falls down with Verlet gravity physics and smooth fade-out!
 *  - 1:1 natural pointer tracking with ZERO button trapping.
 *  - Anti-selection guard preventing rapid tap paragraph highlighting while keeping single click intact.
 *  - Zero-GC object pooling + auto-sleep when stationary.
 *
 * MIT License
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    var exp = factory();
    root.Tendril = exp;
    root.TendrilCursor = exp;
    root.LiquidRopeCursor = exp;
    root.HybridInkRopeCursor = exp;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // SSR Guard
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    function SSRStub() {}
    SSRStub.prototype.init = function() {};
    SSRStub.prototype.destroy = function() {};
    SSRStub.prototype.setColor = function() {};
    SSRStub.prototype.setOptions = function() {};
    SSRStub.prototype.setBlendMode = function() {};
    SSRStub.prototype.spill = function() {};
    SSRStub.prototype.toggleAnchor = function() {};
    SSRStub.reportBug = function() {};
    return SSRStub;
  }

  var DEFAULTS = {
    color: '#10b981',           // Emerald green primary
    secondaryColor: '#06b6d4',  // Cyan secondary
    mixBlendMode: 'difference', // Mendieta's iconic text-inverting lens

    // Rope kinematics
    segments: 26,               // Number of physical joints along the cord
    segTau: 36,                 // Per-segment lag in ms (frame-rate independent)
    headRadius: 14,             // Cursor pointer head radius (px)
    tailRadius: 4,              // Tail tip radius (px)
    strokeWidth: 9,             // Tendon thickness (px)

    // SVG Gooey Viscosity Filter
    gooeyBlur: 7,               // Viscosity blur radius
    gooeyContrast: 34,          // Alpha contrast multiplier
    gooeyOffset: -14,           // Alpha cutoff offset

    // Idle Respiration
    idleTimeout: 150,           // Stillness delay before harmonic breathing (ms)
    idleWobble: true,           // Sinusoidal wave drift when stationary
    idleSpeed: 0.045,           // Frequency of idle wave drift
    idleAmplitude: 6,           // Amplitude of idle wave drift (px)

    // Hover (Natural 1:1 mouse tracking — NO sticky button trapping)
    hoverScale: 1.35,           // Head scale multiplier when over interactive elements
    hoverSelector: 'a, button, [role="button"], input, textarea, select, label, .interactive, [data-cursor-hover]',

    // Click: Radial Ink Burst & Gravitational Spill
    splashOnClick: true,        // Radial ink burst on click
    splashCount: 7,             // Number of radial burst beads
    spillOnClick: true,         // Gravitational liquid spill on click
    spillCount: 14,             // Number of falling liquid drops
    gravity: 0.38,              // Gravitational acceleration (px/frame²)
    dripTrail: true,            // Fast falling drops shed trailing droplets

    // 2-Stage Triple-Tap Anchor & Multi-Waypoint Mechanics
    anchorMode: 'multi',        // 'multi' (multi-pin weaving) | 'single' (1 pin only; old pin glides to the new spot) | 'off' (disabled)
    tripleTapAnchor: true,      // Triple-Tap = Toggle Anchor / Sever & Drop
    tripleTapMaxInterval: 480,  // Maximum milliseconds across 3 taps
    multiCheckpoints: true,     // Single click while in Anchor mode drops additional pins (in 'multi' mode)
    anchorFollowStiffness: 0.016,// 'single' mode: gentle smooth spring pull toward new anchor point
    anchorFollowDamping: 0.88,  // 'single' mode: high viscous liquid damping to prevent snappy jumping and overshoot

    // Anchored Rope Physics (Verlet, inextensible, length-limited, water-like drag)
    ropeLength: 0,              // Max rope length in px (0 = auto ≈ page/screen length + offsetSize)
    usePageLength: true,        // Decide rope length using page/document scroll length (true by default)
    pageLengthRatio: 1.15,      // Multiplier factor for page length
    ropeLengthOffset: 6000,     // Extra pixel offset added to rope capacity (increased for massive full-page weaving)
    offsetSize: 6000,           // General offset size of the rope (alias for ropeLengthOffset or base slack offset)
    ropeSlack: 0.42,            // Maximum slack fraction when cursor is close to anchor (increased droop offset)
    ropeMinSlack: 42,           // Minimum base slack offset (px) so cords droop with expressive catenary curves
    ropeTensionSensitivity: 1.0,// Configurable sensitivity (0.2 = loose/sluggish, 1.0 = standard, 2.5 = hyper-reactive)
    ropeGravity: 0.42,          // Downward gravity pull for expressive catenary droop
    ropeDamping: 0.955,         // Velocity retention per frame (lower = thicker, more water-like)
    ropeIterations: 14,         // Constraint solver passes (higher = less stretchy)
    severedRopeGravity: 0.65,   // Gravitational downward pull for detached falling ropes
    severedRopeDrag: 0.985,     // Air resistance for detached ropes

    // System
    hideNativeCursor: true,     // Automatically hides native OS mouse cursor
    preventTextSelectOnTap: false,// When false (default), native multi-tap and triple-tap word/paragraph selection works
    maxParticles: 130,          // Pre-allocated particle pool size
    maxSeveredRopes: 5,         // Maximum simultaneous falling severed ropes
    zIndex: 999999,             // Layer priority
    respectReducedMotion: true,
    forceTouch: false,
    disableOnTouch: true        // Automatically disables cursor engine on mobile/touchscreen devices
  };

  /* ---------------- Color Utilities ---------------- */

  function toRGB(color) {
    var c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#000';
    c.fillStyle = color;
    var v = c.fillStyle;
    if (v.charAt(0) === '#') {
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    }
    var m = v.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [16, 185, 129];
  }

  function deriveSecondary(color) {
    var rgb = toRGB(color);
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2, d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    h = (h + 35) % 360;
    l = Math.min(0.72, l + 0.10);
    return 'hsl(' + h.toFixed(0) + ',' + (s * 100).toFixed(0) + '%,' + (l * 100).toFixed(0) + '%)';
  }

  function r1(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  /* ---------------- Tendril Engine Class ---------------- */

  function Tendril(options) {
    if (!(this instanceof Tendril)) return new Tendril(options);

    this.opts = Object.assign({}, DEFAULTS, options || {});
    if (!this.opts.secondaryColor) {
      this.opts.secondaryColor = deriveSecondary(this.opts.color);
    }

    this.id = 'tendril_' + Math.random().toString(36).substr(2, 9);
    this.target = { x: -200, y: -200 };
    this.headScale = 1;
    this.targetHeadScale = 1;
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;

    this.idle = false;
    this.idleTimer = null;
    this.lastTime = 0;
    this.running = false;
    this.started = false;
    this.hidden = false;
    this.activeCount = 0;

    // Anchor & Multi-Checkpoint State
    this.isAnchored = false;
    this.anchor = { x: 0, y: 0 };
    this.checkpoints = [];
    this.completedSpans = [];
    this.tapHistory = [];
    this._singleClickTimer = null;
    this.severedRopes = [];

    this.scrollX = window.scrollX || window.pageXOffset || 0;
    this.scrollY = window.scrollY || window.pageYOffset || 0;

    // Bound handlers
    this._move = this._move.bind(this);
    this._down = this._down.bind(this);
    this._up = this._up.bind(this);
    this._touchDown = this._touchDown.bind(this);
    this._touchMove = this._touchMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onSelectStart = this._onSelectStart.bind(this);
    this._over = this._over.bind(this);
    this._out = this._out.bind(this);
    this._vis = this._vis.bind(this);
    this._resize = this._resize.bind(this);
    this._scroll = this._scroll.bind(this);
    this._tick = this._tick.bind(this);

    this.init();
  }

  Tendril.prototype.init = function () {
    var isTouchDevice = (
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) ||
      ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0 && !window.matchMedia('(any-pointer: fine)').matches)
    );

    // Completely disable on mobile/touchscreen devices
    if (this.opts.disableOnTouch && isTouchDevice && !this.opts.forceTouch) {
      this.initialized = false;
      return;
    }

    // Only hide native OS cursor on desktop (fine pointers)
    if (this.opts.hideNativeCursor && !isTouchDevice) {
      this._applyHideNativeCursor();
    }

    if (this.opts.respectReducedMotion && window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.opts.idleWobble = false;
      this.opts.spillOnClick = false;
      this.opts.splashOnClick = false;
    }

    this._buildDOM();
    this._buildRope();
    this._buildPool();

    window.addEventListener('pointermove', this._move, { passive: true });
    window.addEventListener('pointerdown', this._down, { passive: false });
    window.addEventListener('pointerup', this._up, { passive: true });
    window.addEventListener('touchstart', this._touchDown, { passive: true });
    window.addEventListener('touchmove', this._touchMove, { passive: true });
    window.addEventListener('touchend', this._up, { passive: true });
    window.addEventListener('mousedown', this._onMouseDown, { passive: false, capture: true });
    window.addEventListener('selectstart', this._onSelectStart, { passive: false, capture: true });
    window.addEventListener('resize', this._resize, { passive: true });
    window.addEventListener('scroll', this._scroll, { passive: true });
    document.addEventListener('pointerover', this._over, { passive: true });
    document.addEventListener('pointerout', this._out, { passive: true });
    document.addEventListener('visibilitychange', this._vis);

    this.initialized = true;
    this._wake();
  };

  Tendril.prototype._applyHideNativeCursor = function () {
    if (!this.cursorStyleEl) {
      this.cursorStyleEl = document.createElement('style');
      this.cursorStyleEl.id = this.id + '_hide_cursor';
      this.cursorStyleEl.textContent = 'html, body, a, button, input, textarea, select, label { cursor: none !important; }';
      document.head.appendChild(this.cursorStyleEl);
    }
  };

  Tendril.prototype._removeHideNativeCursor = function () {
    if (this.cursorStyleEl && this.cursorStyleEl.parentNode) {
      this.cursorStyleEl.parentNode.removeChild(this.cursorStyleEl);
      this.cursorStyleEl = null;
    }
  };

  Tendril.prototype._buildDOM = function () {
    var o = this.opts;
    this.filterId = this.id + '_goo';
    this.gradId = this.id + '_grad';

    var wrap = document.createElement('div');
    wrap.id = this.id + '_wrap';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = [
      'position: fixed',
      'inset: 0',
      'width: 100vw',
      'height: 100vh',
      'pointer-events: none',
      'overflow: hidden',
      'contain: strict',
      'z-index: ' + o.zIndex,
      'mix-blend-mode: ' + o.mixBlendMode,
      'transform: translate3d(0, 0, 0)',
      'will-change: transform'
    ].join(';') + ';';

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;';

    var blurVal = o.gooeyBlur;
    var matrixOffset = Math.max(-13, Math.min(-9, -15 + (blurVal * 0.5)));

    svg.innerHTML =
      '<defs>' +
        '<filter id="' + this.filterId + '" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">' +
          '<feGaussianBlur in="SourceGraphic" stdDeviation="' + blurVal + '" result="blur"/>' +
          '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ' +
            o.gooeyContrast + ' ' + matrixOffset + '" result="goo"/>' +
          '<feComposite in="SourceGraphic" in2="goo" operator="atop"/>' +
        '</filter>' +
        '<linearGradient id="' + this.gradId + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="0">' +
          '<stop offset="0%" stop-color="' + o.color + '"/>' +
          '<stop offset="100%" stop-color="' + o.secondaryColor + '"/>' +
        '</linearGradient>' +
      '</defs>';

    var g = document.createElementNS(NS, 'g');
    g.setAttribute('filter', 'url(#' + this.filterId + ')');

    // Layer 1: Severed falling ropes
    this.severedGroup = document.createElementNS(NS, 'g');
    g.appendChild(this.severedGroup);

    // Layer 2: Main Kinematic Rope Path
    var rope = document.createElementNS(NS, 'path');
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', 'url(#' + this.gradId + ')');
    rope.setAttribute('stroke-width', o.strokeWidth);
    rope.setAttribute('stroke-linecap', 'round');
    rope.setAttribute('stroke-linejoin', 'round');

    // Layer 3: Rope node circles
    this.nodeGroup = document.createElementNS(NS, 'g');

    // Layer 4: Liquid particles
    this.liquidGroup = document.createElementNS(NS, 'g');
    this.liquidGroup.setAttribute('fill', o.color);

    // Layer 5: Visual Checkpoint / Anchor Pins Group
    this.checkpointGroup = document.createElementNS(NS, 'g');

    g.appendChild(rope);
    g.appendChild(this.nodeGroup);
    g.appendChild(this.liquidGroup);
    g.appendChild(this.checkpointGroup);

    svg.appendChild(g);
    wrap.appendChild(svg);
    document.body.appendChild(wrap);

    this.wrap = wrap;
    this.svg = svg;
    this.g = g;
    this.rope = rope;
    this.grad = svg.querySelector('#' + this.gradId);
  };

  Tendril.prototype._buildRope = function () {
    var o = this.opts, n = o.segments;
    this.points = [];
    this.nodes = [];
    this.completedSpans = [];

    while (this.nodeGroup.firstChild) {
      this.nodeGroup.removeChild(this.nodeGroup.firstChild);
    }

    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var r = o.headRadius + (o.tailRadius - o.headRadius) * Math.pow(t, 0.75);

      this.points.push({
        x: -200, y: -200,
        px: -200, py: -200,
        radius: r,
        ax: Math.random() * 6.28,
        ay: Math.random() * 6.28
      });

      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', r1(r));
      circle.setAttribute('fill', i === 0 ? o.color : o.secondaryColor);
      this.nodeGroup.appendChild(circle);
      this.nodes.push(circle);
    }
  };

  Tendril.prototype._buildPool = function () {
    this.pool = [];
    while (this.liquidGroup.firstChild) {
      this.liquidGroup.removeChild(this.liquidGroup.firstChild);
    }

    for (var i = 0; i < this.opts.maxParticles; i++) {
      var c = document.createElementNS(NS, 'circle');
      c.style.display = 'none';
      this.liquidGroup.appendChild(c);
      this.pool.push({
        el: c,
        active: false,
        kind: 0,
        x: 0, y: 0,
        vx: 0, vy: 0,
        r: 0,
        life: 0,
        decay: 0,
        gravity: null
      });
    }
  };

  /* ---------------- Input & Event Handlers ---------------- */

  Tendril.prototype._move = function (e) {
    this.target.x = e.clientX;
    this.target.y = e.clientY;

    if (!this.started) {
      this.started = true;
      for (var i = 0; i < this.points.length; i++) {
        this.points[i].x = this.target.x;
        this.points[i].y = this.target.y;
        this.points[i].px = this.target.x;
        this.points[i].py = this.target.y;
      }
    }

    this.idle = false;
    clearTimeout(this.idleTimer);
    var self = this;
    this.idleTimer = setTimeout(function () {
      self.idle = true;
      self._wake();
    }, this.opts.idleTimeout);

    this._wake();
  };

  Tendril.prototype._clearSelection = function () {
    try {
      if (window.getSelection) {
        var sel = window.getSelection();
        if (sel) {
          if (sel.removeAllRanges) sel.removeAllRanges();
          if (sel.empty) sel.empty();
        }
      }
      if (document.selection && document.selection.empty) {
        document.selection.empty();
      }
    } catch (e) {}
  };

  Tendril.prototype._isInteractive = function (t) {
    if (!t) return false;
    var tag = t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'label') return true;
    if (t.isContentEditable) return true;
    if (t.closest && t.closest('button, a, input, textarea, select, label, [role="button"], .interactive, [data-cursor-hover], .lens-pill, .btn-pill, .tab-btn, .copy-btn, .copy-prompt-btn, .theme-toggle-btn, .color-swatch, .action-btn-primary, .action-btn-secondary, .HoverButton')) return true;
    return false;
  };

  Tendril.prototype._isTextInput = function (t) {
    if (!t) return false;
    var tag = t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (t.isContentEditable) return true;
    if (t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return true;
    return false;
  };

  /**
   * Temporarily disables text selection page-wide (used from the 2nd rapid tap onward,
   * so double/triple-click word/paragraph highlighting can never kick in).
   * Normal single click + drag selection stays untouched.
   */
  Tendril.prototype._lockSelection = function (ms) {
    if (!this.opts.preventTextSelectOnTap) return;
    if (!this.selLockStyleEl) {
      this.selLockStyleEl = document.createElement('style');
      this.selLockStyleEl.id = this.id + '_nosel';
      this.selLockStyleEl.textContent =
        'html.' + this.id + '_nosel, html.' + this.id + '_nosel * {' +
        '-webkit-user-select: none !important; user-select: none !important;' +
        '-webkit-touch-callout: none !important; }';
      document.head.appendChild(this.selLockStyleEl);
    }
    document.documentElement.classList.add(this.id + '_nosel');
    this._clearSelection();
    clearTimeout(this._selLockTimer);
    var self = this;
    this._selLockTimer = setTimeout(function () {
      self._unlockSelection();
    }, ms || 700);
  };

  Tendril.prototype._unlockSelection = function () {
    clearTimeout(this._selLockTimer);
    this._selLockTimer = null;
    document.documentElement.classList.remove(this.id + '_nosel');
  };

  Tendril.prototype._onMouseDown = function (e) {
    if (this._isTextInput(e.target)) return;
    // Detail >= 2 is rapid double-click or triple-click: prevent browser from selecting text
    if (e.detail >= 2) {
      if (e.cancelable && e.preventDefault) e.preventDefault();
      this._clearSelection();
      this._lockSelection(1000);
    }
  };

  Tendril.prototype._onSelectStart = function (e) {
    if (this._isTextInput(e.target)) return;
    var now = performance.now();
    var recentTap = this._lastTapTime && (now - this._lastTapTime < 600);
    if (recentTap || this.isAnchored || this.tapHistory.length > 1) {
      if (e.cancelable && e.preventDefault) e.preventDefault();
      this._clearSelection();
    }
  };

  Tendril.prototype._down = function (e) {
    if (!this.started) this._move(e);
    var x = e.clientX, y = e.clientY;
    var now = performance.now();
    if (this._isTextInput(e.target) || (e.target.closest && e.target.closest('[data-no-anchor]'))) return;

    // Rapid repeat tap (2nd / 3rd of a multi-tap) → lock selection BEFORE the browser's
    // mousedown runs its word/paragraph selection. (Do NOT preventDefault pointerdown:
    // that suppresses the compat mousedown but does not stop selection.)
    if (this._lastTapTime && now - this._lastTapTime < this.opts.tripleTapMaxInterval) {
      this._lockSelection();
    }
    this._lastTapTime = now;

    // If anchor mode is completely 'off', skip all anchoring logic and do normal splash/spill
    if (this.opts.anchorMode === 'off') {
      if (this.opts.splashOnClick) this._splash(x, y);
      if (this.opts.spillOnClick) this.spill(x, y);
      this.headScale = this.targetHeadScale * 0.65;
      this._wake();
      return;
    }

    var isInteractive = this._isInteractive(e.target);

    // Interactive elements (buttons, links, cards) NEVER trigger triple-tap severing:
    if (isInteractive) {
      this.tapHistory.length = 0;
    } else if (this.opts.tripleTapAnchor) {
      this.tapHistory.push({ time: now, x: x, y: y });
      if (this.tapHistory.length > 3) this.tapHistory.shift();

      // Check for 3 rapid taps on blank background canvas
      if (this.tapHistory.length === 3) {
        var t0 = this.tapHistory[0], t2 = this.tapHistory[2];
        var timeSpan = t2.time - t0.time;
        var dist = Math.hypot(t2.x - t0.x, t2.y - t0.y);

        if (timeSpan <= this.opts.tripleTapMaxInterval && dist < 75) {
          this.tapHistory.length = 0;
          if (this._singleClickTimer) {
            clearTimeout(this._singleClickTimer);
            this._singleClickTimer = null;
          }
          this._clearSelection();
          if (window.getSelection) {
            var sel = window.getSelection();
            if (sel && sel.removeAllRanges) sel.removeAllRanges();
          }
          this._lockSelection(1200);

          if (!this.isAnchored) {
            // Triple-Tap 1: Start Anchor Mode (Plant 1st Pin)
            this.addCheckpoint(x, y);
          } else {
            // Triple-Tap 2: Final Release on blank background!
            this.releaseAllAndDrop();
          }

          this._wake();
          return;
        }
      }
    }

    // While already in Anchor mode, single click behavior:
    if (this.isAnchored) {
      // Trigger liquid splash & spill on click even while in anchor mode
      if (this.opts.splashOnClick) this._splash(x, y);
      if (this.opts.spillOnClick) this.spill(x, y);
      this.headScale = this.targetHeadScale * 0.65;

      if (this._singleClickTimer) {
        clearTimeout(this._singleClickTimer);
        this._singleClickTimer = null;
      }
      var self = this;
      this._singleClickTimer = setTimeout(function () {
        self._singleClickTimer = null;
        if (self.isAnchored) {
          if (self.opts.anchorMode === 'multi' && self.opts.multiCheckpoints) {
            self.addCheckpoint(x, y);
            self._wake();
          } else if (self.opts.anchorMode === 'single') {
            // In single anchor mode, new anchor breaks old anchor and takes over!
            self.addCheckpoint(x, y);
            self._wake();
          }
        }
      }, 240);
      return;
    }

    // Normal Click: Splash & Spill
    if (this.opts.splashOnClick) this._splash(x, y);
    if (this.opts.spillOnClick) this.spill(x, y);
    this.headScale = this.targetHeadScale * 0.65;
    this._wake();
  };

  Tendril.prototype._up = function () {
    this.headScale = 1;
    if (this._selLockTimer) this._clearSelection();
    this._wake();
  };

  Tendril.prototype._touchDown = function (e) {
    if (!e.touches || !e.touches[0]) return;
    var t = e.touches[0];
    // Route touch down through the full anchor, spill, and physics pipeline
    this._down({
      clientX: t.clientX,
      clientY: t.clientY,
      target: e.target,
      detail: 1,
      cancelable: e.cancelable,
      preventDefault: function() { if (e.cancelable && e.preventDefault) e.preventDefault(); }
    });
  };

  Tendril.prototype._touchMove = function (e) {
    if (!e.touches || !e.touches[0]) return;
    var t = e.touches[0];
    this._move({ clientX: t.clientX, clientY: t.clientY });
  };

  Tendril.prototype._over = function (e) {
    if (e.target.closest && e.target.closest(this.opts.hoverSelector)) {
      this.targetHeadScale = this.opts.hoverScale;
      this._wake();
    }
  };

  Tendril.prototype._out = function (e) {
    var to = e.relatedTarget;
    if (!to || !to.closest || !to.closest(this.opts.hoverSelector)) {
      this.targetHeadScale = 1;
      this._wake();
    }
  };

  Tendril.prototype._vis = function () {
    this.hidden = document.hidden;
    if (!this.hidden) this._wake();
  };

  Tendril.prototype._resize = function () {
    this.viewH = window.innerHeight;
    this.viewW = window.innerWidth;
  };

  Tendril.prototype._scroll = function () {
    var curX = window.scrollX || window.pageXOffset || 0;
    var curY = window.scrollY || window.pageYOffset || 0;
    var dx = curX - this.scrollX;
    var dy = curY - this.scrollY;
    this.scrollX = curX;
    this.scrollY = curY;

    if (dx === 0 && dy === 0) return;

    // Shift planted checkpoints so they stay locked to page content instead of viewport
    if (this.checkpoints && this.checkpoints.length > 0) {
      for (var i = 0; i < this.checkpoints.length; i++) {
        var cp = this.checkpoints[i];
        cp.x -= dx;
        cp.y -= dy;
        if (cp.tx !== undefined) { cp.tx -= dx; cp.ty -= dy; }
        if (cp.el) {
          cp.el.setAttribute('cx', r1(cp.x));
          cp.el.setAttribute('cy', r1(cp.y));
        }
      }
      this.anchor.x -= dx;
      this.anchor.y -= dy;

      // Also adjust frozen completed spans
      if (this.completedSpans && this.completedSpans.length > 0) {
        for (var s = 0; s < this.completedSpans.length; s++) {
          var span = this.completedSpans[s];
          for (var p = 0; p < span.length; p++) {
            span[p].x -= dx;
            span[p].y -= dy;
            span[p].px -= dx;
            span[p].py -= dy;
          }
        }
      }

      // Also adjust anchored joints of the active rope (head stays at cursor, tail and body shift)
      if (this.isAnchored && this.points) {
        var nPts = this.points.length;
        for (var j = 1; j < nPts; j++) {
          var weight = j / (nPts - 1);
          this.points[j].x -= dx * weight;
          this.points[j].y -= dy * weight;
          this.points[j].px -= dx * weight;
          this.points[j].py -= dy * weight;
        }
      }
    }

    // Offset severed falling ropes with page scroll
    if (this.severedRopes && this.severedRopes.length > 0) {
      for (var r = 0; r < this.severedRopes.length; r++) {
        var sr = this.severedRopes[r];
        if (!sr.active) continue;
        for (var ptIdx = 0; ptIdx < sr.pts.length; ptIdx++) {
          sr.pts[ptIdx].x -= dx;
          sr.pts[ptIdx].y -= dy;
          sr.pts[ptIdx].px -= dx;
          sr.pts[ptIdx].py -= dy;
        }
      }
    }

    // Offset liquid droplets with scroll
    if (this.pool && this.activeCount > 0) {
      for (var pi = 0; pi < this.pool.length; pi++) {
        var part = this.pool[pi];
        if (part.active) {
          part.x -= dx;
          part.y -= dy;
        }
      }
    }

    this._wake();
  };

  /* ---------------- Multi-Checkpoint Architecture ---------------- */

  /**
   * Set Anchor Mode: 'multi' (multi-pin weaving) | 'single' (1 pin only; old pin glides to new spot) | 'off' (disabled)
   */
  Tendril.prototype.setAnchorMode = function (mode) {
    if (mode !== 'multi' && mode !== 'single' && mode !== 'off') {
      console.warn('Tendril: Invalid anchorMode "' + mode + '". Use "multi", "single", or "off".');
      return;
    }
    this.opts.anchorMode = mode;
    this.tapHistory.length = 0;
    if (this._singleClickTimer) {
      clearTimeout(this._singleClickTimer);
      this._singleClickTimer = null;
    }

    if (mode === 'off') {
      // Turning anchoring off simply lets go of the rope: it falls away naturally
      if (this.isAnchored) {
        this.releaseAllAndDrop();
      }
    } else if (mode === 'single') {
      // Only 1 pin allowed: keep the latest pin + live span, drop the older woven spans as a falling rope
      if (this.checkpoints.length > 1) {
        var oldPts = [];
        for (var k = this.completedSpans.length - 1; k >= 0; k--) {
          var span = this.completedSpans[k];
          for (var j = (k === this.completedSpans.length - 1 ? 0 : 1); j < span.length; j++) {
            oldPts.push(span[j]);
          }
        }
        if (oldPts.length > 1) this._spawnSeveredRope(oldPts);
        while (this.checkpoints.length > 1) {
          var old = this.checkpoints.shift();
          this._splash(old.x, old.y);
          if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
        }
        this.completedSpans.length = 0;
        this.anchor.x = this.checkpoints[0].x;
        this.anchor.y = this.checkpoints[0].y;
      }
    }

    if (typeof this.onAnchorModeChange === 'function') {
      try {
        this.onAnchorModeChange(mode);
      } catch (e) {
        console.warn(e);
      }
    }

    this._wake();
  };

  Tendril.prototype.getAnchorMode = function () {
    return this.opts.anchorMode;
  };

  /**
   * Add an anchor checkpoint / pin at (x, y)
   * Supports 'multi' (chains waypoints), 'single' (old pin glides to the new spot, rope stays attached), and 'off'
   */
  Tendril.prototype.addCheckpoint = function (x, y) {
    if (this.opts.anchorMode === 'off') return;

    x = typeof x === 'number' ? x : this.target.x;
    y = typeof y === 'number' ? y : this.target.y;

    var wasFree = !this.isAnchored || this.checkpoints.length === 0;

    // --- SINGLE ANCHOR MODE LOGIC ---
    if (this.opts.anchorMode === 'single') {
      if (!wasFree && this.checkpoints.length > 0) {
        // Keep only the newest pin, then send it gliding to the new spot WITHOUT breaking the rope
        while (this.checkpoints.length > 1) {
          var extra = this.checkpoints.shift();
          if (extra.el && extra.el.parentNode) extra.el.parentNode.removeChild(extra.el);
        }
        this.completedSpans.length = 0;

        var cp = this.checkpoints[0];
        cp.tx = x;
        cp.ty = y;
        if (cp.vx === undefined) { cp.vx = 0; cp.vy = 0; }
        this.anchor.x = x;
        this.anchor.y = y;
        this._splash(x, y);

        if (typeof this.onAnchorChange === 'function') {
          try {
            this.onAnchorChange(true, {
              mode: 'single',
              count: this.checkpoints.length,
              checkpoints: this.checkpoints,
              moved: true
            });
          } catch (err) {
            console.warn(err);
          }
        }
        this._wake();
        return;
      }

      // First pin in single mode
      this.isAnchored = true;
      this.anchor.x = x;
      this.anchor.y = y;

      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', r1(x));
      circle.setAttribute('cy', r1(y));
      circle.setAttribute('r', (this.opts.headRadius * 1.2).toFixed(1));
      circle.setAttribute('fill', this.opts.color);
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', '2.5');
      this.checkpointGroup.appendChild(circle);

      this.checkpoints.push({ x: x, y: y, el: circle });

      // Start new active rope with tail anchored at (x, y)
      this.completedSpans = [];
      var lastIdx = this.points.length - 1;
      this.points[lastIdx].x = x;
      this.points[lastIdx].y = y;
      this.points[lastIdx].px = x;
      this.points[lastIdx].py = y;
      var h = this.points[0];
      for (var pIdx = 1; pIdx < lastIdx; pIdx++) {
        var frac = pIdx / lastIdx;
        var mx = h.x + (x - h.x) * frac;
        var my = h.y + (y - h.y) * frac + Math.sin(frac * Math.PI) * 20;
        this.points[pIdx].x = mx;
        this.points[pIdx].y = my;
        this.points[pIdx].px = mx;
        this.points[pIdx].py = my;
      }

      this._splash(x, y);
      this._clearSelection();

      if (typeof this.onAnchorChange === 'function') {
        try {
          this.onAnchorChange(true, {
            mode: 'single',
            count: this.checkpoints.length,
            checkpoints: this.checkpoints
          });
        } catch (err) {
          console.warn(err);
        }
      }
      this._wake();
      return;
    }

    // --- MULTI ANCHOR MODE LOGIC ---
    this.isAnchored = true;
    this.anchor.x = x;
    this.anchor.y = y;

    // SVG Pin Circle
    var circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', r1(x));
    circle.setAttribute('cy', r1(y));
    circle.setAttribute('r', (this.opts.headRadius * 1.2).toFixed(1));
    circle.setAttribute('fill', this.opts.color);
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '2.5');
    this.checkpointGroup.appendChild(circle);

    this.checkpoints.push({ x: x, y: y, el: circle });

    // When first entering anchor mode, initialize intermediate points
    if (wasFree) {
      this.completedSpans = [];
      var h = this.points[0];
      var lastIdx = this.points.length - 1;
      this.points[lastIdx].x = x;
      this.points[lastIdx].y = y;
      this.points[lastIdx].px = x;
      this.points[lastIdx].py = y;

      for (var pIdx = 1; pIdx < lastIdx; pIdx++) {
        var frac = pIdx / lastIdx;
        var mx = h.x + (x - h.x) * frac;
        var my = h.y + (y - h.y) * frac + Math.sin(frac * Math.PI) * 25;
        this.points[pIdx].x = mx;
        this.points[pIdx].y = my;
        this.points[pIdx].px = mx;
        this.points[pIdx].py = my;
      }
    } else {
      // Planting an additional anchor at (x, y) with ZERO jitter:
      // 1. Freeze current active span into completedSpans exactly as it rests
      var frozenSpan = [];
      for (var i = 0; i < this.points.length; i++) {
        var pt = this.points[i];
        frozenSpan.push({
          x: pt.x, y: pt.y,
          px: pt.px, py: pt.py,
          radius: pt.radius,
          ax: pt.ax, ay: pt.ay
        });
      }
      frozenSpan[0].x = x;
      frozenSpan[0].y = y;
      frozenSpan[0].px = x;
      frozenSpan[0].py = y;

      // Freeze current active span into completedSpans exactly as it rests
      var prevPin = this.checkpoints[this.checkpoints.length - 2];
      if (prevPin) {
        var lIdx = frozenSpan.length - 1;
        frozenSpan[lIdx].x = prevPin.x;
        frozenSpan[lIdx].y = prevPin.y;
        frozenSpan[lIdx].px = prevPin.x;
        frozenSpan[lIdx].py = prevPin.y;
      }
      this.completedSpans.push(frozenSpan);

      // 2. Initialize new active span starting at (x, y) with zero velocity jump
      for (var sIdx = 0; sIdx < this.points.length; sIdx++) {
        this.points[sIdx].x = x;
        this.points[sIdx].y = y;
        this.points[sIdx].px = x;
        this.points[sIdx].py = y;
      }

      // FIFO Anchor Conservation: Enforce max rope length calculated from screen size
      var maxRope = this._ropeLength();
      var totalChord = 0;
      for (var c = 0; c < this.completedSpans.length; c++) {
        var pA = this.checkpoints[c];
        var pB = this.checkpoints[c + 1];
        if (pA && pB) {
          totalChord += Math.hypot(pB.x - pA.x, pB.y - pA.y);
        }
      }

      // Pop oldest pins and spans in FIFO order if total rope length exceeds screen limit
      while (this.checkpoints.length > 2 && totalChord > maxRope) {
        var p0 = this.checkpoints[0];
        var p1 = this.checkpoints[1];
        var spanDist = (p0 && p1) ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;

        // Remove oldest pin element from DOM
        var oldPin = this.checkpoints.shift();
        if (oldPin && oldPin.el && oldPin.el.parentNode) {
          oldPin.el.parentNode.removeChild(oldPin.el);
        }

        // Remove oldest completed span
        this.completedSpans.shift();
        totalChord -= spanDist;
      }

      if (this.checkpoints.length > 0) {
        this.anchor.x = this.checkpoints[0].x;
        this.anchor.y = this.checkpoints[0].y;
      }
    }

    // Anchor burst
    this._splash(x, y);
    this._clearSelection();

    if (typeof this.onAnchorChange === 'function') {
      try {
        this.onAnchorChange(true, {
          mode: 'multi',
          count: this.checkpoints.length,
          checkpoints: this.checkpoints
        });
      } catch (err) {
        console.warn(err);
      }
    }

    this._wake();
  };

  /**
   * Final Release: Sever all checkpoints & let the entire threaded rope fall with Verlet physics!
   */
  Tendril.prototype.releaseAllAndDrop = function () {
    if (!this.isAnchored && this.checkpoints.length === 0) return;

    this._severAndDropRope();

    // Clear all visual checkpoint nodes
    while (this.checkpointGroup.firstChild) {
      this.checkpointGroup.removeChild(this.checkpointGroup.firstChild);
    }
    this.checkpoints.length = 0;
    this.completedSpans = [];
    this.isAnchored = false;
    this._clearSelection();

    if (typeof this.onAnchorChange === 'function') {
      try {
        this.onAnchorChange(false, { count: 0, checkpoints: [] });
      } catch (err) {
        console.warn(err);
      }
    }

    this._wake();
  };

  /**
   * Clear all checkpoints without dropping a severed rope
   */
  Tendril.prototype.clearCheckpoints = function () {
    if (this._singleClickTimer) {
      clearTimeout(this._singleClickTimer);
      this._singleClickTimer = null;
    }
    while (this.checkpointGroup.firstChild) {
      this.checkpointGroup.removeChild(this.checkpointGroup.firstChild);
    }
    this.checkpoints.length = 0;
    this.completedSpans = [];
    this.isAnchored = false;
    this._clearSelection();

    if (typeof this.onAnchorChange === 'function') {
      try {
        this.onAnchorChange(false, { count: 0, checkpoints: [] });
      } catch (err) {
        console.warn(err);
      }
    }

    this._wake();
  };

  /**
   * Toggle Anchor shorthand (Maintains backward compatibility)
   */
  Tendril.prototype.toggleAnchor = function (x, y) {
    if (this.opts.anchorMode === 'off') return;
    if (!this.isAnchored) {
      this.addCheckpoint(x, y);
    } else {
      this.releaseAllAndDrop();
    }
  };

  /**
   * Drops the current stretched cord as an independent falling rope with Verlet physics
   * Preserves the exact instantaneous shape of the woven cord across all anchor waypoints!
   */
  Tendril.prototype._severAndDropRope = function () {
    var allPts = [];
    if (!this.isAnchored || this.checkpoints.length === 0) {
      allPts = this.points;
    } else {
      for (var i = 0; i < this.points.length; i++) {
        allPts.push(this.points[i]);
      }
      for (var k = this.completedSpans.length - 1; k >= 0; k--) {
        var span = this.completedSpans[k];
        for (var j = 1; j < span.length; j++) {
          allPts.push(span[j]);
        }
      }
    }

    this._spawnSeveredRope(allPts);

    // Liquid bursts at cursor head and every single active checkpoint location
    this._splash(this.target.x, this.target.y);
    for (var cpIdx = 0; cpIdx < this.checkpoints.length; cpIdx++) {
      this._splash(this.checkpoints[cpIdx].x, this.checkpoints[cpIdx].y);
    }
    this.spill(this.target.x, this.target.y, { count: 14, speed: 5.0 });

    // Cursor instantly resets to mouse position with fresh free tail
    for (var m = 0; m < this.points.length; m++) {
      this.points[m].x = this.target.x;
      this.points[m].y = this.target.y;
      this.points[m].px = this.target.x;
      this.points[m].py = this.target.y;
    }

    if (this.severedRopes.length > this.opts.maxSeveredRopes) {
      var oldest = this.severedRopes.shift();
      this._destroySeveredRope(oldest);
    }
  };

  /**
   * Turns an array of rope points into an independent falling Verlet rope (keeps shape + momentum)
   */
  Tendril.prototype._spawnSeveredRope = function (allPts) {
    var severedPts = [];
    var segRestLens = [];
    for (var i = 0; i < allPts.length; i++) {
      var p = allPts[i];
      var vx = (p.x - p.px) || 0;
      var vy = (p.y - p.py) || 0;
      severedPts.push({
        x: p.x,
        y: p.y,
        px: p.x - vx * 0.75,
        py: p.y - vy * 0.75,
        radius: p.radius || 6
      });
    }

    // Preserve the EXACT instantaneous distance of each segment so it falls in the identical shape!
    for (var k = 0; k < severedPts.length - 1; k++) {
      var d = Math.hypot(severedPts[k + 1].x - severedPts[k].x, severedPts[k + 1].y - severedPts[k].y);
      segRestLens.push(Math.max(4, d));
    }

    var path = document.createElementNS(NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', this.opts.color);
    path.setAttribute('stroke-width', r1(Math.max(13, this.opts.strokeWidth * 1.35)));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    this.severedGroup.appendChild(path);

    var nodeGroup = document.createElementNS(NS, 'g');
    var circleEls = [];
    for (var j = 0; j < severedPts.length; j++) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', r1(severedPts[j].radius));
      c.setAttribute('fill', j === 0 ? this.opts.color : this.opts.secondaryColor);
      nodeGroup.appendChild(c);
      circleEls.push(c);
    }
    this.severedGroup.appendChild(nodeGroup);

    this.severedRopes.push({
      pts: severedPts,
      path: path,
      nodeGroup: nodeGroup,
      circleEls: circleEls,
      segRestLens: segRestLens,
      segRestLen: segRestLens[0] || 14,
      life: 1.0,
      active: true
    });

    if (this.severedRopes.length > this.opts.maxSeveredRopes) {
      this._destroySeveredRope(this.severedRopes.shift());
    }
    this._wake();
  };

  Tendril.prototype._destroySeveredRope = function (sr) {
    if (sr.path && sr.path.parentNode) sr.path.parentNode.removeChild(sr.path);
    if (sr.nodeGroup && sr.nodeGroup.parentNode) sr.nodeGroup.parentNode.removeChild(sr.nodeGroup);
    sr.active = false;
  };

  /* ---------------- Particle Spawning & Standalone Spill ---------------- */

  Tendril.prototype._spawn = function (kind, x, y, vx, vy, r, decay) {
    for (var i = 0; i < this.pool.length; i++) {
      var p = this.pool[i];
      if (!p.active) {
        p.active = true; p.kind = kind;
        p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.r = r; p.life = 1; p.decay = decay;
        p.el.style.display = '';
        this.activeCount++;
        return p;
      }
    }
    return null;
  };

  Tendril.prototype._splash = function (x, y) {
    var n = this.opts.splashCount;
    var blurBoost = Math.max(1, this.opts.gooeyBlur / 6.5);
    for (var i = 0; i < n; i++) {
      var a = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.5;
      var s = 2.5 + Math.random() * 3;
      var r = (5 + Math.random() * 3.5) * blurBoost;
      this._spawn(1, x, y, Math.cos(a) * s, Math.sin(a) * s, r, 0.05 + Math.random() * 0.02);
    }
  };

  Tendril.prototype.spill = function (arg1, arg2, arg3) {
    if (!this.initialized) return;

    var x, y, opts = {};
    if (typeof arg1 === 'object' && arg1 !== null) {
      opts = arg1;
      x = opts.x !== undefined ? opts.x : this.target.x;
      y = opts.y !== undefined ? opts.y : this.target.y;
    } else {
      x = typeof arg1 === 'number' ? arg1 : this.target.x;
      y = typeof arg2 === 'number' ? arg2 : this.target.y;
      opts = typeof arg3 === 'object' && arg3 !== null ? arg3 : {};
    }

    if (x < 0 || y < 0) {
      x = window.innerWidth / 2;
      y = window.innerHeight / 2;
    }

    var count = opts.count || this.opts.spillCount || 14;
    var baseSpeed = opts.speed || 5.0;
    var sizeMult = opts.size || 1.0;
    var gravityOverride = opts.gravity !== undefined ? opts.gravity : null;

    var blurComp = Math.max(1.0, this.opts.gooeyBlur / 5.5);

    for (var i = 0; i < count; i++) {
      // Natural downward pouring arc (angles pointing downwards)
      var a = Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      var speed = (2.2 + Math.random() * baseSpeed);
      var r = (4.5 + Math.random() * 6.5) * sizeMult * blurComp;

      var p = this._spawn(
        2,
        x + (Math.random() - 0.5) * 10,
        y + (Math.random() - 0.5) * 6,
        Math.cos(a) * speed,
        Math.abs(Math.sin(a) * speed), // Guaranteed downward velocity (falls DOWN!)
        r,
        0
      );
      if (p && gravityOverride !== null) {
        p.gravity = gravityOverride;
      }
    }

    this._wake();
  };

  /* ---------------- RAF Animation Loop ---------------- */

  Tendril.prototype._wake = function () {
    if (this.running || !this.initialized || this.hidden) return;
    this.running = true;
    this.lastTime = 0;
    this.raf = requestAnimationFrame(this._tick);
  };

  Tendril.prototype._tick = function (now) {
    if (this.hidden) { this.running = false; return; }

    var dt = this.lastTime ? Math.min(now - this.lastTime, 50) : 16.67;
    this.lastTime = now;
    var f = dt / 16.67;
    var o = this.opts;
    var pts = this.points, n = pts.length;
    var moving = false;

    if (this.started) {
      var a = 1 - Math.exp(-dt / o.segTau);
      var ah = 1 - Math.exp(-dt / (o.segTau * 0.25));

      this.headScale += (this.targetHeadScale - this.headScale) * (1 - Math.exp(-dt / 70));

      // Head pins to cursor
      var h = pts[0];
      h.px = h.x; h.py = h.y;
      h.x += (this.target.x - h.x) * ah;
      h.y += (this.target.y - h.y) * ah;

      var energy = Math.abs(h.x - h.px) + Math.abs(h.y - h.py);

      if (!this.isAnchored) {
        // --- NORMAL FREE ROPE CHASE MODE ---
        var wobble = this.idle && o.idleWobble;
        for (var i = 1; i < n; i++) {
          var p = pts[i], q = pts[i - 1];
          p.px = p.x; p.py = p.y;
          var tx = q.x, ty = q.y, k = a;
          if (wobble) {
            p.ax += o.idleSpeed * f * (1 + i * 0.08);
            p.ay += o.idleSpeed * f * (1 + i * 0.08);
            var amp = o.idleAmplitude * (i / n);
            tx += Math.sin(p.ax) * amp;
            ty += Math.cos(p.ay) * amp;
            k = a * 0.72;
          }
          var dx = (tx - p.x) * k, dy = (ty - p.y) * k;
          p.x += dx; p.y += dy;
          energy += Math.abs(dx) + Math.abs(dy);
        }
      } else {
        // --- REAL ROPE PHYSICS BETWEEN ANCHORS (Verlet + inextensible length + water-like drag) ---
        // The rope has a finite length. While the pins/cursor are closer together than that length
        // the rope is LOOSE: every joint swings freely under gravity and sags into a natural catenary.
        // As the total distance approaches the rope length, the slack runs out and ALL spans
        // pull TIGHT together (slack is shared across spans, like a cord threaded through rings).
        var numPins = this.checkpoints.length;
        if (numPins > 0) {
          var wobble = this.idle && o.idleWobble;

          // 'single' mode: the pin glides to its new spot on a damped spring (rope stays attached)
          energy += this._updatePinFollow(f);

          var latestCP = this.checkpoints[numPins - 1];
          var L_rope = this._ropeLength();

          // Straight-line distances of every span
          var spanChords = this._spanChords || (this._spanChords = []);
          spanChords.length = 0;
          var totalChord = 0;
          for (var c = 0; c < this.completedSpans.length; c++) {
            var pA = this.checkpoints[c];
            var pB = this.checkpoints[c + 1];
            var ch = Math.hypot(pB.x - pA.x, pB.y - pA.y);
            spanChords.push(ch);
            totalChord += ch;
          }
          var activeChord = Math.hypot(h.x - latestCP.x, h.y - latestCP.y);
          totalChord += activeChord;

          // CONTINUOUS DYNAMIC TENSION & SLACK SHARING ACROSS ALL ANCHOR SPANS:
          // The tension in the rope is shared globally like a cord threaded through rings.
          // When pulling away or moving fast, tension builds smoothly and pulls ALL spans taut.
          // When relaxing, moving close, or pausing, tension eases and ALL spans droop naturally with gravity.
          var sens = (typeof o.ropeTensionSensitivity === 'number' && o.ropeTensionSensitivity > 0)
            ? o.ropeTensionSensitivity : 1.0;

          // Stretch distance threshold to achieve full tension (scaled by sensitivity)
          var stretchThreshold = Math.max(100, 360 / sens);
          var pullRatio = Math.min(1.0, activeChord / stretchThreshold);
          var activeTension = Math.pow(pullRatio, 1.3);

          // Cursor movement velocity also builds dynamic pull tension
          var cursorSpeed = Math.hypot(h.x - h.px, h.y - h.py) / (dt > 0 ? dt : 16);
          var speedTension = Math.min(1.0, cursorSpeed * 0.12 * sens);

          // Global cord constraint: rope pulls taut if woven length approaches physical limit
          var globalTension = Math.max(0, Math.min(1.0, (totalChord - L_rope * 0.75) / (L_rope * 0.25)));

          // Target tension combines distance pull, motion dynamics, and global length limit
          var targetTension = Math.max(activeTension, speedTension, globalTension);

          // Smooth low-pass physical tension integration:
          // Guarantees zero instantaneous jump/pop when planting an anchor pin,
          // while allowing rapid tightening when actively pulling!
          if (typeof this.ropeTension !== 'number' || isNaN(this.ropeTension)) {
            this.ropeTension = targetTension;
          } else {
            var tensionRate = 1 - Math.exp(-dt / (targetTension > this.ropeTension ? 100 : 220));
            this.ropeTension += (targetTension - this.ropeTension) * tensionRate;
          }

          var looseness = Math.max(0, 1.0 - this.ropeTension);

          // Base slack offset: respects offsetSize if specified as a small offset or ropeMinSlack
          var slackBase = (typeof o.offsetSize === 'number' && o.offsetSize < 1000)
            ? o.offsetSize
            : (o.ropeMinSlack || 42);

          // Active span: cursor head -> newest pin (increased slack cap & offset)
          var activeSlackCap = Math.max(60, 360 * (o.ropeSlack || 0.42));
          var activeMaxExtra = Math.min(activeSlackCap, activeChord * (o.ropeSlack || 0.42)) + slackBase * 0.6;
          var activeTargetLen = activeChord + activeMaxExtra * looseness;

          energy += this._simulateSpan(pts, h, latestCP,
            activeTargetLen, f, wobble);

          // Completed spans: between planted anchor pins
          // Full physical catenary slack sharing: ALL completed spans tighten when pulling
          // and gracefully fall / droop under gravity when relaxing!
          for (var cIdx = 0; cIdx < this.completedSpans.length; cIdx++) {
            var span = this.completedSpans[cIdx];
            var ch = spanChords[cIdx];
            var spanSlackCap = Math.max(60, 360 * (o.ropeSlack || 0.42));
            var spanMaxExtra = Math.min(spanSlackCap, ch * (o.ropeSlack || 0.42)) + slackBase * 0.6;
            var spanTargetLen = ch + spanMaxExtra * looseness;

            energy += this._simulateSpan(
              span,
              this.checkpoints[cIdx + 1],
              this.checkpoints[cIdx],
              spanTargetLen,
              f, wobble
            );
          }
        }
      }

      moving = energy > 0.05 || (this.idle && o.idleWobble) || this.isAnchored;
      if (moving) this._drawRope();
    }

    if (this.severedRopes.length > 0) {
      this._updateSeveredRopes(f);
      moving = true;
    }

    if (this.activeCount) {
      this._updateParticles(f);
      moving = true;
    }

    if (moving || this.activeCount || this.severedRopes.length > 0) {
      this.raf = requestAnimationFrame(this._tick);
    } else {
      this.running = false;
    }
  };

  /**
   * Returns total scrollable page/document length (height in px)
   */
  Tendril.prototype._getPageLength = function () {
    if (typeof document === 'undefined') return this.viewH || 800;
    var body = document.body;
    var html = document.documentElement;
    return Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      html ? html.clientHeight : 0,
      html ? html.scrollHeight : 0,
      html ? html.offsetHeight : 0,
      (typeof window !== 'undefined' ? window.innerHeight : 800)
    );
  };

  /**
   * Maximum physical rope length (px)
   * Dynamically factors in the full scrollable page length (height & diagonal)
   * plus the enlarged offset size, enabling continuous anchoring across long web pages!
   */
  Tendril.prototype._ropeLength = function () {
    if (typeof this.opts.ropeLength === 'number' && this.opts.ropeLength > 0) {
      return this.opts.ropeLength;
    }
    var w = this.viewW || (typeof window !== 'undefined' ? window.innerWidth : 1200);
    var vh = this.viewH || (typeof window !== 'undefined' ? window.innerHeight : 800);
    var viewportDiag = Math.hypot(w, vh);

    // Configurable offset size of the rope (default increased to 6000px)
    var offset = (typeof this.opts.offsetSize === 'number' && this.opts.offsetSize >= 100)
      ? this.opts.offsetSize
      : ((typeof this.opts.ropeLengthOffset === 'number') ? this.opts.ropeLengthOffset : 6000);

    // Factor in the page's scrollable length (height / diagonal) when usePageLength is active
    if (this.opts.usePageLength !== false) {
      var pageLen = this._getPageLength();
      var pageW = (typeof document !== 'undefined' && document.documentElement)
        ? Math.max(document.documentElement.scrollWidth, w)
        : w;
      var pageDiag = Math.hypot(pageW, pageLen);
      var ratio = (typeof this.opts.pageLengthRatio === 'number') ? this.opts.pageLengthRatio : 1.15;
      var basePageLength = Math.max(pageLen * ratio, pageDiag);
      return Math.max(2400, Math.round(basePageLength) + offset);
    }

    return Math.max(1600, Math.round(viewportDiag * 1.35) + offset);
  };

  /**
   * One Verlet step for a rope span pinned at both ends.
   *  - arr[0] is pinned to A, arr[last] is pinned to B
   *  - interior joints get momentum (with water-like drag) + gravity
   *  - distance constraints keep each segment at length/(segments) so the rope
   *    hangs loose when there is slack and straightens taut when there is none
   * Returns kinetic energy (for sleep detection).
   */
  Tendril.prototype._simulateSpan = function (arr, A, B, length, f, wobble) {
    var o = this.opts;
    var len = arr.length;
    if (len < 2) return 0;
    var segs = len - 1;
    var rest = Math.max(0.25, length / segs);
    var damp = Math.pow(o.ropeDamping, f);
    var g = o.ropeGravity * f * f;
    var maxV = 60;
    var looseness = 1 - (this.ropeTension || 0);
    var energy = 0;

    var first = arr[0], last = arr[segs];
    first.x = A.x; first.y = A.y;
    first.px = A.x; first.py = A.y;
    last.x = B.x; last.y = B.y;
    last.px = B.x; last.py = B.y;

    // 1. Integrate (momentum + drag + gravity)
    for (var i = 1; i < segs; i++) {
      var p = arr[i];
      var vx = (p.x - p.px) * damp;
      var vy = (p.y - p.py) * damp;
      if (vx > maxV) vx = maxV; else if (vx < -maxV) vx = -maxV;
      if (vy > maxV) vy = maxV; else if (vy < -maxV) vy = -maxV;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy + g;

      // Gentle underwater current while idle (fades out as the rope pulls taut)
      if (wobble && looseness > 0.05) {
        p.ax = (p.ax || 0) + o.idleSpeed * f;
        p.x += Math.sin(p.ax + i * 0.55) * o.idleAmplitude * 0.018 * f * looseness;
      }
      energy += Math.abs(vx) + Math.abs(vy);
    }

    // 2. Satisfy length constraints (alternating sweep direction for faster convergence)
    var iters = o.ropeIterations;
    for (var it = 0; it < iters; it++) {
      var fwd = (it & 1) === 0;
      for (var s = 0; s < segs; s++) {
        var j = fwd ? s : segs - 1 - s;
        var a = arr[j], b = arr[j + 1];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        var wa = j === 0 ? 0 : 1;
        var wb = j + 1 === segs ? 0 : 1;
        var wsum = wa + wb;
        if (!wsum) continue;
        var diff = (d - rest) / (d * wsum);
        a.x += dx * diff * wa; a.y += dy * diff * wa;
        b.x -= dx * diff * wb; b.y -= dy * diff * wb;
      }
    }

    return energy;
  };

  /**
   * 'single' mode: moves a retargeted pin toward its new spot on a damped (slightly liquid) spring
   */
  Tendril.prototype._updatePinFollow = function (f) {
    var o = this.opts, energy = 0;
    for (var i = 0; i < this.checkpoints.length; i++) {
      var cp = this.checkpoints[i];
      if (cp.tx === undefined) continue;

      var dx = cp.tx - cp.x;
      var dy = cp.ty - cp.y;
      var dist = Math.hypot(dx, dy);

      if (dist < 1.0 && Math.hypot(cp.vx || 0, cp.vy || 0) < 0.6) {
        cp.x = cp.tx;
        cp.y = cp.ty;
        cp.vx = 0;
        cp.vy = 0;
        cp.tx = undefined;
        cp.ty = undefined;
      } else {
        var d = Math.pow(o.anchorFollowDamping, f);
        cp.vx = ((cp.vx || 0) + dx * o.anchorFollowStiffness * f) * d;
        cp.vy = ((cp.vy || 0) + dy * o.anchorFollowStiffness * f) * d;

        // Cap peak glide speed so the pin never teleports or snaps violently across the screen
        var maxSpd = 12.0;
        var spd = Math.hypot(cp.vx, cp.vy);
        if (spd > maxSpd) {
          cp.vx = (cp.vx / spd) * maxSpd;
          cp.vy = (cp.vy / spd) * maxSpd;
        }

        cp.x += cp.vx * f;
        cp.y += cp.vy * f;
      }

      if (cp.el) {
        cp.el.setAttribute('cx', r1(cp.x));
        cp.el.setAttribute('cy', r1(cp.y));
      }
      this.anchor.x = cp.x;
      this.anchor.y = cp.y;
      energy += Math.abs(cp.vx || 0) + Math.abs(cp.vy || 0);
    }
    return energy;
  };

  Tendril.prototype._drawRope = function () {
    var allPts = [];
    if (!this.isAnchored || this.checkpoints.length === 0) {
      allPts = this.points;
    } else {
      for (var i = 0; i < this.points.length; i++) {
        allPts.push(this.points[i]);
      }
      for (var k = this.completedSpans.length - 1; k >= 0; k--) {
        var span = this.completedSpans[k];
        for (var j = 1; j < span.length; j++) {
          allPts.push(span[j]);
        }
      }
    }

    var nAll = allPts.length;
    if (nAll < 2) return;

    var d = 'M' + r1(allPts[0].x) + ' ' + r1(allPts[0].y);
    for (var i = 0; i < nAll - 1; i++) {
      var p0 = allPts[i > 0 ? i - 1 : 0],
          p1 = allPts[i],
          p2 = allPts[i + 1],
          p3 = allPts[i < nAll - 2 ? i + 2 : i + 1];
      d += 'C' + r1(p1.x + (p2.x - p0.x) / 6) + ' ' + r1(p1.y + (p2.y - p0.y) / 6) + ' ' +
                 r1(p2.x - (p3.x - p1.x) / 6) + ' ' + r1(p2.y - (p3.y - p1.y) / 6) + ' ' +
                 r1(p2.x) + ' ' + r1(p2.y);
    }
    this.rope.setAttribute('d', d);

    var L_max = this._ropeLength();

    // Calculate total chord distance across all active anchors
    var totalChord = 0;
    for (var k = 0; k < nAll - 1; k++) {
      totalChord += Math.hypot(allPts[k + 1].x - allPts[k].x, allPts[k + 1].y - allPts[k].y);
    }

    // Elastic Thinning Factor (Poisson necking):
    // Length grows as used; as length increases, the rope stretches and gets thinner!
    var stretchRatio = Math.min(1.0, totalChord / L_max);
    var thinFactor = this.isAnchored
      ? Math.max(0.70, 1.0 - 0.30 * stretchRatio)
      : 1.0;

    // Stroke width scales smoothly with stretch (never drops below filter cutoff!)
    var effectiveStroke = this.isAnchored
      ? Math.max(9.5, this.opts.strokeWidth * 1.35 * thinFactor)
      : this.opts.strokeWidth;
    this.rope.setAttribute('stroke-width', r1(effectiveStroke));

    var g = this.grad, head = allPts[0], tail = allPts[nAll - 1];
    g.setAttribute('x1', r1(head.x)); g.setAttribute('y1', r1(head.y));
    g.setAttribute('x2', r1(tail.x + 0.1)); g.setAttribute('y2', r1(tail.y + 0.1));

    // Full liquid beads and tapering matching non-anchor mode (Image 2):
    // Head circle at cursor tapering down to a slender droplet at the anchor tail!
    var headRad = this.opts.headRadius * this.headScale * (this.isAnchored ? thinFactor : 1.0);
    var tailRad = this.opts.tailRadius * (this.isAnchored ? Math.max(0.80, thinFactor) : 1.0);

    while (this.nodes.length < nAll) {
      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('fill', this.opts.secondaryColor);
      this.nodeGroup.appendChild(circle);
      this.nodes.push(circle);
    }

    for (var j = 0; j < this.nodes.length; j++) {
      var c = this.nodes[j];
      if (j < nAll) {
        c.style.display = '';
        var pt = allPts[j];
        c.setAttribute('cx', r1(pt.x));
        c.setAttribute('cy', r1(pt.y));

        var frac = j / (nAll - 1);
        var beadR = headRad - (headRad - tailRad) * Math.pow(frac, 0.75);

        if (j === 0) {
          c.setAttribute('r', r1(headRad));
          c.setAttribute('fill', this.opts.color);
        } else {
          c.setAttribute('r', r1(Math.max(4.0, beadR)));
          c.setAttribute('fill', this.opts.secondaryColor);
        }
      } else {
        c.style.display = 'none';
      }
    }
  };

  Tendril.prototype._updateSeveredRopes = function (f) {
    var gravity = this.opts.severedRopeGravity * f;
    var drag = Math.pow(this.opts.severedRopeDrag, f);
    var bottomLimit = this.viewH + 80;

    for (var rIdx = this.severedRopes.length - 1; rIdx >= 0; rIdx--) {
      var sr = this.severedRopes[rIdx];
      if (!sr.active) continue;

      // Lifespan timer ensures zero stuck fragments remain on screen (~2.5s max)
      sr.life -= 0.008 * f;

      var pts = sr.pts;
      var len = pts.length;
      var allOffscreen = true;

      for (var i = 0; i < len; i++) {
        var pt = pts[i];
        var vx = (pt.x - pt.px) * drag;
        var vy = (pt.y - pt.py) * drag + gravity;
        pt.px = pt.x;
        pt.py = pt.y;
        pt.x += vx;
        pt.y += vy;

        if (pt.y < bottomLimit) allOffscreen = false;
      }

      // Distance constraints preserve cord integrity in its exact released shape!
      for (var pass = 0; pass < 2; pass++) {
        for (var j = 0; j < len - 1; j++) {
          var p1 = pts[j];
          var p2 = pts[j + 1];
          var targetDist = (sr.segRestLens && sr.segRestLens[j]) ? sr.segRestLens[j] : sr.segRestLen;
          var dx = p2.x - p1.x;
          var dy = p2.y - p1.y;
          var dist = Math.hypot(dx, dy);
          if (dist > 0.001) {
            var diff = (dist - targetDist) / dist * 0.45;
            p1.x += dx * diff;
            p1.y += dy * diff;
            p2.x -= dx * diff;
            p2.y -= dy * diff;
          }
        }
      }

      var d = 'M' + r1(pts[0].x) + ' ' + r1(pts[0].y);
      for (var k = 0; k < len - 1; k++) {
        var p0 = pts[k > 0 ? k - 1 : 0], pA = pts[k], pB = pts[k + 1], pC = pts[k < len - 2 ? k + 2 : k + 1];
        d += 'C' + r1(pA.x + (pB.x - p0.x) / 6) + ' ' + r1(pA.y + (pB.y - p0.y) / 6) + ' ' +
                   r1(pB.x - (pC.x - pA.x) / 6) + ' ' + r1(pB.y - (pC.y - pA.y) / 6) + ' ' +
                   r1(pB.x) + ' ' + r1(pB.y);
      }
      sr.path.setAttribute('d', d);

      // Smooth visual fade-out
      var opacity = Math.max(0, Math.min(1, sr.life));
      sr.path.setAttribute('opacity', opacity.toFixed(2));
      sr.nodeGroup.setAttribute('opacity', opacity.toFixed(2));

      for (var m = 0; m < len; m++) {
        var circle = sr.circleEls[m];
        if (circle) {
          circle.setAttribute('cx', r1(pts[m].x));
          circle.setAttribute('cy', r1(pts[m].y));
        }
      }

      // Clean removal when fallen off-screen OR decayed
      if (allOffscreen || sr.life <= 0) {
        this._destroySeveredRope(sr);
        this.severedRopes.splice(rIdx, 1);
      }
    }
  };

  Tendril.prototype._updateParticles = function (f) {
    var o = this.opts, pool = this.pool, limitY = this.viewH + 50;
    var defaultGravity = o.gravity * f;

    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active) continue;

      if (p.kind === 1) {
        var drag = Math.pow(0.92, f);
        p.vx *= drag; p.vy *= drag;
        p.x += p.vx * f; p.y += p.vy * f;
        p.life -= p.decay * f;
      } else if (p.kind === 2) {
        var grav = (p.gravity !== undefined ? p.gravity : defaultGravity);
        p.vy += grav;
        p.vx *= Math.pow(0.99, f);
        p.x += p.vx * f; p.y += p.vy * f;
        p.r -= 0.010 * f;
        p.life = p.r > 0.8 ? 1 : 0;

        if (o.dripTrail && p.r > 4 && p.vy > 2.2 && Math.random() < 0.20 * f) {
          this._spawn(3, p.x - p.vx * 0.5, p.y - p.vy * 0.5, p.vx * 0.15, p.vy * 0.2, p.r * 0.45, 0.05);
        }
        if (p.y - p.r > limitY || p.x < -60 || p.x > this.viewW + 60) p.life = 0;
      } else {
        p.x += p.vx * f; p.y += p.vy * f;
        p.life -= p.decay * f;
      }

      if (p.life <= 0) {
        p.active = false;
        p.gravity = null;
        p.el.style.display = 'none';
        this.activeCount--;
      } else {
        p.el.setAttribute('cx', r1(p.x));
        p.el.setAttribute('cy', r1(p.y));
        p.el.setAttribute('r', r1(p.r * p.life));
      }
    }
  };

  /* ---------------- Public API Methods ---------------- */

  Tendril.prototype.setColor = function (primary, secondary) {
    this.opts.color = primary;
    this.opts.secondaryColor = secondary || deriveSecondary(primary);

    var stops = this.svg.querySelectorAll('#' + this.gradId + ' stop');
    if (stops.length >= 2) {
      stops[0].setAttribute('stop-color', this.opts.color);
      stops[1].setAttribute('stop-color', this.opts.secondaryColor);
    }
    this.nodes[0].setAttribute('fill', this.opts.color);
    for (var i = 1; i < this.nodes.length; i++) {
      this.nodes[i].setAttribute('fill', this.opts.secondaryColor);
    }
    this.liquidGroup.setAttribute('fill', this.opts.color);
    if (this.checkpointGroup) {
      for (var cp = 0; cp < this.checkpoints.length; cp++) {
        if (this.checkpoints[cp].el) this.checkpoints[cp].el.setAttribute('fill', this.opts.color);
      }
    }
    this._wake();
  };

  Tendril.prototype.setOptions = function (newOpts) {
    Object.assign(this.opts, newOpts);
    if (newOpts.gooeyBlur !== undefined || newOpts.gooeyContrast !== undefined) {
      var blurVal = this.opts.gooeyBlur;
      var matrixOffset = Math.max(-18, Math.min(-10, -18 + (blurVal * 0.5)));
      var filter = this.svg.querySelector('#' + this.filterId);
      if (filter) {
        var gb = filter.querySelector('feGaussianBlur');
        var cm = filter.querySelector('feColorMatrix');
        if (gb) gb.setAttribute('stdDeviation', blurVal);
        if (cm) {
          cm.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ' +
            this.opts.gooeyContrast + ' ' + matrixOffset);
        }
      }
    }
    this._wake();
  };

  Tendril.prototype.setBlendMode = function (mode) {
    this.opts.mixBlendMode = mode;
    if (this.wrap) {
      this.wrap.style.mixBlendMode = mode;
    }
  };

  Tendril.reportBug = function () {
    if (typeof document !== 'undefined') {
      var modal = document.getElementById('bugReportModal');
      if (modal && typeof triggerBugReport === 'function') {
        triggerBugReport();
        return;
      }
    }
    var mailto = 'mailto:mauryanishant2005@gmail.com?subject=Tendril.js%20Bug%20Report&body=Hi%20Nishant,%0A%0AI%20found%20an%20issue%20with%20Tendril.js:%0A%0A-%20Browser:%20' + encodeURIComponent(typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown') + '%0A-%20Viewport:%20' + (typeof window !== 'undefined' ? window.innerWidth + 'x' + window.innerHeight : 'N/A');
    if (typeof document !== 'undefined') {
      var a = document.createElement('a');
      a.href = mailto;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 250);
    } else if (typeof window !== 'undefined') {
      window.location.href = mailto;
    }
  };

  Tendril.prototype.reportBug = function () {
    Tendril.reportBug();
  };

  Tendril.prototype.destroy = function () {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.idleTimer);

    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('touchstart', this._touchDown);
    window.removeEventListener('touchmove', this._touchMove);
    window.removeEventListener('touchend', this._up);
    window.removeEventListener('mousedown', this._onMouseDown, { capture: true });
    window.removeEventListener('selectstart', this._onSelectStart, { capture: true });
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('scroll', this._scroll);
    document.removeEventListener('pointerover', this._over);
    document.removeEventListener('pointerout', this._out);
    document.removeEventListener('visibilitychange', this._vis);

    this._removeHideNativeCursor();
    this._unlockSelection();

    if (this._singleClickTimer) {
      clearTimeout(this._singleClickTimer);
      this._singleClickTimer = null;
    }
    this.clearCheckpoints();

    for (var i = 0; i < this.severedRopes.length; i++) {
      this._destroySeveredRope(this.severedRopes[i]);
    }
    this.severedRopes.length = 0;

    if (this.wrap && this.wrap.parentNode) {
      this.wrap.parentNode.removeChild(this.wrap);
    }
    this.initialized = false;
  };

  // Auto-init via data attribute
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        var auto = document.querySelector('[data-tendril]');
        if (auto && !window.__tendril_auto_instance) {
          window.__tendril_auto_instance = new Tendril();
        }
      });
    } else {
      var auto = document.querySelector('[data-tendril]');
      if (auto && !window.__tendril_auto_instance) {
        window.__tendril_auto_instance = new Tendril();
      }
    }
  }

  return Tendril;
}));
