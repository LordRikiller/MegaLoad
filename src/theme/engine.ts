// @ts-nocheck
// Ambient biome background engine. A single <canvas> particle/texture system
// driven by the theme store. Ported verbatim from the approved design showroom
// — the logic is dynamic and canvas-heavy, so type-checking is disabled for
// this self-contained module. Public surface: new ThemeEngine(canvas), then
// resize(), configure(palette, anim, intensity), start(), stop().

import type { Anim, Palette } from "./themes";

const R = (a: number, b: number) => a + Math.random() * (b - a);
function hexRgb(h: string) {
  h = h.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(h: string, a: number) {
  const c = hexRgb(h);
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}
const AURORA_PALETTE = [[90, 240, 150], [70, 220, 205], [90, 150, 235], [165, 110, 225], [220, 110, 185]];
const INTENS = { subtle: { c: 0.6, s: 0.85 }, medium: { c: 1, s: 1 }, lively: { c: 1.55, s: 1.28 } };

export class ThemeEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = 0; this.h = 0; this.dpr = 1; this.t = 0; this.last = 0; this.raf = 0;
    this.active = []; this.bg1 = "#000"; this.bg2 = "#000"; this.cMul = 1; this.sMul = 1;
    this._layers = [];
    this.buf = null; this.bufx = null;
    this._frame = this.frame.bind(this);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(2, r.width); this.h = Math.max(2, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.buf) { this.buf = document.createElement("canvas"); this.bufx = this.buf.getContext("2d"); }
    this.buf.width = this.canvas.width; this.buf.height = this.canvas.height;
    this.bufx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.rebuild();
  }

  configure(pal: Palette, anim: Anim | null, intensity: string) {
    this.bg1 = pal.bg; this.bg2 = pal.bg2;
    const I = INTENS[intensity] || INTENS.medium; this.cMul = I.c; this.sMul = I.s;
    this._layers = anim && anim.layers ? anim.layers : [];
    this.rebuild();
  }

  rebuild() {
    this.active = [];
    const self = this;
    (this._layers || []).forEach(function (spec) { self.active.push(self.initLayer(spec)); });
  }

  initLayer(spec) {
    const w = this.w, h = this.h, I = this.cMul, mode = spec.mode, o = spec.opts || {};
    const L = { mode: mode, opts: o, color: spec.color, color2: spec.color2 || spec.color, parts: [] };
    let i, n;
    if (mode === "leaves") { n = Math.round(26 * I); for (i = 0; i < n; i++) L.parts.push({ bx: R(0, w), y: R(-h, h), vy: R(16, 40), amp: R(12, 34), fr: R(.4, 1.1), ph: R(0, 6.28), s: R(3, 7), rot: R(0, 6.28), vr: R(-1.2, 1.2) }); }
    else if (mode === "tree") { n = Math.round(15 * I); for (i = 0; i < n; i++) L.parts.push({ bx: R(w * 0.42, w), y: R(-h, h), vy: R(14, 32), amp: R(10, 26), fr: R(.4, 1), ph: R(0, 6.28), s: R(3, 6), rot: R(0, 6.28), vr: R(-1, 1) }); }
    else if (mode === "spores") { n = Math.round(34 * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(0, h), vy: R(6, 18), amp: R(6, 16), fr: R(.3, .8), ph: R(0, 6.28), s: R(1.2, 3), a: R(.35, .75) }); }
    else if (mode === "fireflies") { n = Math.round(15 * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(0, h), vx: R(-9, 9), vy: R(-7, 7), ph: R(0, 6.28), pf: R(.6, 1.6), s: R(1.5, 3), tc: R(0, 3) }); }
    else if (mode === "rain") { const heavy = o.heavy; n = Math.round((heavy ? 150 : 95) * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(-h, h), v: R(430, 690) * (heavy ? 1.12 : 1), len: R(8, heavy ? 22 : 15) }); L.splash = []; }
    else if (mode === "snow") { n = Math.round((o.dense ? 120 : 70) * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(-h, h), vy: R(.6, 1.4), s: R(1.4, 4), ph: R(0, 6.28), fr: R(.5, 1.4) }); }
    else if (mode === "grass") { L.blades = []; for (let x = -8; x < w + 8; x += R(4, 8)) L.blades.push({ x: x, h: R(h * 0.10, h * 0.24), w: R(2, 4.5), ph: R(0, 6.28), depth: Math.random() }); L.blades.sort(function (a, b) { return a.depth - b.depth; }); }
    else if (mode === "mist") {
      const tw = Math.max(480, Math.round(w)), th = Math.max(240, Math.round(h)), tint = hexRgb(L.color), dpr = this.dpr;
      const raw = document.createElement("canvas"); raw.width = Math.round(tw * dpr); raw.height = Math.round(th * dpr);
      const rtx = raw.getContext("2d"); rtx.setTransform(dpr, 0, 0, dpr, 0, 0); rtx.globalCompositeOperation = "lighter";
      const blobN = Math.round(tw / 7); let bi, wrp;
      for (bi = 0; bi < blobN; bi++) {
        const bx0 = R(0, tw), by0 = th * (0.2 + 0.8 * Math.pow(Math.random(), 0.7)), br0 = R(th * 0.10, th * 0.42), ba0 = R(0.012, 0.045) * (0.6 + (by0 / th) * 0.7);
        for (wrp = -1; wrp <= 1; wrp++) {
          const bxx = bx0 + wrp * tw; if (bxx < -br0 || bxx > tw + br0) continue;
          const rg = rtx.createRadialGradient(bxx, by0, 0, bxx, by0, br0);
          rg.addColorStop(0, "rgba(" + tint[0] + "," + tint[1] + "," + tint[2] + "," + ba0 + ")"); rg.addColorStop(1, "rgba(" + tint[0] + "," + tint[1] + "," + tint[2] + ",0)");
          rtx.fillStyle = rg; rtx.beginPath(); rtx.arc(bxx, by0, br0, 0, 6.2832); rtx.fill();
        }
      }
      const tex = document.createElement("canvas"); tex.width = raw.width; tex.height = raw.height;
      const btx = tex.getContext("2d"); btx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { btx.filter = "blur(" + Math.max(2, th * 0.02) + "px)"; } catch (e) { /* filter unsupported */ }
      btx.drawImage(raw, 0, 0, tw, th);
      L.tex = tex; L.tw = tw; L.th = th;
      L.lyr = [{ scale: 1.0, spd: 7, alpha: 0.85, yoff: 0 }, { scale: 1.35, spd: 15, alpha: 0.55, yoff: -th * 0.05 }];
    }
    else if (mode === "embers") { n = Math.round((o.gentle ? 16 : 42) * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(0, h), vy: R(28, 80) * (o.gentle ? .6 : 1), vx: R(-10, 10), ph: R(0, 6.28), fr: R(2, 5), s: R(1.2, 3.4) }); }
    else if (mode === "aurora") {
      L.curt = []; const cn = 3;
      for (i = 0; i < cn; i++) {
        const au = { y: h * (0.26 + i * 0.15), h: h * ((o.strong ? 0.46 : 0.40) * (0.75 + Math.random() * 0.55)), off: R(0, 6.28), off2: R(0, 6.28), a: (o.strong ? .62 : .5) * (0.65 + i * 0.2), foldAmp: R(h * 0.05, h * 0.12), striF: R(0.3, 0.6), striF2: R(0.7, 1.4), striP: R(0, 6.28), csp: R(0.07, 0.16), cshift: R(0, 5), fold: [], ray: [], brt: [] };
        let k2;
        for (k2 = 0; k2 < 4; k2++) au.fold.push({ f: R(0.003, 0.02), a: R(0.4, 1.0), p: R(0, 6.28), sp: R(0.04, 0.18) });
        for (k2 = 0; k2 < 3; k2++) au.ray.push({ f: R(0.01, 0.045), a: R(0.5, 1.0), p: R(0, 6.28), sp: R(0.08, 0.30) });
        for (k2 = 0; k2 < 3; k2++) au.brt.push({ f: R(0.002, 0.013), a: R(0.5, 1.0), p: R(0, 6.28), sp: R(0.03, 0.12) });
        L.curt.push(au);
      }
    }
    else if (mode === "wisps") { n = Math.round(11 * Math.max(1, I * 0.85)); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(h * 0.15, h * 0.9), vx: R(-5, 5), vy: R(-3, 3), ph: R(0, 6.28), pf: R(.4, .9), s: R(2.4, 4.2), tc: R(0, 4) }); }
    else if (mode === "ripples") { L.rips = []; L.spawnT = 0; L.cells = []; const kn = Math.round(14 * I); for (i = 0; i < kn; i++) L.cells.push({ ax: R(0, 6.28), ay: R(0, 6.28), sx: R(.12, .34), sy: R(.16, .4), r: R(h * 0.06, h * 0.16), ph: R(0, 6.28) }); }
    else if (mode === "kelp") { L.fronds = []; const fn = Math.round(7 * Math.max(1, I * 0.8)); for (i = 0; i < fn; i++) { const dep = Math.random(); L.fronds.push({ x: R(0.05, 0.95) * w, h: h * (0.42 + 0.5 * dep), w: R(6, 13) * (0.6 + dep * 0.7), ph: R(0, 6.28), sp: R(.3, .6), curl: R(1.5, 3.5), dep: dep, segs: 9 }); } L.fronds.sort(function (a, b) { return a.dep - b.dep; }); }
    else if (mode === "bubbles") { n = Math.round((o.dense ? 26 : 15) * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(0, h), vy: R(16, 44), r: R(1.5, 5), ph: R(0, 6.28), wob: R(5, 15), wf: R(.6, 1.4) }); }
    else if (mode === "motes") { n = Math.round(42 * I); for (i = 0; i < n; i++) L.parts.push({ x: R(0, w), y: R(0, h), vx: R(-6, 6), vy: R(-4, 8), ph: R(0, 6.28), pf: R(.3, .9), s: R(.6, 1.9), a: R(.14, .4) }); }
    return L;
  }

  step(dt) {
    const ctx0 = this.ctx, w = this.w, h = this.h;
    const g = ctx0.createLinearGradient(0, 0, 0, h); g.addColorStop(0, this.bg2); g.addColorStop(1, this.bg1);
    ctx0.globalCompositeOperation = "source-over"; ctx0.globalAlpha = 1; ctx0.fillStyle = g; ctx0.fillRect(0, 0, w, h);
    const vg = ctx0.createRadialGradient(w * 0.5, h * 0.42, h * 0.2, w * 0.5, h * 0.5, h * 0.9);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx0.fillStyle = vg; ctx0.fillRect(0, 0, w, h);
    for (let li = 0; li < this.active.length; li++) { this.drawLayer(this.active[li], dt); }
    ctx0.globalCompositeOperation = "source-over"; ctx0.globalAlpha = 1;
  }

  drawLayer(L, dt) {
    const c = this.ctx, w = this.w, h = this.h, t = this.t, sm = this.sMul, o = L.opts;
    let p, i, a, x, y;
    c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
    switch (L.mode) {
      case "leaves": case "tree":
        if (L.mode === "tree") { this.drawTree(L, t); }
        c.fillStyle = L.color;
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.fr * dt; p.y += p.vy * dt * sm; p.rot += p.vr * dt;
          if (p.y > h + 14) { p.y = -14; p.bx = R(0, w); }
          x = p.bx + Math.sin(p.ph) * p.amp;
          c.save(); c.translate(x, p.y); c.rotate(p.rot); c.globalAlpha = .82;
          c.beginPath(); c.ellipse(0, 0, p.s, p.s * 0.52, 0, 0, 6.2832); c.fill(); c.restore();
        }
        c.globalAlpha = 1; break;
      case "spores":
        c.fillStyle = L.color;
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.fr * dt; p.y -= p.vy * dt * sm; p.x += Math.sin(p.ph) * p.amp * dt;
          if (p.y < -6) { p.y = h + 6; p.x = R(0, w); }
          a = p.a * (0.55 + 0.45 * Math.sin(p.ph * 1.7)); c.globalAlpha = Math.max(0, a);
          c.beginPath(); c.arc(p.x, p.y, p.s, 0, 6.2832); c.fill();
        }
        c.globalAlpha = 1; break;
      case "fireflies":
        c.globalCompositeOperation = "lighter";
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.pf * dt; p.tc -= dt; if (p.tc < 0) { p.vx = R(-11, 11); p.vy = R(-9, 9); p.tc = R(1, 3); }
          p.x += p.vx * dt * sm; p.y += p.vy * dt * sm;
          if (p.x < -8) p.x = w + 8; if (p.x > w + 8) p.x = -8; if (p.y < -8) p.y = h + 8; if (p.y > h + 8) p.y = -8;
          a = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(p.ph));
          const gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 5);
          gr.addColorStop(0, rgba(L.color2, a)); gr.addColorStop(.4, rgba(L.color, a * 0.6)); gr.addColorStop(1, rgba(L.color, 0));
          c.fillStyle = gr; c.beginPath(); c.arc(p.x, p.y, p.s * 5, 0, 6.2832); c.fill();
        }
        c.globalCompositeOperation = "source-over"; break;
      case "rain":
        c.strokeStyle = L.color; c.lineWidth = 1.1; c.globalAlpha = .4;
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.y += p.v * dt * sm; p.x += p.v * 0.12 * dt * sm;
          if (p.y > h) { if (o.ripples && Math.random() < .5) L.splash.push({ x: p.x, y: h - R(2, 10), r: 0, a: .5, mx: R(4, 9) }); p.y = R(-40, -2); p.x = R(0, w); }
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - 0.12 * p.len, p.y - p.len); c.stroke();
        }
        c.globalAlpha = 1;
        if (o.ripples && L.splash) {
          c.strokeStyle = L.color;
          for (i = L.splash.length - 1; i >= 0; i--) { const s = L.splash[i]; s.r += 42 * dt; s.a -= 1.3 * dt; if (s.a <= 0) { L.splash.splice(i, 1); continue; } c.globalAlpha = s.a * 0.6; c.lineWidth = 1; c.beginPath(); c.ellipse(s.x, s.y, s.r, s.r * 0.4, 0, 0, 6.2832); c.stroke(); }
          c.globalAlpha = 1;
        }
        break;
      case "snow": {
        const wind = (o.wind || 0), gust = (o.gust || 0), fall = (o.fall || 40);
        const W = wind + Math.sin(t * 0.6) * gust + Math.sin(t * 1.7) * gust * 0.4;
        c.fillStyle = L.color; c.strokeStyle = L.color;
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.fr * dt; p.y += fall * p.vy * dt * sm;
          p.x += (W * (p.s / 3) + Math.sin(p.ph) * 8) * dt * sm;
          if (p.y > h + 6) { p.y = -6; p.x = R(-10, w + 10); } if (p.x < -12) p.x = w + 12; if (p.x > w + 12) p.x = -12;
          c.globalAlpha = .85;
          if (o.streak) { c.lineWidth = p.s * 0.6; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - W * 0.04, p.y - Math.abs(fall) * 0.03 - 3); c.stroke(); }
          else { c.beginPath(); c.arc(p.x, p.y, p.s * 0.9, 0, 6.2832); c.fill(); }
        }
        c.globalAlpha = 1; break;
      }
      case "grass":
        this.drawGrass(L, t); break;
      case "mist": {
        if (!L.tex) { break; }
        const mtw = L.tw, mth = L.th; let mi, mxx;
        c.globalCompositeOperation = "screen";
        for (mi = 0; mi < L.lyr.length; mi++) {
          const ly = L.lyr[mi];
          const dw = mtw * ly.scale, dh = mth * ly.scale;
          let off = (t * ly.spd * sm) % dw; if (off < 0) off += dw;
          const yy = (h - dh) + ly.yoff + Math.sin(t * 0.05 + mi) * mth * 0.02;
          c.globalAlpha = ly.alpha;
          for (mxx = -off; mxx < w; mxx += dw) { c.drawImage(L.tex, mxx, yy, dw, dh); }
        }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; break;
      }
      case "embers":
        c.globalCompositeOperation = "lighter";
        if (o.glowBottom) {
          const fl = 0.6 + 0.4 * Math.sin(t * 3.1) + 0.2 * Math.sin(t * 7.7);
          const bgg = c.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.7);
          bgg.addColorStop(0, rgba(L.color, 0.20 * fl)); bgg.addColorStop(1, rgba(L.color, 0));
          c.fillStyle = bgg; c.fillRect(0, 0, w, h);
        }
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.fr * dt; p.y -= p.vy * dt * sm; p.x += (p.vx + Math.sin(p.ph) * 12) * dt * sm;
          if (p.y < -6) { p.y = h + R(0, 24); p.x = R(0, w); }
          a = (0.35 + 0.5 * (0.5 + 0.5 * Math.sin(p.ph))) * (0.35 + 0.65 * (p.y / h));
          const eg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 4);
          eg.addColorStop(0, rgba(L.color2, a)); eg.addColorStop(.5, rgba(L.color, a * 0.6)); eg.addColorStop(1, rgba(L.color, 0));
          c.fillStyle = eg; c.beginPath(); c.arc(p.x, p.y, p.s * 4, 0, 6.2832); c.fill();
        }
        c.globalCompositeOperation = "source-over"; break;
      case "aurora": {
        const bx = this.bufx; if (!bx) { break; }
        bx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        bx.clearRect(0, 0, w, h);
        bx.globalCompositeOperation = "lighter";
        for (let ci = 0; ci < L.curt.length; ci++) {
          const cu = L.curt[ci];
          const driftY = Math.sin(t * 0.08 + cu.off) * h * 0.025; let kk;
          for (x = 0; x <= w; x += 6) {
            let fsum = 0, fden = 0; for (kk = 0; kk < cu.fold.length; kk++) { const of = cu.fold[kk]; fsum += of.a * Math.sin(x * of.f + t * of.sp + of.p); fden += of.a; }
            const baseY = cu.y + driftY + (fsum / fden) * cu.foldAmp;
            let rsum = 0, rden = 0; for (kk = 0; kk < cu.ray.length; kk++) { const orr = cu.ray[kk]; rsum += orr.a * Math.sin(x * orr.f + t * orr.sp + orr.p); rden += orr.a; }
            const rayH = cu.h * (0.15 + 0.85 * (0.5 + 0.5 * (rsum / rden)));
            let bsum = 0, bden = 0; for (kk = 0; kk < cu.brt.length; kk++) { const ob = cu.brt[kk]; bsum += ob.a * Math.sin(x * ob.f + t * ob.sp + ob.p); bden += ob.a; }
            const bnorm = 0.5 + 0.5 * (bsum / bden);
            const breathe = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.3 + x * 0.002 + cu.off2));
            let stri = 0.55 + 0.28 * Math.sin(x * cu.striF + cu.striP + t * 0.12) + 0.17 * Math.sin(x * cu.striF2 + cu.striP * 1.7);
            if (stri < 0) stri = 0;
            const alpha = cu.a * (0.1 + 0.9 * bnorm) * breathe * stri;
            if (alpha < 0.008) continue;
            const cidx = (Math.sin(x * 0.0035 + t * cu.csp + cu.cshift) * 0.5 + 0.5) * (AURORA_PALETTE.length - 1);
            const i0 = Math.floor(cidx), frc = cidx - i0; let i1 = i0 + 1; if (i1 >= AURORA_PALETTE.length) i1 = AURORA_PALETTE.length - 1;
            const C0 = AURORA_PALETTE[i0], C1 = AURORA_PALETTE[i1];
            const rr = Math.round(C0[0] + (C1[0] - C0[0]) * frc), gg = Math.round(C0[1] + (C1[1] - C0[1]) * frc), bb = Math.round(C0[2] + (C1[2] - C0[2]) * frc);
            let topY = baseY - rayH; if (topY < 0) topY = 0;
            const grd = bx.createLinearGradient(0, topY, 0, baseY);
            grd.addColorStop(0, "rgba(" + rr + "," + gg + "," + bb + ",0)");
            grd.addColorStop(0.55, "rgba(" + rr + "," + gg + "," + bb + "," + (alpha * 0.35) + ")");
            grd.addColorStop(1, "rgba(" + rr + "," + gg + "," + bb + "," + alpha + ")");
            bx.fillStyle = grd; bx.fillRect(x, topY, 7, baseY - topY);
          }
        }
        c.save();
        try { c.filter = "blur(" + Math.max(2, h * 0.014) + "px)"; } catch (e) { /* filter unsupported */ }
        c.globalCompositeOperation = "screen";
        c.drawImage(this.buf, 0, 0, w, h);
        c.restore();
        c.globalCompositeOperation = "source-over"; break;
      }
      case "wisps":
        c.globalCompositeOperation = "lighter";
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.pf * dt; p.tc -= dt; if (p.tc < 0) { p.vx = R(-6, 6); p.vy = R(-4, 4); p.tc = R(2, 5); }
          p.x += p.vx * dt * sm; p.y += (p.vy + Math.sin(p.ph) * 3) * dt * sm;
          if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10; if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
          a = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(p.ph));
          const wg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 7);
          wg.addColorStop(0, rgba(L.color2, a)); wg.addColorStop(.35, rgba(L.color, a * 0.5)); wg.addColorStop(1, rgba(L.color, 0));
          c.fillStyle = wg; c.beginPath(); c.arc(p.x, p.y, p.s * 7, 0, 6.2832); c.fill();
          c.fillStyle = rgba(L.color2, Math.min(1, a * 1.1)); c.beginPath(); c.arc(p.x, p.y, p.s * 0.85, 0, 6.2832); c.fill();
        }
        c.globalCompositeOperation = "source-over"; break;
      case "ripples":
        c.globalCompositeOperation = "screen";
        for (i = 0; i < L.cells.length; i++) {
          const ce = L.cells[i];
          const cx2 = w * (0.5 + 0.42 * Math.sin(t * ce.sx + ce.ax)), cy2 = h * (0.5 + 0.42 * Math.sin(t * ce.sy + ce.ay));
          const ca = 0.04 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.3 + ce.ph));
          const cg2 = c.createRadialGradient(cx2, cy2, 0, cx2, cy2, ce.r);
          cg2.addColorStop(0, rgba(L.color2, ca)); cg2.addColorStop(1, rgba(L.color2, 0));
          c.fillStyle = cg2; c.beginPath(); c.ellipse(cx2, cy2, ce.r, ce.r * 0.6, 0, 0, 6.2832); c.fill();
        }
        L.spawnT -= dt; if (L.spawnT <= 0) { L.rips.push({ x: R(w * 0.08, w * 0.92), y: R(h * 0.14, h * 0.92), r: R(2, 6), mx: R(h * 0.16, h * 0.4), sp: R(28, 58) }); L.spawnT = R(0.28, 0.75) / Math.max(0.6, this.cMul); }
        c.lineWidth = 1.4;
        for (i = L.rips.length - 1; i >= 0; i--) {
          const rp = L.rips[i]; rp.r += rp.sp * dt * sm; const frac = rp.r / rp.mx;
          if (frac >= 1) { L.rips.splice(i, 1); continue; }
          const ra = 0.55 * (1 - frac);
          c.strokeStyle = rgba(L.color2, ra); c.beginPath(); c.ellipse(rp.x, rp.y, rp.r, rp.r * 0.42, 0, 0, 6.2832); c.stroke();
          if (frac > 0.28) { c.strokeStyle = rgba(L.color, ra * 0.5); c.beginPath(); c.ellipse(rp.x, rp.y, rp.r * 0.62, rp.r * 0.26, 0, 0, 6.2832); c.stroke(); }
        }
        c.globalCompositeOperation = "source-over"; break;
      case "kelp": {
        const kf1 = hexRgb(L.color);
        for (i = 0; i < L.fronds.length; i++) {
          const fr = L.fronds[i]; const baseY = h + 4, N = fr.segs; let sgi;
          const cxs = [], cys = [];
          for (sgi = 0; sgi <= N; sgi++) {
            const frac = sgi / N;
            cys.push(baseY - frac * fr.h);
            cxs.push(fr.x + Math.sin(t * fr.sp + fr.ph + frac * fr.curl) * (18 * fr.dep + 8) * frac + Math.sin(t * fr.sp * 0.6 + frac * 2.0) * 6 * frac);
          }
          const shade = 0.5 + 0.5 * fr.dep;
          c.globalAlpha = 0.35 + 0.4 * fr.dep;
          c.fillStyle = "rgb(" + Math.round(kf1[0] * shade) + "," + Math.round(kf1[1] * shade) + "," + Math.round(kf1[2] * shade) + ")";
          c.beginPath();
          for (sgi = 0; sgi <= N; sgi++) { const hw = fr.w * (1 - (sgi / N) * 0.8) / 2; if (sgi === 0) c.moveTo(cxs[sgi] - hw, cys[sgi]); else c.lineTo(cxs[sgi] - hw, cys[sgi]); }
          for (sgi = N; sgi >= 0; sgi--) { const hw2 = fr.w * (1 - (sgi / N) * 0.8) / 2; c.lineTo(cxs[sgi] + hw2, cys[sgi]); }
          c.closePath(); c.fill();
          c.globalAlpha = (0.35 + 0.4 * fr.dep) * 0.5; c.strokeStyle = rgba(L.color2, 0.6); c.lineWidth = 1;
          c.beginPath(); for (sgi = 0; sgi <= N; sgi++) { const hw3 = fr.w * (1 - (sgi / N) * 0.8) / 2; if (sgi === 0) c.moveTo(cxs[sgi] - hw3, cys[sgi]); else c.lineTo(cxs[sgi] - hw3, cys[sgi]); } c.stroke();
        }
        c.globalAlpha = 1; break;
      }
      case "bubbles":
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.wf * dt; p.y -= p.vy * dt * sm; p.x += Math.sin(p.ph) * p.wob * dt;
          if (p.y < -8) { p.y = h + R(0, 30); p.x = R(0, w); }
          c.globalAlpha = .5; c.strokeStyle = rgba(L.color, .6); c.lineWidth = 1;
          c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832); c.stroke();
          c.globalAlpha = .13; c.fillStyle = L.color; c.fill();
          c.globalAlpha = .6; c.fillStyle = "rgba(255,255,255,.75)";
          c.beginPath(); c.arc(p.x - p.r * 0.32, p.y - p.r * 0.32, Math.max(.6, p.r * 0.26), 0, 6.2832); c.fill();
        }
        c.globalAlpha = 1; break;
      case "motes":
        c.fillStyle = L.color;
        for (i = 0; i < L.parts.length; i++) {
          p = L.parts[i]; p.ph += p.pf * dt; p.x += (p.vx + Math.sin(p.ph) * 4) * dt * sm; p.y += p.vy * dt * sm * 0.4;
          if (p.x < -6) p.x = w + 6; if (p.x > w + 6) p.x = -6; if (p.y < -6) p.y = h + 6; if (p.y > h + 6) p.y = -6;
          c.globalAlpha = Math.max(0, p.a * (0.6 + 0.4 * Math.sin(p.ph)));
          c.beginPath(); c.arc(p.x, p.y, p.s, 0, 6.2832); c.fill();
        }
        c.globalAlpha = 1; break;
    }
  }

  drawTree(L, t) {
    const c = this.ctx, w = this.w, h = this.h;
    const tx = w * 0.72, base = h * 1.0, trunkH = h * 0.36, sway = Math.sin(t * 0.7) * 7 + Math.sin(t * 1.9) * 2;
    c.globalCompositeOperation = "screen";
    const bl = c.createRadialGradient(tx + sway * 0.5, base - trunkH - h * 0.06, 0, tx + sway * 0.5, base - trunkH - h * 0.06, h * 0.34);
    bl.addColorStop(0, rgba(L.color, 0.10)); bl.addColorStop(1, rgba(L.color, 0));
    c.fillStyle = bl; c.beginPath(); c.arc(tx + sway * 0.5, base - trunkH - h * 0.06, h * 0.34, 0, 6.2832); c.fill();
    c.globalCompositeOperation = "source-over";
    c.strokeStyle = "#0a1a10"; c.lineWidth = Math.max(4, h * 0.016); c.lineCap = "round";
    c.beginPath(); c.moveTo(tx, base); c.quadraticCurveTo(tx + sway * 0.3, base - trunkH * 0.6, tx + sway, base - trunkH); c.stroke();
    c.lineWidth = Math.max(2, h * 0.008);
    c.beginPath(); c.moveTo(tx + sway * 0.55, base - trunkH * 0.55); c.lineTo(tx + sway * 0.7 - h * 0.06, base - trunkH * 0.78); c.stroke();
    c.beginPath(); c.moveTo(tx + sway * 0.7, base - trunkH * 0.68); c.lineTo(tx + sway * 0.8 + h * 0.05, base - trunkH * 0.9); c.stroke();
    c.fillStyle = "#0e2216";
    const cx = tx + sway, cy = base - trunkH - h * 0.05;
    const blobs = [[0, 0, h * 0.15], [-h * 0.10, h * 0.03, h * 0.11], [h * 0.10, h * 0.02, h * 0.11], [0, -h * 0.09, h * 0.10]];
    for (let bi = 0; bi < blobs.length; bi++) { c.beginPath(); c.ellipse(cx + blobs[bi][0], cy + blobs[bi][1], blobs[bi][2], blobs[bi][2] * 0.9, 0, 0, 6.2832); c.fill(); }
    c.strokeStyle = rgba(L.color, 0.28); c.lineWidth = 1.4;
    c.beginPath(); c.ellipse(cx, cy - h * 0.02, h * 0.15, h * 0.13, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  }

  drawGrass(L, t) {
    const c = this.ctx, w = this.w, h = this.h, sm = this.sMul, o = L.opts, sway = (o.sway || 1), sp = (o.speed || 1) * sm, baseY = h + 2;
    const c2 = hexRgb(L.color2), c1 = hexRgb(L.color);
    for (let i = 0; i < L.blades.length; i++) {
      const b = L.blades[i];
      const bend = Math.sin(t * sp * 1.4 + b.ph + b.x * 0.012) * b.h * 0.24 * sway;
      const tipX = b.x + bend, tipY = baseY - b.h;
      const m = b.depth;
      const col = "rgb(" + Math.round(c2[0] + (c1[0] - c2[0]) * m) + "," + Math.round(c2[1] + (c1[1] - c2[1]) * m) + "," + Math.round(c2[2] + (c1[2] - c2[2]) * m) + ")";
      c.fillStyle = col; c.globalAlpha = 0.55 + 0.45 * m;
      c.beginPath(); c.moveTo(b.x - b.w, baseY);
      c.quadraticCurveTo(b.x + bend * 0.4, baseY - b.h * 0.55, tipX, tipY);
      c.quadraticCurveTo(b.x + bend * 0.4 + b.w, baseY - b.h * 0.55, b.x + b.w, baseY);
      c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
  }

  frame(now) {
    let dt = (now - this.last) / 1000; if (!(dt > 0)) dt = 0.016; if (dt > 0.05) dt = 0.05; this.last = now; this.t += dt;
    this.step(dt);
    this.raf = requestAnimationFrame(this._frame);
  }

  start() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.last = performance.now ? performance.now() : 0;
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
}
