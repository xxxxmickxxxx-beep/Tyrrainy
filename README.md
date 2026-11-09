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

- **Generic pressure** is scaled by the city's **cultural sensitivity** to its ruler (`SENSITIVITY` in `src/data.js`): Homeland ×0.6, Kin ×0.85, Foreign ×1.2, Alien ×1.5, plus 0.25 if the city's people are another tribe's culture. Generic pressure covers realm size (+1 per 2 cities past 4), recent conquest (+2 for 15 turns), crowding (+1 per 4 levels), enemies on its land (+1) and riots within 3 tiles (+1).
- **Flat pressure:** Foreign +1, Alien +2, festival riot +2.
- **Compliance:** capital 3, homeland 1, garrison 1, Courthouse 1, Amphitheater 2 (Masonry), Shrine 2 (Philosophy), festival 2 for 5 turns, and subsidies.
- **Subsidies** (`SUBSIDIES`) stop the city's taxes and buy calm: Tax relief −2 (free), Grain dole −4 (2 gold/turn), Patronage −6 (5 gold/turn). If the treasury goes negative, the costliest subsidies lapse to Tax relief.
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

If the city survives that roll, the **conqueror chooses** whether to keep it or raze it. Humans get a dialog with advisor reasoning, and the AI follows the advice. `razeAdvice()` estimates long-run unrest (excluding the 15-turn conquest shock) after adding every compliance building the conqueror could build plus a garrison. It then prices the subsidy needed to cover the rest against the city's worth: taxes, plus unit capacity, score and power. Alien land, grudges against the city's people and a poor treasury push toward razing. Wonders and the conqueror's own people push hard against it. A deliberate razing gives the city's people a +40 grudge against the razer and its former ruler +20.
- **Construction limits:** a city can complete one building or wonder per turn, and none while a hostile unit is adjacent to it.
- **Colours:** each tribe has a two-tone identity, a fill plus an accent used for borders, roofs and unit rims, taken from `TRIBE_PALETTE`. Newcomers (rebellions) get the pair farthest in CIELAB from all living tribes, and colours of fallen tribes become available again.

### Diplomacy (`src/diplomacy.js`)
- **States per pair:**
  - **War** is the default.
  - **Truce:** 10 turns after peace is made; war can't be declared during it.
  - **Peace.**
  - **Alliance:** shared vision, passage through each other's land, and a defensive pact.
- **Closed borders:** units can't attack, pillage, capture or enter the land of tribes they aren't at war with. Allies may pass but can't enter each other's cities. Making peace moves each side's units out of the other's land.
- **Treachery:** declaring war on a tribe at peace gives that tribe a +40 grudge (+60 if it was an ally), and +8 (+15) from everyone who knows the aggressor. The victim's allies join the war automatically.
- **Contact** happens on first sight of a unit or city. Diplomacy news reaches tribes that know either party.
- **AI:** it uses the same hostility weights that drive its wars.
  - **Offering peace:** it offers peace when hostility is low, when it's losing, when it's overstretched or when it's war-weary.
  - **Accepting peace:** a tribe that's clearly winning refuses.
  - **Declaring war:** it declares war when hostility passes its temperament's threshold (opportunist 1.9 … appeaser 2.7) and it isn't weaker, with a lower threshold against a coalition target. It may also prey on a much weaker neighbour, or put a rich treasury to use.
  - **Alliances and trade:** it proposes alliances with coalition partners or co-belligerents, and trade wherever it pays.
- **Humans** act in the Diplomacy screen (D). Offers to a human wait for the start of that human's turn. A human refusal makes the AI wait 15 turns before asking again.

