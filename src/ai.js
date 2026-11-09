// Computer opponents. Greedy heuristics, fast enough for 8 tribes on huge maps.
import { UNITS, TECHS, IMPROVEMENTS, BUILDINGS, WONDERS, KIN_DIST, TERRAIN, SPECIALTY, impYield, INPUT_GOODS, RECIPES, GROUPS } from './data.js';
import { REVOLT_AT } from './game.js';
import { SUBSIDIES } from './data.js';

const HOME_TECH_BIAS = {
  plains: { agriculture: 4, husbandry: 2, riding: 3 },
  hilltop: { mining: 4, masonry: 3, archery: 1 },
  coastal: { fishing: 4, sailing: 4, navigation: 2 },
  riverside: { agriculture: 4, irrigation: 2, trade: 3, bronze: 2 },
  forest: { forestry: 4, archery: 3, roads: 2 },
  desert: { husbandry: 3, riding: 4, irrigation: 3 },
  steppe: { husbandry: 4, riding: 4, chivalry: 2 },
  marsh: { drainage: 3, agriculture: 2, fishing: 2 },
  mountain: { mining: 4, climbing: 4, masonry: 3 },
};

function profile(g, pid) {
  const pl = g.players[pid];
  if (!pl.ai) {
    const r = g.rng;
    pl.ai = { aggression: 0.35 + r() * 0.55, expansion: 0.6 + r() * 0.6 };
  }
  return pl.ai;
}

// Dijkstra distance field to target for a unit's movement rules (ignores units).
export function field(g, target, u, cache) {
  const key = target + ':' + u.type + ':' + u.owner;
  if (cache.has(key)) return cache.get(key);
  const N = g.W * g.H;
  const dist = new Float32Array(N).fill(Infinity);
  dist[target] = 0;
  const heap = [[0, target]];
  const push = (d, i) => {
    heap.push([d, i]); let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) {
      heap[0] = last; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d0, cur] = pop();
    if (d0 > dist[cur]) continue;
    for (const n of g.neighbors(cur)) {
      let c = g.moveCost(u, n, cur); // cost to step n -> cur
      if (c === Infinity) continue;
      if (c >= 99) c = 3;
      const nd = d0 + Math.max(0.5, c);
      if (nd < dist[n]) { dist[n] = nd; push(nd, n); }
    }
  }
  cache.set(key, dist);
  return dist;
}

function enemiesNear(g, pid, i, rad) {
  let n = 0;
  for (const u of g.units) if (u.owner !== pid && g.atWar(pid, u.owner) && g.dist(u.idx, i) <= rad && UNITS[u.type].atk > 0) n++;
  return n;
}

function unitValue(type) { const U = UNITS[type]; return U.cost; }

export function runAI(g, pid) {
  if (g.winner) return;
  const pl = g.players[pid];
  const prof = profile(g, pid);
  const cache = new Map();
  g.rebuildUnitMap();
  diplomacyAct(g, pid);

  const myCities = () => g.cities.filter(c => c.owner === pid);
  const military = () => g.units.filter(u => u.owner === pid && u.type !== 'settler');

  // ---------------- units
  const units = g.units.filter(u => u.owner === pid);
  // settlers last so military clears paths
  units.sort((a, b) => (a.type === 'settler') - (b.type === 'settler'));
  for (const u of units) {
    if (!g.units.includes(u)) continue;
    if (u.type === 'settler') settlerAct(g, u, cache);
    else militaryAct(g, u, cache, prof);
    if (g.winner) return;
  }

  // ---------------- spending
  spend(g, pid, prof);
}

// ---------------- diplomacy
// War thresholds by temperament: the hostility at which a tribe at peace reaches for the sword.
const WAR_AT = { opportunist: 1.9, vengeful: 2.0, balancer: 2.2, steadfast: 2.4, appeaser: 2.7 };

