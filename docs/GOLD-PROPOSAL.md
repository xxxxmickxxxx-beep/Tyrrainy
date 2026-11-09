# Proposal: what gold is for

Status: decisions taken (all recommendations accepted). **All three phases are implemented**, plus technology upkeep. Phase 3 dropped the one-build-per-turn cap in favour of an escalating hurry price, and kept army upkeep as it was (sims showed gold was plentiful). Open: late-game labor and gold have nothing left to buy; that needs content (late projects, unit upgrades).

## The problem today
Gold is a universal converter. Every system eventually turns into "how much gold per turn".

| Gold comes from | Gold goes to |
|---|---|
| City taxes (1 + 0.6×level, culture, specialty, buildings, wonders) | Training **every** unit |
| Selling goods on trade routes, tolls | **Every** building and wonder |
| Tribute from vassals | **Research** (all techs) |
| Ruins | **Every** tile improvement, and repairs |
| | Festivals, subsidies, unit upkeep, route upkeep, buying goods, tribute paid |

The symptoms we've seen all follow from this:
1. **Swings between hoarding and starvation.** Before food existed, AI treasuries reached thousands of gold. Once farms competed for the same pool, they collapsed to 0–100. Any new sink or source re-tunes the whole game, because everything competes for one number.
2. **Growth, tech and armies trade off 1:1.** A farm, a tech and a swordsman are interchangeable gold amounts. There's no sense that a city *makes* things, a scholar *learns* things and a treasury *buys* things.
3. **Tech pace follows wealth directly.** Rich empires out-research everyone, which strengthens the snowball that unrest, coalitions and tributaries all exist to dampen.
4. **Geography stops at goods.** Goods are tied to places, but the gold that does most of the work isn't. A big city and a small one contribute to the same treasury, and anything can be bought anywhere instantly.

## Proposal: four resources, each with one job

| Resource | Where it lives | Its job |
|---|---|---|
| **Labor** (new) | per city, local | *Making* things: units, buildings, improvements, repairs, wonders |
| **Goods** (existing) | national stockpile, needs connection | *Materials* those things require |
| **Knowledge** (new) | national | *Learning*: research |
| **Gold** (narrowed) | national treasury | *Liquidity and influence*: upkeep, loyalty, trade, tribute, hurrying |

In short: **cities make, goods enable, knowledge advances, gold smooths and persuades.**

### 1. Labor: local making power
- **Rate:** each city produces `1 + level` labor per turn into its own pool. The pool is capped at 4× the rate, so a city can't stockpile forever. The capital and the specialty building each add +1.
- **Spending:** all construction costs labor instead of gold, spent from **the city doing the work**: units and buildings from the city itself, and improvements from the city that owns the tile. Current gold costs carry over 1:1 as labor costs to start.
- **Feel:** actions stay **instant**. Click "train" or "build" and it happens if that city's pool covers it. There are no build queues, so the current quick feel and the AI's spend loop both survive.
- **Why local:** big, developed cities build armies and wonders, while frontier towns can barely afford a farm. Losing a core city now costs *capacity*, not just income, and sieges hurt doubly, since they starve the city and stall its works.
- **Hurrying:** you can top up a shortfall with **gold at 3 per missing labor point**. This is gold's big, open-ended sink: rich realms buy speed, not extra stuff.

### 2. Knowledge: research separated from wealth
- **Sources:** each city adds 0.5×level per turn. Shrines and Markets add +2. Each active trade route adds +1, or +2 if the partner's people is unrelated (ideas travel with goods and between peoples). Philosophy multiplies by 1.25. Vassals pass 25% of their knowledge to their overlord, alongside the gold tribute.
- **Costs:** tech costs keep their current formula, still rising with city count, so sprawl still slows learning. They're paid in knowledge.
- **Effect:** trade and contact now speed up research. Isolated or embargoed realms fall behind, and a big rich empire no longer converts wealth straight into technology.

### 3. Gold: liquidity and influence
- **Sources:** taxes (the current formula, slightly reduced), selling goods, tolls, tribute.
- **Sinks:**
  - army upkeep: 1 gold per 2 units beyond 2 per city (gentler than today, since units now also cost labor);
  - subsidies, festivals, route upkeep;
  - buying goods, and paying tribute;
  - **hurrying construction** (3 gold per labor point);
  - later, diplomatic payments: buying peace, paying a protector, subsidising an ally's war.
- **Effect:** a large treasury becomes *flexibility*. You can rush an army where it's needed, keep restless provinces quiet, outbid rivals for scarce bronze, or buy a peace. Hoarding loses its pull, because the hurry sink has no ceiling. A thin treasury now means you can't respond to crises, not that you can't grow at all.

## What changes for the AI
- **Spending:** the spend loop keeps its structure, but each purchase checks the *city's* labor (and goods) instead of the national gold. Research becomes "buy the best affordable tech with knowledge".
- **Gold policy:** keep a reserve for upkeep and subsidies; hurry when threatened (an enemy near a city, a war just declared) or when a wonder race is on; otherwise buy scarce goods.
- **Settlers:** they become a big labor cost in a developed city, so expansion naturally comes from mature cores.

## What changes for players
- **City panel:** shows the labor pool (e.g. "Labor 7/16, +4/turn"). Buttons show labor cost, goods, and the gold to hurry any shortfall.
- **Top bar:** gains knowledge (+N/turn). The tech screen shows knowledge costs.
- **Tile improvements:** spend the owning city's labor, so improving a frontier city's land is slow unless you hurry it with gold.

## Expected effects (to be checked in sims)
- Treasuries stop swinging, because no single pool feeds everything.
- Wealthy but small realms (trade hubs, toll-takers, tribute collectors) gain influence and speed, not size.
- Large, developed cores out-produce frontiers, while the anti-snowball systems (unrest, coalitions, tributary liberty) still bite.
- Trade and contact carry ideas, giving another peaceful reason to open routes.

## Phasing
1. **Knowledge** (small, low risk): research moves from gold to knowledge. Gold costs simply disappear from techs.
2. **Labor** (medium): local pools, construction moves to labor, gold hurrying, UI and AI updates, then retune costs.
3. **Gold retune** (small): lower taxes, gentler upkeep, AI hurry and reserve policy. Then diplomatic payments as content.

Each phase is playable on its own and checked in sims before the next.

## Decisions needed
1. **Instant purchases from local labor pools, or Civ-style build queues?** I recommend instant purchases from pools, which keeps the current feel and AI structure. Queues add micromanagement and a large UI and AI rewrite.
2. **Should improvements use the owning city's labor?** I recommend yes: it ties growth to local capacity. The alternative is a national "works" pool, which is simpler but loses geography.
3. **Should trade and contact feed knowledge?** I recommend yes: it's the cheapest new reason to trade that doesn't touch goods balance.
4. **Hurry price:** 3 gold per labor point is a starting point. Too cheap brings back "gold buys everything"; too dear makes gold pointless. It needs sims.
5. **Do settlers also cost the founding city a level?** That's the classic anti-sprawl lever. I'd **hold off**, since unrest and tech costs already restrain expansion; revisit after phase 2.
