# Tyrrainy

A turn-based hex 4X where **cities are defined by the land they stand on**, not by a fixed faction.
Settle on hills and you get a Hilltop stronghold; on a river, a Riverside trade hub; in the steppe, a horde camp.
Every tribe has a *homeland* and runs similar lands well and distant ones poorly.

Plain HTML/JS (ES modules), no build step, no dependencies.

## Play

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. You can also double-click `index.html`, because the game ships as one bundled classic script (`tyrrainy.js`) that works from `file://`.

`src/` is the source of truth. After editing it, rebuild the bundle with `node tools/build.js`.

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

### Unrest & revolts
Each city weighs **pressure** against **compliance**.

- **Pressure:** realm size (+1 per 2 cities past 4), Foreign +1, Alien +2, recently conquered +2 for 15 turns, crowding +1 per 4 levels, riots in a city of yours within 3 tiles +1, festival riot +2.
- **Compliance:** capital 3, homeland 1, garrison 1, Courthouse 1, Amphitheater 2 (Masonry), Shrine 2 (Philosophy), festival 2 for 5 turns, tax relief 2.
- **Tax relief** is a per-city toggle: −2 pressure, but the city pays no gold. It's reliable and unlimited, but expensive.
- **Festivals** cost `4 + 2×level` gold and are a gamble. Backfire risk is `5% + 12%` per recent festival, capped at 70%. A backfire adds +3 unrest and +2 pressure for 4 turns. Trust recovers by one festival after 6 turns of being content without help, and each compliance building restores two.

When net pressure is positive, it builds unrest. The effects escalate:

| Unrest | State | Effect |
|---|---|---|
| net > 0 | Restless | withholds that much gold per turn |
| 6+ | Rioting | no training or construction except compliance buildings; +1 pressure on your cities within 3 tiles |
| 9+ | Insurrection | 30% chance each turn of a Rebel insurgent spawning next to the city |
| 12 | Revolt | the garrison defects and the city joins the Rebels (capitals never revolt) |

### Rebels
The Rebels are a full AI tribe that takes its turn last. It is dormant while it holds nothing.
- No homeland: every land is kin to it.
- On each revolt it inherits the old owner's techs, receives gold and holds a big grudge against that owner.
- Its own cities can't revolt.
- It counts for conquest and score, so it can win.

### Balance of power (AI coalition)
`power` = Σ(city level + 2) + 0.5 per military unit. Dominance `d = clamp((leader / mean(others) − 1.3) / 0.9, 0, 1)` applies from turn 15 with 3+ tribes in play. The leader is "sticky": a challenger must clearly pass it by 10% before attention shifts.

Each AI rolls a **temperament** (`TEMPERAMENTS` in `src/data.js`) with jittered parameters:

| Temperament | Joins at d ≥ | Commitment | Notes |
|---|---|---|---|
| Balancer | 0.05–0.2 | strong | first in |
| Opportunist | 0.45–0.65 | weak | takes easy kills and undefended cities from anyone |
| Vengeful | 0.2–0.4 | medium | grudges weigh 1.4–2× |
| Steadfast | 0.3–0.45 | medium | leaves only when d < 10–25% of its threshold |
| Appeaser | never | — | avoids hitting the leader and bullies the weak instead |

Hostility toward a target starts at 1 and is shaped by three things:
- **Grudges:** damage taken from that tribe, plus 30 per lost city. They decay 10% per turn.
- **Coalition members:** hostility is multiplied by `1 + 3·e·balance` against the leader and by `1 − 0.85·e·balance` against everyone else. `e` is the member's commitment, which grows as dominance rises past its own threshold.
- **Floors:** kills never fall below opportunism × 0.85, and enemies next to the AI's own cities never fall below 1.

Attacks are valued as gain × hostility − loss. Campaign targets are chosen by hostility × ease ÷ distance.
Joins, switches and departures appear in the log, and the Tribes screen shows each met tribe's temperament, coalition and grudges against you.

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
| `tools/sim.js` | Headless AI-vs-AI sims with coalition, revolt and festival stats: `node tools/sim.js games=3 turns=100 size=large players=8` |
| `tools/build.js` | Bundles `src/` into `tyrrainy.js` (run after edits) |

## Open design questions (not yet decided)
1. **Snowballing** is now dampened by unrest and the AI coalition. On large 8-tribe maps the top tribes end within about 15–17 cities of each other. Coalitions only steer the AI, though. A human leader feels them, but a human in a coalition gets no shared benefit (shared vision, a truce).
2. **Late-game gold still piles up.** Nine world wonders (one per land type, level 5+ city) now soak some of it, but all techs are usually researched by about turn 80–100. Unit upgrades or repeatable techs are the next candidates.
3. **Humans can't play the Rebels.** They're AI-only. With 8+ tribes and a realm-size penalty, the Rebels often reach 5–15 cities. That might be too strong, because they inherit full tech trees.
4. **Coastal threshold.** With 2 water neighbours, coastal cities dominated, so the threshold is now 3. Mixed tiles (a forest on the coast) still get only one identity. A primary/secondary specialty system is the obvious next step.
5. **No diplomacy.** Everyone is at war with everyone. Peace and alliances matter more on big multi-faction maps.
6. **AI cheats slightly.** It knows enemy unit positions near its units without fog checks.
