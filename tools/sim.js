// Headless AI-vs-AI simulation for balance + crash testing.
import { Game } from '../src/game.js';
import { runAI } from '../src/ai.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const games = +(args.games || 1);
for (let k = 0; k < games; k++) {
  const t0 = Date.now();
  const g = Game.create({ size: args.size || 'medium', players: +(args.players || 6), humans: 0, seed: (args.seed || 'sim') + k, mapType: args.type || 'continents', turnLimit: +(args.turns || 80) });
  let steps = 0, revolts = 0, coalitions = [];
  const atk = { onLeader: 0, onOthers: 0, base: 0, baseOthers: 0 };
  g.listeners.push((t, d) => {
    if (t === 'attack') {
      const a = g.players[g.current]; const dom = g.dominance();
      const tgt = d.killed ? null : g.unitAt(d.to);
      const victim = tgt ? tgt.owner : (g.cityAt(d.to)?.owner ?? null);
      if (victim == null || a.rebel || g.players[victim]?.rebel || a.id === dom.leader || dom.leader < 0) return;
      if (dom.d > 0.2) { if (victim === dom.leader) atk.onLeader++; else atk.onOthers++; }
      else { if (victim === dom.leader) atk.base++; else atk.baseOthers++; }
    } if (t === 'revolt') revolts++; if (t === 'coalition') coalitions.push(`T${g.turn}:${g.players[d.leader].name}`); });
  while (!g.winner && steps < 5000) {
    runAI(g, g.current);
    g.endTurn();
    steps++;
  }
  const dt = Date.now() - t0;
  console.log(`game ${k}: turn ${g.turn} winner ${g.winner && g.players[g.winner.pid].name} (${g.winner?.how}) in ${dt}ms`);
  console.log(`  non-leader attacks: coalition-time leader/others=${atk.onLeader}/${atk.onOthers}, normal-time leader/others=${atk.base}/${atk.baseOthers}`);
  console.log(`  revolts=${revolts} coalitions=${coalitions.join(', ') || 'none'} rebelCities=${g.cities.filter(c => g.players[c.owner].rebel).length}`);
  for (const p of g.players) {
    if (p.rebel) continue;
    const cs = g.cities.filter(c => c.owner === p.id);
    console.log(`  ${p.name.padEnd(18)} home=${p.home.padEnd(9)} alive=${p.alive} cities=${cs.length} lv=${cs.reduce((a, c) => a + c.level, 0)} units=${g.units.filter(u => u.owner === p.id).length} techs=${p.techs.length} gold=${p.gold} kills=${p.kills} score=${g.score(p.id)}`);
  }
  const specs = {};
  for (const c of g.cities) specs[c.specialty] = (specs[c.specialty] || 0) + 1;
  console.log('  city specialties:', JSON.stringify(specs));
}
