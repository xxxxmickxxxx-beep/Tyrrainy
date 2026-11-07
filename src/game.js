// Core rules. Pure logic, no DOM — runs in the browser and in node (for sims).
import { neighborsOf, hexDist } from './hex.js';
import { makeRng } from './rng.js';
import {
  TERRAIN, SPECIALTY, KIN_DIST, AFFINITY, UNITS, EMBARKED, IMPROVEMENTS,
  BUILDINGS, WONDERS, TECHS, TEMPERAMENTS, TRIBE_PALETTE, SUBSIDIES, SENSITIVITY, FOREIGN_PEOPLE_SENSITIVITY, techCost, TERRAIN_TO_SPECIALTY, TRIBE_NAMES, CITY_NAMES, PLAYER_COLORS,
} from './data.js';
import { generateMap, pickStarts, MAP_SIZES } from './mapgen.js';
import { ROOTS, LAND_BASE, joinName, combining, cleanBase, pickColors, offshootColors } from './culture.js';

const INTEGRATION_TURNS = 10;
export const REVOLT_AT = 12;
export const RIOT_AT = 6;        // no training or construction
export const INSURRECTION_AT = 9; // rebel partisans may appear

export function rollTemper(rng, key) {
  const keys = Object.keys(TEMPERAMENTS);
  key = key || keys[Math.floor(rng() * keys.length)];
  const T = TEMPERAMENTS[key];
  const roll = ([a, b]) => a + rng() * (b - a);
  const out = { key, joined: -1, grudges: {} };
  for (const f of ['balance', 'caution', 'vengeance', 'appease', 'bully', 'opportunism', 'threshold', 'patience']) out[f] = roll(T[f]);
  return out;
}