function diplomacyAct(g, pid) {
  const pl = g.players[pid];
  const T = pl.temper;
  if (!T || !g.cities.some(c => c.owner === pid)) return;
  pl.lastOffer = pl.lastOffer || {};
  const myP = g.power(pid);
  const others = g.contenders().filter(p => p.id !== pid && g.hasMet(pid, p.id));
  const offerOk = (o, type) => (g.turn - (pl.lastOffer[o + type] ?? -99)) >= 5;
  const offer = (o, type) => { pl.lastOffer[o + type] = g.turn; return g.offer(pid, o, type); };
  // vassals: bide their time, break free when liberty peaks and they can stand alone
  const lord = g.overlordOf(pid);
  if (lord != null) {
    const r = g.vassalRel(pid);
    if (r.liberty >= 100 && myP >= g.power(lord) * 0.5) g.declareIndependence(pid);
    return;
  }
  // overlords absorb vassals when they can
  for (const v of g.vassalsOf(pid)) if (g.canAnnex(pid, v).ok) g.annexVassal(pid, v);
  // under attack and outmatched: seek a protector
  const threats = g.warsOf(pid).filter(e => g.power(e) > myP * 2);
  if (threats.length && !g.vassalsOf(pid).length && offerOk(-1, 'protect')) {
    const protector = others.filter(o => !g.atWar(pid, o.id) && !g.isVassal(o.id) && g.power(o.id) > Math.max(...threats.map(e => g.power(e))) * 0.9)
      .sort((a, b) => g.hostility(pid, a.id) - g.hostility(pid, b.id))[0];
    if (protector) { pl.lastOffer['-1protect'] = g.turn; g.offer(pid, protector.id, 'protect'); }
  }
  const dom = g.dominance();
  if (T.key === 'appeaser' && dom.leader >= 0 && dom.leader !== pid && dom.d > 0.3 && pl.gold > 120 && !g.atWar(pid, dom.leader) && offerOk(dom.leader, 'gift')) {
    pl.lastOffer[dom.leader + 'gift'] = g.turn;
    g.giveGold(pid, dom.leader, Math.floor(pl.gold * 0.15));
  }
  for (const o of others) {
    const r = g.relation(pid, o.id);
    const h = g.hostility(pid, o.id);
    const theirP = g.power(o.id);
    const wars = g.warsOf(pid).length;
    if (r.state === 'vassal') continue;
    if (r.state === 'war') {
      const age = g.turn - (r.since || 0);
      // a crushing advantage: demand submission rather than grind out a conquest
      if (age >= 5 && myP >= theirP * 2 && !g.isVassal(o.id) && offerOk(o.id, 'vassal')) {
        const res = offer(o.id, 'vassal');
        if (res.accepted) continue;
      }
      const losing = myP < theirP * 0.6;
      const containing = T.joined === o.id;
      const weary = age >= 25;
      if (offerOk(o.id, 'peace') && ((age >= 8 && h < 1.5 && !containing) || (losing && age >= 5) || (wars >= 3 && h < 2) || (weary && h < 2.2))) {
        const res = offer(o.id, 'peace');
        // refused? sweeten it: buy peace with a gift and ask again
        if (res.ok && res.accepted === false && pl.gold > 60) {
          g.giveGold(pid, o.id, Math.min(150, Math.floor(pl.gold * 0.25)));
          g.offer(pid, o.id, 'peace');
        }
      }
      continue;
    }
    if (r.state === 'truce') continue;
    // peace or alliance
    if (r.state === 'alliance') {
      if (h > 2.1) g.breakAlliance(pid, o.id);
      continue;
    }
    const thr = (WAR_AT[T.key] ?? 2.2) - (T.joined === o.id ? 0.6 : 0);
    // 1. hostile and able
    if (h > thr && myP >= theirP * 0.8 && wars < 2) { g.declareWar(pid, o.id); continue; }
    // 2. tempting prey: a much weaker neighbour on our border, weighed by appetite
    const x = g.threats(pid).by[o.id];
    const near = x && x.dmin <= 8;
    const appetite = (T.opportunism ?? 0.8) * 0.5 + (T.bully ?? 0) + ((T.grudges[o.id] || 0) > 20 ? 0.4 : 0);
    if (near && wars === 0 && myP >= theirP * 1.5 && g.rng() < 0.05 * appetite) { g.declareWar(pid, o.id); continue; }
    // 3. idle riches: a large treasury and a standing army look for a use
    if (near && wars === 0 && pl.gold > 250 && myP >= theirP * 1.1 && g.rng() < 0.03 * (0.5 + appetite)) { g.declareWar(pid, o.id); continue; }
    if (offerOk(o.id, 'alliance') && g.aiAccepts(pid, o.id, 'alliance')) offer(o.id, 'alliance');
    // close routes that have carried nothing for a while: they cost upkeep and a route slot
    const rt = g.routeBetween(pid, o.id);
    if (rt && (rt.idle || 0) >= 8) g.closeRoute(pid, o.id);
    // trade routes where they pay; close our land to the trade of tribes we loathe
    if (offerOk(o.id, 'route') && h < 1.8) {
      const gain = g.routeGain(pid, o.id);
      if ((gain.buy > 0 || gain.sell > 1) && g.canOpenRoute(pid, o.id).ok) offer(o.id, 'route');
    }
    g.setTransit(pid, o.id, h > 2.3);
  }
}