### Strategic goods (`src/economy.js`)
Goods are rival and come from places. Infinite goods shared freely made "ally with everyone" the dominant strategy, so they were replaced.
- **Deposits:** a Mine on a copper or tin deposit gives that metal, a Pasture on a horse herd gives horses, a Lumber Camp gives timber, and a Quarry on hills gives stone.
- **Copper and tin** come from opposite ends of a low-frequency "geology" noise field. Tin is rarer, and the two metals usually lie in different regions: the median distance from tin to the nearest copper is about 10 tiles on most seeds.
- **Processing** (`RECIPES` in `src/data.js`): a **Bronze Workshop** (Bronze Working, 1 stone) in a connected city smelts up to 2 copper + 2 tin into 2 bronze per turn. Advanced units need bronze. Raw inputs are only kept in reserve by tribes with a workshop to feed, so everyone else's metal goes up for sale. Prices: copper 3, tin 4, bronze 10 (a markup over its inputs). Each yields 1 per turn, capped at 2 per good per city and doubled by that city's specialty building (Deep Mine, Stables, Sawmill, Watchtower). Damaged or enemy-occupied tiles yield nothing.
- **The iron age:** Iron Working (tier 3; needs Bronze Working and Forestry) makes iron ore yield. Iron ore is common: it fills the band between the copper and tin regions, plus bog iron in marshes (Bog Iron Pit). A **Bloomery** smelts 1 iron ore + 1 timber (charcoal) into 1 iron, up to 2 per turn. Units that needed bronze now need any **metal** (`GROUPS.metal`), drawn from iron first and then bronze, for training and supply alike. The iron-only **Legionary** (4/4, 16 hp) is the payoff. In sims, iron output overtakes bronze by about turn 120, metal-armed armies double, tin loses its grip and timber gains one.
- **Food** comes from Farms, Irrigation, Fisheries, Whaling and Reed Beds (fisheries and whaling are now permanent): up to 4 per city, doubled by a Granary. Cities of level 3+ eat (level − 2) per turn from the stockpile. **Hungry** cities (more than 30% unfed) stop leveling up and gain +1 to +2 unrest. Cut-off cities eat only what they grow, so **sieges starve cities**.
- **Luxuries:** wool from Pastures on sheep (hills, steppe) becomes **cloth** at a **Weaver** (Husbandry, 1 timber). **Spice** comes from Plantations (Irrigation) on rare spice deposits in desert and forest, doubled by a Caravanserai. Each city of level 4+ takes up to 1 cloth and 1 spice per turn, largest cities first, and each gives −1 unrest. Cities of level 6+ with neither get +1. Luxuries are scarce: in sims about a third of eligible cities are supplied.
- **Trade reserves:** goods eaten every turn keep a thinner reserve (2 + 2× demand) than military goods (4 + 3× demand), so food surpluses get sold. `goodDemand()` (army supply + food + luxuries + workshop inputs) drives trade and AI priorities.
- **National stockpile:** cap 8 + 2 per city; surplus beyond the cap is lost. A city feeds and draws on it only while **connected to the capital**: a path of land (or shallow water with Sailing, ocean with Navigation) not through hostile land or past enemy units. Cut-off cities (⚠) are economically besieged.
- **Hard requirements:** advanced units and many buildings need goods (`needs` in `src/data.js`). A Swordsman takes 1 bronze, a Knight 1 bronze + 1 horses, Walls 2 stone, and wonders 3 stone + 2 timber. Basic units and buildings never do.
- **Supply:** every 4 units that needed a good consume 1 of it per turn. Unsupplied units get −25% attack and −15% defense, and don't heal.
- **AI:** it values improvements on deposits it lacks, settles near ore and horses, and won't field armies its supply can't feed.

### Trade routes (`src/trade.js`)
- **Opening:** two tribes at peace open a route (an offer in Diplomacy; 1 + 1 per 4 cities each). The route is a real path between their nearest connected cities: over land, over shallow water once both have Sailing, and over ocean once both have Navigation. It can't cross land at war with either partner, foreign cities, or land a third tribe has **closed** to either partner.
- **Flow:** each round, goods flow automatically from surplus to deficit, up to 3 each way. A tribe keeps a reserve of 4 + 3× its army's supply need and imports up to reserve + 2.
- **Prices:** the buyer pays ore/horses 4 and timber/stone 2 per unit, plus a **toll** of 1 per unit to every tribe whose land is crossed. Upkeep is ⌈length / 8⌉ gold per side per round.
- **Raiding:** any unit at war with either partner standing on a route tile seizes that shipment (and earns grudges). Routes appear in the **Trade** map mode, with raided (!) or blocked (×) markers.
- **AI behaviour:**
  - it opens routes where it can buy or sell, and closes routes idle for 8 rounds;
  - it closes its land to tribes it loathes;
  - it sends idle armies to sit on enemy routes;
  - it gains +0.5 hostility per supplier toward anyone at war with a tribe it imports from;
  - it values enemy cities 40% more for each good they produce that it is starving for.
- **Effect in sims (8 tribes, large map, 100 turns):** 10–13 wars per game, against 5–7 with infinite goods, plus 19–65 raids and more alliances.

### Tributaries (`src/vassals.js`)
- **Forming:**
  - **Submission:** a tribe at war demands it (`offer 'vassal'`). The AI demands it after 5+ turns of war at 2× the enemy's power. A target accepts below 45% of the demander's power (60% for appeasers), or when it has lost 40% of its peak cities and is below 75%.
  - **Protection:** a weak tribe asks for it (`offer 'protect'`) when an enemy has 2× its power. The protector must not loathe it, must be able to face its enemies, and must gain goods or kinship. The protector joins the ward's wars.
- **Terms:** the vassal keeps its cities, people and unrest. Each turn it pays **25% of its gold income** and ships surplus goods the overlord lacks (up to 3) along a real, **raidable** tribute route. It follows its overlord's wars and peaces (vassals join wars the overlord declares, and an overlord's peace binds its vassals), can't conduct its own diplomacy beyond trade routes, and shares vision and passage like an ally.
- **Liberty desire (0–100) per turn:**
  - distance between capitals beyond 8 (up to +3);
  - foreign overlord +1.5, or kindred peoples −1;
  - tribute +1;
  - overlord's strength: weaker than the vassal +6, barely stronger +3, overwhelming −1.5;
  - shared enemies or protection −1.5.

  At 100 an AI vassal at least half its overlord's power declares independence (war). A human vassal may do so at any time.
