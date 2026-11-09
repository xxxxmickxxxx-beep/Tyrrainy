// Procedural world generation: elevation, climate, biomes, rivers, resources.
import { makeRng, makeNoise } from './rng.js';
import { neighborsOf, hexDist } from './hex.js';
import { TERRAIN } from './data.js';

export const MAP_SIZES = {
  tiny:   { W: 22, H: 16, label: 'Tiny (22×16)' },
  small:  { W: 32, H: 22, label: 'Small (32×22)' },
  medium: { W: 44, H: 30, label: 'Medium (44×30)' },
  large:  { W: 60, H: 40, label: 'Large (60×40)' },
  huge:   { W: 80, H: 52, label: 'Huge (80×52)' },
};

export const MAP_TYPES = {
  continents: { label: 'Continents', water: 0.45 },
  pangaea:    { label: 'Pangaea', water: 0.30 },
  archipelago:{ label: 'Archipelago', water: 0.58 },
  lakes:      { label: 'Lakeland', water: 0.20 },
};

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

// Landmasses come from "plates": seeds spread east–west, each tile belongs to its nearest seed
// (by a noise-warped distance), and the seam between two plates is forced to sea. So continents
// are genuinely separate (the old pure-noise maps always fused into one landmass), and the
// straits between them vary: narrow ones are shallows (Sailing), wide ones open ocean
// (Navigation). Noise is periodic east–west so the map can wrap.
const PLATES = {
  continents:  (W, H) => Math.max(2, Math.min(6, Math.round(W * H / 650))),
  archipelago: (W, H) => Math.max(6, Math.round(W * H / 110)),
  pangaea:     () => 1,
  lakes:       () => 0, // pure noise: one land with many lakes
};