function opportunism(g, pid) { return g.players[pid].temper?.opportunism ?? 0.8; }

// Is enemy unit e threatening one of pid's cities? Self-defence ignores diplomacy.
function threatensUs(g, pid, e) {
  if (!g.atWar(pid, e.owner)) return false;
  for (const c of g.cities) if (c.owner === pid && g.dist(c.idx, e.idx) <= 1) return true;
  return false;
}

// Targeting gradient: hostility (from game.hostility) scales the *gain* of an attack,
// so AIs still take easy kills on anyone but grind sieges mostly against the leader.
function targetWeight(g, pid, e, kill) {
  let w = g.hostility(pid, e.owner);
  if (threatensUs(g, pid, e)) w = Math.max(w, 1);
  if (kill) w = Math.max(w, opportunism(g, pid) * 0.85);
  return w;
}

function tryAttack(g, u) {
  const targets = g.attackTargets(u);
  let best = null, bestV = 0;
  for (const t of targets) {
    const d = g.unitAt(t);
    const { dmg, ret } = g.combatPreview(u, d);
    const kill = dmg >= d.hp;
    const die = !kill && ret >= u.hp;
    let gain = dmg + (kill ? 8 + unitValue(d.type) : 0);
    const loss = ret * 1.1 + (die ? 15 + unitValue(u.type) : 0);
    const ec = g.cityAt(t);
    if (ec && ec.owner === d.owner) {
      // siege: wearing down garrisons is worth it if we have friends nearby
      const friends = g.units.filter(x => x.owner === u.owner && x !== u && g.dist(x.idx, t) <= 2).length;
      gain += 3 + dmg * 0.4 + friends * 1.5;
    }
    if (g.stats(u).rng > 1 && ret === 0) gain += 2;
    const v = gain * targetWeight(g, u.owner, d, kill) - loss;
    if (v > bestV) { bestV = v; best = t; }
  }
  if (best !== null) { g.attack(u, best); return true; }
  return false;
}

export function bestStep(g, u, dist, avoidDanger) {
  const reach = g.reachable(u);
  let best = null, bestS = dist[u.idx] === Infinity ? Infinity : dist[u.idx] - 0.01;
  for (const [i] of reach) {
    let s = dist[i];
    if (s === Infinity) continue;
    if (avoidDanger) s += enemiesNear(g, u.owner, i, 1) * 2;
    s -= (TERRAIN[g.tiles[i].t].def - 1) * 0.5;
    if (s < bestS) { bestS = s; best = i; }
  }
  return best;
}

