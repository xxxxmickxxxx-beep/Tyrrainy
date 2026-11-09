// Strategic goods: production at deposits, a capped national stockpile, connectivity to the
// capital, and hard requirements for advanced units and buildings. Mixed into Game.prototype.
import { TERRAIN, STRATEGIC, GOOD_KEYS, IMP_YIELD, GOOD_DOUBLER, UNITS } from './data.js';

export const CITY_GOOD_CAP = 2; // per good per city, before its specialty building doubles it
export const SUPPLY_PER = 4; // each 4 units needing a good consume 1 of it per turn

export const economyMethods = {
  stock(pid) {
    const pl = this.players[pid];
    if (!pl.stock) pl.stock = Object.fromEntries(GOOD_KEYS.map(k => [k, 0]));
    return pl.stock;
  },
  stockCap(pid) { return 8 + 2 * this.cities.filter(c => c.owner === pid).length; },
  // Ongoing supply for armies: units that needed a good to train keep consuming it.
  supplyNeed(pid) {
    const n = {};
    for (const u of this.units) {
      if (u.owner !== pid) continue;
      for (const k of Object.keys(UNITS[u.type].needs || {})) n[k] = (n[k] || 0) + 1;
    }
    for (const k in n) n[k] = Math.ceil(n[k] / SUPPLY_PER);
    return n;
  },
  unsupplied(u) {
    const un = this.players[u.owner].unsupplied;
    if (!un) return false;
    for (const k of Object.keys(UNITS[u.type].needs || {})) if (un[k]) return true;
    return false;
  },

  // The good a tile yields this turn, or null. Damaged or enemy-held tiles yield nothing.
  tileYield(i) {
    const tl = this.tiles[i];
    const y = IMP_YIELD[tl.imp];
    if (!y || tl.damaged || tl.owner < 0) return null;
    if (y.res && tl.res !== y.res) return null;
    const u = this.unitAt(i);
    if (u && u.owner !== tl.owner && this.atWar(u.owner, tl.owner)) return null;
    return y.good;
  },
  cityProduction(city) {
    const out = {};
    for (const t of this.cityTiles(city)) {
      const g = this.tileYield(t);
      if (g) out[g] = (out[g] || 0) + 1;
    }
    // a city can only work so much of one good: supply depends on how many places produce it
    for (const g in out) out[g] = Math.min(CITY_GOOD_CAP, out[g]);
    for (const b of city.buildings) { const g = GOOD_DOUBLER[b]; if (g && out[g]) out[g] *= 2; }
    return out;
  },

  // ---- connectivity: a city trades with the national stockpile only if a path links it to
  // the capital through land (or, with Sailing, shallow water) that isn't hostile or blocked.
  hubCity(pid) {
    const mine = this.cities.filter(c => c.owner === pid);
    return mine.find(c => c.capital) || mine.sort((a, b) => b.level - a.level)[0] || null;
  },
  connectedCities(pid) {
    const key = this.turn + ':' + this.current + ':' + (this._moves || 0) + ':' + this.cities.length + ':' + this.units.length;
    this._conn = this._conn || {};
    if (this._conn[pid]?.key === key) return this._conn[pid].set;
    const set = new Set();
    const hub = this.hubCity(pid);
    if (hub) {
      const sail = this.has(pid, 'sailing'), nav = this.has(pid, 'navigation');
      const seen = new Uint8Array(this.tiles.length);
      const q = [hub.idx]; seen[hub.idx] = 1;
      while (q.length) {
        const cur = q.pop();
        const tl = this.tiles[cur];
        if (tl.city >= 0) { const c = this.cityAt(cur); if (c && c.owner === pid) set.add(c.id); }
        for (const n of this.neighbors(cur)) {
          if (seen[n]) continue;
          const nt = this.tiles[n], T = TERRAIN[nt.t];
          if (T.water && !(sail && (!T.deep || nav))) continue;
          if (nt.owner >= 0 && nt.owner !== pid && this.atWar(pid, nt.owner)) continue;
          if (nt.city >= 0 && this.cityAt(n)?.owner !== pid) continue;
          const u = this.unitAt(n);
          if (u && u.owner !== pid && this.atWar(pid, u.owner)) continue;
          seen[n] = 1; q.push(n);
        }
      }
    }
    this._conn[pid] = { key, set };
    return set;
  },
  isConnected(city) { return this.connectedCities(city.owner).has(city.id); },
  production(pid) {
    const out = Object.fromEntries(GOOD_KEYS.map(k => [k, 0]));
    const conn = this.connectedCities(pid);
    for (const c of this.cities) {
      if (c.owner !== pid || !conn.has(c.id)) continue;
      for (const [k, n] of Object.entries(this.cityProduction(c))) out[k] += n;
    }
    return out;
  },
  // Goods lost to a lack of connection (shown to players so a cut-off city is felt).
  stranded(pid) {
    const out = {};
    const conn = this.connectedCities(pid);
    for (const c of this.cities) {
      if (c.owner !== pid || conn.has(c.id)) continue;
      for (const [k, n] of Object.entries(this.cityProduction(c))) out[k] = (out[k] || 0) + n;
    }
    return out;
  },
  collectGoods(pid) {
    const pl = this.players[pid];
    const st = this.stock(pid), prod = this.production(pid), cap = this.stockCap(pid), need = this.supplyNeed(pid);
    const was = pl.unsupplied || {};
    pl.unsupplied = {};
    for (const k of GOOD_KEYS) {
      let v = st[k] + prod[k] - (need[k] || 0);
      if (v < 0) { pl.unsupplied[k] = true; v = 0; }
      st[k] = Math.min(cap, v);
      if (pl.unsupplied[k] && !was[k]) this.addLog(`${pl.name} has run out of ${STRATEGIC[k].name.toLowerCase()}: units that need it are unsupplied.`, pid);
    }
    pl.lastProd = prod;
    pl.lastNeed = need;
  },
  goodsText(needs) { return Object.entries(needs || {}).map(([k, n]) => `${n} ${STRATEGIC[k].name.toLowerCase()}`).join(', '); },
  canPay(pid, needs, city) {
    if (!needs) return { ok: true };
    if (city && !this.isConnected(city)) return { ok: false, why: 'Cut off from the capital: no access to the stockpile' };
    const st = this.stock(pid);
    for (const [k, n] of Object.entries(needs)) if (st[k] < n) return { ok: false, why: `Needs ${n} ${STRATEGIC[k].name.toLowerCase()} (have ${st[k]})` };
    return { ok: true };
  },
  pay(pid, needs) { const st = this.stock(pid); for (const [k, n] of Object.entries(needs || {})) st[k] -= n; },
};
