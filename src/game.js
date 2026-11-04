// Core rules. Pure logic, no DOM — runs in the browser and in node (for sims).
import { neighborsOf, hexDist } from './hex.js';
import { makeRng } from './rng.js';
import {
  TERRAIN, SPECIALTY, KIN_DIST, AFFINITY, UNITS, EMBARKED, IMPROVEMENTS,
  BUILDINGS, TECHS, techCost, TERRAIN_TO_SPECIALTY, TRIBE_NAMES, CITY_NAMES, PLAYER_COLORS,
} from './data.js';
import { generateMap, pickStarts, MAP_SIZES } from './mapgen.js';

const INTEGRATION_TURNS = 10;

export class Game {
  constructor() {
    this.listeners = [];
  }

  // ------------------------------------------------------------ setup
  static create(opts) {
    const g = new Game();
    const size = MAP_SIZES[opts.size] || MAP_SIZES.medium;
    g.W = size.W; g.H = size.H;
    g.seed = String(opts.seed ?? Math.floor(Math.random() * 1e9));
    g.settings = { ...opts };
    const map = generateMap(g.W, g.H, g.seed, opts.mapType);
    g.tiles = map.tiles;
    g.elev = Array.from(map.elev);
    g.rng = makeRng(g.seed + ':game');
    g.turn = 1;
    g.current = 0;
    g.nextId = 1;
    g.cities = [];
    g.units = [];
    g.log = [];
    g.winner = null;
    g.players = [];
    const nPlayers = opts.players || 4;
    const starts = pickStarts(map, nPlayers, g.seed, (i) => g.specialtyAt(i));
    const usedNames = new Set();
    for (let p = 0; p < starts.length; p++) {
      const idx = starts[p];
      const home = g.specialtyAt(idx);
      let nm = TRIBE_NAMES[home].find(n => !usedNames.has(n)) || (TRIBE_NAMES[home][0] + ' ' + (p + 1));
      usedNames.add(nm);
      const human = p < (opts.humans ?? 1);
      g.players.push({
        id: p, name: nm, color: PLAYER_COLORS[p % PLAYER_COLORS.length], home,
        human, gold: 5, techs: [], explored: new Array(g.W * g.H).fill(0), alive: true,
        kills: 0, losses: 0, cityNameIdx: 0,
      });
      const city = g.foundCityAt(p, idx, true);
      city.pop = 1;
      // starting units
      const spot = g.freeNeighbor(idx, (i) => !TERRAIN[g.tiles[i].t].water && g.tiles[i].t !== 'mountain');
      g.spawnUnit(p, 'warrior', spot ?? idx);
    }
    g.cityNamePool = g.rng.shuffle([...CITY_NAMES]);
    // rename starting cities from the shuffled pool for variety
    for (const c of g.cities) {
      c.name = g.takeCityName();
      for (const t of g.within(c.idx, 3)) g.players[c.owner].explored[t] = 1;
    }
    for (const pl of g.players) g.updateVision(pl.id);
    g.startTurn();
    return g;
  }

  takeCityName() {
    if (!this.cityNamePool || this.cityNamePool.length === 0) {
      this.cityNamePool = this.rng.shuffle(CITY_NAMES.map(n => n + ' II'));
    }
    return this.cityNamePool.pop();
  }

  // ------------------------------------------------------------ helpers
  idx(c, r) { return r * this.W + c; }
  cr(i) { return [i % this.W, (i / this.W) | 0]; }
  neighbors(i) {
    const [c, r] = this.cr(i);
    return neighborsOf(c, r, this.W, this.H).map(([nc, nr]) => nr * this.W + nc);
  }
  dist(a, b) { const [c1, r1] = this.cr(a); const [c2, r2] = this.cr(b); return hexDist(c1, r1, c2, r2); }
  within(i, rad) {
    const [c, r] = this.cr(i);
    const out = [];
    for (let rr = Math.max(0, r - rad); rr <= Math.min(this.H - 1, r + rad); rr++)
      for (let cc = Math.max(0, c - rad - 1); cc <= Math.min(this.W - 1, c + rad + 1); cc++)
        if (hexDist(c, r, cc, rr) <= rad) out.push(rr * this.W + cc);
    return out;
  }
  isWater(i) { return !!TERRAIN[this.tiles[i].t].water; }
  unitAt(i) { return this.unitMap ? this.unitMap.get(i) : this.units.find(u => u.idx === i); }
  cityAt(i) { const c = this.tiles[i].city; return c >= 0 ? this.cityById(c) : null; }
  cityById(id) { return this.cities.find(c => c.id === id); }
  unitById(id) { return this.units.find(u => u.id === id); }
  player(id) { return this.players[id]; }
  has(pid, tech) { return this.players[pid].techs.includes(tech); }
  freeNeighbor(i, pred) {
    for (const n of this.neighbors(i)) if (!this.unitAt(n) && (!pred || pred(n))) return n;
    return null;
  }
  emit(type, data) { for (const l of this.listeners) l(type, data); }
  addLog(msg, pid = null, idx = null) {
    this.log.push({ turn: this.turn, msg, pid, idx });
    if (this.log.length > 300) this.log.shift();
    this.emit('log', { msg, pid, idx });
  }
  rebuildUnitMap() {
    this.unitMap = new Map();
    for (const u of this.units) this.unitMap.set(u.idx, u);
  }