function militaryAct(g, u, cache, prof) {
  const pid = u.owner;
  // 1. attack opportunities from where we stand
  if (tryAttack(g, u)) {
    if (!g.units.includes(u) || u.mvLeft <= 0) return;
  }
  if (u.mvLeft <= 0) return;

  // 2. capture empty adjacent/reachable enemy cities
  const reach = g.reachable(u);
  for (const [i] of reach) {
    const c = g.cityAt(i);
    if (c && c.owner !== pid && !g.has_(u, 'naval')) { g.moveUnit(u, i); tryAttack(g, u); return; }
  }

  // 3. garrison duty
  const here = g.cityAt(u.idx);
  if (here && here.owner === pid) {
    const others = g.units.filter(x => x !== u && x.owner === pid && g.dist(x.idx, here.idx) <= 1).length;
    if (enemiesNear(g, pid, here.idx, 3) > 0 && others < 1) { return; }
    // keeping order: stay if leaving would make the city restless
    const un = g.unrest(here);
    if (un.total > 0 && un.net + 1 > 0) return;
  }
  // threatened own city without defender -> go there
  let target = null;
  for (const c of g.cities) {
    if (c.owner !== pid) continue;
    if (g.dist(c.idx, u.idx) > 5) continue;
    if (enemiesNear(g, pid, c.idx, 3) > 0 && !g.unitAt(c.idx)) { target = c.idx; break; }
  }
  // offensive: nearest known enemy city / unit
  const mil = g.units.filter(x => x.owner === pid && x.type !== 'settler').length;
  const nCities = g.cities.filter(c => c.owner === pid).length;
  const inCoalition = (g.players[pid].temper?.joined ?? -1) >= 0;
  const aggressive = mil >= nCities * (inCoalition ? 1 : 2.2 - prof.aggression * 1.4) || g.turn > 25;
  if (target === null && aggressive) {
    // pick the objective with the best (hostility x ease) / distance
    let bs = 0;
    const pl = g.players[pid];
    for (const c of g.cities) {
      if (c.owner === pid || !pl.explored[c.idx] || !g.atWar(pid, c.owner)) continue;
      const d = g.dist(c.idx, u.idx);
      const gar = g.unitAt(c.idx);
      const ease = !gar ? 2.5 * opportunism(g, pid) : 1.6 / (1 + g.stats(gar).def * gar.hp / g.maxHp(gar) * g.defenseBonus(gar) * 0.4);
      let sc = (gar ? g.hostility(pid, c.owner) : Math.max(g.hostility(pid, c.owner), opportunism(g, pid))) * ease / (d + 4);
      // war aims: cities sitting on goods we lack are worth more
      const yields = g.cityProduction(c);
      let hunger = 0;
      for (const k in yields) hunger += goodHunger(g, pid, k) > 1 ? 1 : 0;
      sc *= 1 + 0.4 * hunger;
      if (sc > bs) { bs = sc; target = c.idx; }
    }
    for (const e of g.units) {
      if (e.owner === pid || g.isHiddenFrom(e, pid) || !g.atWar(pid, e.owner)) continue;
      const d = g.dist(e.idx, u.idx);
      if (d > 4) continue;
      const sc = targetWeight(g, pid, e, e.hp <= 4) * 1.3 / (d + 4);
      if (sc > bs) { bs = sc; target = e.idx; }
    }
  }
  if (target === null) {
    // nearby enemy units within 3 - engage
    for (const e of g.units) {
      if (e.owner !== pid && g.atWar(pid, e.owner) && g.dist(e.idx, u.idx) <= 3 && !g.isHiddenFrom(e, pid) && targetWeight(g, pid, e, false) >= 0.8) { target = e.idx; break; }
    }
  }
  // raiding: stand on an enemy's trade route to seize its shipments
  if (target === null && !g.has_(u, 'naval')) target = raidTarget(g, u);
  if (target === null) target = exploreTarget(g, u);
  if (target === null) return;
  const dist = field(g, target, u, cache);
  const step = bestStep(g, u, dist, false);
  if (step !== null) g.moveUnit(u, step);
  if (g.units.includes(u)) tryAttack(g, u);
}

