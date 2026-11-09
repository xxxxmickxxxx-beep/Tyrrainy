// Diplomatic states and trade agreements, mixed into Game.prototype (see game.js).
//
// States per pair: war (default between tribes), truce (10 turns after a peace deal; war
// cannot be declared), peace, alliance (shared vision, defensive pact). Units can't attack
// or enter the territory of tribes they are not at war with; allies may pass.
// (Trade moves to physical routes in a later phase.)

export const TRUCE_TURNS = 10;

export const diplomacyMethods = {
  relKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; },
  relation(a, b) {
    this.relations = this.relations || {};
    const r = this.relations[this.relKey(a, b)];
    if (!r) return { state: 'war', since: 0 };
    if (r.state === 'truce' && this.turn >= r.until) { r.state = 'peace'; }
    return r;
  },
  // cached per relation change and turn: called in every pathing step
  atWar(a, b) {
    if (a === b || a < 0 || b < 0) return false;
    const n = this.players.length;
    let m = this._warM;
    if (!m || m.ver !== this._relVer || m.turn !== this.turn || m.n !== n) {
      m = this._warM = { ver: this._relVer, turn: this.turn, n, a: new Int8Array(n * n).fill(-1) };
    }
    const k = a * n + b;
    let v = m.a[k];
    if (v < 0) { v = m.a[k] = m.a[b * n + a] = this.relation(a, b).state === 'war' ? 1 : 0; }
    return v === 1;
  },
  allied(a, b) { const st = this.relation(a, b).state; return a !== b && (st === 'alliance' || st === 'vassal'); },
  setRelation(a, b, state, extra = {}) {
    this.relations = this.relations || {};
    this.relations[this.relKey(a, b)] = { state, since: this.turn, ...extra };
    this._thr = null;
    this._relVer = (this._relVer || 0) + 1;
  },
  hasMet(a, b) { return a === b || !!this.players[a]?.met?.[b]; },
  warsOf(pid) { return this.contenders().filter(p => p.id !== pid && this.hasMet(pid, p.id) && this.atWar(pid, p.id)).map(p => p.id); },

  // move each side's units out of the other's land when the fighting stops
  evict(a, b) {
    for (const u of this.units.slice()) {
      const other = u.owner === a ? b : u.owner === b ? a : -1;
      if (other < 0 || this.tiles[u.idx].owner !== other) continue;
      const seen = new Set([u.idx]), q = [u.idx];
      let dest = null;
      while (q.length && dest === null && seen.size < 400) {
        const cur = q.shift();
        for (const n of this.neighbors(cur)) {
          if (seen.has(n)) continue;
          seen.add(n);
          if (this.moveCost(u, n, n) === Infinity) continue;
          const o = this.tiles[n].owner;
          if (!this.unitAt(n) && (o < 0 || o === u.owner || this.atWar(u.owner, o) || this.allied(u.owner, o))) { dest = n; break; }
          q.push(n);
        }
      }
      if (dest === null) this.disband(u); else { u.idx = dest; this.rebuildUnitMap(); }
    }
  },

  makePeace(a, b) {
    this.setRelation(a, b, 'truce', { until: this.turn + TRUCE_TURNS });
    this.evict(a, b);
    // an overlord's peace binds its vassals, and theirs
    for (const [x, y] of [[a, b], [b, a]]) for (const v of this.subjectsDeep?.(x) || []) {
      if (v !== y && this.atWar(v, y)) { this.setRelation(v, y, 'truce', { until: this.turn + TRUCE_TURNS }); this.evict(v, y); }
    }
    this.addLog(`${this.players[a].name} and ${this.players[b].name} make peace.`, a);
    this.emit('diplo', { type: 'peace', a, b });
  },
  canDeclareWar(a, b) {
    const r = this.relation(a, b);
    if (r.state === 'war') return { ok: false, why: 'Already at war' };
    if (r.state === 'vassal') return { ok: false, why: r.vassal === a ? 'Declare independence instead' : 'Release your vassal first' };
    if (this.isVassal?.(a)) {
      // a free-hand subject wages its own wars, but never on its overlord's side of the table
      const lord = this.overlordOf(a);
      if (!this.terms(a)?.free) return { ok: false, why: 'Your overlord decides war and peace (you are bound)' };
      if (b === lord || this.topOverlord(a) === b || this.relation(b, lord).state === 'alliance') return { ok: false, why: 'Not against your overlord or its allies' };
    }
    if (r.state === 'truce') return { ok: false, why: `Truce holds for ${r.until - this.turn} more turns` };
    return { ok: true };
  },
  declareWar(a, b, quiet = false) {
    const chk = this.canDeclareWar(a, b);
    if (!chk.ok) return chk;
    const was = this.relation(a, b).state;
    this.setRelation(a, b, 'war');
    if (this.routeBetween?.(a, b)) this.closeRoute(a, b, true);
    // treachery is remembered: the victim, and everyone who knows the aggressor
    this.addGrudge(b, a, was === 'alliance' ? 60 : 40);
    for (const p of this.players) if (p.alive && p.id !== a && p.id !== b && this.hasMet(p.id, a)) this.addGrudge(p.id, a, was === 'alliance' ? 15 : 8);
    // a subject's aggression reflects on whoever holds its leash
    const lord = this.overlordOf?.(a);
    if (lord != null) this.addGrudge(b, lord, 0.3 * (was === 'alliance' ? 60 : 40));
    if (!quiet) this.addLog(`${this.players[a].name} declares war on ${this.players[b].name}!`, a);
    this.emit('diplo', { type: 'war', a, b });
    // defensive pacts
    for (const p of this.players) {
      if (!p.alive || p.id === a || p.id === b || !this.allied(p.id, b) || this.allied(p.id, a)) continue;
      if (this.relation(p.id, a).state === 'war') continue;
      this.setRelation(p.id, a, 'war');
      this.addLog(`${p.name} honours its alliance and joins the war against ${this.players[a].name}.`, p.id);
    }
    // vassals follow their overlord into war, and their own vassals follow them
    for (const v of this.subjectsDeep?.(a) || []) if (v !== b && !this.atWar(v, b) && this.relation(v, b).state !== 'vassal') this.setRelation(v, b, 'war');
    return { ok: true };
  },
  formAlliance(a, b) {
    this.setRelation(a, b, 'alliance');
    this.addLog(`${this.players[a].name} and ${this.players[b].name} form an alliance.`, a);
    this.emit('diplo', { type: 'alliance', a, b });
    this.updateVision(a); this.updateVision(b);
  },
  breakAlliance(a, b) {
    if (!this.allied(a, b)) return { ok: false, why: 'Not allied' };
    this.setRelation(a, b, 'peace');
    this.addGrudge(b, a, 10);
    this.addLog(`${this.players[a].name} ends its alliance with ${this.players[b].name}.`, a);
    return { ok: true };
  },

  // ---- payments: gold buys goodwill. A gift eases the recipient's grudge against the giver and
  // builds favour, which lowers its hostility (and so softens its answers to offers).
  giveGold(from, to, amount) {
    const F = this.players[from], T = this.players[to];
    amount = Math.floor(Math.min(amount, F.gold));
    if (amount <= 0) return { ok: false, why: 'Nothing to give' };
    if (!this.hasMet(from, to)) return { ok: false, why: 'You have not met them' };
    F.gold -= amount; T.gold += amount;
    if (T.temper) {
      T.temper.favor = T.temper.favor || {};
      T.temper.favor[from] = (T.temper.favor[from] || 0) + amount;
      if (T.temper.grudges[from]) T.temper.grudges[from] = Math.max(0, T.temper.grudges[from] - amount * 0.5);
    }
    this.addLog(`${F.name} sends ${amount} gold to ${T.name}.`, from);
    this.emit('diplo', { type: 'gift', a: from, b: to, amount });
    return { ok: true, amount };
  },

  // ---- offers
  // AI answers at once; a human answers at the start of their next turn.
  offer(from, to, type) {
    const pre = this.offerCheck(from, to, type);
    if (!pre.ok) return pre;
    if (this.players[to].human) {
      this.offers = (this.offers || []).filter(o => !(o.from === from && o.to === to && o.type === type));
      this.offers.push({ from, to, type, turn: this.turn });
      return { ok: true, pending: true };
    }
    const yes = this.aiAccepts(to, from, type);
    if (yes) this.applyOffer(from, to, type);
    return { ok: true, accepted: yes };
  },
  offerCheck(from, to, type) {
    if (!this.hasMet(from, to)) return { ok: false, why: 'You have not met them' };
    const st = this.relation(from, to).state;
    // a free-hand subject may make peace in its own wars, not in those it fights for its overlord
    const ownWar = (sub, other) => this.terms(sub)?.free && !this.atWar(this.overlordOf(sub), other);
    if (this.isVassal(from) && type !== 'route' && !(type === 'peace' && ownWar(from, to))) return { ok: false, why: this.terms(from)?.free ? 'This war is your overlord\'s to end' : 'Your overlord conducts your diplomacy' };
    if (type === 'peace' && this.isVassal(to) && !ownWar(to, from)) return { ok: false, why: 'Make peace with their overlord' };
    if (st === 'vassal' && type !== 'route') return { ok: false, why: 'Already bound by vassalage' };
    if (type === 'vassal') {
      if (st !== 'war') return { ok: false, why: 'You can only demand submission in war' };
      if (this.isVassal(to)) return { ok: false, why: 'They already serve another' };
      return { ok: true };
    }
    if (type === 'protect') {
      if (st === 'war') return { ok: false, why: 'Not from an enemy' };
      if (this.isVassal(to)) return { ok: false, why: 'They are a vassal themselves' };
      if (this.vassalsOf(from).length) return { ok: false, why: 'You have vassals of your own' };
      return { ok: true };
    }
    if (type === 'peace' && st !== 'war') return { ok: false, why: 'Not at war' };
    if (type === 'alliance' && (st === 'war' || st === 'alliance')) return { ok: false, why: st === 'war' ? 'Make peace first' : 'Already allied' };
    if (type === 'route') return this.canOpenRoute(from, to);
    return { ok: true };
  },
  applyOffer(from, to, type) {
    if (type === 'peace') this.makePeace(from, to);
    else if (type === 'alliance') this.formAlliance(from, to);
    else if (type === 'route') this.openRoute(from, to);
    else if (type === 'vassal') this.makeVassal(to, from);
    else if (type === 'protect') this.makeVassal(from, to, true);
  },
  answerOffer(o, accept) {
    if (!(this.offers || []).includes(o)) return { ok: false, why: 'Offer no longer stands' };
    if (o.type === 'terms' || o.type === 'arbitrate') return this.answerSubjectOffer(o, accept);
    this.offers = this.offers.filter(x => x !== o);
    if (accept && this.offerCheck(o.from, o.to, o.type).ok) { this.applyOffer(o.from, o.to, o.type); return { ok: true }; }
    if (accept) { this.addLog(`The ${o.type} offer from ${this.players[o.from].name} has lapsed.`, o.to); return { ok: false, why: 'The offer has lapsed' }; }
    this.addLog(`${this.players[o.to].name} declines ${this.players[o.from].name}'s ${o.type} offer.`, o.to);
    // a refusal makes the AI wait longer before asking again
    const f = this.players[o.from];
    if (f.lastOffer) f.lastOffer[o.to + o.type] = this.turn + 10;
    return { ok: true };
  },
  // How an AI judges an offer, using the same hostility weights that drive its wars.
  aiAccepts(pid, from, type) {
    if (!this.players[pid].alive) return false;
    const h = this.hostility(pid, from);
    const myP = this.power(pid), theirP = this.power(from);
    if (type === 'peace') {
      const age = this.turn - (this.relation(pid, from).since || 0);
      if (this.players[pid].temper?.joined === from) return myP < theirP * 0.5; // coalition members don't fold easily
      if (myP >= theirP * 1.5 && age < 25 && h >= 1.1) return false; // winning: press on
      return h < 1.6 || myP < theirP * 0.7 || (age >= 20 && h < 2.2);
    }
    if (type === 'route') {
      const g = this.routeGain(pid, from);
      return h < 1.9 && (g.buy > 0 || g.sell > 0);
    }
    if (type === 'vassal') {
      // submit when hopelessly outmatched or bleeding cities; appeasers bend sooner
      const pl = this.players[pid];
      const mine = this.cities.filter(c => c.owner === pid).length;
      const bleeding = (pl.peak || mine) >= 3 && mine <= (pl.peak || mine) * 0.6;
      const limit = pl.temper?.key === 'appeaser' ? 0.6 : 0.45;
      return myP < theirP * limit || (bleeding && myP < theirP * 0.75);
    }
    if (type === 'protect') {
      // take a ward if we don't loathe it, can face its enemies, and it is worth having
      if (h > 1.6) return false;
      const enemies = this.warsOf(from);
      if (enemies.some(e => this.power(e) > myP * 0.9 && !this.atWar(pid, e))) return false;
      const goods = this.cities.filter(c => c.owner === from).reduce((a, c) => a + Object.keys(this.cityProduction(c)).length, 0);
      return goods >= 1 || this.related(this.players[pid].culture, this.players[from].culture);
    }
    if (type === 'alliance') {
      const T = this.players[pid].temper, F = this.players[from].temper;
      const sameCoalition = T && T.joined >= 0 && (F ? F.joined === T.joined : this.atWar(from, T.joined));
      const sharedEnemy = this.warsOf(pid).some(e => this.atWar(from, e) && this.hostility(pid, e) > 1.5);
      return h < 1.3 && (sameCoalition || sharedEnemy);
    }
    return false;
  },
};