  // Specialty a city founded at tile i would get.
  specialtyAt(i) {
    const tl = this.tiles[i];
    if (tl.t === 'hills') return 'hilltop';
    if (tl.t === 'mountain') return 'mountain';
    if (tl.river) return 'riverside';
    let water = 0;
    for (const n of this.neighbors(i)) if (this.isWater(n)) water++;
    if (water >= 3) return 'coastal';
    return TERRAIN_TO_SPECIALTY[tl.t] || 'plains';
  }

  // 0 home,1 kin,2 foreign,3 alien — after integration & tech.
  affinity(city, pid = city.owner) {
    const base = Math.min(3, KIN_DIST[this.players[pid].home][city.specialty]);
    if (base === 0) return 0;
    let a = base - (city.adapt || 0) - (this.has(pid, 'assimilation') ? 1 : 0);
    return Math.max(1, a);
  }

  // ------------------------------------------------------------ cities
  canFoundAt(pid, i) {
    const tl = this.tiles[i];
    if (TERRAIN[tl.t].water) return { ok: false, why: 'Cannot settle on water' };
    if (tl.city >= 0) return { ok: false, why: 'Already a city' };
    if (tl.owner >= 0 && tl.owner !== pid) return { ok: false, why: 'Inside foreign borders' };
    if (tl.t === 'mountain' && !this.has(pid, 'climbing')) return { ok: false, why: 'Requires Climbing' };
    for (const c of this.cities) if (this.dist(c.idx, i) < 3) return { ok: false, why: 'Too close to ' + c.name };
    return { ok: true };
  }

  foundCityAt(pid, i, capital = false) {
    const pl = this.players[pid];
    const city = {
      id: this.nextId++, name: capital ? 'Capital' : this.takeCityName(), owner: pid, idx: i,
      level: 1, pop: 0, specialty: this.specialtyAt(i), founded: this.turn, held: 0, adapt: 0,
      buildings: [], capital, trainedTurn: -1, hp: 0,
    };
    this.cities.push(city);
    const tl = this.tiles[i];
    tl.city = city.id;
    tl.res = tl.res === 'oasis' ? 'oasis' : null;
    tl.imp = null; tl.ruin = false;
    if (this.affinity(city) === 0) city.pop += 1;
    this.claimTerritory(city);
    this.updateVision(pid);
    return city;
  }

  cityRadius(city) { return city.level >= 4 ? 2 : 1; }

  claimTerritory(city) {
    for (const t of this.within(city.idx, this.cityRadius(city))) {
      const tl = this.tiles[t];
      if (tl.owner < 0 || tl.ownerCity === city.id) { tl.owner = city.owner; tl.ownerCity = city.id; }
    }
    const ct = this.tiles[city.idx];
    ct.owner = city.owner; ct.ownerCity = city.id;
  }

  cityTiles(city) {
    return this.within(city.idx, 2).filter(t => this.tiles[t].ownerCity === city.id);
  }

  addPop(city, n) {
    city.pop += n;
    let leveled = false;
    while (city.pop >= city.level + 1) {
      city.pop -= city.level + 1;
      city.level++;
      leveled = true;
      if (city.level === 4) this.claimTerritory(city);
    }
    if (leveled) {
      this.addLog(`${city.name} grew to level ${city.level}`, city.owner, city.idx);
      this.emit('levelup', city);
    }
  }

  cityIncome(city) {
    const pl = this.players[city.owner];
    const aff = this.affinity(city);
    let g = 1 + Math.ceil(city.level * 0.6) + (city.capital ? 1 : 0) + AFFINITY[aff].gold;
    if (city.specialty === 'riverside' || city.specialty === 'desert') g += 1;
    if (this.has(pl.id, 'trade') && city.level >= 3) g += 1;
    for (const b of city.buildings) {
      const B = BUILDINGS[b];
      if (B.gold) g += B.gold;
      if (b === 'temple') g += 1;
      if (b === 'market') g += Math.floor(city.level / 2);
    }
    const tiles = this.cityTiles(city);
    if (city.buildings.includes('sawmill')) g += tiles.filter(t => this.tiles[t].imp === 'lumber').length;
    if (city.buildings.includes('peatworks')) g += Math.min(3, tiles.filter(t => this.tiles[t].t === 'marsh').length);
    if (city.specialty === 'forest') g += tiles.filter(t => this.tiles[t].imp === 'lumber').length;
    if (city.specialty === 'coastal') g += tiles.filter(t => this.tiles[t].imp === 'fishery' || this.tiles[t].imp === 'whaling').length;
    if (city.specialty === 'mountain') g += tiles.filter(t => this.tiles[t].imp === 'mine').length;
    return Math.max(1, g);
  }

