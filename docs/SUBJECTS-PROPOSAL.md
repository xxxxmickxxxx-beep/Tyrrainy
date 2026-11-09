# Proposal: managing subjects

Status: **built**. See README › Tributaries for the rules as implemented. Decisions taken:
- 30% of the resentment from a free-hand subject's aggression falls on its overlord.
- Submitting imposes a truce on the new subject's wars with its fellow subjects.
- **Victory:** subjects at any depth count toward a conquest win. Disloyal subjects form **conspiracies** (liberty 50+) that rise together once they reach 80% of the overlord's strength.
- **Grants and clients:** subjects can release their own clients, so grants can't be refused.
- **Refusing terms:** any subject, human or AI, can refuse tightened terms by going to war. An AI subject's answer is previewed as a clear yes or no and given instantly; a human subject answers on its turn.

Changed during tuning:
- Conspiring is +0.5 liberty a turn, not +1.
- No tribute is −1.5, and subsidies give −0.5 per tier, so a conspirator can be bought back.
- The AI releases about-to-revolt cities only if they're recent conquests, so rebellions still happen.

Original proposal below.

## What exists today
- A vassal (subject) keeps its cities and pays 25% of its gold, plus surplus goods along a raidable route.
- It follows its overlord into every war and has no foreign policy of its own. It can't declare war, make peace or make offers.
- Liberty desire rises from distance, foreign culture, tribute and the overlord's relative weakness. It falls with kinship, shared enemies and protection. At 100 the subject breaks free.

**Bug found while designing this.** Two tribes that submit to the same overlord while at war with each other stay at war forever: neither may make peace, and nothing makes them. In three 120-turn sims, 25 of 49 sampled co-subject pairs were at war, with 30–195 attacks between co-subjects per game. So subject-on-subject wars already happen, but they are permanent and nobody controls them.

## 1. Terms of subjection (per subject, set by the overlord)
| Lever | Settings | Liberty per turn | Effect |
|---|---|---|---|
| **Tribute** | None / Light 15% / Standard 25% / Heavy 40% | −1 / +0.5 / +1 / +2.5 | Gold tribute share. Goods tribute only at Standard or above. |
| **Subsidy** | none / 3 / 6 / 10 gold a turn, paid to the subject | −0.5 for any subsidy | The AI subject spends it like any gold: hurrying units and buildings. |
| **War rights** | Bound (today's rule) / Free hand | Bound +1, Free hand 0 | A free subject may declare war and make peace with anyone except its overlord and the overlord's allies, its fellow subjects included. Its own wars don't drag the overlord in. It still follows the overlord's wars. |
| **Arbitrate** | action, between two of your subjects at war | winner + (10 + 40 × edge); loser −10 | Imposes a 10-turn truce. *Edge* is a war score: cities taken from each other during this war, plus the power ratio. Forcing peace on the side that's winning is what costs. |

Today's rules are Standard tribute, no subsidy and Bound, so the current liberty math stays the baseline. The only change is the +1 for being Bound. Without it, Free hand would cost nothing.

**Why these levers pull against each other** (this is the "prop up the weaker one" game):
- The existing "overlord is barely stronger / weaker" liberty term is the counterweight. Subsidising a subject or letting it win wars raises its power ratio, and its liberty with it.
- So against a strong subject fighting a weak one, the options are:
  - **Arbitrate:** the strong one's liberty spikes.
  - **Subsidise the weak one:** the war grinds on and the strong one stays busy and small.
  - **Bind the strong one:** liberty rises, but it can't start new wars.
  - **Heavy tribute on the strong one:** drains it, but liberty rises fast.
- Each lever is cheap in one currency and expensive in another.

**AI overlord policy (simple, per subject each turn):**
- **Threat** = the subject's power ÷ yours, together with its liberty.
- **Strong subjects** (ratio > 0.5 or liberty > 60): Bound, with Light tribute.
- **Weak subjects:** Free hand, with Standard tribute.
- **A weak subject at war with a strong co-subject:** subsidised, if the treasury allows.
- **Arbitrate:** only when it's cheap (the winner is weak relative to you), or when the loser is about to fall and its fall would push the winner's ratio past 0.6.

**AI subject policy:** a free-hand subject uses the normal war and peace logic, restricted to legal targets.

## 2. Subjects from conquest
On capturing a city, the dialog offers **Keep / Raze / Release as client / Grant to a subject**.
- **Release as client:** the city becomes a new tribe, your subject from the start. It uses the rebellion machinery: the local people, a homeland on the city's specialty, and naming.
  - Starting liberty: low if its people are kin to yours, high if they're kin to the tribe you took the city from.
  - It inherits your wars, so it is at war with the former owner.
- **Grant to a subject:** the city joins an existing subject within about 8 tiles. Unrest then uses *that subject's* culture. Handing a Gaulic city to your Gaulic client is the elegant use: no conquest shock for a foreign regime.

**The trade-off the existing systems already create:**
- **One strong client holds land well:** it can garrison, it resists rebels and outsiders. But its power ratio, and so its liberty, climbs.
- **Several weak clients stay loyal**, but get picked off by rivals or by rebellions. If they're free-hand, they may also fight each other, which feeds back into part 1.

**AI on capture:** currently `razeAdvice` chooses keep or raze. The new branch:
- **When:** keeping the city would likely lead to revolt (pressure × sensitivity above its compliance capacity) and razing scores poorly.
  - **Grant to a kin subject** in range, if its ratio stays under 0.5 afterwards.
  - Otherwise **release a new client**, if the city is level 2 or more.
  - Otherwise **keep** it.
- **Capping clients:** each extra client adds an independence risk, so the AI weighs the number of subjects it already has.

## Open questions (decisions needed)
1. **Blame for a subject's wars.** Should a free subject's aggression draw grudges onto its overlord (a fraction, say 30%)? I'd say yes. Otherwise Free hand is a deniable proxy-war tool with no reputation cost.
2. **Existing co-subject wars.** When a tribe submits, should its wars with fellow subjects become truces automatically, as part of submitting? Or should they stay open for the overlord to arbitrate? I'd make it automatic: the overlord accepting a submission is the natural point to impose peace. Arbitration is then for wars that start later between free-hand subjects.
3. **Can a subject refuse a grant?** A subject near its liberty threshold might treat an unwanted, restless city as a burden (+liberty). Simple version: grants are always accepted, and the city's unrest is the subject's problem.
4. **Human subjects.** In hotseat, a human subject would have its terms set by another human. Are terms enforced, or advisory? Today a human vassal can't be annexed. I'd enforce terms but keep that rule.
5. **Clients and conquest victory.** Clients count toward your conquest win, as vassals already do. Releasing every conquered city as a client becomes a fast, low-unrest path to victory, held back only by the risk of independence. Acceptable, or should a conquest win require holding a share of cities directly?

## Scope
About one session for the terms and arbitration (vassals.js, a subject panel in the diplomacy screen, AI for both sides). About one session for conquest clients and grants (the capture dialog, a tribe-creation path shared with rebellions, AI).