export function generateMap(W, H, seed, type = 'continents', wrap = false) {
  const rng = makeRng(seed + ':map');
  const nElev = makeNoise(rng.int(1e9));
  const nCont = makeNoise(rng.int(1e9));
  const nMoist = makeNoise(rng.int(1e9));
  const nTemp = makeNoise(rng.int(1e9));
  const nWarpX = makeNoise(rng.int(1e9)), nWarpY = makeNoise(rng.int(1e9)), nGap = makeNoise(rng.int(1e9));
  const N = W * H;
  const elev = new Float32Array(N);
  const moist = new Float32Array(N);
  const temp = new Float32Array(N);
  const cfg = MAP_TYPES[type] || MAP_TYPES.continents;
  const scale = 8 / Math.max(W, H);
  // sample noise at a tile, `f` times the base frequency; periodic east–west when wrapping
  const sample = (noise, f, c, r, oct) => {
    const px = c + 0.5 * (r & 1);
    if (!wrap) return noise(px * scale * 1.15 * f, r * scale * 1.3 * f, oct);
    const period = Math.max(1, Math.round(W * scale * 1.15 * f));
    return noise(px / W * period, r * scale * 1.3 * f, oct, period);
  };
  // plate seeds: evenly spread in longitude, kept off the poles
  const nPlates = (PLATES[type] || PLATES.continents)(W, H);
  const seeds = [];
  for (let k = 0; k < nPlates; k++) {
    const x = nPlates === 1 ? W / 2 : (k + 0.2 + rng() * 0.6) * W / nPlates;
    const y = H * (0.28 + rng() * 0.44);
    seeds.push({ x, y, w: 0.85 + rng() * 0.3 }); // w: plate weight (bigger plates win more land)
  }
  if (type === 'archipelago') rng.shuffle(seeds).forEach(sd => { sd.y = H * (0.12 + rng() * 0.76); });
  const warpAmp = type === 'archipelago' ? 2.5 : 5;
  const gapBase = type === 'archipelago' ? 2.2 : 2.6;

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const px = c + 0.5 * (r & 1), py = r * 0.866;
      let e = sample(nElev, 1.6, c, r, 5);
      if (nPlates > 0) {
        // nearest and second-nearest plate by warped distance
        const wx = px + (sample(nWarpX, 1.1, c, r, 3) - 0.5) * 2 * warpAmp;
        const wy = py + (sample(nWarpY, 1.1, c, r, 3) - 0.5) * 2 * warpAmp;
        let d1 = Infinity, d2 = Infinity, s1 = null;
        for (const sd of seeds) {
          let dx = Math.abs(wx - sd.x);
          if (wrap) dx = Math.min(dx, W - dx);
          const d = Math.hypot(dx, wy - sd.y * 0.866) / sd.w;
          if (d < d1) { d2 = d1; d1 = d; s1 = sd; } else if (d < d2) d2 = d;
        }
        const reach = Math.sqrt(W * H / Math.max(1, nPlates)) * 0.55; // a plate's typical radius
        const shape = 1 - d1 / reach;
        if (type === 'archipelago') e = e * 0.45 + sample(nElev, 3.5, c, r, 3) * 0.2 + shape * 0.45;
        else e = e * 0.5 + shape * 0.5;
        // the seam between plates is sea: 2–5 tiles wide
        const gap = gapBase + sample(nGap, 0.9, c, r, 2) * 2.6;
        if (nPlates > 1 && (d2 - d1) * s1.w < gap) e -= 1;
      } else {
        e = e * 0.55 + sample(nCont, 0.55, c, r, 3) * 0.45;
      }
      // poles are sea; east and west edges too unless the map wraps
      const dy = Math.min(r, H - 1 - r) / (H * 0.5);
      const dx = wrap ? 1 : Math.min(c, W - 1 - c) / (W * 0.5);
      const edge = Math.min(dx, dy);
      const fall = type === 'lakes' ? 0.12 : 0.35;
      e -= Math.max(0, fall - edge * 1.6) * 1.1;
      elev[i] = e;
      moist[i] = sample(nMoist, 2.2, c, r, 4);
      const lat = 1 - Math.abs(r / (H - 1) - 0.5) * 2; // 1 at equator
      temp[i] = lat * 0.65 + sample(nTemp, 1.3, c, r, 3) * 0.55;
    }
  }

  const sortedE = Array.from(elev).sort((a, b) => a - b);
  const sea = quantile(sortedE, cfg.water);
  const tiles = new Array(N);
  for (let i = 0; i < N; i++) tiles[i] = { t: 'ocean', river: false, riverTo: -1, res: null, imp: null, owner: -1, city: -1, ruin: false };

  const landIdx = [];
  for (let i = 0; i < N; i++) if (elev[i] >= sea) landIdx.push(i);
  const landE = landIdx.map(i => elev[i]).sort((a, b) => a - b);
  const mtn = quantile(landE, 0.92), hill = quantile(landE, 0.78);

  // moisture ranks among flat land for balanced biome spread
  const flat = landIdx.filter(i => elev[i] < hill);
  const moistSorted = flat.map(i => moist[i]).sort((a, b) => a - b);
  const mq = (q) => quantile(moistSorted, q);
  const qDesert = mq(0.15), qSteppe = mq(0.31), qPlains = mq(0.58), qForest = mq(0.82);

  for (const i of landIdx) {
    const e = elev[i], m = moist[i], t = temp[i];
    let terr;
    if (e >= mtn) terr = 'mountain';
    else if (e >= hill) terr = 'hills';
    else if (m < qDesert) terr = t > 0.45 ? 'desert' : 'steppe';
    else if (m < qSteppe) terr = t > 0.75 ? 'desert' : 'steppe';
    else if (m < qPlains) terr = 'plains';
    else if (m < qForest) terr = 'forest';
    else terr = (e < sea + (hill - sea) * 0.6) ? 'marsh' : 'forest';
    tiles[i].t = terr;
  }

  // shallows: water next to land
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (elev[i] >= sea) continue;
    let nearLand = false;
    for (const [nc, nr] of neighborsOf(c, r, W, H, wrap)) if (elev[nr * W + nc] >= sea) nearLand = true;
    if (nearLand || elev[i] > sea - 0.025) tiles[i].t = 'shallows';
  }

  // rivers: start at random hills/mountains and flow downhill to water
  const sources = landIdx.filter(i => tiles[i].t === 'hills' || tiles[i].t === 'mountain');
  rng.shuffle(sources);
  const nRivers = Math.max(2, Math.floor(landIdx.length / 45));
  let made = 0;
  for (const s of sources) {
    if (made >= nRivers) break;
    if (tiles[s].river) continue;
    const path = [s];
    let cur = s;
    const seen = new Set([s]);
    let ok = false;
    for (let step = 0; step < 60; step++) {
      const c = cur % W, r = (cur / W) | 0;
      let best = -1, bestE = Infinity;
      for (const [nc, nr] of neighborsOf(c, r, W, H, wrap)) {
        const ni = nr * W + nc;
        if (seen.has(ni)) continue;
        const ee = elev[ni] + rng() * 0.02;
        if (ee < bestE) { bestE = ee; best = ni; }
      }
      if (best < 0) break;
      if (TERRAIN[tiles[best].t].water || tiles[best].river) { path.push(best); ok = true; break; }
      path.push(best); seen.add(best); cur = best;
    }
    if (!ok || path.length < 4) continue;
    made++;
    for (let k = 0; k < path.length - 1; k++) {
      const ti = path[k];
      tiles[ti].river = true;
      tiles[ti].riverTo = path[k + 1];
      if (tiles[ti].t === 'mountain' && k > 0) tiles[ti].t = 'hills';
    }
  }

  // resources
  // Metals follow a low-frequency "geology" field: copper and tin come from opposite ends of
  // it, so the two rarely sit near each other and bronze needs trade or conquest.
  const nMetal = makeNoise(rng.int(1e9));
  const metal = new Float32Array(N);
  const rocky = [];
  for (let i = 0; i < N; i++) {
    if (tiles[i].t !== 'hills' && tiles[i].t !== 'mountain') continue;
    const c = i % W, r = (i / W) | 0;
    metal[i] = sample(nMetal, 0.45, c, r, 2);
    rocky.push(metal[i]);
  }
  rocky.sort((a, b) => a - b);
  const copperAbove = quantile(rocky, 0.58), tinBelow = quantile(rocky, 0.25);
  // iron ore is common: it fills the band between the copper and tin regions
  const metalAt = (i, pCopper, pTin, p) => metal[i] >= copperAbove ? (p < pCopper ? 'copper' : null) : metal[i] <= tinBelow ? (p < pTin ? 'tin' : null) : (p < pCopper * 0.9 ? 'iron' : null);
  for (let i = 0; i < N; i++) {
    const tl = tiles[i];
    const p = rng();
    switch (tl.t) {
      case 'plains': tl.res = p < 0.14 ? 'fruit' : p < 0.26 ? 'wheat' : null; break;
      case 'steppe': tl.res = p < 0.16 ? 'horses' : p < 0.24 ? 'sheep' : p < 0.30 ? 'fruit' : null; break;
      case 'desert': tl.res = p < 0.09 ? 'oasis' : p < 0.16 ? 'spices' : p < 0.19 ? 'fruit' : null; break;
      case 'forest': tl.res = p < 0.2 ? 'game' : p < 0.24 ? 'spices' : null; break;
      case 'marsh': tl.res = p < 0.1 ? 'iron' : p < 0.24 ? 'fruit' : null; break; // bog iron
      case 'hills': tl.res = metalAt(i, 0.3, 0.3, p) || (p > 0.9 ? 'sheep' : p > 0.85 ? 'fruit' : null); break;
      case 'mountain': tl.res = metalAt(i, 0.35, 0.35, p); break;
      case 'shallows': tl.res = p < 0.22 ? 'fish' : null; break;
      case 'ocean': tl.res = p < 0.04 ? 'whales' : null; break;
    }
  }
  // ruins
  const nRuins = Math.max(3, Math.floor(landIdx.length / 70));
  for (let k = 0; k < nRuins; k++) {
    const i = rng.pick(landIdx);
    if (tiles[i].t !== 'mountain') tiles[i].ruin = true;
  }
  return { W, H, tiles, elev, wrap };
}