  grossIncome(pid) {
    let s = 0;
    for (const c of this.cities) if (c.owner === pid) s += this.cityIncome(c);
    return s;
  }
  // Armies cost upkeep: each city supports 2 units for free, every extra unit costs 1 gold per turn.
  upkeep(pid) {
    const n = this.units.filter(u => u.owner === pid).length;
    const free = this.cities.filter(c => c.owner === pid).length * 2;
    return Math.max(0, n - free);
  }
  income(pid) { return Math.max(0, this.grossIncome(pid) - this.upkeep(pid)); }

  unitCap(pid) {
    let s = 0;
    for (const c of this.cities) if (c.owner === pid) s += c.level + 1;
    return s;
  }
  unitCount(pid) { return this.units.filter(u => u.owner === pid).length; }

  unitCost(city, type) {
    const U = UNITS[type];
    let cost = U.cost;
    if (type === 'settler') {
      const n = this.cities.filter(c => c.owner === city.owner).length +
        this.units.filter(u => u.owner === city.owner && u.type === 'settler').length;
      cost = 4 + 3 * n;
    }
    if (U.unique && U.unique === city.specialty) cost += AFFINITY[this.affinity(city)].unitCost;
    else if (U.unique) cost += 1; // trained through an adopted tradition
    if (city.buildings.includes('stables') && U.traits?.includes('mounted')) cost -= 1;
    return Math.max(1, cost);
  }

  // Traditions: owning 3+ well-integrated (home/kin) cities of a specialty lets every
  // city of the tribe train that specialty's unique unit.
  traditions(pid) {
    const count = {};
    for (const c of this.cities) {
      if (c.owner !== pid || this.affinity(c) > 1) continue;
      count[c.specialty] = (count[c.specialty] || 0) + 1;
    }
    return Object.keys(count).filter(s => count[s] >= 3);
  }

  trainable(city) {
    const pid = city.owner;
    const out = [];
    const trad = this.traditions(pid);
    for (const [k, U] of Object.entries(UNITS)) {
      if (U.unique && U.unique !== city.specialty && !trad.includes(U.unique)) continue;
      if (U.tech && !this.has(pid, U.tech)) continue;
      if (U.traits?.includes('naval')) {
        if (!this.neighbors(city.idx).some(n => this.isWater(n))) continue;
      }
      out.push(k);
    }
    return out;
  }

  canTrain(city, type) {
    if (city.owner !== this.current) return { ok: false, why: 'Not your turn' };
    if (!this.trainable(city).includes(type)) return { ok: false, why: 'Not available' };
    if (city.trainedTurn === this.turn) return { ok: false, why: 'Already trained this turn' };
    const cost = this.unitCost(city, type);
    if (this.players[city.owner].gold < cost) return { ok: false, why: `Need ${cost} gold` };
    if (this.unitCount(city.owner) >= this.unitCap(city.owner)) return { ok: false, why: 'Unit cap reached (grow cities)' };
    const U = UNITS[type];
    let spot = null;
    if (U.traits?.includes('naval')) spot = this.freeNeighbor(city.idx, n => this.isWater(n));
    else if (!this.unitAt(city.idx)) spot = city.idx;
    if (spot === null) return { ok: false, why: U.traits?.includes('naval') ? 'No free water tile' : 'City tile occupied' };
    return { ok: true, cost, spot };
  }

  train(city, type) {
    const chk = this.canTrain(city, type);
    if (!chk.ok) return chk;
    this.players[city.owner].gold -= chk.cost;
    city.trainedTurn = this.turn;
    const u = this.spawnUnit(city.owner, type, chk.spot);
    u.mvLeft = 0; u.attacked = true; u.acted = true;
    if (city.specialty === 'steppe' && UNITS[type].traits?.includes('mounted')) { u.vet = true; u.hp = this.maxHp(u); }
    this.emit('train', u);
    return { ok: true, unit: u };
  }

