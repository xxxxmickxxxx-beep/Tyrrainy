// Roads and repeatable city projects: things worth making once a city has built everything.
// Mixed into Game.prototype.
//
// Roads: any land tile in your territory (or next to your road network / a city of yours) can
// carry a road, paid in labor by your nearest city. Moving from road to road costs 1/2 (cities
// count as road), for anyone, enemies included. Trade routes prefer roads and cost less upkeep
// along them.
//
// Projects (repeatable, paid in the city's labor):
//   Public games — a festival paid in labor instead of gold (same effect and riot risk).
//   Scholars     — turn spare labor into knowledge, 4 : 1.
//   Drill        — make the unit garrisoned in the city a veteran.
import { TERRAIN, UNITS, GRAND, TECHS } from './data.js';

export const SCHOLAR_RATE = 4; // labor per knowledge
export const DRILL_COST = 8;

export const projectMethods = {
  isRoad(i) { const t = this.tiles[i]; return !!t.road || t.city >= 0; },
  roadCost(i) {
    const t = this.tiles[i].t;
    return t === 'mountain' ? 4 : (t === 'forest' || t === 'hills' || t === 'marsh') ? 3 : 2;
  },
  // the city that would pay for a road on tile i: the owning city, or your nearest within 4
  roadCity(pid, i) {
    const tl = this.tiles[i];
    if (tl.owner === pid && tl.ownerCity != null) return this.cityById(tl.ownerCity);
    let best = null, bd = 5;
    for (const c of this.cities) if (c.owner === pid) { const d = this.dist(c.idx, i); if (d < bd) { bd = d; best = c; } }
    return best;
  },
  canBuildRoad(pid, i) {
    const tl = this.tiles[i];
    if (TERRAIN[tl.t].water) return { ok: false, why: 'No roads on water' };
    if (this.isRoad(i)) return { ok: false, why: 'Already a road' };
    if (tl.t === 'mountain' && !this.has(pid, 'climbing')) return { ok: false, why: 'Requires Climbing' };
    if (tl.owner >= 0 && tl.owner !== pid) return { ok: false, why: 'Foreign land' };
    if (tl.owner < 0 && !this.neighbors(i).some(n => this.isRoad(n) && (this.tiles[n].owner === pid || this.cityAt(n)?.owner === pid))) return { ok: false, why: 'Must extend your own road network' };
    const u = this.unitAt(i);
    if (u && u.owner !== pid && this.atWar(u.owner, pid)) return { ok: false, why: 'Enemy on the tile' };
    const city = this.roadCity(pid, i);
    if (!city) return { ok: false, why: 'No city of yours close enough' };
    const w = this.workCheck(city, this.roadCost(i));
    if (!w.ok) return w;
    return { ...w, city };
  },
  buildRoad(pid, i) {
    const chk = this.canBuildRoad(pid, i);
    if (!chk.ok) return chk;
    this.payWork(chk.city, chk);
    this.tiles[i].road = true;
    this._moves = (this._moves || 0) + 1;
    this.emit('road', { pid, idx: i });
    return { ok: true };
  },
  // Next tile to build on the cheapest path from `city` to the nearest of the owner's cities not
  // yet joined to it by road. Returns null when the city's road links are complete.
  roadPlan(city, maxDist = 7) {
    const pid = city.owner;
    const targets = this.cities.filter(c => c.owner === pid && c !== city && this.dist(c.idx, city.idx) <= maxDist)
      .sort((a, b) => this.dist(a.idx, city.idx) - this.dist(b.idx, city.idx));
    for (const t of targets) {
      const path = this.roadPath(pid, city.idx, t.idx);
      if (!path) continue;
      const missing = path.filter(i => !this.isRoad(i));
      if (!missing.length) continue; // already joined
      // build outward from our end so the network stays connected
      return { next: missing[0], target: t, left: missing.length };
    }
    return null;
  },
  // cheapest land path over own or unclaimed tiles, where existing road is cheap
  roadPath(pid, from, to) {
    const N = this.tiles.length;
    const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    dist[from] = 0;
    const open = [[0, from]];
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [d, cur] = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (d > dist[cur]) continue;
      if (cur === to) break;
      if (d > 20) break;
      for (const n of this.neighbors(cur)) {
        const tl = this.tiles[n];
        if (TERRAIN[tl.t].water) continue;
        if (tl.owner >= 0 && tl.owner !== pid) continue;
        if (tl.t === 'mountain' && !this.has(pid, 'climbing')) continue;
        const nd = d + (this.isRoad(n) ? 0.3 : this.roadCost(n));
        if (nd < dist[n]) { dist[n] = nd; prev[n] = cur; open.push([nd, n]); }
      }
    }
    if (dist[to] === Infinity) return null;
    const path = [];
    for (let t = to; t >= 0; t = prev[t]) path.push(t);
    return path.reverse();
  },
  extendRoads(city) {
    const plan = this.roadPlan(city);
    if (!plan) return { ok: false, why: 'This city is already joined by road to its neighbours' };
    return this.buildRoad(city.owner, plan.next);
  },

  // ---- grand projects
  hasGrand(pid, key) { return this.cities.some(c => c.owner === pid && c.grand?.includes(key)); },
  // a project whose site has been lost is lost with it
  grandTick(pid) {
    const pl = this.players[pid];
    for (const [key, gp] of Object.entries(pl.grandWork || {})) {
      const site = this.cityById(gp.site);
      if (site && site.owner === pid) continue;
      delete pl.grandWork[key];
      this.addLog(`${pl.name} has lost the half-built ${GRAND[key].name}${site ? ' at ' + site.name : ''}.`, pid);
    }
  },
  grandInProgress(pid) {
    const out = [];
    for (const [key, gp] of Object.entries(this.players[pid].grandWork || {})) {
      const site = this.cityById(gp.site);
      if (site && site.owner === pid) out.push({ key, ...gp, siteCity: site });
    }
    return out;
  },
  canStartGrand(city, key) {
    const G = GRAND[key], pid = city.owner, pl = this.players[pid];
    if (this.hasGrand(pid, key)) return { ok: false, why: 'Already yours' };
    if (pl.grandWork?.[key] && this.cityById(pl.grandWork[key].site)?.owner === pid) return { ok: false, why: 'Already under way' };
    if (!this.has(pid, G.tech)) return { ok: false, why: 'Requires ' + TECHS[G.tech].name };
    if (!this.isConnected(city)) return { ok: false, why: 'Site must be connected to the capital' };
    return this.canPay(pid, G.needs, city);
  },
  startGrand(city, key) {
    const chk = this.canStartGrand(city, key);
    if (!chk.ok) return chk;
    const pl = this.players[city.owner];
    this.pay(pl.id, GRAND[key].needs);
    pl.grandWork = pl.grandWork || {};
    pl.grandWork[key] = { site: city.id, progress: 0, started: this.turn };
    this.addLog(`${pl.name} begins the ${GRAND[key].name} at ${city.name}.`, pl.id, city.idx);
    return { ok: true };
  },
  // the site can only take in so much work a turn: grand projects take several turns whatever
  // the realm's size, so a half-built one can be fought over
  grandIntake(site) { return 10 + 2 * site.level; },
  grandRoom(gp, site) { return gp.turn === this.turn ? Math.max(0, this.grandIntake(site) - (gp.given || 0)) : this.grandIntake(site); },
  // a city can give labor to a grand project if it is the site or connected to it
  canContribute(city, key) {
    const gp = this.players[city.owner].grandWork?.[key];
    const site = gp && this.cityById(gp.site);
    if (!site || site.owner !== city.owner) return { ok: false, why: 'Not under way' };
    if (city !== site && !(this.isConnected(city) && this.isConnected(site))) return { ok: false, why: 'Not connected to the site' };
    if ((city.labor || 0) < 1) return { ok: false, why: 'No labor' };
    const room = this.grandRoom(gp, site);
    if (room < 1) return { ok: false, why: `The site takes ${this.grandIntake(site)} labor a turn; full for this turn` };
    return { ok: true, gp, site, room };
  },
  contribute(city, key, amount = Infinity) {
    const chk = this.canContribute(city, key);
    if (!chk.ok) return chk;
    const G = GRAND[key];
    const n = Math.min(Math.floor(city.labor), amount, chk.room, G.labor - chk.gp.progress);
    city.labor -= n;
    chk.gp.progress += n;
    if (chk.gp.turn !== this.turn) { chk.gp.turn = this.turn; chk.gp.given = 0; }
    chk.gp.given += n;
    if (chk.gp.progress >= G.labor) {
      const pl = this.players[city.owner];
      chk.site.grand = [...(chk.site.grand || []), key];
      delete pl.grandWork[key];
      this.addLog(`${pl.name} completes the ${G.name} at ${chk.site.name}!`, pl.id, chk.site.idx);
      this.emit('grand', { pid: pl.id, key, city: chk.site });
    }
    return { ok: true, given: n };
  },

  // ---- repeatable projects
  canScholars(city) {
    const have = Math.floor(city.labor || 0);
    if (have < SCHOLAR_RATE) return { ok: false, why: `Needs at least ${SCHOLAR_RATE} labor` };
    return { ok: true, labor: have - (have % SCHOLAR_RATE), gain: Math.floor(have / SCHOLAR_RATE) };
  },
  scholars(city) {
    const chk = this.canScholars(city);
    if (!chk.ok) return chk;
    city.labor -= chk.labor;
    this.players[city.owner].knowledge = (this.players[city.owner].knowledge || 0) + chk.gain;
    return { ok: true, gain: chk.gain };
  },
  canDrill(city) {
    const u = this.unitAt(city.idx);
    if (!u || u.owner !== city.owner || u.type === 'settler') return { ok: false, why: 'No garrison to drill' };
    if (u.vet) return { ok: false, why: 'Already veteran' };
    const w = this.workCheck(city, DRILL_COST);
    if (!w.ok) return w;
    return { ...w, unit: u };
  },
  drill(city) {
    const chk = this.canDrill(city);
    if (!chk.ok) return chk;
    this.payWork(city, chk);
    chk.unit.vet = true; chk.unit.hp = this.maxHp(chk.unit);
    this.addLog(`The garrison of ${city.name} has been drilled into veterans.`, city.owner, city.idx);
    return { ok: true };
  },
};
