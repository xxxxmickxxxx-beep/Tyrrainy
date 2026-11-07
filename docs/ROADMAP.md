# Roadmap: from fortified blocs to a living world

## The problem
Homeland bias, sensitivity-scaled unrest, war damage and razing all make holding foreign land expensive. That's intended, but it leaves conquest as the only way tribes interact. The rational equilibrium is self-contained cultural blocs separated by razed buffer zones. The sims already show it: in war-heavy games the AI razes 20+ alien cities.

The fix is not to make conquest cheaper. It is to give tribes **other ways to get value from foreign land and foreign peoples**, and to make sure dead zones don't stay dead.

Below, the proposals are ordered by how much they open the game up per unit of work. Each one reuses existing systems: hostility weights, grudges, unrest, culture and the Histomap.

---

## 1. Diplomatic states (the foundation, small)
Each pair of tribes is in one of four states: **War**, **Truce** (a fixed number of turns), **Peace** or **Alliance**.
- Units can't attack or enter the territory of tribes at peace. Zones of control don't apply between them.
- **AI:** it already computes `hostility()`. It offers peace when hostility toward a neighbour stays low for a few turns, and declares war when hostility passes a threshold. That threshold is per temperament: opportunists are trigger-happy, appeasers are slow.
- **Coalition members** become actual alliances: shared vision, and a war with the leader drags in the others.
- **Breaking a treaty** adds a grudge from every tribe that knows you. This is the first "reputation", and it falls out of the grudge system for free.
- **UI:** a column in the Tribes screen with offer and declare buttons. In hotseat, offers between humans go through the pass screen.

Why first: everything below needs "not at war" to mean something.

## 2. Tributaries / indirect rule (medium; the direct answer to dead zones)
When a tribe is badly beaten (it has lost most of its power, or its capital is under siege), the victor can demand **vassalage** instead of conquering its cities.
- **The tributary keeps its cities, its culture and its own unrest.** That costs the overlord nothing in unrest.
- It pays tribute, say 25% of its income. It joins the overlord's wars, and can't make war or peace on its own.
- **Liberty desire** is unrest at the tribe level. It rises with the overlord's distance, cultural distance, and the overlord's weakness relative to the vassal. It falls with time, kinship and shared enemies. Past a threshold, the vassal declares independence.
- A tributary that gets culturally close (homeland kinship, many turns) can be **peacefully annexed**. Its cities join without the conquest shock.

This makes alien land valuable without owning it, and turns a war's end into a political choice instead of raze-or-garrison. It also makes the Histomap far more interesting: vassal streams can be drawn hatched inside their overlord's.

## 3. Trade goods (medium-small; peaceful interdependence)
Each specialty produces a good once its specialty building exists: grain (plains), stone (hilltop), salt fish (coastal), cloth (riverside), timber (forest), spice (desert), horses (steppe), peat or reeds (marsh), and ore (mountain).
- **Owning or trading for a good** gives an empire-wide bonus. For example, horses make mounted units −1 cost, grain gives +1 pop on founding, and spice gives +1 gold in every level 3+ city.
- **Trade agreements** need Peace. Each side sends a good, and both earn gold scaled by distance and cultural difference. Trading with very different peoples pays most.
- **War cuts trade.** That is a real, felt cost of war for both sides, so peace is economically valuable.

Homeland bias makes alien specialty buildings hard for you to build, so trade is the natural way to get what your culture can't. No caravans or roads are needed: trade is a treaty with a fixed yield.

## 4. Cultural pull and defection (small; non-violent border change)
Every city projects **influence** onto foreign cities within about 4 tiles. Influence comes from level, wonders and Shrines, and is multiplied by kinship with the target city's land and culture.
- A restless city whose strongest pull comes from a kin neighbour may **defect** to that neighbour instead of founding a rebellion. It goes with no sack and no conquest shock.
- Borders then move toward cultural lines over time, which pairs naturally with the Culture map mode.
- A cheap counter-play already exists: compliance buildings, subsidies and garrisons.

## 5. Resettling the wilds (small; keeps dead zones from staying dead)
Ruins and unclaimed land slowly regrow.
- After about 15 turns, a razed site may spawn a **free town**: a minor neutral city of the local specialty that doesn't expand.
- Free towns can be traded with, vassalized, absorbed by cultural pull or conquered.
- Naming is already in place: a free town would be a new people named for its land or ruin site (`newCulture({ base: LAND_BASE[spec], root })`). Its root would come from the nearest people, as an offshoot that went its own way, or be a fresh root if it's far from everyone.
- Rebellions that lose momentum can settle into the same role.

## Suggested order and scope
| Step | System | Scope | Unlocks |
|---|---|---|---|
| 1 | Diplomatic states | ~1 session | peace as a real state; reputation via grudges |
| 2 | Trade goods | ~1 session | reasons to stay at peace; why alien land matters |
| 3 | Tributaries | 1–2 sessions | indirect rule; war ends with politics |
| 4 | Cultural pull | <1 session | peaceful border drift; defections |
| 5 | Free towns | <1 session | dead zones refill |

## Deliberately out of scope
- **Per-tile yields and a full resource economy.** They add a lot of UI and balance work for little narrative gain. Goods stay abstract, one per specialty.
- **Caravans, roads and pathing-based trade.**
- **Free-form diplomacy text or bargaining tables.** The AI accepts or declines offers based on hostility.

## Open questions
1. **Hotseat diplomacy:** do humans negotiate via the pass screen, or should human-to-human deals stay manual (honour system)?
2. **Shared victory:** should vassals share their overlord's victory, or does a vassal still "lose"? This affects whether humans would ever accept vassalage.
3. **Rival goods:** should two tribes producing the same good compete on price? The simple version just ignores duplicates.
