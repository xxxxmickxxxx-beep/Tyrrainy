// Strategic goods: production at deposits, a capped national stockpile, connectivity to the
// capital, and hard requirements for advanced units and buildings. Mixed into Game.prototype.
import { TERRAIN, STRATEGIC, GOOD_KEYS, GOOD_DOUBLER, UNITS, RECIPES, INPUT_GOODS, LUXURIES, GROUPS, GOOD_TECH, goodName, impYield } from './data.js';

export const CITY_GOOD_CAP = 2; // per good per city, before its specialty building doubles it
export const SUPPLY_PER = 4; // each 4 units needing a good consume 1 of it per turn

export const economyMethods = {
  stock(pid) {
    const pl = this.players[pid];
    if (!pl.stock) pl.stock = {};
    for (const k of GOOD_KEYS) if (pl.stock[k] == null) pl.stock[k] = 0;
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
    const good = impYield(tl.imp, tl.res);
    if (!good || tl.damaged || tl.owner < 0) return null;
    if (GOOD_TECH[good] && !this.has(tl.owner, GOOD_TECH[good])) return null;
    const u = this.unitAt(i);
    if (u && u.owner !== tl.owner && this.atWar(u.owner, tl.owner)) return null;
    return good;
  },
  cityProduction(city) {
    const out = {};
    for (const t of this.cityTiles(city)) {
      const g = this.tileYield(t);
      if (g) out[g] = (out[g] || 0) + 1;
    }
    // a city can only work so much of one good: supply depends on how many places produce it
    for (const g in out) out[g] = Math.min(STRATEGIC[g].cityCap || CITY_GOOD_CAP, out[g]);
    for (const b of city.buildings) for (const g of GOOD_DOUBLER[b] || []) if (out[g]) out[g] *= 2;
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
    for (const k of GOOD_KEYS) st[k] += prod[k];
    // processing: workshops in connected cities turn inputs into products
    const made = this.process(pid);
    // group needs (e.g. metal) draw on their members in order: iron first, then bronze
    for (const [gk, members] of Object.entries(GROUPS)) {
      let left = need[gk] || 0;
      for (const m of members) { const take = Math.min(left, st[m]); st[m] -= take; left -= take; }
      if (left > 0) { pl.unsupplied[gk] = true; if (!was[gk]) this.addLog(`${pl.name} has run out of metal: units that need it are unsupplied.`, pid); }
    }
    for (const k of GOOD_KEYS) {
      let v = st[k] - (need[k] || 0);
      if (v < 0) { pl.unsupplied[k] = true; v = 0; }
      st[k] = v;
      if (pl.unsupplied[k] && !was[k]) this.addLog(`${pl.name} has run out of ${STRATEGIC[k].name.toLowerCase()}: units that need it are unsupplied.`, pid);
    }
    const eaten = this.feedCities(pid);
    const lux = this.supplyLuxuries(pid);
    for (const k of GOOD_KEYS) st[k] = Math.min(cap, st[k]);
    pl.lastProd = prod;
    pl.lastMade = made;
    pl.lastNeed = need;
    pl.lastEaten = eaten;
    pl.lastLux = lux;
  },

  // ---- sustenance: cities of level 3+ eat (level - 2) food a turn. Connected cities eat from
  // the stockpile; cut-off cities only what they grow themselves. Hungry cities stop growing
  // and grow restless.
  foodDemand(city) { return Math.max(0, city.level - 2); },
  feedCities(pid) {
    const st = this.stock(pid);
    const conn = this.connectedCities(pid);
    const mine = this.cities.filter(c => c.owner === pid);
    let demand = 0;
    for (const c of mine) if (conn.has(c.id)) demand += this.foodDemand(c);
    const eaten = Math.min(st.food, demand);
    st.food -= eaten;
    const fed = demand ? eaten / demand : 1;
    for (const c of mine) {
      const d = this.foodDemand(c);
      const was = c.hunger || 0;
      if (!d) c.hunger = 0;
      else if (conn.has(c.id)) c.hunger = 1 - fed;
      else c.hunger = Math.max(0, 1 - (this.cityProduction(c).food || 0) / d);
      if (c.hunger > 0.3 && was <= 0.3) this.addLog(`${c.name} is going hungry.`, pid, c.idx);
      if (c.hunger <= 0.3 && was > 0.3) this.addPop(c, 0); // growth resumes
    }
    return eaten;
  },
  // ---- luxuries: each city of level 4+ takes up to 1 of each luxury; each calms it (-1).
  // Larger cities are served first. Level 6+ cities with none grumble.
  supplyLuxuries(pid) {
    const st = this.stock(pid);
    const conn = this.connectedCities(pid);
    const used = {};
    const mine = this.cities.filter(c => c.owner === pid).sort((a, b) => b.level - a.level);
    for (const c of mine) {
      c.lux = [];
      if (c.level < 4 || !conn.has(c.id)) continue;
      for (const k of LUXURIES) if (st[k] > 0) { st[k]--; c.lux.push(k); used[k] = (used[k] || 0) + 1; }
    }
    return used;
  },
  // Everything a tribe uses of a good per turn: army supply, food, luxuries, workshop inputs.
  goodDemand(pid, k) {
    const sn = this.supplyNeed(pid);
    let d = sn[k] || 0;
    for (const [gk, members] of Object.entries(GROUPS)) if (members.includes(k) && this.preferredMember(pid, gk) === k) d += sn[gk] || 0;
    if (k === 'food') for (const c of this.cities) if (c.owner === pid) d += this.foodDemand(c);
    if (LUXURIES.includes(k)) d += this.cities.filter(c => c.owner === pid && c.level >= 4).length;
    d += this.inputDemand(pid, k);
    return d;
  },
  // Workshop capacity per product for a tribe (connected cities only).
  workshops(pid) {
    const out = {};
    const conn = this.connectedCities(pid);
    for (const [prod, R] of Object.entries(RECIPES)) {
      const n = this.cities.filter(c => c.owner === pid && conn.has(c.id) && c.buildings.includes(R.building)).length;
      if (n) out[prod] = n * R.rate;
    }
    return out;
  },
  process(pid) {
    const st = this.stock(pid), made = {}, used = {};
    for (const [prod, cap] of Object.entries(this.workshops(pid))) {
      const R = RECIPES[prod];
      let n = cap;
      for (const [k, q] of Object.entries(R.inputs)) n = Math.min(n, Math.floor(st[k] / q));
      if (n <= 0) continue;
      for (const [k, q] of Object.entries(R.inputs)) { st[k] -= n * q; used[k] = (used[k] || 0) + n * q; }
      st[prod] += n;
      made[prod] = n;
    }
    this.players[pid].lastUsed = used;
    return made;
  },
  // How much of a raw input a tribe can use per turn (0 without a workshop).
  inputDemand(pid, k) {
    let d = 0;
    for (const [prod, cap] of Object.entries(this.workshops(pid))) d += cap * (RECIPES[prod].inputs[k] || 0);
    return d;
  },
  goodsText(needs) { return Object.entries(needs || {}).map(([k, n]) => `${n} ${GROUPS[k] ? 'metal' : goodName(k).toLowerCase()}`).join(', '); },
  // stock available for a good or a group of interchangeable goods
  avail(pid, k) { const st = this.stock(pid); return GROUPS[k] ? GROUPS[k].reduce((a, m) => a + st[m], 0) : st[k]; },
  canPay(pid, needs, city) {
    if (!needs) return { ok: true };
    if (city && !this.isConnected(city)) return { ok: false, why: 'Cut off from the capital: no access to the stockpile' };
    for (const [k, n] of Object.entries(needs)) { const a = this.avail(pid, k); if (a < n) return { ok: false, why: `Needs ${n} ${GROUPS[k] ? 'metal (iron or bronze)' : goodName(k).toLowerCase()} (have ${a})` }; }
    return { ok: true };
  },
  pay(pid, needs) {
    const st = this.stock(pid);
    for (const [k, n] of Object.entries(needs || {})) {
      if (!GROUPS[k]) { st[k] -= n; continue; }
      let left = n;
      for (const m of GROUPS[k]) { const take = Math.min(left, st[m]); st[m] -= take; left -= take; }
    }
  },
  // which member of a group a tribe will lean on (for demand and trade)
  preferredMember(pid, gk) { return gk === 'metal' && this.has(pid, 'ironworking') ? 'iron' : GROUPS[gk][GROUPS[gk].length - 1]; },
};
