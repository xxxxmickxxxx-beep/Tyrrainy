# Tyrrainy

A turn-based hex 4X where **cities are defined by the land they stand on**, not by a fixed faction.
Settle on hills and you get a Hilltop stronghold; on a river, a Riverside trade hub; in the steppe, a horde camp.
Every tribe has a *homeland* and runs similar lands well and distant ones poorly.

Plain HTML/JS (ES modules), no build step, no dependencies.

## Play

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` straight from disk won't work, because ES modules need a server.)

**GitHub Pages:** `.github/workflows/pages.yml` deploys on every push to `main`. Turn it on once under
*Settings → Pages → Source: GitHub Actions*. Until you do, the workflow fails at the deploy step.

Options include map size (tiny to huge, 80×52), map type (continents, pangaea, archipelago, lakeland),
2–10 tribes, 1–4 hotseat humans, a turn limit, a seed, and a "Watch AIs" spectator mode.
Games autosave to localStorage at the start of each human turn.

## Core design

### Land → city specialty
| Rule (in priority order) | Specialty |
|---|---|
| Hills | Hilltop |
| Mountain (needs Climbing) | Mountain |
| River tile | Riverside |
| 3+ adjacent water tiles | Coastal |
| otherwise the terrain itself | Plains / Forest / Desert / Steppe / Marsh |

Each specialty has a passive bonus, a **unique unit** and a **unique building** (see the in-game help or `src/data.js`).

### Homeland & kinship
Specialties sit in a kinship graph (`KIN_EDGES` in `src/data.js`), for example plains–steppe, hilltop–mountain and riverside–coastal.
A city's graph distance from the owner's homeland sets its culture:

| Distance | Culture | Effect |
|---|---|---|
| 0 | Homeland | +1 gold, unique unit −1 cost, +1 starting pop |
| 1 | Kin | none |
| 2 | Foreign | −1 gold, unique unit +2 |
| 3+ | Alien | −2 gold, unique unit +3, no specialty building |

Foreign and alien cities **integrate** one step every 10 turns (5 with a Shrine). The *Assimilation* tech removes one step for all of them.
**Traditions:** owning 3+ Homeland/Kin cities of a type lets *every* city train that type's unique unit.
Tribes also move at cost 1 across their homeland terrain. Coastal tribes embark without stopping, and riverside tribes move fast along rivers.

### Economy
- Gold per turn comes from cities: `1 + ceil(level × 0.6)`, plus capital, culture, specialty and building bonuses.
- Tile improvements (farm, mine, lumber camp, fishery, …) cost gold and add pop. When pop fills, the city levels up, and level 4 widens its borders.
- Settlers found cities, and each one costs more than the last.
- Unit cap is Σ(city level + 1). Each city feeds 2 units, and every unit beyond that costs 1 gold upkeep.
- There are 20 techs in 4 tiers. Cost scales with how many cities you have.

### Combat
Attack and defense forces are scaled by HP and terrain or city defense, and the formula is deterministic. Defenders that survive and are in range retaliate.
Zones of control stop movement. Melee kills advance into the tile, and walking into an undefended enemy city captures it.
Three kills make a unit a veteran.

## Code map
| File | What |
|---|---|
| `src/data.js` | All tunables: terrains, specialties, kinship, units, improvements, buildings, techs |
| `src/mapgen.js` | Noise-based elevation, moisture, temperature, rivers, resources, ruins, start placement |
| `src/game.js` | Rules engine (pure, runs in node), save/load |
| `src/ai.js` | Heuristic AI: expansion, tech valuation, combat evaluation, distance-field pathing |
| `src/render.js` | Canvas renderer |
| `src/main.js` | UI, input, turn flow, hotseat |
| `tools/sim.js` | Headless AI-vs-AI sims: `node tools/sim.js games=3 turns=100 size=medium players=6` |

## Open design questions (not yet decided)
1. **Snowballing.** In sims, the leading tribe often ends with 2–3× the runner-up's cities. Candidates: a war-weariness penalty, a rising cost for many alien cities, or AI coalitions against the leader.
2. **Late-game gold has no sink.** All techs are usually researched by about turn 80–100. Wonders, unit upgrades or repeatable techs could fix this.
3. **Should culture distance also affect unit stats or loyalty (revolts)**, rather than only gold and cost? Revolts would make "having a harder time with different land" much sharper.
4. **Coastal threshold.** With 2 water neighbours, coastal cities dominated, so the threshold is now 3. Mixed tiles (a forest on the coast) still get only one identity. A primary/secondary specialty system is the obvious next step.
5. **No diplomacy.** Everyone is at war with everyone. Peace and alliances matter more on big multi-faction maps.
6. **AI cheats slightly.** It knows enemy unit positions near its units without fog checks.
