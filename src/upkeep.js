// Technology upkeep and dark ages. Mixed into Game.prototype. (Game option: settings.techUpkeep)
//
// Every known tech costs knowledge each turn (by tier). A subject pays nothing for what its
// overlord knows. Upkeep halves if a trade partner, vassal or overlord knows the tech, and drops a further 25% if any tribe at peace with you knows it:
// isolation is expensive, contact keeps ideas alive. The knowledge stock is the buffer
// (libraries); only when it runs dry does *decline* build up. When decline reaches DECLINE_AT, a
// tech must be forgotten. Only "leaf" techs (nothing else you know depends on them) can go, so
// the most advanced knowledge is lost first. Existing units, buildings and improvements stay;
// you just can't make new ones that need the lost tech. Forgotten techs are cheaper to relearn
// (50%, or 25% if a partner knows them). Two losses within 10 turns start a Dark Age.
import { TECHS, UNITS, BUILDINGS, IMPROVEMENTS } from './data.js';

export const TECH_UPKEEP = [0, 1, 2, 3, 4];
export const DECLINE_AT = 10;
export const FORGET_GRACE = 3;

export const upkeepMethods = {
  upkeepOn() { return this.settings?.techUpkeep !== false; },
  // tribes whose knowledge rubs off on pid: trade partners and tributary ties (strong), peace (weak)
  knowledgePartners(pid) {
    const strong = new Set(), weak = new Set();
    for (const r of this.routesOf?.(pid) || []) strong.add(r.a === pid ? r.b : r.a);
    const lord = this.overlordOf?.(pid); if (lord != null) strong.add(lord);
    for (const v of this.vassalsOf?.(pid) || []) strong.add(v);
    for (const p of this.players) if (p.alive && p.id !== pid && this.hasMet(pid, p.id) && !this.atWar(pid, p.id)) weak.add(p.id);
    return { strong, weak };
  },
  techUpkeepOf(pid, t, partners = this.knowledgePartners(pid)) {
    // a subject lives inside its overlord's learning: what the overlord knows costs it nothing
    const lord = this.overlordOf?.(pid);
    if (lord != null && this.players[lord]?.techs.includes(t)) return 0;
    let u = TECH_UPKEEP[TECHS[t].tier];
    const knows = (set) => [...set].some(o => this.players[o]?.techs.includes(t));
    if (knows(partners.strong)) u *= 0.5;
    if (knows(partners.weak)) u *= 0.75;
    return u;
  },
  techUpkeep(pid) {
    if (!this.upkeepOn()) return 0;
    const partners = this.knowledgePartners(pid);
    const total = this.players[pid].techs.reduce((a, t) => a + this.techUpkeepOf(pid, t, partners), 0);
    return this.hasGrand?.(pid, 'library') ? total * 0.75 : total;
  },
  // libraries hold enough to buy the dearest tech twice over, no more: a buffer, not a hoard
  knowledgeCap(pid) {
    let top = 0;
    for (const t of Object.keys(TECHS)) top = Math.max(top, this.techPrice(pid, t) / this.rediscoveryFactor(pid, t));
    return 30 + 2 * top;
  },
  forgettable(pid) {
    const known = this.players[pid].techs;
    return known.filter(t => !known.some(o => TECHS[o].req.includes(t)));
  },
  forgetTech(pid, t, forced = false) {
    const pl = this.players[pid];
    if (!this.forgettable(pid).includes(t)) return { ok: false, why: 'Other knowledge depends on it' };
    pl.techs = pl.techs.filter(x => x !== t);
    pl.forgotten = [...new Set([...(pl.forgotten || []), t])];
    pl.decline = 0; pl.mustForget = null;
    pl.forgetTurns = [...(pl.forgetTurns || []).filter(x => this.turn - x < 10), this.turn];
    this.addLog(forced ? `${pl.name} has lost the knowledge of ${TECHS[t].name}.` : `${pl.name} lets the knowledge of ${TECHS[t].name} fade.`, pid);
    this.emit('forget', { pid, t, forced });
    if (!pl.darkAge && pl.forgetTurns.length >= 2) {
      pl.darkAge = { since: this.turn };
      this.addLog(`${pl.name} enters a Dark Age.`, pid);
      this.emit('darkage', { pid, start: true });
    }
    return { ok: true };
  },
  // How much a tribe still uses a tech (to pick what to drop): units, buildings, improvements.
  techUse(pid, t) {
    let n = 0;
    for (const u of this.units) if (u.owner === pid && UNITS[u.type].tech === t) n += 2;
    for (const c of this.cities) if (c.owner === pid) for (const b of c.buildings) if (BUILDINGS[b].tech === t) n += 1;
    for (const tl of this.tiles) if (tl.owner === pid && tl.imp && IMPROVEMENTS[tl.imp]?.tech === t) n += 0.5;
    if (t === 'ironworking' || t === 'sailing' || t === 'mining' || t === 'agriculture') n += 3; // economic backbones
    return n;
  },
  leastUsefulLeaf(pid) {
    return this.forgettable(pid).sort((a, b) => (this.techUse(pid, a) - TECHS[a].tier * 0.5) - (this.techUse(pid, b) - TECHS[b].tier * 0.5))[0];
  },
  // Called at the start of a tribe's turn, after knowledge income.
  upkeepTick(pid) {
    const pl = this.players[pid];
    if (!this.upkeepOn()) return;
    const up = this.techUpkeep(pid);
    pl.lastUpkeep = up;
    pl.knowledge = (pl.knowledge || 0) - up;
    pl.knowledge = Math.min(pl.knowledge, this.knowledgeCap(pid)); // libraries hold only so much
    if (pl.knowledge < 0) {
      pl.decline = (pl.decline || 0) - pl.knowledge;
      pl.knowledge = 0;
    } else pl.decline = Math.max(0, (pl.decline || 0) - 1);
    if (pl.decline >= DECLINE_AT && !pl.mustForget && pl.techs.length) {
      pl.mustForget = { since: this.turn };
      if (pl.human) this.addLog(`Learning is in decline: ${pl.name} must let one technology go.`, pid);
    }
    if (pl.mustForget && (!pl.human || this.turn - pl.mustForget.since >= FORGET_GRACE)) {
      const t = this.leastUsefulLeaf(pid);
      if (t) this.forgetTech(pid, t, true); else pl.mustForget = null;
    }
    if (pl.darkAge && this.turn - (pl.forgetTurns?.slice(-1)[0] ?? 0) >= 15 && pl.knowledge > 0) {
      this.addLog(`${pl.name} emerges from its Dark Age after ${this.turn - pl.darkAge.since} turns.`, pid);
      pl.darkAges = (pl.darkAges || 0) + 1;
      pl.darkAge = null;
      this.emit('darkage', { pid, start: false });
    }
  },
  // Relearning: 50% of the price, 25% if a partner still knows it.
  rediscoveryFactor(pid, t) {
    const pl = this.players[pid];
    if (!pl.forgotten?.includes(t)) return 1;
    const { strong } = this.knowledgePartners(pid);
    return [...strong].some(o => this.players[o]?.techs.includes(t)) ? 0.25 : 0.5;
  },
};
