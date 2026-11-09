// Trade routes: physical paths between tribes along which scarce goods flow from surplus to
// deficit each turn. Mixed into Game.prototype.
//  - A route runs from the nearest pair of connected cities, over land, or shallow water when
//    both partners have Sailing (ocean with Navigation). It can't cross the land of a tribe at
//    war with either partner, or one that has closed its land to them.
//  - Each turn up to ROUTE_CAP units per direction move, surplus -> deficit. The buyer pays
//    PRICE per unit to the seller and TOLL per unit to every tribe whose land is crossed.
//  - An enemy unit standing on the route seizes the shipment (raiding). Upkeep scales with length.
import { TERRAIN, STRATEGIC, GOOD_KEYS, INPUT_GOODS } from './data.js';

export const ROUTE_CAP = 3;
// bronze trades at a markup over its inputs (copper 3 + tin 4)
export const PRICE = { food: 1, copper: 3, tin: 4, bronze: 10, ironore: 2, iron: 6, horses: 4, timber: 2, stone: 2, wool: 2, cloth: 5, spice: 6 };
export const TOLL = 1;
export const MAX_ROUTE_LEN = 40;

export const tradeMethods = {
  routesOf(pid) { return (this.routes || []).filter(r => r.a === pid || r.b === pid); },
  routeBetween(a, b) { return (this.routes || []).find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a)) || null; },
  routeLimit(pid) { return 1 + Math.floor(this.cities.filter(c => c.owner === pid).length / 4) + (this.hasGrand?.(pid, 'royalroad') ? 1 : 0); },
  transitClosed(c, p) { return !!this.players[c]?.closedTransit?.[p]; },
  setTransit(c, p, closed) {
    const pl = this.players[c];
    pl.closedTransit = pl.closedTransit || {};
    if (closed) pl.closedTransit[p] = true; else delete pl.closedTransit[p];
    this._routeKey = null;
  },

  // reserve: what a tribe keeps for itself before exporting; it imports up to reserve + 2
  // Raw inputs are only worth keeping with a workshop to feed: otherwise every unit is for sale.
  reserve(pid, k) {
    if (INPUT_GOODS.has(k)) return 2 * this.inputDemand(pid, k);
    const d = this.goodDemand(pid, k);
    if (STRATEGIC[k].kind === 'sustenance' || STRATEGIC[k].kind === 'luxury') return 2 + 2 * d; // eaten every turn: a thinner buffer
    return 4 + 3 * d;
  },
  surplus(pid, k) { return Math.max(0, this.stock(pid)[k] - this.reserve(pid, k)); },
  deficit(pid, k) {
    if (INPUT_GOODS.has(k) && !this.inputDemand(pid, k)) return 0;
    return Math.max(0, this.reserve(pid, k) + 2 - this.stock(pid)[k]);
  },

  // Cheapest path between any connected city of a and any connected city of b.
  routePath(a, b) {
    const A = this.cities.filter(c => c.owner === a && this.isConnected(c));
    const B = new Set(this.cities.filter(c => c.owner === b && this.isConnected(c)).map(c => c.idx));
    if (!A.length || !B.size) return null;
    const sail = this.has(a, 'sailing') && this.has(b, 'sailing');
    const nav = this.has(a, 'navigation') && this.has(b, 'navigation');
    const N = this.tiles.length;
    const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const open = [];
    for (const c of A) { dist[c.idx] = 0; open.push([0, c.idx]); }
    let end = -1;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [d, cur] = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (d > dist[cur]) continue;
      if (B.has(cur)) { end = cur; break; }
      if (d > MAX_ROUTE_LEN) break;
      for (const n of this.neighbors(cur)) {
        const tl = this.tiles[n], T = TERRAIN[tl.t];
        if (T.water && !(sail && (!T.deep || nav))) continue;
        const o = tl.owner;
        if (o >= 0 && o !== a && o !== b) {
          if (this.atWar(o, a) || this.atWar(o, b) || this.transitClosed(o, a) || this.transitClosed(o, b)) continue;
          if (tl.city >= 0) continue; // through land, not through foreign cities
        }
        if (o >= 0 && (o === a || o === b) && this.atWar(a, b)) continue;
        const step = this.isRoad(n) && this.isRoad(cur) ? 0.4 : T.water ? 0.8 : tl.t === 'mountain' ? 3 : (tl.t === 'forest' || tl.t === 'hills' || tl.t === 'marsh') ? 1.5 : 1;
        const nd = d + step;
        if (nd < dist[n]) { dist[n] = nd; prev[n] = cur; open.push([nd, n]); }
      }
    }
    if (end < 0) return null;
    const path = [];
    for (let t = end; t >= 0; t = prev[t]) path.push(t);
    path.reverse();
    const transit = new Set();
    for (const t of path) { const o = this.tiles[t].owner; if (o >= 0 && o !== a && o !== b) transit.add(o); }
    // upkeep follows the effort of the journey: roads and sea lanes are cheap
    return { path, len: path.length - 1, effort: dist[end], transit: [...transit] };
  },
  routeUpkeep(len) { return Math.ceil(len / 8); },

  canOpenRoute(a, b) {
    if (a === b || !this.players[b]?.alive) return { ok: false, why: 'No such tribe' };
    if (!this.hasMet(a, b)) return { ok: false, why: 'Not met' };
    if (this.atWar(a, b)) return { ok: false, why: 'At war' };
    if (this.routeBetween(a, b)) return { ok: false, why: 'Route already open' };
    if (this.routesOf(a).length >= this.routeLimit(a)) return { ok: false, why: `Route limit ${this.routeLimit(a)} (1 + 1 per 4 cities)` };
    if (this.routesOf(b).length >= this.routeLimit(b)) return { ok: false, why: 'They have no room for more routes' };
    const p = this.routePath(a, b);
    if (!p) return { ok: false, why: 'No safe path between your connected cities' };
    return { ok: true, path: p };
  },
  openRoute(a, b) {
    const chk = this.canOpenRoute(a, b);
    if (!chk.ok) return chk;
    this.routes = this.routes || [];
    this.routes.push({ a, b, since: this.turn, path: chk.path.path, transit: chk.path.transit, last: null });
    this.addLog(`${this.players[a].name} and ${this.players[b].name} open a trade route (${chk.path.len} tiles).`, a);
    this.emit('diplo', { type: 'route', a, b });
    return { ok: true };
  },
  closeRoute(a, b, quiet = false) {
    const r = this.routeBetween(a, b);
    if (!r) return { ok: false, why: 'No route' };
    this.routes = this.routes.filter(x => x !== r);
    if (!quiet) this.addLog(`The trade route between ${this.players[a].name} and ${this.players[b].name} closes.`, a);
    return { ok: true };
  },
  // Value of a route to pid: goods it could gain now, and goods it could sell.
  routeGain(pid, other) {
    let buy = 0, sell = 0;
    for (const k of GOOD_KEYS) {
      buy += Math.min(this.deficit(pid, k), this.surplus(other, k));
      sell += Math.min(this.surplus(pid, k), this.deficit(other, k));
    }
    return { buy, sell };
  },

  // First enemy (of the shipper or the buyer) standing on the path, if any.
  raiderOn(path, from, to) {
    for (const t of path) {
      const u = this.unitAt(t);
      if (u && u.owner !== from && u.owner !== to && (this.atWar(u.owner, from) || this.atWar(u.owner, to)) && UNIT_ATK(u)) return u;
    }
    return null;
  },

  // Once per round: move goods along every route.
  tradeTick() {
    for (const r of [...(this.routes || [])]) {
      const A = this.players[r.a], B = this.players[r.b];
      if (!A?.alive || !B?.alive || this.atWar(r.a, r.b)) { this.closeRoute(r.a, r.b, true); continue; }
      const p = this.routePath(r.a, r.b);
      r.last = { ab: {}, ba: {}, raided: null, blocked: !p, gold: { [r.a]: 0, [r.b]: 0 }, tolls: {} };
      if (!p) continue;
      r.path = p.path; r.transit = p.transit;
      const up0 = this.routeUpkeep(p.effort ?? p.len);
      for (const pid of [r.a, r.b]) {
        const up = this.hasGrand?.(pid, 'royalroad') ? Math.ceil(up0 / 2) : up0;
        this.players[pid].gold = Math.max(0, this.players[pid].gold - up); r.last.gold[pid] -= up;
      }
      for (const [from, to, rec] of [[r.a, r.b, r.last.ab], [r.b, r.a, r.last.ba]]) {
        let cap = ROUTE_CAP;
        const goods = GOOD_KEYS.slice().sort((x, y) => this.deficit(to, y) - this.deficit(to, x));
        for (const k of goods) {
          if (cap <= 0) break;
          const unitPrice = PRICE[k] + TOLL * p.transit.length;
          let n = Math.min(cap, this.surplus(from, k), this.deficit(to, k), Math.floor(this.players[to].gold / unitPrice));
          if (n <= 0) continue;
          cap -= n;
          this.stock(from)[k] -= n;
          const raider = this.raiderOn(p.path, from, to);
          if (raider) {
            const st = this.stock(raider.owner), capR = this.stockCap(raider.owner);
            st[k] = Math.min(capR, st[k] + n);
            r.last.raided = raider.owner;
            this.addLog(`${this.players[raider.owner].name} raiders seize ${n} ${STRATEGIC[k].name.toLowerCase()} bound for ${this.players[to].name}!`, raider.owner, raider.idx);
            this.addGrudge(from, raider.owner, 5 * n); this.addGrudge(to, raider.owner, 5 * n);
            this.emit('raid', { by: raider.owner, idx: raider.idx, k, n });
            continue;
          }
          const st = this.stock(to);
          st[k] = Math.min(this.stockCap(to), st[k] + n);
          this.players[to].gold -= n * unitPrice;
          this.players[from].gold += n * PRICE[k];
          r.last.gold[to] -= n * unitPrice; r.last.gold[from] += n * PRICE[k];
          for (const c of p.transit) { this.players[c].gold += n * TOLL; r.last.tolls[c] = (r.last.tolls[c] || 0) + n * TOLL; }
          rec[k] = (rec[k] || 0) + n;
        }
      }
      const moved = Object.keys(r.last.ab).length + Object.keys(r.last.ba).length + (r.last.raided != null ? 1 : 0);
      r.idle = moved ? 0 : (r.idle || 0) + 1;
    }
  },
  // Which tribes a tribe depends on for imports (for AI loyalty to suppliers).
  suppliersOf(pid) {
    const out = new Set();
    for (const r of this.routesOf(pid)) {
      const inc = r.a === pid ? r.last?.ba : r.last?.ab;
      if (inc && Object.values(inc).some(n => n > 0)) out.add(r.a === pid ? r.b : r.a);
    }
    return out;
  },
};

function UNIT_ATK(u) { return u.type !== 'settler'; }
