// Managing subjects (vassals): terms, consent, arbitration, conspiracies, clients and grants.
// Mixed into Game.prototype. Builds on vassals.js.
//
// Terms (per subject, set by its overlord):
//   tribute  None / Light / Standard / Heavy: share of gold income, and liberty per turn
//   subsidy  gold a turn paid *to* the subject (−0.5 liberty a turn per tier)
//   free     war rights: a free-hand subject wages its own wars (even on fellow subjects);
//            a bound one only follows its overlord's, and resents it (+1 liberty a turn)
// Easing terms applies at once. Tightening them (more tribute, binding, cutting a subsidy) is
// a demand: the subject's liberty jumps, and it may refuse, which means war. An AI subject's
// answer is known before the demand is sent and given at once; a human answers on its turn.
//
// Arbitration imposes a truce on two subjects at war; the side that is winning pays in liberty.
//
// Conspiracies: disloyal subjects (liberty >= 50) of the same overlord join a pact, and leave
// it if liberty falls under 35. When the pact's strength reaches 80% of the overlord's (its own
// power plus half its loyal subjects'), or any member's liberty reaches 100, they rise together
// as allies.
//
// Clients and grants: any non-capital city can be released as a new tribe, subject to its
// former owner (subjects can do this too, making subjects of their own), or granted to one of
// the owner's subjects nearby.

export const TRIBUTE_TIERS = [
  { name: 'No', share: 0, lib: -1.5 },
  { name: 'Light', share: 0.15, lib: 0.5 },
  { name: 'Standard', share: 0.25, lib: 1 },
  { name: 'Heavy', share: 0.4, lib: 2.5 },
];
export const SUBSIDY_GOLD = [0, 3, 6, 10];
export const PACT_JOIN = 50, PACT_LEAVE = 35, PACT_RISE = 0.8;
const GRANT_RANGE = 8;

