// Computer opponents. Greedy heuristics, fast enough for 8 tribes on huge maps.
import { UNITS, TECHS, IMPROVEMENTS, BUILDINGS, WONDERS, KIN_DIST, TERRAIN, SPECIALTY } from './data.js';
import { REVOLT_AT } from './game.js';

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
  for (const u of g.units) if (u.owner !== pid && g.dist(u.idx, i) <= rad && UNITS[u.type].atk > 0) n++;
  return n;
}

function unitValue(type) { const U = UNITS[type]; return U.cost; }

export function runAI(g, pid) {
  if (g.winner) return;
  const pl = g.players[pid];
  const prof = profile(g, pid);
  const cache = new Map();
  g.rebuildUnitMap();

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

function opportunism(g, pid) { return g.players[pid].temper?.opportunism ?? 0.8; }

// Is enemy unit e threatening one of pid's cities? Self-defence ignores diplomacy.
function threatensUs(g, pid, e) {
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
      if (c.owner === pid || !pl.explored[c.idx]) continue;
      const d = g.dist(c.idx, u.idx);
      const gar = g.unitAt(c.idx);
      const ease = !gar ? 2.5 * opportunism(g, pid) : 1.6 / (1 + g.stats(gar).def * gar.hp / g.maxHp(gar) * g.defenseBonus(gar) * 0.4);
      const sc = (gar ? g.hostility(pid, c.owner) : Math.max(g.hostility(pid, c.owner), opportunism(g, pid))) * ease / (d + 4);
      if (sc > bs) { bs = sc; target = c.idx; }
    }
    for (const e of g.units) {
      if (e.owner === pid || g.isHiddenFrom(e, pid)) continue;
      const d = g.dist(e.idx, u.idx);
      if (d > 4) continue;
      const sc = targetWeight(g, pid, e, e.hp <= 4) * 1.3 / (d + 4);
      if (sc > bs) { bs = sc; target = e.idx; }
    }
  }
  if (target === null) {
    // nearby enemy units within 3 - engage
    for (const e of g.units) {
      if (e.owner !== pid && g.dist(e.idx, u.idx) <= 3 && !g.isHiddenFrom(e, pid) && targetWeight(g, pid, e, false) >= 0.8) { target = e.idx; break; }
    }
  }
  if (target === null) target = exploreTarget(g, u);
  if (target === null) return;
  const dist = field(g, target, u, cache);
  const step = bestStep(g, u, dist, false);
  if (step !== null) g.moveUnit(u, step);
  if (g.units.includes(u)) tryAttack(g, u);
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
  if (t === 'climbing') v += g.tiles.some((tl, i) => tl.owner === pid && tl.t === 'mountain') ? 1 : -1;
  if (t === 'sailing' || t === 'navigation') v += g.cities.some(c => c.owner === pid && c.specialty === 'coastal') ? 1.5 : -0.5;
  if (['masonry', 'bronze', 'engineering', 'chivalry'].includes(t)) v += 1 + g.turn / 25;
  if (['philosophy', 'assimilation', 'trade'].includes(t)) v += g.turn / 20;
  return v / TECHS[t].tier;
}

function bestMilitary(g, city, gold) {
  let best = null, bestS = -Infinity;
  for (const k of g.trainable(city)) {
    if (k === 'settler') continue;
    const U = UNITS[k];
    const cost = g.unitCost(city, k);
    if (cost > gold) continue;
    if (U.traits?.includes('naval') && g.rng() < 0.6) continue;
    const s = (U.atk * 1.1 + U.def) * U.hp / 10 + (U.mv - 1) * 0.8 + (U.rng - 1) * 0.6 + (U.unique ? 1 : 0) + g.rng() * 1.5 - cost * (gold > 30 ? 0.02 : 0.15);
    if (s > bestS) { bestS = s; best = k; }
  }
  return best;
}

function spend(g, pid, prof) {
  const pl = g.players[pid];
  for (let iter = 0; iter < 30; iter++) {
    const cities = g.cities.filter(c => c.owner === pid);
    if (!cities.length) return;
    const units = g.units.filter(u => u.owner === pid);
    const mil = units.filter(u => u.type !== 'settler').length;
    const settlers = units.filter(u => u.type === 'settler').length;
    const net = g.grossIncome(pid) - g.upkeep(pid);
    const capLeft = Math.min(g.unitCap(pid) - units.length, net >= 3 || pl.gold > 40 ? 99 : 0);
    let acted = false;

    // 0) keep the peace: compliance buildings first, festivals when revolt is near,
    //    tax relief as the reliable fallback; lift relief once the city would be fine without it
    for (const c of cities) {
      const un = g.unrest(c);
      if (c.taxRelief && un.net + 2 <= -1 && (c.unrest || 0) === 0) c.taxRelief = false;
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
      if (!c.taxRelief && un.net > 0 && (cur >= 4 || urgent)) { c.taxRelief = true; acted = true; break; }
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
      const c = cities.filter(c => !g.unitAt(c.idx) && c.trainedTurn !== g.turn).sort((a, b) => b.level - a.level)[0];
      if (c) {
        const cost = g.unitCost(c, 'settler');
        if (pl.gold >= cost) { if (g.train(c, 'settler').ok) continue; }
        else if (pl.gold + g.income(pid) * 1.5 >= cost && cities.length < 3) return; // save up
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
        for (const k of g.improvementsFor(pid, t)) {
          const chk = g.canImprove(pid, t, k);
          if (!chk.ok) continue;
          const v = g.improvePop(t, k) / IMPROVEMENTS[k].cost;
          if (v > bestV) { bestV = v; bestImp = [t, k]; }
        }
      }
    }
    if (bestImp && (bestV >= 0.3 || pl.gold > 15)) { g.improve(pid, bestImp[0], bestImp[1]); continue; }

    // d) research
    let bestT = null, bestTV = 0;
    for (const t of Object.keys(TECHS)) {
      const chk = g.canResearch(pid, t);
      if (!chk.ok) continue;
      const v = techValue(g, pid, t);
      if (v > bestTV) { bestTV = v; bestT = t; }
    }
    const wantMil = Math.ceil(cities.length * (1 + prof.aggression)) + 1;
    if (bestT && (bestTV > 1.2 || mil >= wantMil)) { g.research(pid, bestT); continue; }

    // e) military
    if ((mil < wantMil + (g.turn > 30 ? cities.length : 0) || pl.gold > 25) && capLeft > 0) {
      const c = cities.filter(c => !g.unitAt(c.idx) && c.trainedTurn !== g.turn).sort((a, b) => enemiesNear(g, pid, b.idx, 8) - enemiesNear(g, pid, a.idx, 8))[0];
      if (c) { const k = bestMilitary(g, c, pl.gold); if (k && g.train(c, k).ok) continue; }
    }

    // f) wonders, then buildings
    let built = false;
    for (const c of cities) {
      for (const w of Object.keys(WONDERS)) if (g.canBuildWonder(c, w).ok) { g.buildWonder(c, w); built = true; break; }
      if (built) break;
    }
    if (built) continue;
    for (const c of cities) {
      for (const b of g.buildable(c)) {
        if (g.canBuild(c, b).ok && pl.gold - BUILDINGS[b].cost >= 2) { g.build(c, b); built = true; break; }
      }
      if (built) break;
    }
    if (built) continue;
    if (bestT) { g.research(pid, bestT); continue; }
    break;
  }
}
