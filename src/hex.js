// Hex grid helpers. Map is stored as a rectangular "odd-r" offset grid
// (pointy-top hexes, odd rows shoved right). Tile index = r * W + c.

export const SQRT3 = Math.sqrt(3);

const EVEN_DIRS = [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]];
const ODD_DIRS = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];

// wrap: the map is a cylinder, east and west edges join
export function neighborsOf(c, r, W, H, wrap = false) {
  const dirs = (r & 1) ? ODD_DIRS : EVEN_DIRS;
  const out = [];
  for (const [dc, dr] of dirs) {
    let nc = c + dc;
    const nr = r + dr;
    if (wrap) nc = (nc + W) % W;
    if (nc >= 0 && nc < W && nr >= 0 && nr < H) out.push([nc, nr]);
  }
  return out;
}

export function toCube(c, r) {
  const x = c - (r - (r & 1)) / 2;
  const z = r;
  return [x, -x - z, z];
}

function cubeDist(c1, r1, c2, r2) {
  const [x1, y1, z1] = toCube(c1, r1);
  const [x2, y2, z2] = toCube(c2, r2);
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}
// wrapW: the map's width when east and west join (the shorter way round counts)
// (the nearer image by column is the shorter way round, except possibly for tiles about
// half the world apart, where a difference of one tile doesn't matter)
export function hexDist(c1, r1, c2, r2, wrapW = 0) {
  if (wrapW) { const dc = c2 - c1; if (dc > wrapW / 2) c2 -= wrapW; else if (dc < -wrapW / 2) c2 += wrapW; }
  return cubeDist(c1, r1, c2, r2);
}

// Pixel center of a hex of "size" (center-to-corner radius).
export function hexToPixel(c, r, size) {
  const x = size * SQRT3 * (c + 0.5 * (r & 1));
  const y = size * 1.5 * r;
  return [x, y];
}

export function pixelToHex(px, py, size) {
  // to fractional axial
  const q = (SQRT3 / 3 * px - 1 / 3 * py) / size;
  const r = (2 / 3 * py) / size;
  // cube round
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  const col = rx + (rz - (rz & 1)) / 2;
  return [col, rz];
}

export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}