export const subjectMethods = {
  terms(v) {
    const r = this.vassalRel(v);
    if (!r) return null;
    if (!r.terms) r.terms = { tribute: 2, subsidy: 0, free: false };
    return r.terms;
  },
  topOverlord(pid) {
    let p = pid;
    for (let n = 0; n < 12; n++) { const o = this.overlordOf(p); if (o == null) return p; p = o; }
    return p;
  },
  // all subjects below pid, at any depth
  subjectsDeep(pid, out = []) {
    for (const v of this.vassalsOf(pid)) if (!out.includes(v)) { out.push(v); this.subjectsDeep(v, out); }
    return out;
  },

  // ---- terms and consent
  // The liberty jump a change of terms causes (0 if it only eases them).
  termsSpike(v, to) {
    const cur = this.terms(v);
    let spike = 0;
    if (to.tribute > cur.tribute) spike += 6 * (to.tribute - cur.tribute);
    if (!to.free && cur.free) spike += 10;
    if (to.subsidy < cur.subsidy) spike += 4 * (cur.subsidy - to.subsidy);
    return spike;
  },
  // How strong a subject could stand against its overlord: itself and its fellow conspirators.
  standRatio(v) {
    const o = this.overlordOf(v);
    if (o == null) return 0;
    const r = this.vassalRel(v);
    let mine = this.power(v);
    if (r.pact) for (const m of this.pactOf(o)) if (m !== v) mine += this.power(m);
    return mine / Math.max(1, this.pactStrength(o).lord);
  },
  // Would an AI subject swallow a demand that raises its liberty by `spike`?
  subjectAccepts(v, spike) {
    const r = this.vassalRel(v);
    const L = r.liberty + spike, stand = this.standRatio(v);
    if (L >= 100) return { yes: false, why: `liberty would reach ${Math.round(L)}` };
    if (L >= 60 && stand >= 0.6) return { yes: false, why: 'strong enough to fight' };
    if (L >= 80 && stand >= 0.35) return { yes: false, why: 'resentful, and not without friends' };
    return { yes: true, why: `liberty ${Math.round(r.liberty)} → ${Math.round(L)}` };
  },
  // What happens if overlord o sets these terms (for the UI and the AI).
  previewTerms(o, v, to) {
    const r = this.vassalRel(v);
    if (!r || r.overlord !== o) return { ok: false, why: 'Not your subject' };
    const spike = this.termsSpike(v, to);
    if (!spike) return { ok: true, tighten: false, spike: 0 };
    if (this.players[v].human) return { ok: true, tighten: true, spike, human: true };
    const a = this.subjectAccepts(v, spike);
    return { ok: true, tighten: true, spike, accept: a.yes, why: a.why };
  },
  applyTerms(v, to, spike) {
    const r = this.vassalRel(v);
    r.terms = { ...this.terms(v), ...to };
    r.liberty = Math.min(100, r.liberty + spike);
  },
  setTerms(o, v, change) {
    const to = { ...this.terms(v) || {}, ...change };
    const pre = this.previewTerms(o, v, to);
    if (!pre.ok) return pre;
    const V = this.players[v], O = this.players[o];
    if (!pre.tighten) { this.applyTerms(v, to, 0); return { ok: true, applied: true }; }
    if (pre.human) {
      this.offers = (this.offers || []).filter(x => !(x.from === o && x.to === v && x.type === 'terms'));
      this.offers.push({ from: o, to: v, type: 'terms', terms: to, spike: pre.spike, turn: this.turn });
      return { ok: true, pending: true };
    }
    if (pre.accept) {
      this.applyTerms(v, to, pre.spike);
      this.addLog(`${V.name} bows to harsher terms from ${O.name}.`, o);
      return { ok: true, accepted: true };
    }
    this.addLog(`${V.name} refuses ${O.name}'s terms and takes up arms!`, v);
    this.riseAgainst(v);
    return { ok: true, accepted: false };
  },

  // ---- arbitration between two subjects at war
  // war score: cities taken from each other in this war, and relative power
  countCapture(pid, from) {
    if (!this.atWar(pid, from)) return;
    const key = this.relKey(pid, from);
    this.relations = this.relations || {};
    if (!this.relations[key]) this.setRelation(pid, from, 'war');
    const r = this.relations[key];
    r.taken = r.taken || {};
    r.taken[pid] = (r.taken[pid] || 0) + 1;
  },
  warEdge(a, b) {
    const r = this.relation(a, b);
    const ta = r.taken?.[a] || 0, tb = r.taken?.[b] || 0;
    const pa = Math.max(1, this.power(a)), pb = Math.max(1, this.power(b));
    const s = (ta - tb) + 2 * (pa >= pb ? pa / pb - 1 : -(pb / pa - 1));
    return s >= 0 ? { winner: a, loser: b, edge: Math.min(1, s / 6) } : { winner: b, loser: a, edge: Math.min(1, -s / 6) };
  },
  previewArbitration(o, a, b) {
    if (this.overlordOf(a) !== o || this.overlordOf(b) !== o) return { ok: false, why: 'Both must be your subjects' };
    if (!this.atWar(a, b)) return { ok: false, why: 'They are not at war' };
    const e = this.warEdge(a, b);
    const spike = Math.round(10 + 40 * e.edge);
    if (this.players[e.winner].human) return { ok: true, ...e, spike, human: true };
    const acc = this.subjectAccepts(e.winner, spike);
    return { ok: true, ...e, spike, accept: acc.yes, why: acc.why };
  },
  imposeTruce(o, a, b, e, spike) {
    this.setRelation(a, b, 'truce', { until: this.turn + 10 });
    this.evict(a, b);
    const rw = this.vassalRel(e.winner), rl = this.vassalRel(e.loser);
    if (rw) rw.liberty = Math.min(100, rw.liberty + spike);
    if (rl) rl.liberty = Math.max(0, rl.liberty - 10);
    this.addLog(`${this.players[o].name} forces a truce on ${this.players[a].name} and ${this.players[b].name}.`, o);
    this.emit('diplo', { type: 'arbitrate', a, b });
  },
  arbitrate(o, a, b) {
    const pre = this.previewArbitration(o, a, b);
    if (!pre.ok) return pre;
    if (pre.human) {
      this.offers = (this.offers || []).filter(x => !(x.from === o && x.to === pre.winner && x.type === 'arbitrate'));
      this.offers.push({ from: o, to: pre.winner, type: 'arbitrate', a, b, spike: pre.spike, turn: this.turn });
      return { ok: true, pending: true };
    }
    if (pre.accept) { this.imposeTruce(o, a, b, pre, pre.spike); return { ok: true, accepted: true }; }
    this.addLog(`${this.players[pre.winner].name} will not be robbed of victory: it defies ${this.players[o].name}!`, pre.winner);
    this.riseAgainst(pre.winner);
    return { ok: true, accepted: false };
  },
  // a human subject answers terms or arbitration on its turn: refusing means war
  answerSubjectOffer(o, accept) {
    this.offers = this.offers.filter(x => x !== o);
    const r = this.vassalRel(o.to);
    if (!r || r.overlord !== o.from) return { ok: false, why: 'No longer their subject' };
    if (!accept) {
      this.addLog(`${this.players[o.to].name} refuses ${this.players[o.from].name}'s demands and takes up arms!`, o.to);
      this.riseAgainst(o.to);
      return { ok: true };
    }
    if (o.type === 'terms') { this.applyTerms(o.to, o.terms, o.spike); this.addLog(`${this.players[o.to].name} accepts ${this.players[o.from].name}'s terms.`, o.to); }
    else if (this.atWar(o.a, o.b)) this.imposeTruce(o.from, o.a, o.b, this.warEdge(o.a, o.b), o.spike);
    return { ok: true };
  },

  // ---- conspiracies
  pactOf(o) { return this.vassalsOf(o).filter(v => this.vassalRel(v)?.pact); },
  // the pact's strength against the overlord's: its own power plus half its loyal subjects'
  pactStrength(o) {
    const members = this.pactOf(o);
    let pact = 0, lord = this.power(o);
    for (const v of this.vassalsOf(o)) {
      const pv = this.power(v) + 0.5 * this.vassalsOf(v).reduce((a, x) => a + this.power(x), 0);
      if (members.includes(v)) pact += pv; else lord += 0.5 * pv;
    }
    return { members, pact, lord, ratio: pact / Math.max(1, lord) };
  },
  canJoinPact(v) {
    const r = this.vassalRel(v);
    if (!r) return { ok: false, why: 'Not a subject' };
    if (r.pact) return { ok: false, why: 'Already conspiring' };
    if (r.liberty < PACT_JOIN) return { ok: false, why: `Liberty desire must reach ${PACT_JOIN}` };
    return { ok: true };
  },
  joinPact(v, on = true) {
    const r = this.vassalRel(v);
    if (!r) return { ok: false, why: 'Not a subject' };
    if (on && !this.canJoinPact(v).ok) return this.canJoinPact(v);
    r.pact = on;
    if (on) this.addLog(`${this.players[v].name} conspires with ${this.players[r.overlord].name}'s other discontented subjects.`, r.overlord);
    return { ok: true };
  },
  pactTick(o) {
    if (!this.players[o]?.alive) return;
    for (const v of this.vassalsOf(o)) {
      const r = this.vassalRel(v);
      if (this.players[v].human) { if (r.pact && r.liberty < PACT_LEAVE) r.pact = false; continue; }
      if (!r.pact && r.liberty >= PACT_JOIN) this.joinPact(v);
      else if (r.pact && r.liberty < PACT_LEAVE) { r.pact = false; this.addLog(`${this.players[v].name} abandons the conspiracy against ${this.players[o].name}.`, o); }
    }
    const ps = this.pactStrength(o);
    if (ps.members.length >= 2 && ps.ratio >= PACT_RISE) this.risePact(o);
  },
  // a subject breaking free brings its fellow conspirators with it
  riseAgainst(v) {
    const o = this.overlordOf(v);
    if (o == null) return;
    if (this.vassalRel(v).pact && this.pactOf(o).length >= 2) this.risePact(o);
    else this.declareIndependence(v);
  },
  risePact(o) {
    const members = this.pactOf(o);
    for (const m of members) this.declareIndependence(m);
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) this.setRelation(members[i], members[j], 'alliance');
    for (const m of members) this.updateVision(m);
    this.addLog(`${members.map(m => this.players[m].name).join(', ')} rise together against ${this.players[o].name}!`, o);
    this.emit('diplo', { type: 'pactRising', a: o, members });
  },

  // ---- grants: a city handed to one of its owner's subjects nearby
  grantTargets(city) {
    return this.vassalsOf(city.owner).filter(v => this.cities.some(c => c.owner === v && this.dist(c.idx, city.idx) <= GRANT_RANGE));
  },
  canGrantCity(city, v) {
    if (city.capital) return { ok: false, why: 'Not the capital' };
    if (this.overlordOf(v) !== city.owner) return { ok: false, why: 'Not your subject' };
    if (!this.grantTargets(city).includes(v)) return { ok: false, why: `They hold no city within ${GRANT_RANGE} tiles` };
    return { ok: true };
  },
  grantCity(city, v) {
    const chk = this.canGrantCity(city, v);
    if (!chk.ok) return chk;
    const o = city.owner;
    city.owner = v; city.subsidy = 0; city.razeDecision = undefined;
    for (const t of this.within(city.idx, 2)) if (this.tiles[t].ownerCity === city.id) this.tiles[t].owner = v;
    const gar = this.unitAt(city.idx);
    if (gar && gar.owner === o && gar.type !== 'settler') { gar.owner = v; gar.goto = null; this.rebuildUnitMap(); }
    // kindred land is a welcome gift; a foreign, restless city is a burden
    const r = this.vassalRel(v);
    const kin = this.related(city.culture, this.players[v].culture);
    r.liberty = Math.max(0, Math.min(100, r.liberty + (kin ? -5 : 5)));
    this.bumpPeak(v);
    this.addLog(`${this.players[o].name} grants ${city.name} to its subject, the ${this.players[v].name}.`, o, city.idx);
    this.emit('diplo', { type: 'grant', a: o, b: v });
    this.updateVision(v);
    return { ok: true };
  },
};