const MAX_TRIBES = 20;
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
      const nm = '';
      const human = p < (opts.humans ?? 1);
      g.players.push({
        id: p, name: nm, color: null, color2: null, home,
        human, gold: 5, techs: [], explored: new Array(g.W * g.H).fill(0), alive: true,
        kills: 0, losses: 0, cityNameIdx: 0,
      });
      if (!human) g.players[p].temper = rollTemper(g.rng);
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
    // each founding people is named for its capital, with its own word for "people"
    g.cultures = [];
    const roots = g.rng.shuffle(ROOTS.map(r => r[0]));
    for (const pl of g.players) {
      const cap = g.cities.find(c => c.owner === pl.id);
      const cul = g.newCulture({ base: cap.name, root: roots[pl.id % roots.length], home: pl.home });
      pl.culture = cul.id; pl.name = cul.name; pl.color = cul.color; pl.color2 = cul.color2;
      cap.culture = cul.id;
    }
    g.coalition = -1;
    g.history = [];
    for (const pl of g.players) { pl.founded = 1; pl.peak = 1; }
    g.recordHistory();
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
  // Kinship distance between a tribe's homeland and a specialty. Rebels have no homeland:
  // every land is kin to them, none is home.
  kinDist(pid, spec) {
    const home = this.players[pid].home;
    return home ? KIN_DIST[home][spec] : 1;
  }
  affinity(city, pid = city.owner) {
    const base = Math.min(3, this.kinDist(pid, city.specialty));
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
      buildings: [], capital, trainedTurn: -1, hp: 0, culture: pl.culture,
    };
    this.cities.push(city);
    const tl = this.tiles[i];
    tl.city = city.id;
    tl.res = tl.res === 'oasis' ? 'oasis' : null;
    tl.imp = null; tl.ruin = false;
    if (this.affinity(city) === 0) city.pop += 1;
    this.claimTerritory(city);
    this.updateVision(pid);
    this.bumpPeak(pid);
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
    if (city.subsidy) return 0;
    const riot = this.unrest(city).net;
    if (riot > 0) g -= riot; // restless cities withhold taxes
    if (city.specialty === 'riverside' || city.specialty === 'desert') g += 1;
    if (this.has(pl.id, 'trade') && city.level >= 3) g += 1;
    if (this.hasWonder(pl.id, 'grandbazaar')) g += 1;
    if (city.wonders?.includes('eaglethrone')) g += 4;
    for (const b of city.buildings) {
      const B = BUILDINGS[b];
      if (B.gold) g += B.gold;
      if (b === 'temple') g += 1;
      if (b === 'market') g += Math.floor(city.level / 2);
    }
    const tiles = this.cityTiles(city);
    g -= this.occupation(city).lost;
    if (city.buildings.includes('sawmill')) g += tiles.filter(t => this.tiles[t].imp === 'lumber').length;
    if (city.buildings.includes('peatworks')) g += Math.min(3, tiles.filter(t => this.tiles[t].t === 'marsh').length);
    if (city.specialty === 'forest') g += tiles.filter(t => this.tiles[t].imp === 'lumber').length;
    if (city.specialty === 'coastal') g += tiles.filter(t => this.tiles[t].imp === 'fishery' || this.tiles[t].imp === 'whaling').length;
    if (city.specialty === 'mountain') g += tiles.filter(t => this.tiles[t].imp === 'mine').length;
    return Math.max(riot > 0 ? 0 : 1, g);
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
  subsidyCost(pid) {
    let s = 0;
    for (const c of this.cities) if (c.owner === pid && c.subsidy) s += SUBSIDIES[c.subsidy].cost;
    return s;
  }
  // Net income; can go negative when subsidies outrun revenue.
  income(pid) { return Math.max(0, this.grossIncome(pid) - this.upkeep(pid)) - this.subsidyCost(pid); }

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
    if (this.rioting(city)) return { ok: false, why: 'City is rioting' };
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
    const lim = this.buildBlock(city);
    if (lim) return { ok: false, why: lim };
    if (this.rioting(city) && !B.calm) return { ok: false, why: 'City is rioting (only compliance buildings)' };
    if (B.special && B.special !== city.specialty) return { ok: false, why: 'Wrong specialty' };
    if (B.tech && !this.has(city.owner, B.tech)) return { ok: false, why: 'Requires ' + TECHS[B.tech].name };
    if (B.special && this.affinity(city) >= 3) return { ok: false, why: 'Alien culture — integrate first' };
    if (this.players[city.owner].gold < B.cost) return { ok: false, why: `Need ${B.cost} gold` };
    return { ok: true };
  }
  // One construction per city per turn, and none while hostile troops stand next to it.
  buildBlock(city) {
    if (city.builtTurn === this.turn) return 'Already built this turn';
    if (this.neighbors(city.idx).some(n => { const u = this.unitAt(n); return u && u.owner !== city.owner; })) return 'Enemies at the gates';
    return null;
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
    city.builtTurn = this.turn;
    city.everBuilt = true;
    if (B.calm) city.festivals = Math.max(0, (city.festivals || 0) - 2);
    if (B.pop) this.addPop(city, B.pop);
    if (b === 'temple') this.addPop(city, 1);
    if (b === 'watchtower') this.updateVision(city.owner);
    this.addLog(`${city.name} built ${B.name}`, city.owner, city.idx);
    return { ok: true };
  }

  // ------------------------------------------------------------ unrest
  // Pressure (empire size, culture, conquest, city size) vs compliance (garrison,
  // buildings, capital, homeland, festivals). Positive net accumulates unrest; at
  // REVOLT_AT the city rises up and joins the Rebels.
  unrest(city) {
    const pid = city.owner;
    const pl = this.players[pid];
    const pressure = [], calm = [];
    // generic pressures are felt more keenly the more foreign the ruler is to the city
    const generic = [];
    const n = this.cities.filter(c => c.owner === pid).length;
    const size = Math.floor(Math.max(0, n - 4) / 2);
    if (size) generic.push(['Sprawling realm (' + n + ' cities)', size]);
    const aff = this.affinity(city);
    if (city.capturedTurn != null && this.turn - city.capturedTurn < 15) generic.push(['Recently conquered', 2]);
    if (this.occupation(city).occupied > 0) generic.push(['Enemies in our lands', 1]);
    const big = Math.floor(city.level / 4);
    if (big) generic.push(['Crowded city', big]);
    if (this.cities.some(o => o !== city && o.owner === pid && (o.unrest || 0) >= RIOT_AT && this.dist(o.idx, city.idx) <= 3)) generic.push(['Riots nearby', 1]);
    pressure.push(...generic);
    const R = pl.culture;
    const foreignPeople = city.culture != null && R != null && !this.related(city.culture, R);
    const regional = !foreignPeople && city.culture != null && city.culture !== R;
    const sens = SENSITIVITY[aff] + (foreignPeople ? FOREIGN_PEOPLE_SENSITIVITY : regional ? 0.1 : 0);
    const raw = generic.reduce((a, x) => a + x[1], 0);
    const adj = Math.round(raw * sens) - raw;
    if (raw && adj) pressure.push([`Cultural sensitivity ×${sens.toFixed(2).replace(/0$/, '')}`, adj]);
    if (aff >= 2) pressure.push([AFFINITY[aff].name, aff - 1]);
    if (city.riotUntil != null && this.turn <= city.riotUntil) pressure.push(['Festival riot', 2]);
    if (city.capital) calm.push(['Capital', 3]);
    if (aff === 0) calm.push(['Homeland', 1]);
    const gar = this.unitAt(city.idx);
    if (gar && gar.owner === pid && gar.type !== 'settler') calm.push(['Garrison', 1]);
    for (const b of city.buildings) if (BUILDINGS[b].calm) calm.push([BUILDINGS[b].name, BUILDINGS[b].calm]);
    if (city.subsidy) calm.push([SUBSIDIES[city.subsidy].name, SUBSIDIES[city.subsidy].calm]);
    const fest = city.festivalUntil != null && this.turn <= city.festivalUntil;
    if (fest) calm.push(['Festival', 2]);
    const P = pressure.reduce((a, x) => a + x[1], 0), C = calm.reduce((a, x) => a + x[1], 0);
    // underlying: the mood without any festival propping it up
    return { pressure, calm, net: P - C, total: P, underlying: P - C + (fest ? 2 : 0), sensitivity: sens };
  }
  // Subsidies: tiers of bought calm (see SUBSIDIES). Reliable, unlimited, costly.
  setSubsidy(city, tier) {
    if (city.owner !== this.current) return { ok: false, why: 'Not your turn' };
    tier = Math.max(0, Math.min(SUBSIDIES.length - 1, tier | 0));
    const extra = SUBSIDIES[tier].cost - SUBSIDIES[city.subsidy || 0].cost;
    if (extra > 0 && this.players[city.owner].gold < extra) return { ok: false, why: `Need ${extra} gold in the treasury` };
    city.subsidy = tier;
    return { ok: true };
  }
  rioting(city) { return (city.unrest || 0) >= RIOT_AT; }
  moodState(city) {
    const u = city.unrest || 0;
    if (u >= INSURRECTION_AT) return 'insurrection';
    if (u >= RIOT_AT) return 'rioting';
    if (this.unrest(city).net > 0) return 'restless';
    return u > 0 ? 'calming' : 'content';
  }
  // Festivals get less reliable each time one is held without fixing the underlying
  // problem. Building compliance or staying content on its own restores trust.
  festivalRisk(city) { return Math.min(0.7, 0.05 + 0.12 * (city.festivals || 0)); }
  placateCost(city) { return 4 + city.level * 2 + Math.floor((city.unrest || 0) / 2); }
  canPlacate(city) {
    if ((city.unrest || 0) <= 0 && this.unrest(city).net <= 0) return { ok: false, why: 'City is content' };
    if (city.festivalUntil != null && this.turn <= city.festivalUntil) return { ok: false, why: 'Festival under way' };
    if (city.riotUntil != null && this.turn <= city.riotUntil) return { ok: false, why: 'Still rioting after the last festival' };
    const cost = this.placateCost(city);
    if (this.players[city.owner].gold < cost) return { ok: false, why: `Need ${cost} gold` };
    return { ok: true, cost, risk: this.festivalRisk(city) };
  }
  placate(city) {
    const chk = this.canPlacate(city);
    if (!chk.ok) return chk;
    this.players[city.owner].gold -= chk.cost;
    city.festivals = (city.festivals || 0) + 1;
    city.calmStreak = 0;
    if (this.rng() < chk.risk) {
      city.unrest = (city.unrest || 0) + 3;
      city.riotUntil = this.turn + 4;
      this.addLog(`The festival in ${city.name} turned into a riot!`, city.owner, city.idx);
      this.emit('festival', { city, backfired: true });
      return { ok: true, backfired: true };
    }
    city.unrest = 0;
    city.festivalUntil = this.turn + 5;
    this.addLog(`${city.name} holds a festival — unrest quelled`, city.owner, city.idx);
    this.emit('festival', { city, backfired: false });
    return { ok: true, backfired: false };
  }
  uniqueTribeName(base) {
    const taken = new Set(this.players.filter(p => p.alive).map(p => p.name)); // a people may rise again under its old name
    if (!taken.has(base)) return base;
    const R = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    for (const r of R) if (!taken.has(base + ' ' + r)) return base + ' ' + r;
    return base + ' ' + this.players.length;
  }
  // ------------------------------------------------------------ peoples
  liveCultures() {
    const used = new Set();
    for (const p of this.players) if (p.alive && p.culture != null) used.add(p.culture);
    for (const c of this.cities) if (c.culture != null) used.add(c.culture);
    return [...used].map(id => this.cultures[id]).filter(Boolean);
  }
  newCulture({ base, root, parent = null, influence = null, core = null, home = null, city = null, reuse = false }) {
    this.cultures = this.cultures || [];
    // a people that rises again is the same people, not a new one
    if (reuse) {
      const same = this.cultures.find(c => cleanBase(c.base) === cleanBase(base) && c.root === root && (c.influence ?? null) === influence && (influence == null || c.core === core) && !this.polityOf(c.id));
      if (same) return same;
    }
    const id = this.cultures.length;
    let name = influence != null
      ? `${combining(this.cultures[influence].base)}-${this.cultures[core].name}`
      : joinName(base, root);
    const taken = new Set(this.liveCultures().map(c => c.name));
    if (taken.has(name) && city && !name.startsWith(cleanBase(city.name))) name = `${cleanBase(city.name)} ${name}`;
    if (taken.has(name)) for (const r of ['II', 'III', 'IV', 'V', 'VI', 'VII']) if (!taken.has(name + ' ' + r)) { name += ' ' + r; break; }
    const cul = { id, base, root, parent, influence, core: core ?? id, home, name, born: this.turn };
    const live = this.liveCultures();
    [cul.color, cul.color2] = parent != null ? offshootColors(this.cultures[parent], live) : pickColors(live);
    this.cultures.push(cul);
    return cul;
  }
  cultureFamily(id) {
    let c = this.cultures?.[id];
    let guard = 0;
    while (c && c.parent != null && guard++ < 50) c = this.cultures[c.parent];
    return c ? c.id : id;
  }
  // Same family = kin peoples: founding people, its regional offshoots and influenced variants.
  related(a, b) { return a != null && b != null && this.cultureFamily(a) === this.cultureFamily(b); }
  polityOf(cid) {
    if (cid == null) return null;
    return this.players.find(p => p.alive && p.culture === cid) || null;
  }
  // How a city's people are called right now: "Eskjana", or "Esko-Mardujana" under foreign rule.
  peopleLabel(city) {
    const cul = this.cultures?.[city.culture];
    const R = this.cultures?.[this.players[city.owner].culture];
    if (!cul) return '';
    if (!R || this.related(cul.id, R.id)) return cul.name;
    return `${combining(this.cultures[cul.core].base)}-${R.name}`;
  }
  // Distant, long-held cities of a tribe's own people grow their own regional identity.
  maybeDiverge(pl) {
    const cap = this.cities.find(c => c.owner === pl.id && c.capital);
    if (!cap || (this.cultures?.length || 0) > 80) return;
    for (const c of this.cities) {
      if (c.owner !== pl.id || c.culture !== pl.culture || c.capital || (c.held || 0) < 20) continue;
      if (this.dist(c.idx, cap.idx) < 8 || this.rng() > 0.04) continue;
      const parent = this.cultures[pl.culture];
      const base = c.level >= 4 ? c.name : LAND_BASE[c.specialty];
      const cul = this.newCulture({ base, root: parent.root, parent: parent.id, home: c.specialty, city: c });
      const region = this.cities.filter(o => o.owner === pl.id && o.culture === pl.culture && !o.capital && this.dist(o.idx, c.idx) <= 3 && this.dist(o.idx, cap.idx) >= 6);
      for (const o of region) o.culture = cul.id;
      this.addLog(`The people around ${c.name} have come to call themselves the ${cul.name}.`, pl.id, c.idx);
      this.emit('diverge', { cul, city: c });
      return; // at most one new identity per tribe per turn
    }
  }

  // A rebellion takes the homeland of the city it rises in. Kindred rebellions close by merge.
  rebellionFor(city) {
    const owner = city.owner;
    const cur = this.players[city.rebellion];
    if (cur && cur.alive && cur.id !== owner) return cur.id;
    for (const p of this.players) {
      if (!p.rebel || !p.alive || p.id === owner) continue;
      if (this.kinDist(p.id, city.specialty) > 1) continue;
      if (!this.related(p.culture, city.culture)) continue;
      if (this.cities.some(c => c.owner === p.id && this.dist(c.idx, city.idx) <= 5)) { city.rebellion = p.id; return p.id; }
    }
    const nearest = () => this.players.filter(p => p.rebel && p.alive && p.id !== owner)
      .map(p => [p.id, Math.min(99, ...this.cities.filter(c => c.owner === p.id).map(c => this.dist(c.idx, city.idx)))]).sort((a, b) => a[1] - b[1])[0];
    if (this.players.filter(p => p.alive).length >= MAX_TRIBES) { const n = nearest(); if (n) { city.rebellion = n[0]; return n[0]; } }
    const old = this.players[owner];
    const id = this.players.length;
    const human = this.settings.rebelControl === 'human' && this.players.some(p => p.human);
    // who are the rebels? their own people, possibly marked by their former rulers
    const R = old.culture;
    let cul, cid = city.culture;
    if (cid == null || this.related(cid, R)) {
      if (cid != null && cid !== R && !this.polityOf(cid)) cul = this.cultures[cid]; // an existing regional identity
      else cul = this.newCulture({ base: city.name, root: this.cultures[R]?.root || '', parent: cid ?? R, home: city.specialty, city, reuse: true });
    } else {
      const X = this.cultures[this.cultures[cid].core];
      if ((city.held || 0) >= 15 && R != null) cul = this.newCulture({ base: X.base, root: X.root, parent: X.id, influence: R, core: X.id, home: city.specialty, city, reuse: true });
      else if (!this.polityOf(X.id)) cul = X;
      else cul = this.newCulture({ base: city.name, root: X.root, parent: X.id, home: city.specialty, city, reuse: true });
    }
    const pl = {
      id, name: this.uniqueTribeName(cul.name), color: cul.color, color2: cul.color2, culture: cul.id, home: city.specialty, human, rebel: true, rebelFrom: owner,
      gold: 4, techs: [...old.techs], explored: new Array(this.W * this.H).fill(0), alive: true, kills: 0, losses: 0, born: this.turn,
    };
    if (!human) { pl.temper = rollTemper(this.rng); pl.temper.grudges[owner] = 40; }
    pl.founded = this.turn; pl.peak = 0;
    this.players.push(pl);
    for (const t of this.within(city.idx, 4)) pl.explored[t] = 1;
    city.rebellion = id;
    this.addLog(`A rebellion rises in ${city.name}: the ${pl.name} defy ${old.name}!`, owner, city.idx);
    this.emit('rebellion', { pid: id, city, from: owner });
    return id;
  }

  revolt(city) {
    const old = city.owner;
    const rid = this.rebellionFor(city);
    const gar = this.unitAt(city.idx);
    if (gar && gar.owner === old) { gar.owner = rid; gar.goto = null; } // the garrison defects
    city.owner = rid;
    city.culture = this.players[rid].culture; // the rebels are this city's own people
    city.unrest = 0;
    city.subsidy = 0;
    city.capital = false;
    city.held = 0; city.adapt = 0;
    for (const t of this.within(city.idx, 2)) if (this.tiles[t].ownerCity === city.id) this.tiles[t].owner = rid;
    if (!this.unitAt(city.idx)) this.spawnUnit(rid, this.turn > 35 ? 'swordsman' : 'warrior', city.idx);
    const spot = this.freeNeighbor(city.idx, n => !this.isWater(n) && this.tiles[n].t !== 'mountain');
    if (spot !== null) this.spawnUnit(rid, this.turn > 35 ? 'archer' : 'warrior', spot);
    this.rebuildUnitMap();
    const reb = this.players[rid];
    reb.heldCity = true;
    this.bumpPeak(rid);
    reb.gold += 5 + city.level * 2;
    for (const t of this.within(city.idx, 3)) reb.explored[t] = 1;
    if (reb.temper) reb.temper.grudges[old] = (reb.temper.grudges[old] || 0) + 40;
    this.updateVision(rid);
    this.addLog(`${city.name} has revolted against ${this.players[old].name} and joined the ${reb.name}!`, old, city.idx);
    this.emit('revolt', { city, old });
    this.checkElimination(old);
  }

  // ------------------------------------------------------------ balance of power
  power(pid) {
    let p = 0;
    for (const c of this.cities) if (c.owner === pid) p += c.level + 2;
    for (const u of this.units) if (u.owner === pid && u.type !== 'settler') p += 0.5;
    return p;
  }
  // Tribes still in the game: alive and holding at least one city.
  contenders() {
    const holders = new Set(this.cities.map(c => c.owner));
    return this.players.filter(p => p.alive && holders.has(p.id));
  }
  addGrudge(victim, attacker, amount) {
    const t = this.players[victim]?.temper;
    if (!t || victim === attacker) return;
    t.grudges[attacker] = (t.grudges[attacker] || 0) + amount;
  }
  // A single runaway power: 0 .. 1. Needs a clear lead over the runner-up AND the field,
  // so two near-peer empires don't trigger a world coalition.
  dominance() {
    if (this._dom && this._dom.key === this.turn + ':' + this.current) return this._dom;
    const alive = this.contenders();
    let res = { leader: -1, d: 0, key: this.turn + ':' + this.current };
    if (alive.length >= 3 && this.turn >= 15) {
      const pw = alive.map(p => [p.id, this.power(p.id)]).sort((a, b) => b[1] - a[1]);
      const rest = pw.slice(1).reduce((a, x) => a + x[1], 0) / (pw.length - 1);
      const vsField = (pw[0][1] / Math.max(1, rest) - 1.3) / 0.9;
      const vsSecond = (pw[0][1] / Math.max(1, pw[1][1]) - 1.2) / 0.6;
      res = { leader: pw[0][0], d: Math.max(0, Math.min(1, vsField, vsSecond)), ratio: pw[0][1] / Math.max(1, rest), ratio2: pw[0][1] / Math.max(1, pw[1][1]), key: res.key };
    }
    this._dom = res;
    return res;
  }
  // How dangerous each other tribe is to pid: proximity, shared border, armies near pid's
  // cities, relative power. Cached per player-turn.
  threats(pid) {
    const key = this.turn + ':' + this.current + ':' + this.units.length + ':' + this.cities.length;
    this._thr = this._thr || {};
    if (this._thr[pid]?.key === key) return this._thr[pid];
    const mine = this.cities.filter(c => c.owner === pid);
    const myPow = Math.max(1, this.power(pid));
    const border = {};
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i].owner !== pid) continue;
      const seen = new Set();
      for (const n of this.neighbors(i)) {
        const o = this.tiles[n].owner;
        if (o >= 0 && o !== pid && !seen.has(o)) { seen.add(o); border[o] = (border[o] || 0) + 1; }
      }
    }
    const out = { key, by: {} };
    for (const p of this.players) {
      if (!p.alive || p.id === pid) continue;
      const theirs = this.cities.filter(c => c.owner === p.id);
      let dmin = 99;
      for (const a of mine) for (const b of theirs) dmin = Math.min(dmin, this.dist(a.idx, b.idx));
      let army = 0;
      for (const u of this.units) {
        if (u.owner !== p.id || UNITS[u.type].atk <= 0) continue;
        if (mine.some(c => this.dist(c.idx, u.idx) <= 3)) army += UNITS[u.type].atk / 2;
      }
      if (!theirs.length && !army) continue;
      const rp = Math.max(0.25, Math.min(2.5, this.power(p.id) / myPow));
      const prox = 1 / (1 + Math.max(0, dmin - 4) / 4);
      const bord = (border[p.id] || 0) / ((border[p.id] || 0) + 8);
      const threat = (0.5 * prox + 0.8 * bord + Math.min(1, army / 5)) * Math.pow(rp, 0.7) / 1.5;
      out.by[p.id] = { threat, rp, dmin, border: border[p.id] || 0, army, reach: 1 / (1 + Math.max(0, dmin - 6) / 5) };
    }
    const { leader, d } = this.dominance();
    let pressing = 0;
    for (const [t, x] of Object.entries(out.by)) if (+t !== leader) pressing = Math.max(pressing, x.threat);
    out.pressing = Math.min(1, pressing);
    const T = this.players[pid].temper;
    out.containment = leader >= 0 && leader !== pid && T
      ? d * T.balance * (out.by[leader]?.reach ?? 0) * (1 - 0.7 * out.pressing)
      : 0;
    this._thr[pid] = out;
    return out;
  }
  // Targeting weight an AI tribe gives to fighting `target`. Temperament sets the weights;
  // nothing is forbidden. An appeaser whose core is threatened fights back, and a far-away
  // balancer beset by its own neighbours does not march across the world.
  hostility(pid, target) {
    if (target === pid) return 0;
    const T = this.players[pid].temper;
    if (!T) return 1;
    const thr = this.threats(pid);
    const x = thr.by[target] || { threat: 0, rp: 1, reach: 0 };
    const caution = T.caution ?? 0.8, appease = T.appease ?? 0, bully = T.bully ?? 0;
    const grudge = Math.min(1.5, (T.grudges[target] || 0) / 25 * (T.vengeance ?? 1));
    const threatW = x.threat * caution;
    const preyW = bully * Math.max(0, 0.7 - x.rp);
    const { leader, d } = this.dominance();
    const C = thr.containment;
    let w;
    if (leader >= 0 && leader !== pid && target === leader) {
      w = 1 + grudge + threatW + 3 * C;
      w -= appease * d * 1.5 * Math.max(0, 1 - x.threat * 1.5); // fades as the leader becomes a direct threat
    } else {
      // members go easy on fellow non-leaders, but never at the cost of self-defence
      const restraint = Math.max(0.3, 1 - 0.7 * Math.min(1, C * 2));
      w = (1 + grudge + preyW) * restraint + threatW;
    }
    return Math.max(0.1, w);
  }
  coalitionMembers() {
    const live = new Set(this.contenders().map(p => p.id));
    return this.players.filter(p => p.temper && live.has(p.id) && p.temper.joined >= 0 && p.temper.joined === this.coalition).map(p => p.id);
  }
  // Coalition membership is descriptive: an AI counts itself in when its own containment
  // pull passes its threshold (and out when it falls below threshold × patience).
  updateCoalition() {
    const { leader } = this.dominance();
    for (const p of this.contenders()) {
      const T = p.temper;
      if (!T) continue;
      for (const k in T.grudges) { T.grudges[k] *= 0.9; if (T.grudges[k] < 1) delete T.grudges[k]; }
      const C = this.threats(p.id).containment;
      if (T.joined >= 0 && (T.joined !== leader || C < T.threshold * T.patience)) {
        this.addLog(`${p.name} abandons the coalition against ${this.players[T.joined].name}.`, p.id);
        T.joined = -1;
      }
      if (T.joined < 0 && leader >= 0 && leader !== p.id && C >= T.threshold) {
        T.joined = leader;
        this.addLog(`${p.name} joins the coalition against ${this.players[leader].name}!`, p.id);
        this.emit('coalition', { leader, member: p.id });
      }
    }
    const any = this.players.some(p => p.temper && p.alive && p.temper.joined >= 0);
    this.coalition = any ? leader : -1;
  }

  // ------------------------------------------------------------ wonders
  wonderOwner(w) { for (const c of this.cities) if (c.wonders?.includes(w)) return c; return null; }
  hasWonder(pid, w) { const c = this.wonderOwner(w); return !!c && c.owner === pid; }
  canBuildWonder(city, w) {
    const W = WONDERS[w];
    if (W.special !== city.specialty) return { ok: false, why: 'Wrong specialty' };
    const o = this.wonderOwner(w);
    if (o) return { ok: false, why: o.owner === city.owner ? 'Already yours' : `Built by ${this.players[o.owner].name}` };
    if (city.level < 5) return { ok: false, why: 'City must be level 5' };
    const lim = this.buildBlock(city);
    if (lim) return { ok: false, why: lim };
    if (this.rioting(city)) return { ok: false, why: 'City is rioting' };
    if (this.players[city.owner].gold < W.cost) return { ok: false, why: `Need ${W.cost} gold` };
    return { ok: true };
  }
  buildWonder(city, w) {
    const chk = this.canBuildWonder(city, w);
    if (!chk.ok) return chk;
    const W = WONDERS[w];
    const pl = this.players[city.owner];
    pl.gold -= W.cost;
    city.wonders = city.wonders || [];
    city.wonders.push(w);
    city.builtTurn = this.turn;
    city.everBuilt = true;
    if (w === 'greatgranary') for (const c of this.cities) if (c.owner === pl.id) this.addPop(c, 2);
    if (w === 'lighthouse') for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i].t === 'shallows') pl.explored[i] = 1;
    this.updateVision(pl.id);
    this.addLog(`${pl.name} completed the ${W.name} in ${city.name}!`, pl.id, city.idx);
    this.emit('wonder', { city, w });
    return { ok: true };
  }

  // ------------------------------------------------------------ occupation & war damage
  // Hostile units standing on a city's tiles cut it off from them; damaged improvements
  // produce nothing until repaired.
  occupation(city) {
    let occupied = 0, damaged = 0;
    for (const t of this.cityTiles(city)) {
      if (t === city.idx) continue;
      const tl = this.tiles[t];
      const u = this.unitAt(t);
      const hostile = u && u.owner !== city.owner;
      if (hostile) occupied++;
      if (tl.imp && (hostile || tl.damaged)) { if (tl.damaged) damaged++; }
    }
    let lost = 0;
    for (const t of this.cityTiles(city)) {
      if (t === city.idx) continue;
      const tl = this.tiles[t];
      const u = this.unitAt(t);
      if ((tl.imp || tl.res) && ((u && u.owner !== city.owner) || tl.damaged)) lost++;
    }
    return { occupied, damaged, lost };
  }
  removePop(city, n) {
    city.pop -= n;
    let lost = false;
    while (city.pop < 0 && city.level > 1) { city.level--; city.pop += city.level + 1; lost = true; }
    if (city.pop < 0) city.pop = 0;
    if (lost) this.addLog(`${city.name} shrank to level ${city.level}`, city.owner, city.idx);
  }
  // Called at the start of the occupier's turn for each unit sitting on enemy improvements.
  pillage(u) {
    const tl = this.tiles[u.idx];
    if (!tl.imp || tl.owner < 0 || tl.owner === u.owner || tl.city >= 0) return;
    if (this.rng() >= 0.35) return;
    const city = this.cityById(tl.ownerCity);
    const I = IMPROVEMENTS[tl.imp];
    if (!tl.damaged) {
      tl.damaged = true;
      this.addLog(`${this.players[u.owner].name} damaged a ${I.name}${city ? ' near ' + city.name : ''}`, tl.owner, u.idx);
    } else {
      const pop = tl.impPop ?? I.pop;
      tl.imp = null; tl.damaged = false; tl.impPop = undefined;
      if (city) this.removePop(city, pop);
      this.addLog(`${this.players[u.owner].name} destroyed a ${I.name}${city ? ' near ' + city.name : ''}`, tl.owner, u.idx);
    }
    this.emit('pillage', { idx: u.idx });
  }
  repairCost(i) { const tl = this.tiles[i]; return tl.imp ? Math.ceil(IMPROVEMENTS[tl.imp].cost / 2) : 0; }
  canRepair(pid, i) {
    const tl = this.tiles[i];
    if (!tl.damaged || tl.owner !== pid) return { ok: false, why: 'Nothing to repair' };
    const u = this.unitAt(i);
    if (u && u.owner !== pid) return { ok: false, why: 'Enemy on the tile' };
    if (this.players[pid].gold < this.repairCost(i)) return { ok: false, why: `Need ${this.repairCost(i)} gold` };
    return { ok: true };
  }
  repair(pid, i) {
    const chk = this.canRepair(pid, i);
    if (!chk.ok) return chk;
    this.players[pid].gold -= this.repairCost(i);
    this.tiles[i].damaged = false;
    return { ok: true };
  }
  destroyBuilding(city, why) {
    if (!city.buildings.length) return null;
    const b = city.buildings.splice(this.rng.int(city.buildings.length), 1)[0];
    this.addLog(`${BUILDINGS[b].name} in ${city.name} was destroyed${why ? ' ' + why : ''}`, city.owner, city.idx);
    if (b === 'watchtower') this.updateVision(city.owner);
    return b;
  }
  // Chance a city is razed when captured (after the sack has taken its toll).
  //  - holds a wonder: 5%
  //  - still has buildings: never
  //  - stripped bare (had buildings once): 60% at level 1, −10% per level, min 10%
  //  - never built anything: 33% at level 1, −3% per level, min 18%
  razeChance(c) {
    if (c.wonders?.length) return 0.05;
    if (c.buildings.length) return 0;
    if (c.everBuilt) return Math.max(0.1, 0.6 - 0.1 * c.level);
    return Math.max(0.18, 0.36 - 0.03 * c.level);
  }
  // Should the conqueror raze this freshly captured city? Favours razing cities that will
  // be restless and unproductive; never one of the conqueror's own people.
  razeAdvice(c, pid) {
    const reasons = [];
    const un = this.unrest(c);
    const aff = this.affinity(c, pid);
    // judge the long run: conquest shock fades after 15 turns
    const shock = c.capturedTurn === this.turn ? Math.round(2 * un.sensitivity) : 0;
    const longRun = un.net - shock;
    // calm we could still add without subsidies: compliance buildings we can build, and a garrison
    let calmB = 0;
    for (const [k, B] of Object.entries(BUILDINGS)) if (B.calm && !c.buildings.includes(k) && (!B.tech || this.has(pid, B.tech))) calmB += B.calm;
    const gar = this.unitAt(c.idx);
    if (!gar || gar.owner !== pid) calmB += 1;
    const rest = longRun - calmB;
    const yieldNow = Math.max(0, 1 + Math.ceil(c.level * 0.6) + AFFINITY[aff].gold);
    let value;
    if (rest <= 0) {
      value = yieldNow;
      reasons.push(`Governable: long-run unrest ${longRun > 0 ? '+' + longRun : longRun}, offset by buildings and a garrison`);
      reasons.push(`worth about ${yieldNow} gold/turn`);
    } else {
      const tier = SUBSIDIES.findIndex(S => S.calm >= rest);
      if (tier > 0) {
        value = -SUBSIDIES[tier].cost - 0.5;
        reasons.push(`Long-run unrest +${longRun}: needs ${SUBSIDIES[tier].name} (${SUBSIDIES[tier].cost ? SUBSIDIES[tier].cost + ' gold/turn, ' : ''}no taxes) on top of buildings`);
      } else {
        value = -10;
        reasons.push(`Long-run unrest +${longRun}: ungovernable, it will revolt`);
      }
    }
    // gold matters less to a full treasury; a city is also worth unit capacity, score and power
    const rich = this.players[pid].gold > 150 ? 0.5 : 1;
    let score = -value * (value < 0 ? rich : 1) - (1 + c.level * 0.6);
    if (aff === 3) { score += 1; reasons.push('Alien land'); }
    if (c.wonders?.length) { score -= 6; reasons.push('Holds a wonder'); }
    if (this.related(c.culture, this.players[pid].culture)) { score -= 20; reasons.push('Our own people'); }
    const T = this.players[pid].temper;
    const pol = this.polityOf(c.culture) || this.polityOf(this.cultures?.[c.culture]?.core);
    if (T && pol && T.grudges[pol.id]) { const gb = Math.min(1.5, T.grudges[pol.id] / 30 * (T.vengeance ?? 1)); score += gb; if (gb > 0.5) reasons.push('Old grudge'); }
    return { raze: score > 2, score, reasons };
  }
  // Deliberate razing by a human conqueror, allowed on the turn of capture.
  razeByChoice(c) {
    if (c.razeDecision !== this.turn || c.owner !== this.current) return { ok: false, why: 'Too late to raze' };
    const old = c.culture;
    this.razeCity(c, c.owner, true);
    return { ok: true, old };
  }
  keepCity(c) { c.razeDecision = undefined; return { ok: true }; }
  razeCity(c, by, deliberate = false) {
    if (deliberate) {
      // atrocities are remembered by the city's people and its former rulers
      const pol = this.polityOf(c.culture) || this.polityOf(this.cultures?.[c.culture]?.core);
      if (pol && pol.id !== by) this.addGrudge(pol.id, by, 40);
      if (c.capturedFrom != null && c.capturedFrom !== c.culture) this.addGrudge(c.capturedFrom, by, 20);
    }
    const old = c.owner;
    for (const t of this.within(c.idx, 2)) {
      const tl = this.tiles[t];
      if (tl.ownerCity === c.id) { tl.owner = -1; tl.ownerCity = undefined; }
    }
    this.tiles[c.idx].city = -1;
    this.tiles[c.idx].ruin = true;
    this.cities = this.cities.filter(x => x !== c);
    for (const o of this.cities) if (o.owner >= 0) this.claimTerritory(o); // neighbours reclaim free land
    this.addLog(`${c.name} was ${deliberate ? 'put to the torch' : 'razed to the ground'} by ${this.players[by].name}!`, by, c.idx);
    this.emit('razed', { c, by, old });
  }
  bumpPeak(pid) {
    const n = this.cities.filter(c => c.owner === pid).length;
    const p = this.players[pid];
    if (p && n > (p.peak || 0)) p.peak = n;
  }
  recordHistory() {
    this.history = this.history || [];
    const pw = {};
    for (const p of this.players) if (p.alive) { const v = this.power(p.id); if (v > 0) pw[p.id] = Math.round(v * 10) / 10; }
    this.history.push({ t: this.turn, pw });
    // remember who has met whom, so fallen tribes stay identifiable in the records
    for (const h of this.players) {
      if (!h.human || !h.alive) continue;
      for (const c of this.cities) {
        const p = this.players[c.owner];
        if (p.id !== h.id && h.explored[c.idx] && !(p.metBy ||= []).includes(h.id)) p.metBy.push(h.id);
      }
    }
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
    if (I.consume) { tl.res = null; if (k === 'fishery' || k === 'whaling') tl.imp = k; } else { tl.imp = k; }
    tl.impPop = pop;
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
    return techCost(TECHS[t].tier, n, this.has(pid, 'philosophy'), this.hasWonder(pid, 'sunpyramid'));
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
      const lh = this.hasWonder(u.owner, 'lighthouse') ? 1 : 0;
      return { ...EMBARKED, mv: EMBARKED.mv + nav + coastHome + lh };
    }
    if (U.traits?.includes('mounted') && this.hasWonder(u.owner, 'khansbanner')) return { ...U, mv: U.mv + 1 };
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
    c.unrest = 0;
    c.subsidy = 0;
    c.capturedTurn = this.turn;
    c.capturedFrom = old;
    for (const t of this.within(c.idx, 2)) {
      if (this.tiles[t].ownerCity === c.id) this.tiles[t].owner = pid;
    }
    this.addGrudge(old, pid, 30);
    this.addLog(`${this.players[pid].name} captured ${c.name} from ${oldName}!`, pid, c.idx);
    // the sack: each building may be lost; a city stripped of everything may be razed
    const had = c.buildings.length;
    for (const b of [...c.buildings]) if (this.rng() < 0.35) { c.buildings.splice(c.buildings.indexOf(b), 1); }
    if (had && c.buildings.length < had) this.addLog(`${had - c.buildings.length} building(s) in ${c.name} were lost in the sack`, old, c.idx);
    if (this.rng() < this.razeChance(c)) {
      this.razeCity(c, pid);
      this.checkElimination(old);
      return;
    }
    // the conqueror decides: keep it, or put it to the torch
    if (this.players[pid].human) {
      c.razeDecision = this.turn;
    } else if (this.razeAdvice(c, pid).raze) {
      this.razeCity(c, pid, true);
      this.checkElimination(old);
      return;
    }
    this.bumpPeak(pid);
    this.emit('capture', { c, old, pid });
    if (c.razeDecision === this.turn) this.emit('razeChoice', { city: c, pid });
    this.checkElimination(old);
  }

  checkElimination(pid) {
    const pl = this.players[pid];
    if (!pl.alive) return;
    const hasCity = this.cities.some(c => c.owner === pid);
    // a rebellion that has not yet taken a city lives on while its insurgents do
    if (!hasCity && pl.rebel && this.units.some(u => u.owner === pid)) { this.checkConquest(); return; }
    if (!hasCity) {
      pl.alive = false;
      pl.fell = this.turn;
      this.units = this.units.filter(u => u.owner !== pid);
      this.rebuildUnitMap();
      for (const t of this.tiles) if (t.owner === pid) { t.owner = -1; }
      this.addLog(pl.rebel && !pl.heldCity ? `The ${pl.name} uprising is crushed.` : `${pl.name} has fallen.`, pid);
      this.emit('eliminated', pl);
      if (pl.human) this.offerRebellion(pl);
      this.checkConquest();
      if (this.winner) return;
      if (!this.players.some(p => p.alive && p.human) && this.players.some(p => p.human)) {
        // all humans dead: game over, highest-score AI wins
        this.declareWinner(this.ranking()[0].id, 'conquest');
      }
    }
  }

  // Optional comeback: a fallen human takes command of the strongest AI rebellion.
  offerRebellion(pl) {
    if (!['fall', 'human'].includes(this.settings.rebelControl)) return;
    const cand = this.contenders().filter(p => p.rebel && !p.human).sort((a, b) => this.power(b.id) - this.power(a.id))[0];
    if (!cand) return;
    cand.human = true;
    cand.adoptedBy = pl.name;
    this.addLog(`The leaders of the ${pl.name} flee to the ${cand.name} and take command.`, cand.id);
    this.emit('adopt', { from: pl.id, to: cand.id });
  }

  checkConquest() {
    const c = this.contenders();
    if (c.length === 1) this.declareWinner(c[0].id, 'conquest');
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
      if (this.hasWonder(d.owner, 'skycitadel')) b *= 1.25;
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
    this.addGrudge(d.owner, a.owner, dmg);
    const sieged = this.cityAt(targetIdx);
    if (sieged && sieged.owner === d.owner && this.rng() < 0.12) this.destroyBuilding(sieged, 'in the siege');
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
    if (this.players[u.owner].rebel && !this.cities.some(c => c.owner === u.owner)) this.checkElimination(u.owner);
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
      if (this.hasWonder(pid, 'eaglethrone')) r += 1;
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
    if (pl.gold < 0) { // the treasury cannot cover subsidies: the most expensive lapse first
      const subs = this.cities.filter(c => c.owner === pl.id && c.subsidy >= 2).sort((a, b) => b.subsidy - a.subsidy);
      for (const c of subs) { if (pl.gold >= 0) break; pl.gold += SUBSIDIES[c.subsidy].cost; c.subsidy = 1; this.addLog(`The treasury is empty: subsidies in ${c.name} lapse`, pl.id, c.idx); }
      pl.gold = Math.max(0, pl.gold);
    }
    // cities: integration
    for (const c of this.cities) {
      if (c.owner !== pl.id) continue;
      c.held++;
      const base = this.kinDist(pl.id, c.specialty);
      let need = c.buildings.includes('temple') ? INTEGRATION_TURNS / 2 : INTEGRATION_TURNS;
      if (this.hasWonder(pl.id, 'mirelabyrinth')) need = Math.max(2, Math.round(need / 3));
      if (base >= 2 && this.affinity(c) > 1 && c.held % need === 0) {
        c.adapt++;
        this.addLog(`${c.name} is integrating into ${pl.name} culture (${AFFINITY[this.affinity(c)].name})`, pl.id, c.idx);
      }
      if (c.culture != null && !this.related(c.culture, pl.culture) && c.held >= (c.buildings.includes('temple') ? 15 : 25)) {
        const was = this.cultures[c.culture]?.name;
        c.culture = pl.culture;
        this.addLog(`The people of ${c.name} now count themselves ${pl.name}${was ? ' rather than ' + was : ''}`, pl.id, c.idx);
      }
    }
    // unrest
    for (const c of this.cities.slice()) {
      if (c.owner !== pl.id) continue;
      const { net, underlying } = this.unrest(c);
      c.unrest = c.unrest || 0;
      if (net > 0) c.unrest += net;
      else c.unrest = Math.max(0, c.unrest - Math.max(1, -net));
      // trust in festivals returns when the city is content without one
      if (underlying <= 0) { c.calmStreak = (c.calmStreak || 0) + 1; if (c.calmStreak >= 6 && c.festivals) { c.festivals--; c.calmStreak = 0; } }
      else c.calmStreak = 0;
      if (net > 0 && c.unrest >= REVOLT_AT - 4 && c.unrest - net < REVOLT_AT - 4) this.addLog(`${c.name} is close to revolt!`, pl.id, c.idx);
      if (c.unrest >= REVOLT_AT && !c.capital) { this.revolt(c); continue; }
      if (c.unrest >= INSURRECTION_AT && this.rng() < 0.3) {
        const spot = this.freeNeighbor(c.idx, n => !this.isWater(n) && this.tiles[n].t !== 'mountain');
        if (spot !== null) {
          const rid = this.rebellionFor(c);
          const pu = this.spawnUnit(rid, this.turn > 35 ? 'swordsman' : 'warrior', spot);
          pu.mvLeft = 0;
          this.addLog(`Insurgents take up arms outside ${c.name}!`, pl.id, c.idx);
        }
      }
    }
    // a city-less uprising melts away once the unrest that fed it has died down
    if (pl.rebel && !this.cities.some(c => c.owner === pl.id)) {
      const fed = this.cities.some(c => c.rebellion === pl.id && c.owner !== pl.id && (c.unrest || 0) >= RIOT_AT);
      if (!fed && this.turn - (pl.born ?? 0) >= 3) {
        this.units = this.units.filter(u => u.owner !== pl.id);
        this.rebuildUnitMap();
        this.checkElimination(pl.id);
        return;
      }
    }
    this.maybeDiverge(pl);
    // occupying units ravage the improvements under them
    for (const u of this.units.slice()) if (u.owner === pl.id) this.pillage(u);
    // units: heal + reset
    for (const u of this.units) {
      if (u.owner !== pl.id) continue;
      if (!u.acted && u.hp < this.maxHp(u)) {
        let h = 2;
        const tl = this.tiles[u.idx];
        if (tl.owner === pl.id) h = 4;
        const c = this.cityAt(u.idx);
        if (c && c.owner === pl.id) { h = 5; if (c.specialty === 'marsh') h += 2; }
        if (this.hasWonder(pl.id, 'worldtree')) h += 3;
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
      this.recordHistory();
      for (const p of this.players) if (p.alive) this.bumpPeak(p.id);
      this.turn++;
      this.updateCoalition();
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
    for (const c of this.cities) if (c.owner === pid) s += 20 + c.level * 15 + c.buildings.length * 10 + (c.wonders?.length || 0) * 60;
    s += this.players[pid].techs.length * 12;
    s += this.players[pid].explored.reduce((a, b) => a + b, 0) / 10 | 0;
    s += this.players[pid].kills * 3;
    return Math.round(s);
  }
  ranking() {
    return this.players.filter(p => !p.rebel || p.heldCity).map(p => ({ id: p.id, score: p.alive ? this.score(p.id) : -1 })).sort((a, b) => b.score - a.score);
  }

  // ------------------------------------------------------------ save/load
  serialize() {
    return JSON.stringify({
      v: 1, W: this.W, H: this.H, seed: this.seed, settings: this.settings, tiles: this.tiles,
      elev: this.elev, turn: this.turn, current: this.current, nextId: this.nextId,
      cities: this.cities, units: this.units, log: this.log, winner: this.winner, coalition: this.coalition, history: this.history, cultures: this.cultures,
      players: this.players.map(p => ({ ...p, _vis: undefined })), rng: this.rng.state(),
      cityNamePool: this.cityNamePool,
    });
  }
  static deserialize(str) {
    const o = JSON.parse(str);
    const g = new Game();
    Object.assign(g, o);
    g.rng = makeRng(1); g.rng.setState(o.rng);
    if (g.coalition == null) g.coalition = -1;
    g.history = g.history || [];
    for (const p of g.players) if (!p.color2) [p.color, p.color2] = pickColors(g.players.filter(q => q.color2 && q.alive));
    if (!g.cultures) { // older saves: one people per tribe, ids shared with tribes
      g.cultures = g.players.map(p => ({ id: p.id, base: p.name, root: '', parent: null, influence: null, core: p.id, home: p.home, name: p.name, color: p.color, color2: p.color2, born: p.founded ?? 1 }));
      for (const p of g.players) p.culture = p.id;
    }
    for (const c of g.cities) { if (c.taxRelief) { c.subsidy = 1; delete c.taxRelief; } if (c.culture == null) c.culture = c.owner; if (c.everBuilt == null) c.everBuilt = !!(c.buildings.length || c.wonders?.length); }
    for (const p of g.players) { if (p.founded == null) p.founded = p.born ?? 1; if (p.peak == null) p.peak = g.cities.filter(c => c.owner === p.id).length; }
    for (const p of g.players) {
      if (p.rebel && !p.home) { // older saves: a single homeless Rebels faction
        const c = g.cities.find(c => c.owner === p.id);
        p.home = c ? c.specialty : 'plains';
        p.heldCity = !!c;
      }
      if (!p.human && (!p.temper || p.temper.caution == null)) {
        const old = p.temper;
        p.temper = rollTemper(g.rng, old && TEMPERAMENTS[old.key] ? old.key : undefined);
        if (old) { p.temper.grudges = old.grudges || {}; }
      }
    }
    delete g.rebelId;
    g.rebuildUnitMap();
    for (const p of g.players) g.updateVision(p.id);
    return g;
  }
}
