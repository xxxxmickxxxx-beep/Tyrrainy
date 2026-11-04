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

### Rebellions
Every revolt (and every insurrection's first insurgent) belongs to a **rebellion**: a new tribe appended to the turn order.
- **Homeland:** the specialty of the city it rose in, so it is subject to the same homeland bias as everyone else.
- **Merging:** a revolt joins an existing rebellion if one holds a city within 5 tiles and is kin to the city's land. Otherwise it founds a new one (soft cap of 20 tribes alive).
- **Starting kit:** the parent's techs, some gold, and a 40-point grudge against the parent.
- **Afterwards** it's an ordinary tribe: its own cities can revolt, it can fall, and it can win.
- **Fizzling:** an uprising that never takes a city disbands once its source city calms below rioting.

Menu option *Rebellions*:
- **AI — I take one over if my tribe falls** (default): when a human falls, they take command of the strongest AI rebellion.
- **AI only.**
- **Played by humans (hotseat):** every new rebellion is a human seat.

### Balance of power
**Runaway detection.** `power` = Σ(city level + 2) + 0.5 per military unit. Dominance is the minimum of two terms:
- leader vs. field: `(leader / mean(others) − 1.3) / 0.9`
- leader vs. runner-up: `(leader / second − 1.2) / 0.6`

It's clamped to 0–1 and applies from turn 15 with 3+ tribes holding cities. **Two near-peers give d ≈ 0**, so no world coalition forms.

**Threat** (per pair, cached per turn) combines proximity of the closest cities, shared border length, enemy attack strength within 3 tiles of my cities, and relative power. **Containment** for an AI = `d × balance × reach(leader) × (1 − 0.7 × pressing)`. `reach` falls off past 6 tiles, and `pressing` is the largest threat from anyone other than the leader.

**Hostility** (no hard rules; temperaments only set weights):
- **vs. the leader:** `1 + grudge + threat·caution + 3·containment − appease·d·1.5·(1 − 1.5·threat)`. An appeaser's restraint vanishes as the leader becomes a direct threat.
- **vs. anyone else:** `(1 + grudge + prey) × restraint + threat·caution`. Restraint (≥ 0.3) comes from containment, so coalition members go easy on each other but always defend themselves. `prey` is the bully weight against much weaker tribes.

Coalition *membership* is a label: an AI counts itself in when its containment passes its threshold, and out below threshold × patience.

| Temperament | balance | caution | other |
|---|---|---|---|
| Balancer | 1.3–1.7 | 0.6–0.9 | joins early when the leader is within reach |
| Opportunist | 0.4–0.7 | 0.5–0.8 | bully 0.6–1.0, high opportunism |
| Vengeful | 0.6–0.9 | 0.7–1.0 | vengeance 1.4–2.0 |
| Appeaser | 0.1–0.25 | 1.1–1.5 | appease 0.6–0.9, bully 0.4–0.8 |
| Steadfast | 0.8–1.1 | 0.8–1.1 | patience 0.15–0.3 (sticks around) |

Sims with a boosted runaway (`node tools/sim.js boost=12 …`) show the intended distance gradient. Steadfast tribes within 8 tiles of the leader aimed all their attacks at it, and those farther away none. Opportunists near it: 35%; far away: 0%.

### War damage
- **Occupation:** each occupied or damaged worked tile (one with an improvement or a resource) costs its city 1 gold. Enemies on a city's land add +1 unrest pressure.
- **Pillage:** a unit that starts its turn on an enemy improvement has a 35% chance to damage it, and then to destroy it. Destroying it removes the pop it granted, so cities can drop levels. Repairs cost half the build price.
- **Siege:** each attack on a garrison inside its city has a 12% chance to destroy a building.
- **Sack:** on capture, each building is lost with 35% chance. A captured city may then be razed (the tile becomes ruins):

| City after the sack | Raze chance |
|---|---|
| holds a wonder | 5% |
| still has buildings | 0% |
| stripped bare (had buildings once) | `max(10%, 60% − 10%×level)` |
| never built anything | `max(18%, 36% − 3%×level)`: 33% at level 1, down to 18% at level 6+ |
- **Construction limits:** a city can complete one building or wonder per turn, and none while a hostile unit is adjacent to it.
- **Colours:** each tribe has a two-tone identity, a fill plus an accent used for borders, roofs and unit rims, taken from `TRIBE_PALETTE`. Newcomers (rebellions) get the pair farthest in CIELAB from all living tribes, and colours of fallen tribes become available again.

### Culture & records
- Cities remember their **culture**: the people who founded them, or the rebellion that freed them. A conquered city adopts its ruler's culture after 25 turns, or 15 with a Shrine.
- **Map modes** (M): Terrain, Political, Culture (thick stripes show a people under foreign rule; thin lines show own people on foreign land), Specialty (unclaimed land shows what it would become), and Unrest.
- **Tribes screen:** sortable, with Peak cities, Founded and Fell columns.
- **Histomap:** each turn's power share is recorded and drawn as a classic Histomap, with rebellions placed beside their parent. It's reachable from the Tribes screen, the leave dialog and the victory screen.

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
3. **Rebellions inherit the full tech tree** of their parent. With homeland bias applied they now stay small (1–5 cities in sims), but a late-game rebellion is still technologically mature on day one.
4. **Coastal threshold.** With 2 water neighbours, coastal cities dominated, so the threshold is now 3. Mixed tiles (a forest on the coast) still get only one identity. A primary/secondary specialty system is the obvious next step.
5. **No diplomacy.** Everyone is at war with everyone. Peace and alliances matter more on big multi-faction maps.
6. **AI cheats slightly.** It knows enemy unit positions near its units without fog checks.
