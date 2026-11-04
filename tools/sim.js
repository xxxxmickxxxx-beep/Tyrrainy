// Headless AI-vs-AI simulation for balance + crash testing.
import { Game } from '../src/game.js';
import { runAI } from '../src/ai.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const games = +(args.games || 1);
for (let k = 0; k < games; k++) {
  const t0 = Date.now();
  const g = Game.create({ size: args.size || 'medium', players: +(args.players || 6), humans: 0, seed: (args.seed || 'sim') + k, mapType: args.type || 'continents', turnLimit: +(args.turns || 80) });
  let steps = 0;
  while (!g.winner && steps < 5000) {
    runAI(g, g.current);
    g.endTurn();
    steps++;
  }
  const dt = Date.now() - t0;
  console.log(`game ${k}: turn ${g.turn} winner ${g.winner && g.players[g.winner.pid].name} (${g.winner?.how}) in ${dt}ms`);
  for (const p of g.players) {
    const cs = g.cities.filter(c => c.owner === p.id);
    console.log(`  ${p.name.padEnd(18)} home=${p.home.padEnd(9)} alive=${p.alive} cities=${cs.length} lv=${cs.reduce((a, c) => a + c.level, 0)} units=${g.units.filter(u => u.owner === p.id).length} techs=${p.techs.length} gold=${p.gold} kills=${p.kills} score=${g.score(p.id)}`);
  }
  const specs = {};
  for (const c of g.cities) specs[c.specialty] = (specs[c.specialty] || 0) + 1;
  console.log('  city specialties:', JSON.stringify(specs));
}
