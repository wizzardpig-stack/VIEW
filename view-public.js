(() => {
  "use strict";

  const V = window.VIEW_INTERNAL;
  if (!V) return;

  const DEV_MODE = /[?&]dev=1(?:&|$)/.test(location.search);
  const mobile = (window.matchMedia && window.matchMedia("(max-width:760px)").matches) || (navigator.maxTouchPoints || 0) > 1;
  const panel = document.getElementById("devPanel");
  const toggle = document.getElementById("devToggle");
  const viewer = document.getElementById("viewer");

  if (!DEV_MODE) {
    toggle.textContent = "SET";
    toggle.setAttribute("aria-label", "Toggle settings");
    toggle.title = "Settings";
    const title = panel && panel.querySelector(".dev-title");
    if (title) title.textContent = "VIEW // SETTINGS";
  }

  // Remove the microphone-react experiment. VIEW cannot reliably inspect audio
  // from another iOS app, so the public build does not pretend that it can.
  if (panel) {
    panel.querySelectorAll(".public-audio-row").forEach(el => el.remove());
  }

  // Favor Retina clarity first. The core performance governor can still step
  // resolution down later if a device genuinely cannot sustain it.
  if (mobile) {
    const nativeDpr = Math.max(1, window.devicePixelRatio || 1);
    V.Renderer.dprCap = Math.min(3, Math.max(2.75, nativeDpr));
    V.Engine.quality = Math.max(V.Engine.quality, 2);
    V.Renderer.w = 0;
    V.Renderer.resize();
  }

  const style = document.createElement("style");
  style.id = "view-public-touch-style";
  style.textContent = `
    #viewer { touch-action:none; }
    #touchFx {
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      z-index:7;
      pointer-events:none;
      display:block;
      mix-blend-mode:screen;
    }
    body.view-hold-sharp #overlayFx::before {
      opacity:.012 !important;
      filter:blur(2px) !important;
    }
    body.view-hold-sharp #overlayFx::after {
      opacity:.008 !important;
      filter:blur(4px) !important;
    }
    body.view-hold-sharp.fallback #layerA,
    body.view-hold-sharp.fallback .b-band {
      filter:none !important;
    }
    @media (max-width:760px) {
      .vignette { background:radial-gradient(circle at center, transparent 72%, rgba(0,0,0,.12) 100%) !important; }
    }
  `;
  document.head.appendChild(style);

  if (V.UI && V.UI.hint) V.UI.hint.textContent = "touch · drift";

  const TouchFX = {
    canvas: null,
    ctx: null,
    dpr: 1,
    w: 0,
    h: 0,
    ripples: [],
    wakes: [],
    energy: 0,
    nx: 0,
    ny: 0,
    lastPoint: null,
    lastWakeAt: 0,

    init() {
      const c = document.createElement("canvas");
      c.id = "touchFx";
      c.setAttribute("aria-hidden", "true");
      viewer.appendChild(c);
      this.canvas = c;
      this.ctx = c.getContext("2d", { alpha: true });
      this.resize();
      window.addEventListener("resize", () => this.resize(), { passive:true });
      if (window.visualViewport) window.visualViewport.addEventListener("resize", () => this.resize(), { passive:true });
    },

    resize() {
      if (!this.canvas || !this.ctx) return;
      const r = viewer.getBoundingClientRect();
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.canvas.style.width = this.w + "px";
      this.canvas.style.height = this.h + "px";
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },

    point(clientX, clientY) {
      const r = viewer.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      this.nx = Math.max(-1, Math.min(1, (x / Math.max(1, r.width) - 0.5) * 2));
      this.ny = Math.max(-1, Math.min(1, (y / Math.max(1, r.height) - 0.5) * 2));
      return { x, y };
    },

    palette() {
      const id = V.Engine.started ? V.Engine.world().id : "veil";
      if (id === "abyss") return [150, 224, 255];
      if (id === "orbit") return [205, 188, 255];
      if (id === "beach") return [255, 241, 214];
      return [226, 238, 244];
    },

    pulse(x, y, strength = 1, wake = false) {
      this.ripples.push({
        x, y,
        age: 0,
        life: wake ? 0.78 : 1.45,
        speed: wake ? 105 : 170,
        strength: Math.max(0.18, Math.min(1.35, strength)),
        wake
      });
      if (this.ripples.length > 42) this.ripples.splice(0, this.ripples.length - 42);
      this.energy = Math.min(1.2, this.energy + (wake ? 0.12 : 0.42) * strength);
    },

    begin(clientX, clientY) {
      const p = this.point(clientX, clientY);
      this.lastPoint = { x:p.x, y:p.y, t:performance.now() };
      this.lastWakeAt = performance.now();
      this.pulse(p.x, p.y, 1, false);
    },

    move(clientX, clientY) {
      const p = this.point(clientX, clientY);
      const now = performance.now();
      if (!this.lastPoint) {
        this.lastPoint = { x:p.x, y:p.y, t:now };
        return;
      }
      const dx = p.x - this.lastPoint.x;
      const dy = p.y - this.lastPoint.y;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(8, now - this.lastPoint.t);
      const speed = dist / dt * 1000;

      if (dist > 7 || now - this.lastWakeAt > 42) {
        const strength = Math.max(0.25, Math.min(1.15, 0.28 + speed / 780));
        this.pulse(p.x, p.y, strength, true);
        this.wakes.push({
          x1:this.lastPoint.x, y1:this.lastPoint.y,
          x2:p.x, y2:p.y,
          age:0, life:0.46,
          strength
        });
        if (this.wakes.length > 28) this.wakes.splice(0, this.wakes.length - 28);
        this.lastWakeAt = now;
      }

      this.lastPoint = { x:p.x, y:p.y, t:now };
      this.energy = Math.min(1.2, this.energy + Math.min(0.18, speed / 5000));
    },

    end(clientX, clientY) {
      if (clientX != null && clientY != null) {
        const p = this.point(clientX, clientY);
        this.pulse(p.x, p.y, 0.52, false);
      }
      this.lastPoint = null;
    },

    drawRipple(r, rgb) {
      const ctx = this.ctx;
      const k = Math.max(0, 1 - r.age / r.life);
      const radius = 8 + r.age * r.speed;
      const alpha = k * k * r.strength;
      if (alpha <= 0.002) return;

      ctx.save();
      ctx.lineCap = "round";
      ctx.globalCompositeOperation = "screen";

      const halo = ctx.createRadialGradient(r.x, r.y, Math.max(0, radius * 0.72), r.x, r.y, radius * 1.18);
      halo.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      halo.addColorStop(0.58, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.035 * alpha).toFixed(4)})`);
      halo.addColorStop(0.78, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.10 * alpha).toFixed(4)})`);
      halo.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.34 * alpha).toFixed(4)})`;
      ctx.lineWidth = r.wake ? 0.9 : 1.25;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,255,255,${(0.12 * alpha).toFixed(4)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, radius - 5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },

    drawWake(w, rgb) {
      const ctx = this.ctx;
      const k = Math.max(0, 1 - w.age / w.life);
      const alpha = k * k * 0.26 * w.strength;
      if (alpha <= 0.002) return;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const g = ctx.createLinearGradient(w.x1, w.y1, w.x2, w.y2);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      g.addColorStop(0.55, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(4)})`);
      g.addColorStop(1, `rgba(255,255,255,${(alpha * 0.55).toFixed(4)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.1 + w.strength * 1.3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.quadraticCurveTo((w.x1 + w.x2) * 0.5 + (w.y2 - w.y1) * 0.08, (w.y1 + w.y2) * 0.5 - (w.x2 - w.x1) * 0.08, w.x2, w.y2);
      ctx.stroke();
      ctx.restore();
    },

    tick(now, prev) {
      if (!this.ctx) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - prev) / 1000));
      this.ctx.clearRect(0, 0, this.w, this.h);
      const rgb = this.palette();

      for (const r of this.ripples) {
        r.age += dt;
        this.drawRipple(r, rgb);
      }
      for (const w of this.wakes) {
        w.age += dt;
        this.drawWake(w, rgb);
      }
      this.ripples = this.ripples.filter(r => r.age < r.life);
      this.wakes = this.wakes.filter(w => w.age < w.life);
      this.energy *= Math.pow(0.10, dt);
      if (this.energy < 0.001) this.energy = 0;
    }
  };

  TouchFX.init();

  // Sharpen stable scenes. Distortion and atmosphere are allowed to breathe
  // during a real morph, then resolve almost completely once the scene lands.
  const baseFrameState = V.Engine.frameState.bind(V.Engine);
  V.Engine.frameState = function () {
    const state = baseFrameState();
    if (!state) return state;

    const hold = this.phase === "hold" && this.scrub == null && !(V.FlowMode && V.FlowMode.active);

    if (mobile) {
      state.atmos[0] *= hold ? 0.20 : 0.46;
      state.atmos[2] *= hold ? 0.42 : 0.68;
      state.atmos[3] *= hold ? 0.52 : 0.76;
      state.warp[0] *= hold ? 0.15 : 0.54;
      state.warp[1] *= hold ? 0.22 : 0.62;
      state.warp[2] *= hold ? 0.48 : 0.78;
    }

    if (TouchFX.energy > 0.001) {
      const e = Math.min(1, TouchFX.energy);
      const id = this.world().id;
      const worldGain = id === "abyss" ? 1.45 : id === "beach" ? 1.18 : id === "orbit" ? 0.72 : 0.92;
      state.warp[0] += 0.010 * e * worldGain;
      state.warp[1] += 0.006 * e * worldGain;
      state.cam = [
        state.cam[0] * (1 + e * 0.0025),
        state.cam[1] + TouchFX.nx * 0.0065 * e,
        state.cam[2] + TouchFX.ny * 0.0065 * e
      ];
      state.atmos[3] *= 1 + e * 0.12;
    }

    return state;
  };

  // The chosen world is locked. Dragging is now an environmental gesture,
  // never navigation. World changes only happen through explicit UI choices.
  let touch = null;
  let lastTouchAt = 0;

  const touchStart = e => {
    if (!V.Engine.started || e.touches.length !== 1) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const t = e.touches[0];
    touch = { x:t.clientX, y:t.clientY, moved:false };
    lastTouchAt = performance.now();
    TouchFX.begin(t.clientX, t.clientY);
  };

  const touchMove = e => {
    if (!touch || !V.Engine.started || e.touches.length !== 1) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const t = e.touches[0];
    if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 9) touch.moved = true;
    TouchFX.move(t.clientX, t.clientY);
  };

  const touchEnd = e => {
    if (!touch || !V.Engine.started) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const t = e.changedTouches && e.changedTouches[0];
    if (t) TouchFX.end(t.clientX, t.clientY);
    else TouchFX.end();
    lastTouchAt = performance.now();
    const wasTap = !touch.moved;
    touch = null;
    if (wasTap) V.UI.toggleUI();
  };

  const touchCancel = e => {
    if (!touch) return;
    e.stopImmediatePropagation();
    touch = null;
    TouchFX.end();
  };

  viewer.addEventListener("touchstart", touchStart, { capture:true, passive:false });
  viewer.addEventListener("touchmove", touchMove, { capture:true, passive:false });
  viewer.addEventListener("touchend", touchEnd, { capture:true, passive:false });
  viewer.addEventListener("touchcancel", touchCancel, { capture:true, passive:false });

  viewer.addEventListener("click", e => {
    e.stopImmediatePropagation();
    if (performance.now() - lastTouchAt < 700) {
      e.preventDefault();
      return;
    }
    if (!V.Engine.started) return;
    TouchFX.begin(e.clientX, e.clientY);
    TouchFX.end(e.clientX, e.clientY);
    V.UI.toggleUI();
  }, { capture:true });

  document.addEventListener("keydown", e => {
    if (V.Engine.started && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      V.UI.showUI();
    }
  }, { capture:true });

  let lastFrame = performance.now();
  const tick = now => {
    const sharpHold = V.Engine.started && V.Engine.phase === "hold" && V.Engine.scrub == null && !(V.FlowMode && V.FlowMode.active);
    document.body.classList.toggle("view-hold-sharp", !!sharpHold);
    TouchFX.tick(now, lastFrame);
    lastFrame = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