  canBuild(city, b) {
    const B = BUILDINGS[b];
    if (city.buildings.includes(b)) return { ok: false, why: 'Built' };
    if (B.special && B.special !== city.specialty) return { ok: false, why: 'Wrong specialty' };
    if (B.tech && !this.has(city.owner, B.tech)) return { ok: false, why: 'Requires ' + TECHS[B.tech].name };
    if (B.special && this.affinity(city) >= 3) return { ok: false, why: 'Alien culture — integrate first' };
    if (this.players[city.owner].gold < B.cost) return { ok: false, why: `Need ${B.cost} gold` };
    return { ok: true };
  }
  buildable(city) {
    return Object.keys(BUILDINGS).filter(b => {
      const B = BUILDINGS[b];
      return !city.buildings.includes(b) && (!B.special || B.special === city.specialty);
    });
  }
  build(city, b) {
    const chk = this.canBuild(city, b);
    if (!chk.ok) return chk;
    const B = BUILDINGS[b];
    this.players[city.owner].gold -= B.cost;
    city.buildings.push(b);
    if (B.pop) this.addPop(city, B.pop);
    if (b === 'temple') this.addPop(city, 1);
    if (b === 'watchtower') this.updateVision(city.owner);
    this.addLog(`${city.name} built ${B.name}`, city.owner, city.idx);
    return { ok: true };
  }

  // ------------------------------------------------------------ improvements
  improvementsFor(pid, i) {
    const tl = this.tiles[i];
    if (tl.owner !== pid || tl.city >= 0 || tl.imp) return [];
    const out = [];
    for (const [k, I] of Object.entries(IMPROVEMENTS)) {
      if (!I.terrain.includes(tl.t)) continue;
      if (I.consume && tl.res !== I.resource) continue;
      if (k === 'irrigate' && !(tl.river || tl.res === 'oasis' || this.neighbors(i).some(n => this.tiles[n].river || this.tiles[n].res === 'oasis'))) continue;
      if (k === 'gather' && tl.res !== 'fruit') continue;
      out.push(k);
    }
    return out;
  }
  canImprove(pid, i, k) {
    const I = IMPROVEMENTS[k];
    if (!this.improvementsFor(pid, i).includes(k)) return { ok: false, why: 'Not possible here' };
    if (I.tech && !this.has(pid, I.tech)) return { ok: false, why: 'Requires ' + TECHS[I.tech].name };
    if (this.players[pid].gold < I.cost) return { ok: false, why: `Need ${I.cost} gold` };
    return { ok: true };
  }
  improvePop(i, k) {
    const I = IMPROVEMENTS[k];
    const tl = this.tiles[i];
    const city = this.cityById(tl.ownerCity);
    let pop = I.pop;
    if (!I.consume && I.resource && tl.res === I.resource) pop += 1;
    if (k === 'farm' && tl.river) pop += 1;
    if (city) {
      if (k === 'farm' && city.specialty === 'plains') pop += 1;
      if (k === 'farm' && city.specialty === 'riverside' && tl.river) pop += 1;
      if ((k === 'mine' || k === 'quarry') && city.specialty === 'hilltop') pop += 1;
      if (k === 'pasture' && city.specialty === 'steppe') pop += 1;
      if (city.specialty === 'desert' && k !== 'irrigate') pop = Math.max(1, pop - 0); // desert: no bonus
    }
    return pop;
  }
  improve(pid, i, k) {
    const chk = this.canImprove(pid, i, k);
    if (!chk.ok) return chk;
    const I = IMPROVEMENTS[k];
    const tl = this.tiles[i];
    const pop = this.improvePop(i, k);
    this.players[pid].gold -= I.cost;
    if (I.consume) { tl.res = null; } else { tl.imp = k; }
    const city = this.cityById(tl.ownerCity);
    if (city) this.addPop(city, pop);
    this.emit('improve', { idx: i, k });
    return { ok: true };
  }

  // ------------------------------------------------------------ tech
  canResearch(pid, t) {
    const T = TECHS[t];
    const pl = this.players[pid];
    if (pl.techs.includes(t)) return { ok: false, why: 'Known' };
    if (!T.req.every(r => pl.techs.includes(r))) return { ok: false, why: 'Missing prerequisites' };
    const cost = this.techPrice(pid, t);
    if (pl.gold < cost) return { ok: false, why: `Need ${cost} gold` };
    return { ok: true, cost };
  }
  techPrice(pid, t) {
    const n = this.cities.filter(c => c.owner === pid).length;
    return techCost(TECHS[t].tier, n, this.has(pid, 'philosophy'));
  }
  research(pid, t) {
    const chk = this.canResearch(pid, t);
    if (!chk.ok) return chk;
    const pl = this.players[pid];
    pl.gold -= chk.cost;
    pl.techs.push(t);
    this.addLog(`${pl.name} learned ${TECHS[t].name}`, pid);
    return { ok: true };
  }

