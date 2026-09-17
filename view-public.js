(() => {
  "use strict";

  const V = window.VIEW_INTERNAL;
  if (!V) return;

  const DEV_MODE = /[?&]dev=1(?:&|$)/.test(location.search);
  const mobile = (window.matchMedia && window.matchMedia("(max-width:760px)").matches) || (navigator.maxTouchPoints || 0) > 1;
  const panel = document.getElementById("devPanel");
  const toggle = document.getElementById("devToggle");

  if (!DEV_MODE) {
    toggle.textContent = "SET";
    toggle.setAttribute("aria-label", "Toggle settings");
    toggle.title = "Settings";
    const title = panel && panel.querySelector(".dev-title");
    if (title) title.textContent = "VIEW // SETTINGS";
  }

  if (mobile) V.Renderer.dprCap = Math.max(V.Renderer.dprCap, 2.5);

  const AudioReact = {
    active: false,
    ctx: null,
    analyser: null,
    stream: null,
    data: null,
    level: 0,
    button: null,

    async toggle() {
      if (this.active) { this.stop(); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.label("MIC UNAVAILABLE");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false
        });
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          stream.getTracks().forEach(t => t.stop());
          this.label("AUDIO UNSUPPORTED");
          return;
        }
        const ctx = new AC();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.70;
        source.connect(analyser);
        this.stream = stream;
        this.ctx = ctx;
        this.analyser = analyser;
        this.data = new Uint8Array(analyser.frequencyBinCount);
        this.active = true;
        this.level = 0;
        this.label("MIC REACT · ON");
        if (this.button) this.button.classList.add("active");
      } catch (err) {
        console.warn("VIEW: microphone audio-react unavailable", err);
        this.label("MIC PERMISSION");
      }
    },

    stop() {
      this.active = false;
      this.level = 0;
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.ctx) { try { this.ctx.close(); } catch (_) {} }
      this.stream = null;
      this.ctx = null;
      this.analyser = null;
      this.data = null;
      this.label("MIC REACT");
      if (this.button) this.button.classList.remove("active");
    },

    label(text) {
      if (this.button) this.button.textContent = text;
    },

    tick() {
      if (!this.active || !this.analyser || !this.data) {
        this.level *= 0.86;
        return;
      }
      this.analyser.getByteFrequencyData(this.data);
      const bassBins = Math.max(8, Math.floor(this.data.length * 0.18));
      let bass = 0;
      let all = 0;
      for (let i = 0; i < this.data.length; i++) {
        const v = this.data[i] / 255;
        all += v;
        if (i < bassBins) bass += v;
      }
      bass /= bassBins;
      all /= this.data.length;
      const target = Math.max(0, Math.min(1, bass * 1.35 + all * 0.55 - 0.08));
      this.level = this.level * 0.76 + target * 0.24;
    }
  };

  if (panel) {
    const firstSep = panel.querySelector(".dev-sep");
    const audioRow = document.createElement("div");
    audioRow.className = "dev-row public-audio-row";
    audioRow.innerHTML = '<label>Audio sync</label><div class="dev-buttons"><button class="dev-btn" id="audioReactBtn">MIC REACT</button></div>';
    panel.insertBefore(audioRow, firstSep);
    AudioReact.button = audioRow.querySelector("#audioReactBtn");
    AudioReact.button.addEventListener("click", e => {
      e.stopPropagation();
      AudioReact.toggle();
    });
  }

  const baseFrameState = V.Engine.frameState.bind(V.Engine);
  V.Engine.frameState = function () {
    const state = baseFrameState();
    if (!state) return state;

    if (mobile) {
      state.atmos[0] *= 0.60;
      state.atmos[2] *= 0.82;
      state.warp[0] *= 0.72;
      state.warp[1] *= 0.82;
    }

    if (AudioReact.active) {
      const e = AudioReact.level;
      state.warp[0] *= 1 + e * 2.2;
      state.warp[1] *= 1 + e * 1.2;
      state.atmos[1] *= 1 + e * 0.45;
      state.atmos[2] *= 1 + e * 0.65;
      state.atmos[3] *= 1 + e * 1.15;
      state.micro[1] += e * 0.14;
      state.micro[2] += e * 0.18;
    }
    return state;
  };

  const tick = () => {
    AudioReact.tick();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
