// Canvas renderer: terrain, rivers, borders, cities, units, fog, overlays.
import { hexToPixel, pixelToHex, hexCorners, SQRT3 } from './hex.js';
import { TERRAIN, SPECIALTY, UNITS, RESOURCES, IMPROVEMENTS } from './data.js';

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.min(255, Math.max(0, Math.round(r * f)));
  g = Math.min(255, Math.max(0, Math.round(g * f)));
  b = Math.min(255, Math.max(0, Math.round(b * f)));
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.size = 28;
    this.camX = 0; this.camY = 0;
    this.viewer = 0;
    this.highlights = new Map(); // idx -> 'move'|'attack'|'settle'
    this.selected = null;
    this.hover = null;
    this.anims = [];
    this.dirty = true;
    this.revealAll = false;
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.vw = r.width; this.vh = r.height;
    this.dirty = true;
  }

  worldSize() {
    const g = this.game;
    return [this.size * SQRT3 * (g.W + 0.5), this.size * 1.5 * (g.H - 1) + this.size * 2];
  }

  centerOn(i) {
    const [c, r] = this.game.cr(i);
    const [x, y] = hexToPixel(c, r, this.size);
    this.camX = x - this.vw / 2;
    this.camY = y - this.vh / 2;
    this.clampCam();
    this.dirty = true;
  }

  clampCam() {
    const [ww, wh] = this.worldSize();
    this.camX = Math.max(-this.vw * 0.5, Math.min(ww - this.vw * 0.5, this.camX));
    this.camY = Math.max(-this.vh * 0.5, Math.min(wh - this.vh * 0.5, this.camY));
  }

  zoomAt(px, py, factor) {
    const wx = (px + this.camX) / this.size, wy = (py + this.camY) / this.size;
    this.size = Math.max(10, Math.min(70, this.size * factor));
    this.camX = wx * this.size - px;
    this.camY = wy * this.size - py;
    this.clampCam();
    this.dirty = true;
  }

  screenToTile(px, py) {
    const [c, r] = pixelToHex(px + this.camX, py + this.camY, this.size);
    if (c < 0 || r < 0 || c >= this.game.W || r >= this.game.H) return null;
    return r * this.game.W + c;
  }

  tileCenter(i) {
    const [c, r] = this.game.cr(i);
    const [x, y] = hexToPixel(c, r, this.size);
    return [x - this.camX, y - this.camY];
  }

  addAnim(a) { a.t0 = performance.now(); this.anims.push(a); this.dirty = true; }

  draw() {
    const g = this.game, ctx = this.ctx, S = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b1622';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const pl = g.players[this.viewer];
    const explored = this.revealAll ? null : pl.explored;
    const vis = this.revealAll ? null : (pl._vis || g.vision(this.viewer));

    // visible tile range
    const r0 = Math.max(0, Math.floor((this.camY - S) / (S * 1.5)));
    const r1 = Math.min(g.H - 1, Math.ceil((this.camY + this.vh + S) / (S * 1.5)));
    const c0 = Math.max(0, Math.floor(this.camX / (S * SQRT3)) - 1);
    const c1 = Math.min(g.W - 1, Math.ceil((this.camX + this.vw) / (S * SQRT3)) + 1);
    const list = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) list.push(r * g.W + c);

    // pass 1: terrain
    for (const i of list) {
      if (explored && !explored[i]) continue;
      const [x, y] = this.tileCenter(i);
      const tl = g.tiles[i];
      const T = TERRAIN[tl.t];
      const elevTint = 0.92 + ((g.elev[i] * 997) % 1) * 0.12;
      this.hexPath(x, y, S + 0.6);
      ctx.fillStyle = shade(T.color, elevTint);
      ctx.fill();
      this.drawTerrainGlyph(tl.t, x, y, S, i);
    }
    // rivers
    ctx.lineCap = 'round';
    for (const i of list) {
      if (explored && !explored[i]) continue;
      const tl = g.tiles[i];
      if (!tl.river || tl.riverTo < 0) continue;
      const [x, y] = this.tileCenter(i);
      const [x2, y2] = this.tileCenter(tl.riverTo);
      ctx.strokeStyle = '#4aa6e0';
      ctx.lineWidth = Math.max(2, S * 0.16);
      ctx.beginPath(); ctx.moveTo(x, y);
      const mx = (x + x2) / 2 + ((i * 7) % 5 - 2) * S * 0.05, my = (y + y2) / 2;
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();
    }
    // resources / improvements / ruins
    for (const i of list) {
      if (explored && !explored[i]) continue;
      const tl = g.tiles[i];
      const [x, y] = this.tileCenter(i);
      if (tl.res && tl.city < 0) {
        const R = RESOURCES[tl.res];
        ctx.fillStyle = R.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        const rx = x + S * 0.38, ry = y + S * 0.3, rr = S * 0.13;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (tl.imp) this.drawImprovement(tl.imp, x, y, S);
      if (tl.ruin) {
        ctx.fillStyle = '#6d5b4b'; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1;
        for (let k = -1; k <= 1; k++) {
          ctx.fillRect(x + k * S * 0.18 - S * 0.06, y - S * 0.15 - (k === 0 ? S * 0.1 : 0), S * 0.12, S * 0.32 + (k === 0 ? S * 0.1 : 0));
        }
        ctx.fillRect(x - S * 0.3, y + S * 0.15, S * 0.6, S * 0.07);
      }
    }
    // borders
    for (const i of list) {
      if (explored && !explored[i]) continue;
      const tl = g.tiles[i];
      if (tl.owner < 0) continue;
      const [x, y] = this.tileCenter(i);
      const col = g.players[tl.owner].color;
      const corners = hexCorners(x, y, S - 1.5);
      const nb = this.neighborDirs(i);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, S * 0.09);
      for (let k = 0; k < 6; k++) {
        const n = nb[k];
        if (n !== null && g.tiles[n].owner === tl.owner) continue;
        const a = corners[(k + 5) % 6], b = corners[k];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.globalAlpha = 0.12;
      this.hexPath(x, y, S);
      ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1;
    }
    // highlights
    for (const [i, kind] of this.highlights) {
      const [x, y] = this.tileCenter(i);
      this.hexPath(x, y, S * 0.86);
      if (kind === 'move') { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      else if (kind === 'attack') { ctx.fillStyle = 'rgba(255,60,40,0.28)'; ctx.fill(); ctx.strokeStyle = '#ff5a40'; ctx.lineWidth = 2.5; ctx.stroke(); }
      else if (kind === 'capture') { ctx.fillStyle = 'rgba(255,200,40,0.3)'; ctx.fill(); ctx.strokeStyle = '#ffd040'; ctx.lineWidth = 2.5; ctx.stroke(); }
      else if (kind === 'site') { ctx.strokeStyle = 'rgba(120,255,140,0.8)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    }
    // cities
    for (const c of g.cities) {
      if (explored && !explored[c.idx]) continue;
      const [x, y] = this.tileCenter(c.idx);
      if (x < -S * 2 || y < -S * 2 || x > this.vw + S * 2 || y > this.vh + S * 2) continue;
      this.drawCity(c, x, y, S);
    }
    // fog overlay for explored-but-not-visible
    if (vis) {
      ctx.fillStyle = 'rgba(8,14,22,0.42)';
      for (const i of list) {
        if (!explored[i] || vis[i]) continue;
        const [x, y] = this.tileCenter(i);
        this.hexPath(x, y, S + 0.6);
        ctx.fill();
      }
    }
    // units
    const now = performance.now();
    for (const u of g.units) {
      if (vis && !vis[u.idx]) continue;
      if (g.isHiddenFrom(u, this.viewer) && !this.revealAll) continue;
      let [x, y] = this.tileCenter(u.idx);
      const mv = this.anims.find(a => a.type === 'move' && a.uid === u.id);
      if (mv) {
        const t = Math.min(1, (now - mv.t0) / mv.dur);
        const [fx, fy] = this.tileCenter(mv.from);
        const e = t * (2 - t);
        x = fx + (x - fx) * e; y = fy + (y - fy) * e;
      }
      this.drawUnit(u, x, y, S);
    }
    // selection ring
    if (this.selected != null) {
      const [x, y] = this.tileCenter(this.selected);
      this.hexPath(x, y, S * 0.95);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    if (this.hover != null) {
      const [x, y] = this.tileCenter(this.hover);
      this.hexPath(x, y, S * 0.95);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (this.hover != null && this.hoverLabel) {
      const [x, y] = this.tileCenter(this.hover);
      ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      const lines = this.hoverLabel.split('\n');
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14;
      const hgt = lines.length * 16 + 8;
      ctx.fillStyle = 'rgba(10,14,20,0.92)'; ctx.strokeStyle = '#ff7a50'; ctx.lineWidth = 1;
      ctx.fillRect(x - w / 2, y - S - hgt, w, hgt); ctx.strokeRect(x - w / 2, y - S - hgt, w, hgt);
      ctx.fillStyle = '#fff';
      lines.forEach((l, k) => ctx.fillText(l, x, y - S - hgt + 18 + k * 16));
    }
    // goto path markers
    if (this.gotoMarks) for (const i of this.gotoMarks) {
      const [x, y] = this.tileCenter(i);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, S * 0.3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    // floating anims
    this.anims = this.anims.filter(a => now - a.t0 < a.dur);
    for (const a of this.anims) {
      const t = (now - a.t0) / a.dur;
      if (a.type === 'text') {
        const [x, y] = this.tileCenter(a.idx);
        ctx.globalAlpha = 1 - t;
        ctx.font = `bold ${Math.max(12, S * 0.55)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        ctx.strokeText(a.text, x, y - S * 0.6 - t * S);
        ctx.fillStyle = a.color || '#fff';
        ctx.fillText(a.text, x, y - S * 0.6 - t * S);
        ctx.globalAlpha = 1;
      } else if (a.type === 'shot') {
        const [x1, y1] = this.tileCenter(a.from), [x2, y2] = this.tileCenter(a.to);
        const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * S * 0.8;
        ctx.fillStyle = '#ffeb90';
        ctx.beginPath(); ctx.arc(px, py, S * 0.1, 0, Math.PI * 2); ctx.fill();
      } else if (a.type === 'flash') {
        const [x, y] = this.tileCenter(a.idx);
        this.hexPath(x, y, S);
        ctx.fillStyle = `rgba(255,80,40,${0.5 * (1 - t)})`; ctx.fill();
      }
    }
    this.dirty = this.anims.length > 0;
  }

  neighborDirs(i) {
    // returns neighbor idx in order matching hexCorners edges (E, SE?..) — computed by pixel direction
    const g = this.game;
    const [c, r] = g.cr(i);
    const odd = r & 1;
    // edge k is between corner k-1 and k; corner angles -30+60k: edge 0 (between -90 & -30) faces NE
    const dirs = odd
      ? [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [0, -1]]
      : [[0, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    return dirs.map(([dc, dr]) => {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.W || nr >= g.H) return null;
      return nr * g.W + nc;
    });
  }

  hexPath(x, y, s) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k - 30);
      const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  drawTerrainGlyph(t, x, y, S, i) {
    const ctx = this.ctx;
    const jx = (((i * 13) % 7) - 3) * S * 0.03, jy = (((i * 29) % 5) - 2) * S * 0.03;
    if (S < 14) return;
    switch (t) {
      case 'forest': {
        ctx.fillStyle = '#2a5e2a';
        for (const [dx, dy] of [[-0.3, 0.05], [0.25, -0.1], [0, 0.3]]) {
          const px = x + dx * S + jx, py = y + dy * S + jy;
          ctx.beginPath(); ctx.moveTo(px, py - S * 0.32); ctx.lineTo(px + S * 0.18, py + S * 0.05); ctx.lineTo(px - S * 0.18, py + S * 0.05); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'hills': {
        ctx.strokeStyle = '#7a6a3a'; ctx.lineWidth = Math.max(1.2, S * 0.07);
        for (const [dx, dy] of [[-0.25, 0.1], [0.22, -0.12]]) {
          ctx.beginPath(); ctx.arc(x + dx * S + jx, y + dy * S + S * 0.15 + jy, S * 0.25, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        }
        break;
      }
      case 'mountain': {
        ctx.fillStyle = '#6c6762';
        ctx.beginPath(); ctx.moveTo(x - S * 0.5, y + S * 0.3); ctx.lineTo(x - S * 0.1, y - S * 0.42); ctx.lineTo(x + S * 0.25, y + S * 0.3); ctx.fill();
        ctx.fillStyle = '#7b7671';
        ctx.beginPath(); ctx.moveTo(x - S * 0.05, y + S * 0.3); ctx.lineTo(x + S * 0.25, y - S * 0.2); ctx.lineTo(x + S * 0.55, y + S * 0.3); ctx.fill();
        ctx.fillStyle = '#f0f0f0';
        ctx.beginPath(); ctx.moveTo(x - S * 0.1, y - S * 0.42); ctx.lineTo(x - S * 0.2, y - S * 0.22); ctx.lineTo(x, y - S * 0.22); ctx.fill();
        break;
      }
      case 'marsh': {
        ctx.strokeStyle = '#3e5a48'; ctx.lineWidth = Math.max(1, S * 0.05);
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath(); ctx.moveTo(x - S * 0.3 + jx, y + k * S * 0.22 + jy); ctx.lineTo(x + S * 0.3 + jx, y + k * S * 0.22 + jy); ctx.stroke();
        }
        ctx.strokeStyle = '#7a9a5a';
        ctx.beginPath(); ctx.moveTo(x + S * 0.15, y + S * 0.1); ctx.lineTo(x + S * 0.12, y - S * 0.25); ctx.moveTo(x + S * 0.22, y + S * 0.1); ctx.lineTo(x + S * 0.28, y - S * 0.18); ctx.stroke();
        break;
      }
      case 'desert': {
        ctx.strokeStyle = '#c9b06a'; ctx.lineWidth = Math.max(1, S * 0.05);
        ctx.beginPath(); ctx.moveTo(x - S * 0.4 + jx, y + jy); ctx.quadraticCurveTo(x - S * 0.1 + jx, y - S * 0.2 + jy, x + S * 0.2 + jx, y + jy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - S * 0.1 - jx, y + S * 0.25); ctx.quadraticCurveTo(x + S * 0.15, y + S * 0.05, x + S * 0.4, y + S * 0.25); ctx.stroke();
        break;
      }
      case 'steppe': {
        ctx.strokeStyle = '#a69d55'; ctx.lineWidth = Math.max(1, S * 0.045);
        for (const [dx, dy] of [[-0.25, 0.1], [0.2, -0.15], [0.1, 0.3]]) {
          const px = x + dx * S + jx, py = y + dy * S + jy;
          ctx.beginPath(); ctx.moveTo(px - S * 0.08, py - S * 0.12); ctx.lineTo(px, py); ctx.lineTo(px + S * 0.08, py - S * 0.12); ctx.moveTo(px, py); ctx.lineTo(px, py - S * 0.15); ctx.stroke();
        }
        break;
      }
      case 'plains': {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(x + jx, y + jy, S * 0.25, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'ocean': case 'shallows': {
        ctx.strokeStyle = t === 'ocean' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = Math.max(1, S * 0.05);
        ctx.beginPath(); ctx.moveTo(x - S * 0.3 + jx, y + jy); ctx.quadraticCurveTo(x - S * 0.15 + jx, y - S * 0.12 + jy, x + jx, y + jy); ctx.quadraticCurveTo(x + S * 0.15 + jx, y + S * 0.12 + jy, x + S * 0.3 + jx, y + jy); ctx.stroke();
        break;
      }
    }
  }

  drawImprovement(k, x, y, S) {
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(1, S * 0.05);
    switch (k) {
      case 'farm': case 'irrigate': case 'reedbeds':
        ctx.strokeStyle = k === 'farm' ? '#e8d050' : k === 'irrigate' ? '#50c8e0' : '#a0c070';
        for (let d = -2; d <= 2; d++) { ctx.beginPath(); ctx.moveTo(x - S * 0.45, y + d * S * 0.12); ctx.lineTo(x + S * 0.45, y + d * S * 0.12); ctx.stroke(); }
        break;
      case 'pasture':
        ctx.strokeStyle = '#7a5a3a';
        ctx.strokeRect(x - S * 0.35, y - S * 0.25, S * 0.7, S * 0.5);
        break;
      case 'lumber':
        ctx.fillStyle = '#8a5a2a';
        ctx.fillRect(x - S * 0.3, y + S * 0.15, S * 0.6, S * 0.1); ctx.fillRect(x - S * 0.25, y + S * 0.03, S * 0.5, S * 0.1);
        break;
      case 'mine': case 'quarry':
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath(); ctx.arc(x, y + S * 0.15, S * 0.16, Math.PI, 0); ctx.fill();
        ctx.fillStyle = k === 'mine' ? '#c0c0d8' : '#d8d0b0';
        ctx.fillRect(x - S * 0.22, y + S * 0.15, S * 0.44, S * 0.06);
        break;
    }
  }

  drawCity(c, x, y, S) {
    const ctx = this.ctx, g = this.game;
    const col = g.players[c.owner].color;
    const spec = SPECIALTY[c.specialty];
    // base plate in specialty color
    ctx.fillStyle = spec.color;
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    this.hexPath(x, y, S * 0.62); ctx.fill(); ctx.stroke();
    // buildings: houses count by level
    const n = Math.min(5, 1 + Math.floor(c.level / 2));
    const pos = [[0, -0.1], [-0.25, 0.1], [0.25, 0.1], [-0.12, 0.3], [0.14, 0.3]];
    for (let k = 0; k < n; k++) {
      const [dx, dy] = pos[k];
      const hx = x + dx * S, hy = y + dy * S, w = S * 0.22;
      ctx.fillStyle = col;
      ctx.fillRect(hx - w / 2, hy - w * 0.4, w, w * 0.7);
      ctx.fillStyle = '#5a3a2a';
      ctx.beginPath(); ctx.moveTo(hx - w * 0.6, hy - w * 0.4); ctx.lineTo(hx, hy - w); ctx.lineTo(hx + w * 0.6, hy - w * 0.4); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8; ctx.strokeRect(hx - w / 2, hy - w * 0.4, w, w * 0.7);
    }
    if (c.buildings.includes('walls')) {
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1.5, S * 0.07);
      this.hexPath(x, y, S * 0.7); ctx.stroke();
    }
    if (c.capital) {
      ctx.fillStyle = '#ffd700';
      const sx = x, sy = y - S * 0.62;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + k * Math.PI * 2 / 5, a2 = a + Math.PI / 5;
        ctx.lineTo(sx + Math.cos(a) * S * 0.16, sy + Math.sin(a) * S * 0.16);
        ctx.lineTo(sx + Math.cos(a2) * S * 0.07, sy + Math.sin(a2) * S * 0.07);
      }
      ctx.fill();
    }
    // label
    if (S >= 14) {
      const fs = Math.max(10, Math.min(15, S * 0.42));
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      const label = `${c.level} ${c.name}`;
      const tw = ctx.measureText(label).width + 10;
      const ly = y + S * 0.95;
      ctx.fillStyle = 'rgba(10,10,15,0.78)';
      ctx.fillRect(x - tw / 2, ly - fs * 0.85, tw, fs * 1.25);
      ctx.fillStyle = col;
      ctx.fillRect(x - tw / 2, ly - fs * 0.85, 3, fs * 1.25);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, ly + fs * 0.1);
      // pop pips
      const need = c.level + 1;
      const pw = Math.min(6, (tw - 8) / need);
      for (let k = 0; k < need; k++) {
        ctx.fillStyle = k < c.pop ? '#7ddc6a' : 'rgba(255,255,255,0.25)';
        ctx.fillRect(x - (need * pw) / 2 + k * pw + 0.5, ly + fs * 0.45, pw - 1, 3);
      }
    }
  }

  drawUnit(u, x, y, S) {
    const ctx = this.ctx, g = this.game;
    const col = g.players[u.owner].color;
    const U = UNITS[u.type];
    const embarked = g.embarked(u);
    const rad = S * 0.36;
    const cy = y - S * 0.05;
    if (embarked || U.traits?.includes('naval')) {
      ctx.fillStyle = '#6a4a2a';
      ctx.beginPath(); ctx.moveTo(x - rad * 1.3, cy + rad * 0.3); ctx.lineTo(x + rad * 1.3, cy + rad * 0.3); ctx.lineTo(x + rad * 0.9, cy + rad * 0.9); ctx.lineTo(x - rad * 0.9, cy + rad * 0.9); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + rad * 0.85, rad * 0.9, rad * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.strokeStyle = u.vet ? '#ffd700' : '#111';
    ctx.lineWidth = u.vet ? 2.5 : 1.5;
    ctx.beginPath();
    if (U.traits?.includes('mounted')) {
      ctx.moveTo(x, cy - rad); ctx.lineTo(x + rad, cy); ctx.lineTo(x, cy + rad); ctx.lineTo(x - rad, cy); ctx.closePath();
    } else if (U.rng > 1) {
      ctx.moveTo(x, cy - rad); ctx.lineTo(x + rad * 0.95, cy + rad * 0.75); ctx.lineTo(x - rad * 0.95, cy + rad * 0.75); ctx.closePath();
    } else if (u.type === 'settler') {
      ctx.rect(x - rad * 0.8, cy - rad * 0.8, rad * 1.6, rad * 1.6);
    } else {
      ctx.arc(x, cy, rad, 0, Math.PI * 2);
    }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(9, rad * 1.05)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const gl = U.glyph;
    ctx.strokeText(gl, x, cy + (U.rng > 1 ? rad * 0.2 : 0));
    ctx.fillText(gl, x, cy + (U.rng > 1 ? rad * 0.2 : 0));
    ctx.textBaseline = 'alphabetic';
    // hp bar
    const mh = g.maxHp(u);
    if (u.hp < mh) {
      const bw = rad * 1.8;
      ctx.fillStyle = '#300'; ctx.fillRect(x - bw / 2, cy - rad - 6, bw, 4);
      ctx.fillStyle = u.hp / mh > 0.5 ? '#6f6' : u.hp / mh > 0.25 ? '#fc4' : '#f44';
      ctx.fillRect(x - bw / 2, cy - rad - 6, bw * u.hp / mh, 4);
    }
    // exhausted indicator
    if (u.owner === g.current && g.players[u.owner].human && u.mvLeft <= 0 && (u.attacked || g.attackTargets(u).length === 0)) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(x, cy, rad, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawMinimap(mc) {
    const g = this.game, ctx = mc.getContext('2d');
    const w = mc.width, h = mc.height;
    const sx = w / (g.W + 0.5), sy = h / g.H;
    ctx.fillStyle = '#0b1622'; ctx.fillRect(0, 0, w, h);
    const pl = g.players[this.viewer];
    for (let i = 0; i < g.tiles.length; i++) {
      if (!this.revealAll && !pl.explored[i]) continue;
      const [c, r] = g.cr(i);
      const tl = g.tiles[i];
      ctx.fillStyle = tl.owner >= 0 ? g.players[tl.owner].color : TERRAIN[tl.t].color;
      if (tl.owner >= 0 && tl.city < 0) ctx.globalAlpha = 0.7;
      ctx.fillRect((c + 0.5 * (r & 1)) * sx, r * sy, sx + 0.5, sy + 0.5);
      ctx.globalAlpha = 1;
      if (tl.city >= 0) { ctx.fillStyle = '#fff'; ctx.fillRect((c + 0.5 * (r & 1)) * sx - 1, r * sy - 1, sx + 2, sy + 2); }
    }
    // viewport
    const [ww, wh] = this.worldSize();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(this.camX / ww * w, this.camY / wh * h, this.vw / ww * w, this.vh / wh * h);
  }
}