  // ------------------------------------------------------------ units
  spawnUnit(pid, type, i) {
    const U = UNITS[type];
    const u = { id: this.nextId++, type, owner: pid, idx: i, hp: U.hp, vet: false, kills: 0, mvLeft: U.mv, attacked: false, acted: false };
    this.units.push(u);
    this.rebuildUnitMap();
    return u;
  }
  has_(u, trait) { return !!UNITS[u.type].traits?.includes(trait); }
  maxHp(u) { return UNITS[u.type].hp + (u.vet ? 5 : 0); }
  embarked(u) { return !this.has_(u, 'naval') && this.isWater(u.idx); }
  stats(u) {
    const U = UNITS[u.type];
    if (this.embarked(u)) {
      const nav = this.has(u.owner, 'navigation') ? 1 : 0;
      const coastHome = this.players[u.owner].home === 'coastal' ? 1 : 0;
      return { ...EMBARKED, mv: EMBARKED.mv + nav + coastHome };
    }
    return U;
  }
  maxMv(u) { return this.stats(u).mv; }

  // Movement cost of unit u entering tile i (Infinity if impossible)
  moveCost(u, from, i) {
    const tl = this.tiles[i];
    const T = TERRAIN[tl.t];
    const pid = u.owner;
    const naval = this.has_(u, 'naval');
    if (naval) {
      if (!T.water) {
        const c = this.cityAt(i);
        return c && c.owner === pid ? 1 : Infinity;
      }
      return 1;
    }
    if (u.type === 'settler' && false) return Infinity;
    if (T.water) {
      if (T.deep && !this.has(pid, 'navigation')) return Infinity;
      if (!this.has(pid, 'sailing')) return Infinity;
      // embarking ends movement unless already at sea or coastal homeland
      if (!this.isWater(from) && this.players[pid].home !== 'coastal') return 99;
      return 1;
    }
    if (this.isWater(from)) return 99; // disembark ends movement
    const home = this.players[pid].home;
    const homeTerrain = { hilltop: 'hills', mountain: 'mountain', forest: 'forest', marsh: 'marsh', desert: 'desert', steppe: 'steppe', plains: 'plains' }[home];
    if (tl.t === 'mountain') {
      if (!this.has(pid, 'climbing') && !this.has_(u, 'mountainwalk') && home !== 'mountain') return Infinity;
      if (this.has_(u, 'mountainwalk') || home === 'mountain') return 1;
      return 3;
    }
    let cost = T.move;
    if (tl.t === homeTerrain) cost = 1;
    if (tl.t === 'forest' && (this.has_(u, 'forestwalk') || this.has(pid, 'roads'))) cost = 1;
    if (tl.t === 'hills' && (this.has_(u, 'hillwalk') || this.has(pid, 'roads'))) cost = 1;
    if (tl.t === 'marsh' && (this.has_(u, 'marshwalk') || this.has(pid, 'drainage'))) cost = 1;
    if ((tl.t === 'desert' || tl.t === 'steppe') && this.has_(u, 'desertwalk')) cost = 0.5;
    if (home === 'riverside' && tl.river && this.tiles[from].river) cost = Math.min(cost, 0.5);
    return cost;
  }

  // Tiles under enemy zone of control for player pid.
  zocSet(pid) {
    const s = new Set();
    for (const e of this.units) {
      if (e.owner === pid) continue;
      if (this.isHiddenFrom(e, pid)) continue;
      for (const n of this.neighbors(e.idx)) s.add(n);
    }
    return s;
  }

  isHiddenFrom(u, pid) {
    if (u.owner === pid) return false;
    if (this.has_(u, 'stealth') && this.tiles[u.idx].t === 'marsh') {
      for (const n of this.neighbors(u.idx)) { const o = this.unitAt(n); if (o && o.owner === pid) return false; }
      const c = this.cityAt(u.idx);
      return true;
    }
    return false;
  }

  // Dijkstra over this turn's movement points. Returns Map idx -> remaining mv.
  reachable(u, zoc = null) {
    const res = new Map();
    if (u.mvLeft <= 0) return res;
    zoc = zoc || this.zocSet(u.owner);
    const best = new Map([[u.idx, u.mvLeft]]);
    const open = [[u.idx, u.mvLeft]];
    while (open.length) {
      open.sort((a, b) => b[1] - a[1]);
      const [cur, left] = open.shift();
      if (best.get(cur) > left) continue;
      if (cur !== u.idx && zoc.has(cur)) continue; // can enter ZoC, not leave
      if (left <= 0) continue;
      for (const n of this.neighbors(cur)) {
        const occ = this.unitAt(n);
        if (occ && occ.owner !== u.owner) continue;
        const ec = this.cityAt(n);
        const cost = this.moveCost(u, cur, n);
        if (cost === Infinity) continue;
        // embarking/disembarking from a city is free-ish: treat normally
        const nl = Math.max(0, left - cost);
        if ((best.get(n) ?? -1) < nl) {
          best.set(n, nl);
          // can't pass through own units' tiles? allowed to pass, not stop
          open.push([n, nl]);
        }
      }
    }
    for (const [i, l] of best) {
      if (i === u.idx) continue;
      const occ = this.unitAt(i);
      if (occ) continue;
      if (u.type === 'settler' || this.has_(u, 'naval')) {
        const ec = this.cityAt(i);
        if (ec && ec.owner !== u.owner) continue;
      }
      res.set(i, l);
    }
    return res;
  }