// Choose spread-out start tiles with as much biome variety as possible.
export function pickStarts(map, count, seed, specialtyOf, wrap = false) {
  const rng = makeRng(seed + ':starts');
  const { W, H, tiles } = map;
  // land connectivity: component sizes
  const comp = new Int32Array(W * H).fill(-1);
  const compSize = [];
  for (let i = 0; i < W * H; i++) {
    if (comp[i] >= 0 || TERRAIN[tiles[i].t].water) continue;
    const id = compSize.length; let size = 0;
    const st = [i]; comp[i] = id;
    while (st.length) {
      const cur = st.pop(); size++;
      for (const [nc, nr] of neighborsOf(cur % W, (cur / W) | 0, W, H, wrap)) {
        const ni = nr * W + nc;
        if (comp[ni] < 0 && !TERRAIN[tiles[ni].t].water) { comp[ni] = id; st.push(ni); }
      }
    }
    compSize.push(size);
  }
  const cand = [];
  for (let i = 0; i < W * H; i++) {
    const t = tiles[i].t;
    if (TERRAIN[t].water || t === 'mountain') continue;
    if (compSize[comp[i]] < 14) continue;
    const c = i % W, r = (i / W) | 0;
    if (r < 2 || r >= H - 2 || (!wrap && (c < 2 || c >= W - 2))) continue;
    // count usable land around
    let land = 0;
    for (const [nc, nr] of neighborsOf(c, r, W, H, wrap)) if (!TERRAIN[tiles[nr * W + nc].t].water) land++;
    if (land < 4) continue;
    cand.push(i);
  }
  rng.shuffle(cand);
  const starts = [];
  const usedSpec = new Set();
  for (let p = 0; p < count; p++) {
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < Math.min(cand.length, 600); k++) {
      const i = cand[k];
      if (starts.includes(i)) continue;
      const c = i % W, r = (i / W) | 0;
      let minD = 99;
      for (const s of starts) minD = Math.min(minD, hexDist(c, r, s % W, (s / W) | 0, wrap ? W : 0));
      if (starts.length === 0) minD = 10;
      const spec = specialtyOf(i);
      const score = Math.min(minD, 14) * 2 + (usedSpec.has(spec) ? 0 : 7) + rng() * 2;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    starts.push(best);
    usedSpec.add(specialtyOf(best));
  }
  return starts;
}