function raidTarget(g, u) {
  const pid = u.owner;
  let best = null, bd = 7;
  for (const r of g.routes || []) {
    if (!g.atWar(pid, r.a) && !g.atWar(pid, r.b)) continue;
    if (r.a === pid || r.b === pid) continue;
    for (const t of r.path || []) {
      const d = g.dist(t, u.idx);
      if (d >= bd || g.unitAt(t) || g.isWater(t)) continue;
      if (enemiesNear(g, pid, t, 1) > 1) continue;
      bd = d; best = t;
    }
  }
  return best;
}

function exploreTarget(g, u) {
  const pl = g.players[u.owner];
  const seen = new Set([u.idx]);
  const q = [u.idx];
  let n = 0;
  while (q.length && n < 900) {
    const cur = q.shift(); n++;
    if (!pl.explored[cur]) return cur;
    for (const nb of g.neighbors(cur)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (g.moveCost(u, cur, nb) === Infinity && pl.explored[nb]) continue;
      q.push(nb);
    }
  }
  return null;
}

function siteScore(g, pid, i) {
  const chk = g.canFoundAt(pid, i);
  if (!chk.ok) return -Infinity;
  const pl = g.players[pid];
  let s = 0;
  for (const t of g.within(i, 1)) {
    const tl = g.tiles[t];
    if (tl.owner >= 0 && tl.owner !== pid) s -= 1;
    if (TERRAIN[tl.t].water) s += 0.4;
    else if (tl.t !== 'mountain') s += 1;
    if (tl.res) s += 1.3;
    if (tl.res === 'copper' || tl.res === 'tin' || tl.res === 'horses') s += 1.2; // strategic deposits draw settlers
    if (tl.res === 'iron') s += g.has(pid, 'ironworking') ? 1 : 0.4;
    if (tl.res === 'spices' || tl.res === 'sheep') s += 0.8;
    if (tl.river) s += 0.4;
  }
  const spec = g.specialtyAt(i);
  const kd = g.kinDist(pid, spec);
  s += [4, 2.5, 0.5, -1.5][Math.min(3, kd)];
  for (const c of g.cities) if (c.owner !== pid && g.dist(c.idx, i) <= 4) s -= 4;
  return s;
}

function settlerAct(g, u, cache) {
  const pid = u.owner;
  const pl = g.players[pid];
  if (u.goal != null && g.canFoundAt(pid, u.goal).ok !== true) u.goal = null;
  if (u.goal === u.idx) { g.settle(u); return; }
  if (u.goal == null) {
    let best = null, bestS = -Infinity;
    for (const i of g.within(u.idx, 9)) {
      if (!pl.explored[i]) continue;
      const s = siteScore(g, pid, i) - g.dist(i, u.idx) * 0.55;
      if (s > bestS) { bestS = s; best = i; }
    }
    u.goal = best;
    u.age = 0;
  }
  u.age = (u.age || 0) + 1;
  if (u.goal == null || u.age > 12) {
    if (g.canSettle(u).ok) { g.settle(u); return; }
    const t = exploreTarget(g, u);
    if (t !== null) {
      const step = bestStep(g, u, field(g, t, u, cache), true);
      if (step !== null) g.moveUnit(u, step);
    }
    return;
  }
  const dist = field(g, u.goal, u, cache);
  if (dist[u.idx] === Infinity) { u.goal = null; return; }
  const step = bestStep(g, u, dist, true);
  if (step !== null) g.moveUnit(u, step);
  if (g.units.includes(u) && u.idx === u.goal) g.settle(u);
}