  canMove(u, i) {
    if (u.owner !== this.current) return false;
    return this.reachable(u).has(i);
  }

  moveUnit(u, i) {
    const reach = this.reachable(u);
    if (!reach.has(i)) return { ok: false, why: 'Unreachable' };
    const from = u.idx;
    u.idx = i;
    u.mvLeft = reach.get(i);
    u.acted = true;
    if (this.attackTargets(u).length === 0 && !this.has_(u, 'skirmish') && u.attacked) u.mvLeft = 0;
    this.rebuildUnitMap();
    this.afterEnter(u, from);
    this.updateVision(u.owner);
    this.emit('move', { u, from, to: i });
    return { ok: true };
  }

  afterEnter(u, from) {
    const tl = this.tiles[u.idx];
    const c = this.cityAt(u.idx);
    if (c && c.owner !== u.owner) this.captureCity(c, u.owner);
    if (tl.ruin) { tl.ruin = false; this.openRuin(u); }
  }

  openRuin(u) {
    const pl = this.players[u.owner];
    const roll = this.rng.int(5);
    if (roll === 0) {
      const avail = Object.keys(TECHS).filter(t => !pl.techs.includes(t) && TECHS[t].req.every(r => pl.techs.includes(r)));
      if (avail.length) {
        const t = this.rng.pick(avail); pl.techs.push(t);
        this.addLog(`${pl.name} found old scrolls: learned ${TECHS[t].name}`, pl.id, u.idx); return;
      }
    }
    if (roll === 1) {
      const spot = this.freeNeighbor(u.idx, n => !this.isWater(n) && this.tiles[n].t !== 'mountain');
      if (spot !== null) {
        const nu = this.spawnUnit(u.owner, this.rng() < 0.4 ? 'settler' : 'swordsman', spot);
        nu.mvLeft = 0;
        this.addLog(`${pl.name} met wanderers: a ${UNITS[nu.type].name} joins`, pl.id, u.idx); return;
      }
    }
    if (roll === 2) {
      for (const t of this.within(u.idx, 5)) pl.explored[t] = 1;
      this.addLog(`${pl.name} found an old map`, pl.id, u.idx); return;
    }
    const g = 6 + this.rng.int(8);
    pl.gold += g;
    this.addLog(`${pl.name} found buried treasure: +${g} gold`, pl.id, u.idx);
  }

  captureCity(c, pid) {
    const old = c.owner;
    const oldName = this.players[old].name;
    c.owner = pid;
    c.pop = 0;
    c.held = 0;
    c.adapt = 0;
    c.capital = false;
    for (const t of this.within(c.idx, 2)) {
      if (this.tiles[t].ownerCity === c.id) this.tiles[t].owner = pid;
    }
    this.addLog(`${this.players[pid].name} captured ${c.name} from ${oldName}!`, pid, c.idx);
    this.emit('capture', { c, old, pid });
    this.checkElimination(old);
  }

  checkElimination(pid) {
    const pl = this.players[pid];
    if (!pl.alive) return;
    const hasCity = this.cities.some(c => c.owner === pid);
    if (!hasCity) {
      pl.alive = false;
      this.units = this.units.filter(u => u.owner !== pid);
      this.rebuildUnitMap();
      for (const t of this.tiles) if (t.owner === pid) { t.owner = -1; }
      this.addLog(`${pl.name} has fallen.`, pid);
      this.emit('eliminated', pl);
      const alive = this.players.filter(p => p.alive);
      if (alive.length === 1) this.declareWinner(alive[0].id, 'conquest');
      else if (!this.players.some(p => p.alive && p.human) && this.players.some(p => p.human)) {
        // all humans dead: game over, highest-score AI wins
        this.declareWinner(this.ranking()[0].id, 'conquest');
      }
    }
  }

  declareWinner(pid, how) {
    if (this.winner) return;
    this.winner = { pid, how };
    this.addLog(`${this.players[pid].name} wins by ${how}!`, pid);
    this.emit('win', this.winner);
  }

  // ------------------------------------------------------------ combat
  attackTargets(u) {
    if (u.attacked || u.owner !== this.current) return [];
    const S = this.stats(u);
    if (S.atk <= 0) return [];
    const out = [];
    for (const t of this.within(u.idx, S.rng)) {
      const e = this.unitAt(t);
      if (!e || e.owner === u.owner) continue;
      if (this.isHiddenFrom(e, u.owner)) continue;
      // naval units can only hit things on water or coast; land melee can't hit naval at sea unless embarked
      if (S.rng === 1 && this.has_(u, 'naval') && !this.isWater(t) && !this.neighbors(t).some(n => this.isWater(n))) continue;
      if (S.rng === 1 && !this.has_(u, 'naval') && !this.embarked(u) && this.isWater(t) && this.has_(e, 'naval')) continue;
      out.push(t);
    }
    return out;
  }

