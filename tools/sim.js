// Headless AI-vs-AI simulation for balance + crash testing.
//   node tools/sim.js games=3 turns=100 size=large players=8 seed=x
import { Game } from '../src/game.js';
import { runAI } from '../src/ai.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const games = +(args.games || 1);
for (let k = 0; k < games; k++) {
  const t0 = Date.now();
  const g = Game.create({ size: args.size || 'medium', players: +(args.players || 6), humans: 0, seed: (args.seed || 'sim') + k, mapType: args.type || 'continents', turnLimit: +(args.turns || 80) });
  const st = { revolts: 0, fest: 0, backfire: 0, insurg: 0, joins: [], byTemper: {} };
  g.listeners.push((t, d) => {
    if (t === 'attack') {
      const a = g.players[g.current]; const dom = g.dominance();
      const tgt = d.killed ? null : g.unitAt(d.to);
      const victim = tgt ? tgt.owner : (g.cityAt(d.to)?.owner ?? null);
      if (victim == null || !a.temper || a.id === dom.leader || dom.leader < 0 || dom.d < 0.2) return;
      const near = (g.threats(a.id).by[dom.leader]?.dmin ?? 99) <= 8;
      const b = st.byTemper[a.temper.key + (near ? '/near' : '/far')] ||= { leader: 0, other: 0 };
      if (victim === dom.leader) b.leader++; else b.other++;
    }
    if (t === 'revolt') st.revolts++;
    if (t === 'rebellion') st.rebellions = (st.rebellions || 0) + 1;
    if (t === 'festival') { st.fest++; if (d.backfired) st.backfire++; }
    if (t === 'coalition') st.joins.push(`T${g.turn} ${g.players[d.member].temper.key}`);
    if (t === 'log' && /Insurgents/.test(d.msg)) st.insurg++;
  });
  let steps = 0;
  const boost = +(args.boost || 0); // test runaway behaviour: tribe 0 gets free gold each turn
  while (!g.winner && steps < 5000) { if (boost && g.current === 0) g.players[0].gold += boost; runAI(g, g.current); g.endTurn(); steps++; }
  console.log(`game ${k}: turn ${g.turn} winner ${g.winner && g.players[g.winner.pid].name} (${g.winner?.how}) in ${Date.now() - t0}ms`);
  console.log(`  revolts=${st.revolts} insurgents=${st.insurg} festivals=${st.fest} backfired=${st.backfire} rebellions=${st.rebellions || 0} rebelCities=${g.cities.filter(c => g.players[c.owner].rebel).length}`);
  console.log(`  coalition joins: ${st.joins.join(', ') || 'none'}`);
  console.log(`  share of attacks on leader while dominant, by temperament: ` + Object.entries(st.byTemper).map(([k, v]) => `${k} ${Math.round(100 * v.leader / Math.max(1, v.leader + v.other))}% (${v.leader + v.other})`).join(', '));
  for (const p of g.players) {
    const cs = g.cities.filter(c => c.owner === p.id);
    if (p.rebel && !cs.length) continue;
    if (!p.alive && !cs.length && p.rebel) continue;
    console.log(`  ${p.name.padEnd(16)} ${String(p.home).padEnd(9)} ${(p.temper?.key || 'human').padEnd(11)} alive=${p.alive ? 'Y' : 'n'} cities=${String(cs.length).padStart(2)} lv=${String(cs.reduce((a, c) => a + c.level, 0)).padStart(3)} units=${String(g.units.filter(u => u.owner === p.id).length).padStart(3)} gold=${String(p.gold).padStart(5)} score=${g.score(p.id)}`);
  }
}