// ---------------- economy
function techValue(g, pid, t) {
  const pl = g.players[pid];
  let v = (HOME_TECH_BIAS[pl.home]?.[t] || 0) + 1;
  // improvements this tech unlocks in our territory
  for (const [k, I] of Object.entries(IMPROVEMENTS)) {
    if (I.tech !== t) continue;
    for (let i = 0; i < g.tiles.length; i++) {
      const tl = g.tiles[i];
      if (tl.owner !== pid || tl.city >= 0 || tl.imp) continue;
      if (I.terrain.includes(tl.t) && (!I.consume || tl.res === I.resource)) v += 0.8;
    }
  }
  // unique units unlocked for our cities
  for (const c of g.cities) {
    if (c.owner !== pid) continue;
    const un = SPECIALTY[c.specialty].unit;
    if (UNITS[un].tech === t) v += 1.5;
  }
  if (t === 'ironworking') {
    const ironTiles = g.tiles.filter(tl => tl.owner === pid && tl.res === 'iron').length;
    v += 1 + 0.4 * ironTiles + (g.avail(pid, 'metal') < 3 ? 1.5 : 0); // the way out of a tin shortage
  }
  if (t === 'climbing') v += g.tiles.some((tl, i) => tl.owner === pid && tl.t === 'mountain') ? 1 : -1;
  if (t === 'sailing' || t === 'navigation') v += g.cities.some(c => c.owner === pid && c.specialty === 'coastal') ? 1.5 : -0.5;
  if (['masonry', 'bronze', 'engineering', 'chivalry'].includes(t)) v += 1 + g.turn / 25;
  if (['philosophy', 'assimilation', 'trade'].includes(t)) v += g.turn / 20;
  return v / TECHS[t].tier;
}

// How badly a tribe wants more of a good: high when its stockpile is low and it isn't producing any.
function goodHunger(g, pid, good) {
  if (INPUT_GOODS.has(good)) return g.inputDemand(pid, good) && g.stock(pid)[good] < g.inputDemand(pid, good) ? 1.2 : 0.1;
  const st = g.stock(pid)[good], prod = (g.players[pid].lastProd?.[good] || 0) + (g.players[pid].lastMade?.[good] || 0);
  const demand = g.goodDemand(pid, good);
  if (demand > 0 && prod < demand && st < demand * 3) return 1.2; // consuming faster than we make it
  if (prod === 0 && st < 4) return 1.2;
  if (st < 6) return 0.6;
  return 0.15;
}

// per-turn inflow of a good (or group): production + workshop output
function supplyRate(g, pid, k) {
  const pl = g.players[pid];
  const one = (m) => (pl.lastProd?.[m] || 0) + (pl.lastMade?.[m] || 0);
  return GROUPS[k] ? GROUPS[k].reduce((a, m) => a + one(m), 0) : one(k);
}

function bestMilitary(g, city, gold) {
  let best = null, bestS = -Infinity;
  for (const k of g.trainable(city)) {
    if (k === 'settler') continue;
    const U = UNITS[k];
    const cost = g.unitCost(city, k);
    if (!g.workCheck(city, cost).ok) continue;
    if (!g.canPay(city.owner, U.needs, city).ok) continue;
    // don't field more of an army than our supply can feed
    if (U.needs && Object.keys(U.needs).some(k => supplyRate(g, city.owner, k) < (g.supplyNeed(city.owner)[k] || 0) + 0.5 && g.avail(city.owner, k) < 6)) continue;
    if (U.traits?.includes('naval') && g.rng() < 0.6) continue;
    const s = (U.atk * 1.1 + U.def) * U.hp / 10 + (U.mv - 1) * 0.8 + (U.rng - 1) * 0.6 + (U.unique ? 1 : 0) + g.rng() * 1.5 - cost * (gold > 30 ? 0.02 : 0.15);
    if (s > bestS) { bestS = s; best = k; }
  }
  return best;
}

// Research no longer competes with gold: learn the best affordable tech whenever knowledge allows.
function researchAct(g, pid) {
  for (let n = 0; n < 3; n++) {
    let bestT = null, bestTV = -Infinity;
    for (const t of Object.keys(TECHS)) {
      if (!g.canResearch(pid, t).ok) continue;
      const v = techValue(g, pid, t);
      if (v > bestTV) { bestTV = v; bestT = t; }
    }
    if (!bestT) return;
    g.research(pid, bestT);
  }
}