  defenseBonus(d) {
    const tl = this.tiles[d.idx];
    if (this.embarked(d) || this.has_(d, 'naval')) return 1;
    let b = TERRAIN[tl.t].def;
    const c = this.cityAt(d.idx);
    if (c && c.owner === d.owner) {
      b = Math.max(b, 1.5);
      if (c.buildings.includes('walls')) b *= 2;
      if (c.specialty === 'hilltop') b *= 1.5;
      if (c.buildings.includes('watchtower')) b *= 1.5;
    }
    return b;
  }

  combatPreview(a, d) {
    const SA = this.stats(a), SD = this.stats(d);
    let atk = SA.atk * (a.vet ? 1.2 : 1);
    let def = SD.def * (d.vet ? 1.2 : 1) * this.defenseBonus(d);
    const aMounted = this.has_(a, 'mounted') && !this.embarked(a);
    const dMounted = this.has_(d, 'mounted') && !this.embarked(d);
    if (this.has_(d, 'antimount') && aMounted) def *= 2;
    if (this.has_(a, 'antimount') && dMounted) atk *= 1.5;
    const atTile = this.tiles[a.idx].t;
    if (this.has_(a, 'forestwalk') && atTile === 'forest') atk *= 1.4;
    if (this.has_(a, 'stealth') && atTile === 'marsh') atk *= 1.4;
    const dc = this.cityAt(d.idx);
    if (dc && dc.owner === d.owner && dc.specialty === 'marsh') atk *= 0.75;
    const aForce = atk * (a.hp / this.maxHp(a));
    const dForce = def * (d.hp / this.maxHp(d));
    const total = aForce + dForce;
    const dmg = Math.round((aForce / total) * atk * 4.5);
    let ret = 0;
    const dist = this.dist(a.idx, d.idx);
    if (d.hp - dmg > 0 && SD.rng >= dist && SD.atk > 0) {
      ret = Math.round((dForce / total) * def * 3);
    }
    return { dmg: Math.max(1, dmg), ret };
  }

  attack(a, targetIdx) {
    if (!this.attackTargets(a).includes(targetIdx)) return { ok: false, why: 'Invalid target' };
    const d = this.unitAt(targetIdx);
    const { dmg, ret } = this.combatPreview(a, d);
    d.hp -= dmg;
    a.attacked = true; a.acted = true;
    const res = { ok: true, dmg, ret: 0, killed: false, died: false, from: a.idx, to: targetIdx };
    if (d.hp <= 0) {
      res.killed = true;
      this.killUnit(d, a);
      // melee advance
      if (this.stats(a).rng === 1 && !this.has_(a, 'naval') && this.moveCost(a, a.idx, targetIdx) !== Infinity) {
        const from = a.idx; a.idx = targetIdx; this.rebuildUnitMap(); this.afterEnter(a, from);
      } else if (this.has_(a, 'naval') && this.isWater(targetIdx)) {
        a.idx = targetIdx; this.rebuildUnitMap();
      }
    } else if (ret > 0) {
      a.hp -= ret; res.ret = ret;
      if (a.hp <= 0) { res.died = true; this.killUnit(a, d); }
    }
    if (!res.died) {
      if (!this.has_(a, 'skirmish')) a.mvLeft = 0;
    }
    this.updateVision(a.owner);
    this.emit('attack', res);
    return res;
  }

  killUnit(u, killer) {
    this.units = this.units.filter(x => x !== u);
    this.rebuildUnitMap();
    this.players[u.owner].losses++;
    if (killer) {
      killer.kills++;
      this.players[killer.owner].kills++;
      if (!killer.vet && killer.kills >= 3) {
        killer.vet = true; killer.hp = this.maxHp(killer);
        this.addLog(`A ${UNITS[killer.type].name} of ${this.players[killer.owner].name} became a veteran`, killer.owner, killer.idx);
      }
    }
  }

  disband(u) { this.units = this.units.filter(x => x !== u); this.rebuildUnitMap(); }

  // ------------------------------------------------------------ settlers
  canSettle(u) {
    if (u.type !== 'settler') return { ok: false, why: 'Not a settler' };
    if (u.owner !== this.current) return { ok: false, why: 'Not your turn' };
    if (u.mvLeft <= 0 && u.settledBlocked) return { ok: false, why: 'No moves' };
    return this.canFoundAt(u.owner, u.idx);
  }
  settle(u) {
    const chk = this.canSettle(u);
    if (!chk.ok) return chk;
    const i = u.idx;
    this.disband(u);
    const c = this.foundCityAt(u.owner, i);
    this.addLog(`${this.players[u.owner].name} founded ${c.name} (${SPECIALTY[c.specialty].name})`, u.owner, i);
    this.emit('found', c);
    return { ok: true, city: c };
  }

