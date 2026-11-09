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
    if (t === 'diplo') st[d.type] = (st[d.type] || 0) + 1;
    if (t === 'raid') st.raids = (st.raids || 0) + 1;
    if (t === 'razed') { st.razed = (st.razed || 0) + 1; if (/torch/.test(g.log[g.log.length - 1]?.msg || '')) st.chosen = (st.chosen || 0) + 1; }
    if (t === 'log' && /destroyed a /.test(d.msg)) st.impLost = (st.impLost || 0) + 1;
    if (t === 'log' && /was destroyed|lost in the sack/.test(d.msg)) st.bldLost = (st.bldLost || 0) + 1;
    if (t === 'rebellion') st.rebellions = (st.rebellions || 0) + 1;
    if (t === 'festival') { st.fest++; if (d.backfired) st.backfire++; }
    if (t === 'coalition') st.joins.push(`T${g.turn} ${g.players[d.member].temper.key}`);
    if (t === 'log' && /Insurgents/.test(d.msg)) st.insurg++;
  });
  let steps = 0;
  const boost = +(args.boost || 0); // test runaway behaviour: tribe 0 gets free gold each turn
  while (!g.winner && steps < 5000) { if (boost && g.current === 0) g.players[0].gold += boost; runAI(g, g.current); g.endTurn(); steps++; }
  console.log(`game ${k}: turn ${g.turn} winner ${g.winner && g.players[g.winner.pid].name} (${g.winner?.how}) in ${Date.now() - t0}ms`);
  console.log(`  revolts=${st.revolts} insurgents=${st.insurg} festivals=${st.fest} backfired=${st.backfire} razed=${st.razed || 0}(chosen ${st.chosen || 0}) improvementsDestroyed=${st.impLost || 0} buildingLossEvents=${st.bldLost || 0} rebellions=${st.rebellions || 0} rebelCities=${g.cities.filter(c => g.players[c.owner].rebel).length}`);
  const rel = { war: 0, truce: 0, peace: 0, alliance: 0 }; const live = g.contenders();
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) if (g.hasMet(live[i].id, live[j].id)) rel[g.relation(live[i].id, live[j].id).state]++;
  const goods = g.contenders().map(p => `${p.name.slice(0, 8)}:${Object.entries(g.stock(p.id)).map(([k, v]) => k.slice(0, 2) + v).join(' ')}`).join(' | ');
  const units = {}; for (const u of g.units) units[u.type] = (units[u.type] || 0) + 1;
  console.log(`  stockpiles: ${goods}`);
  console.log(`  unit mix: ${Object.entries(units).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' ')}`);
  console.log(`  diplomacy events: war ${st.war || 0}, peace ${st.peace || 0}, alliance ${st.alliance || 0}, routes opened ${st.route || 0} (active ${(g.routes || []).length}), raids ${st.raids || 0} | final relations among met pairs: ${JSON.stringify(rel)}`);
  console.log(`  coalition joins: ${st.joins.join(', ') || 'none'}`);
  console.log(`  share of attacks on leader while dominant, by temperament: ` + Object.entries(st.byTemper).map(([k, v]) => `${k} ${Math.round(100 * v.leader / Math.max(1, v.leader + v.other))}% (${v.leader + v.other})`).join(', '));
  const subs = [0, 0, 0, 0]; for (const c of g.cities) subs[c.subsidy || 0]++;
  console.log(`  subsidy tiers at end (none/relief/dole/patronage): ${subs.join('/')}`);
  for (const p of g.players) {
    const cs = g.cities.filter(c => c.owner === p.id);
    if (p.rebel && !cs.length) continue;
    if (!p.alive && !cs.length && p.rebel) continue;
    console.log(`  ${p.name.padEnd(16)} ${String(p.home).padEnd(9)} ${(p.temper?.key || 'human').padEnd(11)} alive=${p.alive ? 'Y' : 'n'} cities=${String(cs.length).padStart(2)} lv=${String(cs.reduce((a, c) => a + c.level, 0)).padStart(3)} units=${String(g.units.filter(u => u.owner === p.id).length).padStart(3)} gold=${String(p.gold).padStart(5)} score=${g.score(p.id)}`);
  }
}