function spend(g, pid, prof) {
  const pl = g.players[pid];
  researchAct(g, pid);
  // hurry policy: spend gold on labor only above a reserve (upkeep, subsidies, emergencies),
  // or when a city is threatened
  const nC = g.cities.filter(c => c.owner === pid).length;
  const reserve = 25 + 6 * nC + 5 * g.subsidyCost(pid);
  const threatened = g.cities.some(c => c.owner === pid && enemiesNear(g, pid, c.idx, 3) > 0);
  pl.allowHurry = pl.gold > reserve || (threatened && pl.gold > 15);
  // a fuller treasury accepts the steeper prices of hurrying several projects in one city
  pl.hurryMaxMult = threatened ? 2 : pl.gold > reserve * 4 ? 3 : pl.gold > reserve * 2 ? 2 : 1;
  for (let iter = 0; iter < 30; iter++) {
    const cities = g.cities.filter(c => c.owner === pid);
    if (!cities.length) return;
    const units = g.units.filter(u => u.owner === pid);
    const mil = units.filter(u => u.type !== 'settler').length;
    const settlers = units.filter(u => u.type === 'settler').length;
    const net = g.grossIncome(pid) - g.upkeep(pid);
    const capLeft = Math.min(g.unitCap(pid) - units.length, net >= 3 || pl.gold > 40 ? 99 : 0);
    let acted = false;
    let saving = null; // a city putting its labor aside for a settler

    // 0) keep the peace: compliance buildings first, festivals when revolt is near,
    //    tax relief as the reliable fallback; lift relief once the city would be fine without it
    for (const c of cities) {
      const un = g.unrest(c);
      // step subsidies down once the city would stay calm without the current tier
      const t = c.subsidy || 0;
      if (t && (c.unrest || 0) === 0 && un.net + SUBSIDIES[t].calm - SUBSIDIES[t - 1].calm <= -1) c.subsidy = t - 1;
    }
    for (const c of cities) {
      const un = g.unrest(c);
      const cur = c.unrest || 0;
      if (un.net <= 0 && cur < 6) continue;
      const calmB = g.buildable(c).filter(b => BUILDINGS[b].calm && g.canBuild(c, b).ok).sort((a, b) => BUILDINGS[a].cost - BUILDINGS[b].cost)[0];
      if (calmB) { g.build(c, calmB); acted = true; break; }
      // festivals are a gamble: only take long odds when revolt is imminent
      const pc = g.canPlacate(c);
      const urgent = cur + Math.max(0, un.net) >= REVOLT_AT - 1;
      if (pc.ok && cur + Math.max(0, un.net) >= REVOLT_AT - 3 && (pc.risk < 0.35 || urgent && pc.risk < 0.5)) { g.placate(c); acted = true; break; }
      const t = c.subsidy || 0;
      if (t < SUBSIDIES.length - 1 && un.net > 0 && (cur >= 4 || urgent)) {
        const extra = SUBSIDIES[t + 1].cost - SUBSIDIES[t].cost;
        if (g.income(pid) - extra >= 0 || pl.gold > extra * 12) { g.setSubsidy(c, t + 1); acted = true; break; }
      }
    }
    if (acted) continue;

    // a) defend threatened cities
    for (const c of cities) {
      if (enemiesNear(g, pid, c.idx, 3) > 0 && !g.unitAt(c.idx) && capLeft > 0) {
        const k = bestMilitary(g, c, pl.gold);
        if (k && g.train(c, k).ok) { acted = true; break; }
      }
    }
    if (acted) continue;

    // b) expansion
    const restless = cities.filter(c => g.unrest(c).net > 0).length;
    const wantCities = Math.min(14, Math.round((3 + g.turn / 5) * prof.expansion)) - restless * 2;
    if (settlers < 2 && cities.length + settlers < wantCities && capLeft > 0 && mil >= Math.min(2, cities.length)) {
      const c = cities.filter(c => !g.unitAt(c.idx)).sort((a, b) => b.level - a.level)[0];
      if (c) {
        if (g.train(c, 'settler').ok) continue;
        // not enough labor yet: this city saves for the settler instead of spending on other things
        if (g.workCheck(c, g.unitCost(c, 'settler')).short <= g.laborRate(c) * 3) saving = c;
      }
    }

    // c0) repair war damage
    let repaired = false;
    for (const c of cities) {
      for (const t of g.cityTiles(c)) if (g.tiles[t].damaged && g.canRepair(pid, t).ok) { g.repair(pid, t); repaired = true; break; }
      if (repaired) break;
    }
    if (repaired) continue;

    // c) improvements (cheap growth)
    let bestImp = null, bestV = 0;
    for (const c of cities) {
      for (const t of g.cityTiles(c)) {
        if (c === saving) continue;
        for (const k of g.improvementsFor(pid, t)) {
          const chk = g.canImprove(pid, t, k);
          if (!chk.ok) continue;
          let v = g.improvePop(t, k) / IMPROVEMENTS[k].cost;
          const yg = impYield(k, g.tiles[t].res);
          if (yg) v += Math.max(goodHunger(g, pid, yg), INPUT_GOODS.has(yg) ? 0.5 : 0) / IMPROVEMENTS[k].cost; // raw metal sells even unused
          if (v > bestV) { bestV = v; bestImp = [t, k]; }
        }
      }
    }
    if (bestImp && (bestV >= 0.3 || pl.gold > 15)) { g.improve(pid, bestImp[0], bestImp[1]); continue; }

    const wantMil = Math.ceil(cities.length * (1 + prof.aggression)) + 1;

    // e) military
    // build armies when below target, or when a city's labor would otherwise overflow
    const fullCity = cities.some(c => c !== saving && (c.labor || 0) >= g.laborCap(c) * 0.75 && !g.unitAt(c.idx));
    if ((mil < wantMil + (g.turn > 30 ? cities.length : 0) || fullCity) && capLeft > 0) {
      const c = cities.filter(c => c !== saving && !g.unitAt(c.idx)).sort((a, b) => enemiesNear(g, pid, b.idx, 8) - enemiesNear(g, pid, a.idx, 8))[0];
      if (c) { const k = bestMilitary(g, c, pl.gold); if (k && g.train(c, k).ok) continue; }
    }

    // f0) processing: one workshop per recipe once we can feed it (own metal or a trade partner's)
    let built = false;
    for (const [prod, R] of Object.entries(RECIPES)) {
      const have = cities.filter(c => c.buildings.includes(R.building)).length;
      const st = g.stock(pid);
      const canFeed = Object.keys(R.inputs).some(k => st[k] > 0 || (pl.lastProd?.[k] || 0) > 0) || g.routesOf(pid).length > 0;
      if (have >= Math.max(1, Math.ceil(cities.length / 6)) || !canFeed) continue;
      const c = cities.filter(c => g.isConnected(c) && g.canBuild(c, R.building).ok).sort((a, b) => b.level - a.level)[0];
      if (c) { g.build(c, R.building); built = true; break; }
    }
    if (built) continue;
    // f) wonders, then buildings
    for (const c of cities) {
      for (const w of Object.keys(WONDERS)) if (g.canBuildWonder(c, w).ok) { g.buildWonder(c, w); built = true; break; }
      if (built) break;
    }
    if (built) continue;
    for (const c of cities) {
      for (const b of g.buildable(c)) {
        if (Object.values(RECIPES).some(R => R.building === b)) continue; // workshops are placed deliberately above
        if (g.canBuild(c, b).ok) { g.build(c, b); built = true; break; }
      }
      if (built) break;
    }
    if (built) continue;
    break;
  }
}