  // ------------------------------------------------------------ vision
  vision(pid) {
    const vis = new Uint8Array(this.W * this.H);
    for (const u of this.units) {
      if (u.owner !== pid) continue;
      let r = 1;
      const t = this.tiles[u.idx].t;
      if (t === 'hills' || t === 'mountain') r = 2;
      if (u.type === 'slinger' || this.has_(u, 'mounted')) r = Math.max(r, 2);
      for (const x of this.within(u.idx, r)) vis[x] = 1;
    }
    for (const c of this.cities) {
      if (c.owner !== pid) continue;
      let r = this.cityRadius(c) + 1;
      if (c.specialty === 'hilltop' || c.specialty === 'mountain') r += 1;
      if (c.buildings.includes('watchtower')) r += 2;
      for (const x of this.within(c.idx, r)) vis[x] = 1;
    }
    return vis;
  }
  updateVision(pid) {
    const pl = this.players[pid];
    if (!pl) return;
    const v = this.vision(pid);
    for (let i = 0; i < v.length; i++) if (v[i]) pl.explored[i] = 1;
    pl._vis = v;
  }
  visibleTo(pid, i) {
    const pl = this.players[pid];
    if (!pl._vis) this.updateVision(pid);
    return !!pl._vis[i];
  }

  // ------------------------------------------------------------ turns
  startTurn() {
    const pl = this.players[this.current];
    // income
    const inc = this.income(pl.id);
    pl.gold += inc;
    // cities: integration
    for (const c of this.cities) {
      if (c.owner !== pl.id) continue;
      c.held++;
      const base = KIN_DIST[pl.home][c.specialty];
      const need = c.buildings.includes('temple') ? INTEGRATION_TURNS / 2 : INTEGRATION_TURNS;
      if (base >= 2 && this.affinity(c) > 1 && c.held % need === 0) {
        c.adapt++;
        this.addLog(`${c.name} is integrating into ${pl.name} culture (${AFFINITY[this.affinity(c)].name})`, pl.id, c.idx);
      }
    }
    // units: heal + reset
    for (const u of this.units) {
      if (u.owner !== pl.id) continue;
      if (!u.acted && u.hp < this.maxHp(u)) {
        let h = 2;
        const tl = this.tiles[u.idx];
        if (tl.owner === pl.id) h = 4;
        const c = this.cityAt(u.idx);
        if (c && c.owner === pl.id) { h = 5; if (c.specialty === 'marsh') h += 2; }
        u.hp = Math.min(this.maxHp(u), u.hp + h);
      }
      u.mvLeft = this.maxMv(u);
      u.attacked = false;
      u.acted = false;
    }
    this.updateVision(pl.id);
    this.emit('turnstart', { pid: pl.id, turn: this.turn });
  }

  endTurn() {
    if (this.winner) return;
    let next = this.current;
    let wrapped = false;
    for (let k = 0; k < this.players.length; k++) {
      next = (next + 1) % this.players.length;
      if (next === 0) wrapped = true;
      if (this.players[next].alive) break;
    }
    if (wrapped || next <= this.current) {
      this.turn++;
      const lim = this.settings.turnLimit || 0;
      if (lim && this.turn > lim) {
        const top = this.ranking()[0];
        this.declareWinner(top.id, 'score');
        return;
      }
    }
    this.current = next;
    this.startTurn();
  }

  score(pid) {
    let s = 0;
    for (const c of this.cities) if (c.owner === pid) s += 20 + c.level * 15 + c.buildings.length * 10;
    s += this.players[pid].techs.length * 12;
    s += this.players[pid].explored.reduce((a, b) => a + b, 0) / 10 | 0;
    s += this.players[pid].kills * 3;
    return Math.round(s);
  }
  ranking() {
    return this.players.map(p => ({ id: p.id, score: p.alive ? this.score(p.id) : -1 })).sort((a, b) => b.score - a.score);
  }

  // ------------------------------------------------------------ save/load
  serialize() {
    return JSON.stringify({
      v: 1, W: this.W, H: this.H, seed: this.seed, settings: this.settings, tiles: this.tiles,
      elev: this.elev, turn: this.turn, current: this.current, nextId: this.nextId,
      cities: this.cities, units: this.units, log: this.log, winner: this.winner,
      players: this.players.map(p => ({ ...p, _vis: undefined })), rng: this.rng.state(),
      cityNamePool: this.cityNamePool,
    });
  }
  static deserialize(str) {
    const o = JSON.parse(str);
    const g = new Game();
    Object.assign(g, o);
    g.rng = makeRng(1); g.rng.setState(o.rng);
    g.rebuildUnitMap();
    for (const p of g.players) g.updateVision(p.id);
    return g;
  }
}