- **Endings:** the overlord can **release** a vassal (peace) or **annex** it peacefully: it needs related peoples, or 30+ turns with liberty under 25. Annexed cities join without conquest shock, and the absorbed tribe shows as "absorbed" in the records. If an overlord falls, its vassals go free.
- **Power & victory:** dominance and coalitions use **bloc power** (own power + half of each vassal's) and never treat a vassal as the leader. An overlord whose only remaining rivals are its own vassals wins by conquest; vassals don't share the victory.
- **Map:** in political mode, a vassal's land is striped in its overlord's colour.
- **Sims (8 tribes, large map, 120 turns):** 11–18 vassalages, 1–4 annexations and 4–7 independence wars per game, with 6–8 vassals standing at the end.

### Peoples (cultures) & records
Peoples are separate from polities (`src/culture.js`), as in CK3, and names never exceed two parts.

| Situation | Pattern | Example |
|---|---|---|
| founding people | capital + own word for "people" | Mardu + *jana* → **Mardujana** |
| regional offshoot | major local city (level 4+) or land word, plus the parent's root | **Eskjana**, **Hilljana**; **Esk Hilljana** on a name clash |
| subjects of a foreign realm (label) | core combining form + ruler's name | **Esko-Mardujana** |
| independent after ≥15 turns of foreign rule | ruler's combining form + core name | **Mardu-Eskjana** (only the latest influence is kept) |

- **Roots:** each founding people gets a distinct word for "people" from 16 languages (*folk, volk, laos, narod, gens, jana, tauta, halk, ulus, kansa, tuath, mardom, bangsa, qaum, hito, dene*). Offshoots inherit it, so families read as families.
- **Divergence:** a tribe's own-culture city held 20+ turns and 8+ tiles from the capital has a 4% chance per turn to found a regional people. Neighbouring cities of the same region (within 3) join it. At most one new people per tribe per turn.
- **Effects:** same-family peoples are kin. A subject people gets +0.25 unrest sensitivity, a regional offshoot +0.1. Integration (25 turns, 15 with a Shrine) converts only peoples outside the ruler's family.
- **Revolts follow peoples:**
  - a regional city rises as its regional people;
  - a city of the ruler's own people founds a new offshoot named for the city;
  - a subject people rises under its own name, marked by its rulers if they held it 15+ turns.

  A people that rises again keeps its old identity, and rebellions merge only with related peoples.
- **Colours:** founding peoples take palette pairs. Offshoots get a 15–40° hue shift of the parent's fill, kept as far as possible from every other living people, plus their own border colour. Tribes wear their people's colours.
- **Map modes** (M): Terrain, Political, Culture (each people's colour; thick stripes show a people under foreign rule; thin lines show own people on foreign land), Specialty (unclaimed land shows what it would become), and Unrest. **Labels** (L, or the checkbox) name connected regions on every non-terrain mode.
- **Tribes screen:** sortable, with Peak cities, Founded and Fell columns, plus a **Peoples** table (word for "people", origin, cities, rulers).
- **Histomap:** each turn's power share, drawn as a classic Histomap with rebellions beside their parent. It's reachable from the Tribes screen, the leave dialog and the victory screen.

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

## Roadmap
See [`docs/ROADMAP.md`](docs/ROADMAP.md) for proposed next systems: diplomacy, tributaries, trade goods, cultural pull and resettling the wilds.

## Open design questions (not yet decided)
1. **Snowballing** is now dampened by unrest and the AI coalition. On large 8-tribe maps the top tribes end within about 15–17 cities of each other. Coalitions only steer the AI, though. A human leader feels them, but a human in a coalition gets no shared benefit (shared vision, a truce).
2. **Late-game gold still piles up.** Nine world wonders (one per land type, level 5+ city) now soak some of it, but all techs are usually researched by about turn 80–100. Unit upgrades or repeatable techs are the next candidates.
3. **Rebellions inherit the full tech tree** of their parent. With homeland bias applied they now stay small (1–5 cities in sims), but a late-game rebellion is still technologically mature on day one.
4. **Coastal threshold.** With 2 water neighbours, coastal cities dominated, so the threshold is now 3. Mixed tiles (a forest on the coast) still get only one identity. A primary/secondary specialty system is the obvious next step.
5. **Gold is now tight for the AI** (0–100 at turn 100), since food pulls spending into farms, which is the reverse of the old balloon. **Luxuries are rarely traded** because nobody has a surplus: supply is below demand everywhere. **Bronze is the bottleneck:** bronze units are rare (about 25–40 swordsmen per large game), and armies lean on goods-free units. Workshop rate and metal density are the tuning levers. **Late-game AI treasuries balloon**, often to thousands of gold, now that peace and trade let economies run. More sinks are needed (wonders scaled to treasury, unit upgrades), or the AI should declare more wars of opportunity.
6. **AI cheats slightly.** It knows enemy unit positions near its units without fog checks.
