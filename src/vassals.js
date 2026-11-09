// Tributaries (indirect rule). Mixed into Game.prototype.
//
// A vassal keeps its cities, its people and its own unrest. It pays its overlord 25% of its
// gold income each turn and ships surplus goods the overlord lacks along a real (raidable)
// tribute route. It follows the overlord's wars and peaces; the two share vision and passage.
// Liberty desire builds from distance, cultural difference, the tribute burden and the
// overlord's weakness, and eases with kinship and shared enemies. At 100 the vassal breaks
// free. An overlord can release a vassal, or annex it peacefully once the peoples are
// related or after 30 quiet turns.
import { GOOD_KEYS, STRATEGIC } from './data.js';

export const TRIBUTE_SHARE = 0.25;
export const ANNEX_AFTER = 30;

export const vassalMethods = {
  vassalRel(v) {
    for (const [, r] of Object.entries(this.relations || {})) if (r.state === 'vassal' && r.vassal === v) return r;
    return null;
  },
  overlordOf(v) { const r = this.vassalRel(v); return r && this.players[r.overlord]?.alive ? r.overlord : null; },
  vassalsOf(o) { return Object.values(this.relations || {}).filter(r => r.state === 'vassal' && r.overlord === o && this.players[r.vassal]?.alive).map(r => r.vassal); },
  isVassal(pid) { return this.overlordOf(pid) != null; },

  makeVassal(v, o, protect = false) {
    const V = this.players[v], O = this.players[o];
    this.setRelation(v, o, 'vassal', { vassal: v, overlord: o, liberty: protect ? 5 : 25, protect });
    this.evict?.(v, o);
    // the vassal is drawn into its overlord's wars
    for (const p of this.players) {
      if (!p.alive || p.id === v || p.id === o) continue;
      if (this.atWar(o, p.id) && !this.atWar(v, p.id)) this.setRelation(v, p.id, 'war');
      // a protector takes up its new ward's wars
      if (protect && this.atWar(v, p.id) && !this.atWar(o, p.id) && this.relation(o, p.id).state !== 'vassal') this.setRelation(o, p.id, 'war');
    }
    this.addLog(protect ? `${V.name} places itself under the protection of ${O.name}.` : `${V.name} submits to ${O.name} as a tributary.`, v);
    this.emit('diplo', { type: 'vassal', a: o, b: v });
    this.updateVision(v); this.updateVision(o);
  },
  releaseVassal(o, v) {
    if (this.overlordOf(v) !== o) return { ok: false, why: 'Not your vassal' };
    this.setRelation(o, v, 'peace');
    this.addLog(`${this.players[o].name} releases ${this.players[v].name} from vassalage.`, o);
    return { ok: true };
  },
  canAnnex(o, v) {
    const r = this.vassalRel(v);
    if (!r || r.overlord !== o) return { ok: false, why: 'Not your vassal' };
    if (this.players[v].human) return { ok: false, why: 'A human vassal cannot be annexed' };
    const related = this.related(this.players[v].culture, this.players[o].culture);
    const settled = this.turn - r.since >= ANNEX_AFTER && r.liberty < 25;
    if (!related && !settled) return { ok: false, why: `Needs kindred peoples, or ${ANNEX_AFTER} turns with liberty desire under 25 (${this.turn - r.since} turns, liberty ${Math.round(r.liberty)})` };
    return { ok: true };
  },
  annexVassal(o, v) {
    const chk = this.canAnnex(o, v);
    if (!chk.ok) return chk;
    const V = this.players[v];
    for (const c of this.cities) {
      if (c.owner !== v) continue;
      c.owner = o; c.capital = false; c.held = 0; c.subsidy = 0; // no conquest shock: a peaceful union
      for (const t of this.within(c.idx, 2)) if (this.tiles[t].ownerCity === c.id) this.tiles[t].owner = o;
    }
    for (const u of this.units) if (u.owner === v) { u.owner = o; u.goto = null; }
    const st = this.stock(o), vs = this.stock(v);
    for (const k of GOOD_KEYS) st[k] = Math.min(this.stockCap(o), st[k] + vs[k]);
    this.players[o].gold += V.gold;
    V.alive = false; V.fell = this.turn; V.absorbedBy = o;
    this.routes = (this.routes || []).filter(r => r.a !== v && r.b !== v);
    this.rebuildUnitMap();
    this.addLog(`${this.players[o].name} peacefully absorbs ${V.name}.`, o);
    this.emit('diplo', { type: 'annex', a: o, b: v });
    this.updateVision(o);
    this.checkConquest();
    return { ok: true };
  },
  declareIndependence(v) {
    const o = this.overlordOf(v);
    if (o == null) return { ok: false, why: 'Not a vassal' };
    this.setRelation(v, o, 'war');
    this.addGrudge(o, v, 30);
    this.addLog(`${this.players[v].name} throws off the rule of ${this.players[o].name}!`, v);
    this.emit('diplo', { type: 'independence', a: v, b: o });
    // allies of the overlord (and its other vassals) are drawn in
    for (const p of this.players) {
      if (!p.alive || p.id === v || p.id === o || !this.allied(p.id, o) || this.allied(p.id, v)) continue;
      if (!this.atWar(p.id, v)) this.setRelation(p.id, v, 'war');
    }
    return { ok: true };
  },

  // Liberty desire: what each term contributes per turn (for display and the tick).
  libertyTerms(v) {
    const r = this.vassalRel(v);
    if (!r) return [];
    const o = r.overlord;
    const terms = [];
    const capO = this.cities.find(c => c.owner === o && c.capital) || this.cities.find(c => c.owner === o);
    const capV = this.cities.find(c => c.owner === v && c.capital) || this.cities.find(c => c.owner === v);
    if (capO && capV) { const d = this.dist(capO.idx, capV.idx); if (d > 8) terms.push(['Distance', Math.min(3, (d - 8) / 4)]); }
    const related = this.related(this.players[v].culture, this.players[o].culture);
    terms.push(related ? ['Kindred peoples', -1] : ['Foreign overlord', 1.5]);
    terms.push(['Tribute', 1]);
    const ratio = this.power(v) / Math.max(1, this.power(o));
    if (ratio > 1) terms.push(['Overlord is weaker', 6]); else if (ratio > 0.6) terms.push(['Overlord is barely stronger', 3]);
    else if (ratio < 0.3) terms.push(['Overlord is overwhelming', -1.5]);
    const shared = this.warsOf(o).some(e => this.atWar(v, e) && e !== v);
    if (shared || r.protect) terms.push([r.protect ? 'Protection' : 'Shared enemies', -1.5]);
    return terms;
  },
  vassalTick() {
    for (const r of Object.values(this.relations || {})) {
      if (r.state !== 'vassal') continue;
      if (!this.players[r.overlord]?.alive) { r.state = 'peace'; continue; }
      if (!this.players[r.vassal]?.alive) continue;
      r.liberty = Math.max(0, Math.min(100, (r.liberty || 0) + this.libertyTerms(r.vassal).reduce((a, [, x]) => a + x, 0)));
      // goods tribute along a real route: free, but raidable
      const p = this.routePath?.(r.vassal, r.overlord);
      r.lastTribute = { goods: {}, raided: null, blocked: !p };
      if (!p) continue;
      r.path = p.path;
      let cap = 3;
      for (const k of GOOD_KEYS.slice().sort((x, y) => this.deficit(r.overlord, y) - this.deficit(r.overlord, x))) {
        if (cap <= 0) break;
        const n = Math.min(cap, this.surplus(r.vassal, k), this.deficit(r.overlord, k));
        if (n <= 0) continue;
        cap -= n;
        this.stock(r.vassal)[k] -= n;
        const raider = this.raiderOn(p.path, r.vassal, r.overlord);
        const to = raider ? raider.owner : r.overlord;
        this.stock(to)[k] = Math.min(this.stockCap(to), this.stock(to)[k] + n);
        if (raider) { r.lastTribute.raided = raider.owner; this.addLog(`${this.players[raider.owner].name} raiders seize tribute bound for ${this.players[r.overlord].name}.`, raider.owner, raider.idx); }
        else r.lastTribute.goods[k] = (r.lastTribute.goods[k] || 0) + n;
      }
    }
  },
  // Gold tribute, taken when the vassal collects its income.
  payTribute(v, inc) {
    const o = this.overlordOf(v);
    if (o == null || inc <= 0) return 0;
    const t = Math.floor(inc * TRIBUTE_SHARE);
    this.players[v].gold -= t;
    this.players[o].gold += t;
    const r = this.vassalRel(v); if (r) r.lastGold = t;
    return t;
  },
};
