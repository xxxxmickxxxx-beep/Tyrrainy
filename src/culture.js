// Peoples (cultures), kept separate from polities (tribes), plus colour identity.
//
// A culture's name is never more than two parts:
//   founding people     <capital><root>            Mardujana
//   regional offshoot   <city|land><root>          Eskjana, Hilljana, "Esk Hilljana" on a clash
//   subjects (label)    <core>-o + <ruler name>    Esko-Mardujana
//   influenced people   <influence>-o + <core>     Mardu-Eskjana   (only the latest influence is kept)
// Offshoots keep their parent's root word, so families read as families, and get a
// hue-shifted version of the parent's colour with their own border colour.
import { TRIBE_PALETTE } from './data.js';

// The word for "people" in various languages. Each founding people gets its own.
export const ROOTS = [
  ['folk', 'Old English'], ['volk', 'German'], ['laos', 'Greek'], ['narod', 'Slavic'],
  ['gens', 'Latin'], ['jana', 'Sanskrit'], ['tauta', 'Lithuanian'], ['halk', 'Turkish'],
  ['ulus', 'Mongolian'], ['kansa', 'Finnish'], ['tuath', 'Irish'], ['mardom', 'Persian'],
  ['bangsa', 'Malay'], ['qaum', 'Arabic'], ['hito', 'Japanese'], ['dene', 'Dene'],
];
export const LAND_BASE = {
  plains: 'Field', hilltop: 'Hill', coastal: 'Sea', riverside: 'River', forest: 'Wood',
  desert: 'Dune', steppe: 'Grass', marsh: 'Fen', mountain: 'Peak',
};
const LAND_WORDS = new Set(Object.values(LAND_BASE));

export function cleanBase(base) { return base.replace(/\s+[IVX]+$/, '').trim(); }
export function joinName(base, root) {
  base = cleanBase(base);
  if (!root) return base;
  const b = base;
  const last = b[b.length - 1].toLowerCase();
  const r = last === root[0] ? root.slice(1) : root;
  return b + r;
}
// Combining form for hyphenated names: Esk -> Esko-, Mardu -> Mardu-, Hill -> Hill-
export function combining(base) {
  const b = cleanBase(base).split(' ').pop();
  if (LAND_WORDS.has(b) || /[aeiouy]$/i.test(b)) return b;
  return b + 'o';
}

// ---- colour maths
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function toLab(h) {
  const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function colorDist(a, b) { const A = toLab(a), B = toLab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); }
export function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
function toHsl(hex) {
  let [r, g, b] = hexRgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
const ACCENTS = ['#111111', '#f4f4f4', '#ffd23f', '#13294b', '#c0392b', '#2a9d3c', '#7a2a00', '#9fd8cb', '#3a1d70', '#ff6f3c', '#ffb3c6', '#0b3d2e'];

// Pick the [fill, border] pair most distinct from everything in `live` (objects with color/color2).
export function pickColors(live) {
  live = live.filter(p => p.color);
  const score = ([f, c]) => live.length ? Math.min(...live.map(p => colorDist(f, p.color) + 0.4 * colorDist(c, p.color2 || p.color))) : 1e9;
  const taken = new Set(live.map(p => p.color + p.color2));
  let best = null, bestS = -1;
  for (const pair of TRIBE_PALETTE) {
    if (taken.has(pair[0] + pair[1])) continue;
    const sc = score(pair);
    if (sc > bestS) { bestS = sc; best = pair; }
  }
  if (best && bestS >= 25) return best;
  for (let hue = 0; hue < 360; hue += 12) for (const l of [0.32, 0.5, 0.68]) {
    const f = hslHex(hue, 0.65, l);
    const c = ACCENTS.reduce((a, b) => colorDist(b, f) > colorDist(a, f) ? b : a);
    const sc = score([f, c]);
    if (sc > bestS) { bestS = sc; best = [f, c]; }
  }
  return best;
}
// Kept for older callers.
export function pickTribeColors(players) { return pickColors(players.filter(p => p.alive !== false)); }

// An offshoot's colours: visibly derived from the parent (hue shift 15–40°), but as far
// from every other living culture as possible, with a border colour of its own.
export function offshootColors(parent, live) {
  const [h, s, l] = toHsl(parent.color);
  let best = null, bestS = -1;
  for (const dh of [-40, -30, -20, 20, 30, 40]) for (const dl of [-0.1, 0, 0.1]) {
    const f = hslHex(h + dh, Math.min(0.85, Math.max(0.35, s)), Math.min(0.75, Math.max(0.25, l + dl)));
    const dp = colorDist(f, parent.color);
    if (dp < 12) continue; // must be distinguishable from the parent
    const others = live.filter(x => x !== parent && x.color);
    const sc = (others.length ? Math.min(...others.map(x => colorDist(f, x.color))) : 100) - Math.max(0, dp - 45);
    if (sc > bestS) { bestS = sc; best = f; }
  }
  best = best || parent.color;
  // border: the accent least used by living cultures that still contrasts with the fill
  let c2 = ACCENTS[0], cs = -1;
  for (const a of ACCENTS) {
    if (colorDist(a, best) < 30) continue;
    const sc = Math.min(...live.map(x => x.color2 ? colorDist(a, x.color2) : 100), 100) + (a === parent.color2 ? -15 : 0);
    if (sc > cs) { cs = sc; c2 = a; }
  }
  return [best, c2];
}
