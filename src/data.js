// All static game data: terrains, specialties, affinity, units, techs, buildings.

export const TERRAIN = {
  ocean:    { name: 'Ocean',    water: true, deep: true, move: 1, def: 1.0, color: '#1d4e7a' },
  shallows: { name: 'Shallows', water: true, move: 1, def: 1.0, color: '#2f78a8' },
  plains:   { name: 'Plains',   move: 1, def: 1.0, color: '#9cc35a' },
  steppe:   { name: 'Steppe',   move: 1, def: 1.0, color: '#c9c27a' },
  desert:   { name: 'Desert',   move: 1, def: 0.9, color: '#e3cf8d' },
  forest:   { name: 'Forest',   move: 2, def: 1.25, color: '#3f7f3a' },
  marsh:    { name: 'Marsh',    move: 2, def: 1.1, color: '#5f7d5a' },
  hills:    { name: 'Hills',    move: 2, def: 1.5, color: '#a3925a' },
  mountain: { name: 'Mountain', move: 3, def: 1.8, color: '#8a8580', climb: true },
};

// Specialty a city takes from the land it is founded on.
export const SPECIALTY = {
  plains: {
    name: 'Plains', title: 'Breadbasket', color: '#9cc35a',
    desc: 'Farms yield +1 extra pop. Grows fast.',
    unit: 'lancer', building: 'granary',
  },
  hilltop: {
    name: 'Hilltop', title: 'Stronghold', color: '#b39a55',
    desc: 'City defense x1.5 more, +1 vision. Mines +1 pop.',
    unit: 'slinger', building: 'watchtower',
  },
  coastal: {
    name: 'Coastal', title: 'Port', color: '#3b8fc4',
    desc: 'Only coastal cities build warships. Fisheries +1 gold.',
    unit: 'corsair', building: 'harbor',
  },
  riverside: {
    name: 'Riverside', title: 'Trade Hub', color: '#5fb3d6',
    desc: '+1 gold per turn. River farms flourish.',
    unit: 'pikeman', building: 'market',
  },
  forest: {
    name: 'Forest', title: 'Woodland Hold', color: '#3f7f3a',
    desc: 'Lumber camps +1 gold. Ambushers.',
    unit: 'ranger', building: 'sawmill',
  },
  desert: {
    name: 'Desert', title: 'Oasis Town', color: '#e3cf8d',
    desc: '+1 gold per turn, slow growth. Fast raiders.',
    unit: 'camel', building: 'caravanserai',
  },
  steppe: {
    name: 'Steppe', title: 'Horde Camp', color: '#c9c27a',
    desc: 'Pastures +1 pop. Mounted units trained here start veteran.',
    unit: 'horsearcher', building: 'stables',
  },
  marsh: {
    name: 'Marsh', title: 'Fen Hold', color: '#5f7d5a',
    desc: 'Attackers suffer -25% when assaulting. Units heal +2.',
    unit: 'bogstalker', building: 'peatworks',
  },
  mountain: {
    name: 'Mountain', title: 'Eyrie', color: '#8a8580',
    desc: 'Near-impregnable. Mines +1 gold.',
    unit: 'highlander', building: 'deepmine',
  },
};

export const SPECIALTY_KEYS = Object.keys(SPECIALTY);

// Kinship graph between specialties. Distance in this graph decides how well a
// tribe can make use of a city: 0 = homeland, 1 = kin, 2 = foreign, 3+ = alien.
export const KIN_EDGES = [
  ['plains', 'steppe'], ['plains', 'riverside'], ['plains', 'forest'],
  ['riverside', 'coastal'], ['riverside', 'marsh'], ['coastal', 'marsh'],
  ['forest', 'marsh'], ['forest', 'hilltop'], ['hilltop', 'mountain'],
  ['hilltop', 'steppe'], ['steppe', 'desert'], ['desert', 'mountain'],
];

export const KIN_DIST = (() => {
  const adj = {};
  for (const k of SPECIALTY_KEYS) adj[k] = [];
  for (const [a, b] of KIN_EDGES) { adj[a].push(b); adj[b].push(a); }
  const dist = {};
  for (const s of SPECIALTY_KEYS) {
    dist[s] = { [s]: 0 };
    const q = [s];
    while (q.length) {
      const cur = q.shift();
      for (const n of adj[cur]) if (dist[s][n] === undefined) { dist[s][n] = dist[s][cur] + 1; q.push(n); }
    }
  }
  return dist;
})();

export const AFFINITY = [
  { name: 'Homeland', short: 'Home', gold: +1, unitCost: -1, color: '#7ddc6a' },
  { name: 'Kin land', short: 'Kin', gold: 0, unitCost: 0, color: '#c8e070' },
  { name: 'Foreign land', short: 'Foreign', gold: -1, unitCost: +2, color: '#e0a050' },
  { name: 'Alien land', short: 'Alien', gold: -2, unitCost: +3, color: '#e05050' },
];

// ---------------- Units ----------------
// traits: mounted, ranged handled by rng>1, skirmish (can move after attacking),
// forestwalk/marshwalk/desertwalk/mountainwalk (terrain costs 1, climbs),
// stealth (hidden in marsh unless adjacent), naval (water only), settler, antimount
export const UNITS = {
  warrior:   { name: 'Warrior',   atk: 2, def: 2, hp: 10, mv: 1, rng: 1, cost: 2, glyph: 'W' },
  settler:   { name: 'Settler',   atk: 0, def: 1, hp: 10, mv: 1, rng: 1, cost: 5, glyph: 'S', traits: ['settler'] },
  archer:    { name: 'Archer',    atk: 2, def: 1, hp: 10, mv: 1, rng: 2, cost: 3, glyph: 'A', tech: 'archery' },
  rider:     { name: 'Rider',     atk: 2, def: 1, hp: 10, mv: 2, rng: 1, cost: 3, glyph: 'R', tech: 'riding', traits: ['mounted'], needs: { horses: 1 } },
  defender:  { name: 'Defender',  atk: 1, def: 3, hp: 15, mv: 1, rng: 1, cost: 3, glyph: 'D', tech: 'masonry' },
  swordsman: { name: 'Swordsman', atk: 3, def: 3, hp: 15, mv: 1, rng: 1, cost: 5, glyph: 'X', tech: 'bronze', needs: { bronze: 1 } },
  catapult:  { name: 'Catapult',  atk: 4, def: 0, hp: 10, mv: 1, rng: 3, cost: 8, glyph: 'C', tech: 'engineering', needs: { timber: 2 } },
  knight:    { name: 'Knight',    atk: 3.5, def: 1, hp: 15, mv: 3, rng: 1, cost: 8, glyph: 'K', tech: 'chivalry', traits: ['mounted'], needs: { bronze: 1, horses: 1 } },
  // specialty uniques
  lancer:     { name: 'Lancer',      atk: 4, def: 1, hp: 12, mv: 2, rng: 1, cost: 5, glyph: 'L', tech: 'riding', traits: ['mounted'], unique: 'plains', needs: { horses: 1 } },
  slinger:    { name: 'Slinger',     atk: 2, def: 1, hp: 8,  mv: 1, rng: 2, cost: 3, glyph: 's', unique: 'hilltop', traits: ['hillwalk'] },
  corsair:    { name: 'Corsair',     atk: 3, def: 2, hp: 12, mv: 3, rng: 1, cost: 6, glyph: 'Q', tech: 'sailing', traits: ['naval'], unique: 'coastal', needs: { timber: 2 } },
  pikeman:    { name: 'Pikeman',     atk: 2, def: 3, hp: 12, mv: 1, rng: 1, cost: 4, glyph: 'P', tech: 'bronze', traits: ['antimount'], unique: 'riverside', needs: { bronze: 1 } },
  ranger:     { name: 'Ranger',      atk: 3, def: 1, hp: 10, mv: 1, rng: 2, cost: 5, glyph: 'G', tech: 'archery', traits: ['forestwalk'], unique: 'forest' },
  camel:      { name: 'Camel Raider',atk: 3, def: 1, hp: 12, mv: 3, rng: 1, cost: 5, glyph: 'M', tech: 'riding', traits: ['mounted', 'desertwalk'], unique: 'desert' },
  horsearcher:{ name: 'Horse Archer',atk: 2, def: 1, hp: 10, mv: 2, rng: 2, cost: 5, glyph: 'H', tech: 'riding', traits: ['mounted', 'skirmish'], unique: 'steppe', needs: { horses: 1 } },
  bogstalker: { name: 'Bog Stalker', atk: 3, def: 1, hp: 10, mv: 2, rng: 1, cost: 4, glyph: 'B', traits: ['marshwalk', 'stealth'], unique: 'marsh' },
  highlander: { name: 'Highlander',  atk: 2, def: 4, hp: 15, mv: 1, rng: 1, cost: 5, glyph: 'U', tech: 'masonry', traits: ['mountainwalk', 'hillwalk'], unique: 'mountain', needs: { bronze: 1 } },
};

export const EMBARKED = { name: 'Boat', atk: 1, def: 1, mv: 2, rng: 1 };

// ---------------- Improvements ----------------
// pop: growth given to owning city; gold: one-off? no -> permanent income bonus
export const IMPROVEMENTS = {
  farm:     { name: 'Farm',        terrain: ['plains', 'steppe'], tech: 'agriculture', cost: 4, pop: 1 },
  irrigate: { name: 'Irrigation',  terrain: ['desert'], tech: 'irrigation', cost: 4, pop: 1, needRiverOrOasis: true },
  pasture:  { name: 'Pasture',     terrain: ['steppe', 'plains', 'hills'], tech: 'husbandry', cost: 4, pop: 1, resource: ['horses', 'sheep'] },
  plantation: { name: 'Plantation', terrain: ['desert', 'forest'], tech: 'irrigation', cost: 5, pop: 1, resource: 'spices', requires: true },
  lumber:   { name: 'Lumber Camp', terrain: ['forest'], tech: 'forestry', cost: 4, pop: 1 },
  hunt:     { name: 'Hunting Lodge', terrain: ['forest'], tech: null, cost: 2, pop: 1, resource: 'game', consume: true },
  gather:   { name: 'Forage',      terrain: ['plains', 'steppe', 'desert', 'marsh', 'hills'], tech: null, cost: 2, pop: 1, resource: 'fruit', consume: true },
  mine:     { name: 'Mine',        terrain: ['hills', 'mountain'], tech: 'mining', cost: 5, pop: 2, resource: ['copper', 'tin'] },
  quarry:   { name: 'Quarry',      terrain: ['hills'], tech: 'mining', cost: 4, pop: 1 },
  fishery:  { name: 'Fishery',     terrain: ['shallows'], tech: 'fishing', cost: 3, pop: 1, resource: 'fish', requires: true },
  whaling:  { name: 'Whaling',     terrain: ['ocean'], tech: 'navigation', cost: 5, pop: 2, resource: 'whales', requires: true },
  reedbeds: { name: 'Reed Beds',   terrain: ['marsh'], tech: 'drainage', cost: 4, pop: 1 },
};

export const RESOURCES = {
  fruit:  { name: 'Wild Fruit', color: '#e44f6f' },
  game:   { name: 'Game',       color: '#a0673a' },
  horses: { name: 'Horses',     color: '#6a4a2a' },
  copper: { name: 'Copper',     color: '#d07a3a' },
  sheep:  { name: 'Sheep',      color: '#f4f0e0' },
  spices: { name: 'Spices',     color: '#c03050' },
  tin:    { name: 'Tin',        color: '#a8b8c4' },
  fish:   { name: 'Fish',       color: '#e0f0ff' },
  whales: { name: 'Whales',     color: '#b0c8e0' },
  oasis:  { name: 'Oasis',      color: '#30b0a0' },
  wheat:  { name: 'Wheat',      color: '#f0d050' },
};

// ---------------- Buildings ----------------
export const BUILDINGS = {
  walls:        { name: 'Walls', cost: 6, tech: 'masonry', desc: 'City defense x2 (stacks with specialty).', needs: { stone: 2 } },
  weaver:       { name: 'Weaver', cost: 6, tech: 'husbandry', needs: { timber: 1 }, desc: 'Weaves up to 2 wool into 2 cloth each turn.' },
  bronzeworks:  { name: 'Bronze Workshop', cost: 8, tech: 'bronze', needs: { stone: 1 }, desc: 'Smelts up to 2 copper + 2 tin into 2 bronze each turn.' },
  courthouse:   { name: 'Courthouse', cost: 5, calm: 1, desc: '-1 unrest pressure.' },
  amphitheater: { name: 'Amphitheater', cost: 9, tech: 'masonry', calm: 2, desc: '-2 unrest pressure.', needs: { stone: 2 } },
  temple:       { name: 'Shrine', cost: 8, tech: 'philosophy', calm: 2, desc: '+1 pop, +1 gold, -2 unrest. Integration twice as fast.', needs: { stone: 1 } },
  granary:      { name: 'Granary', cost: 6, special: 'plains', desc: '+2 pop; doubles the city\'s food.' , pop: 2, needs: { timber: 1 } },
  watchtower:   { name: 'Watchtower', cost: 5, special: 'hilltop', desc: '+2 vision, city defense +50%; doubles the city\'s stone.', needs: { stone: 1 } },
  harbor:       { name: 'Harbor', cost: 7, special: 'coastal', desc: '+2 gold per turn.', gold: 2, needs: { timber: 2 } },
  market:       { name: 'Market', cost: 8, special: 'riverside', desc: '+1 gold per 2 city levels.', needs: { stone: 1 } },
  sawmill:      { name: 'Sawmill', cost: 6, special: 'forest', desc: '+1 gold per lumber camp; doubles the city\'s timber.' },
  caravanserai: { name: 'Caravanserai', cost: 7, special: 'desert', desc: '+2 gold, +1 pop; doubles the city\'s spice.', gold: 2, pop: 1 },
  stables:      { name: 'Stables', cost: 6, special: 'steppe', desc: 'Mounted units cost -1, +1 pop; doubles the city\'s horses.', pop: 1, needs: { timber: 1 } },
  peatworks:    { name: 'Peat Works', cost: 6, special: 'marsh', desc: '+1 gold per marsh tile in territory (max 3).' },
  deepmine:     { name: 'Deep Mine', cost: 8, special: 'mountain', desc: '+3 gold per turn; doubles the city\'s copper and tin.', gold: 3, needs: { timber: 1 } },
};

// ---------------- Strategic goods ----------------
// Goods come from places: an improvement on the right tile yields 1 unit per turn into the
// tribe's national stockpile, if its city is connected to the capital. They are spent to
// train advanced units and raise buildings (hard requirements; basic units and buildings
// never need goods). Stockpiles are capped; surplus beyond the cap is lost.
export const STRATEGIC = {
  food:   { name: 'Food',   short: 'Fd', color: '#e8c84a', cityCap: 4, kind: 'sustenance', from: 'Farms, Irrigation, Fisheries, Whaling and Reed Beds' },
  copper: { name: 'Copper', short: 'Cu', color: '#d07a3a', kind: 'arms', from: 'a Mine on a copper deposit (hills, mountains)' },
  tin:    { name: 'Tin',    short: 'Sn', color: '#a8b8c4', kind: 'arms', from: 'a Mine on a tin deposit (hills, mountains), rarer and far from copper' },
  bronze: { name: 'Bronze', short: 'Br', color: '#c89a3a', kind: 'arms', from: 'a Bronze Workshop smelting copper + tin' },
  horses: { name: 'Horses', short: 'Hr', color: '#9a6a3a', kind: 'arms', from: 'a Pasture on a horse herd (steppe)' },
  timber: { name: 'Timber', short: 'Tb', color: '#4f9a4a', kind: 'build', from: 'a Lumber Camp in a forest' },
  stone:  { name: 'Stone',  short: 'St', color: '#d8c8a0', kind: 'build', from: 'a Quarry on hills' },
  wool:   { name: 'Wool',   short: 'Wo', color: '#efe6cf', kind: 'luxury', from: 'a Pasture on sheep (hills, steppe)' },
  cloth:  { name: 'Cloth',  short: 'Cl', color: '#8a6ad0', kind: 'luxury', from: 'a Weaver weaving wool' },
  spice:  { name: 'Spice',  short: 'Sp', color: '#d0405a', kind: 'luxury', from: 'a Plantation on rare spice deposits (desert, forest)' },
};
export const LUXURIES = ['cloth', 'spice'];
export const GOOD_KEYS = Object.keys(STRATEGIC);
// Processing: a building in a connected city turns inputs from the stockpile into a product.
// Add entries here to extend production chains.
export const RECIPES = {
  bronze: { inputs: { copper: 1, tin: 1 }, building: 'bronzeworks', rate: 2 },
  cloth:  { inputs: { wool: 1 }, building: 'weaver', rate: 2 },
};
export const INPUT_GOODS = new Set(Object.values(RECIPES).flatMap(r => Object.keys(r.inputs)));
// improvement -> good it yields: fixed, or chosen by the tile's resource
export const IMP_YIELD = {
  mine: { byRes: { copper: 'copper', tin: 'tin' } }, pasture: { byRes: { horses: 'horses', sheep: 'wool' } },
  lumber: { good: 'timber' }, quarry: { good: 'stone' }, plantation: { good: 'spice', res: 'spices' },
  farm: { good: 'food' }, irrigate: { good: 'food' }, fishery: { good: 'food' }, whaling: { good: 'food' }, reedbeds: { good: 'food' },
};
export function impYield(imp, res) {
  const y = IMP_YIELD[imp];
  if (!y) return null;
  if (y.byRes) return y.byRes[res] || null;
  if (y.res && res !== y.res) return null;
  return y.good;
}
// specialty buildings that double goods produced in their city
export const GOOD_DOUBLER = { deepmine: ['copper', 'tin'], stables: ['horses'], sawmill: ['timber'], watchtower: ['stone'], granary: ['food'], caravanserai: ['spice'] };
export function resMatches(I, res) { return Array.isArray(I.resource) ? I.resource.includes(res) : I.resource === res; }

// ---------------- Subsidies ----------------
// Escalating ways to buy calm in a city. Every tier stops the city paying taxes;
// higher tiers also draw on the treasury each turn.
export const SUBSIDIES = [
  { name: 'None', calm: 0, cost: 0, desc: 'The city pays its taxes.' },
  { name: 'Tax relief', calm: 2, cost: 0, desc: 'No taxes collected.' },
  { name: 'Grain dole', calm: 4, cost: 2, desc: 'No taxes, plus 2 gold per turn in free bread.' },
  { name: 'Patronage', calm: 6, cost: 5, desc: 'No taxes, plus 5 gold per turn in games, gifts and offices.' },
];

// Cultural sensitivity: how strongly a city feels generic pressure (sprawl, crowding,
// war, conquest, nearby riots), by its affinity to the ruler (home, kin, foreign, alien).
export const SENSITIVITY = [0.6, 0.85, 1.2, 1.5];
export const FOREIGN_PEOPLE_SENSITIVITY = 0.25; // extra when the city's people are another tribe's culture

// ---------------- Wonders ----------------
// One per specialty, unique in the world, need a level 5+ city of that specialty.
export const WONDERS = {
  greatgranary: { name: 'Great Granary', special: 'plains', cost: 20, desc: 'Every city you own gains +2 pop now.', needs: { stone: 3, timber: 2 } },
  skycitadel:   { name: 'Sky Citadel', special: 'hilltop', cost: 20, desc: 'All your cities +25% defense.', needs: { stone: 3, timber: 2 } },
  lighthouse:   { name: 'Lighthouse', special: 'coastal', cost: 18, desc: 'Your boats +1 move; all coastal tiles revealed.', needs: { stone: 3, timber: 2 } },
  grandbazaar:  { name: 'Grand Bazaar', special: 'riverside', cost: 22, desc: '+1 gold in every city you own.', needs: { stone: 3, timber: 2 } },
  worldtree:    { name: 'World Tree', special: 'forest', cost: 18, desc: 'All your units heal +3 extra.', needs: { stone: 3, timber: 2 } },
  sunpyramid:   { name: 'Sun Pyramid', special: 'desert', cost: 20, desc: 'Techs 20% cheaper.', needs: { stone: 3, timber: 2 } },
  khansbanner:  { name: "Khan's Banner", special: 'steppe', cost: 20, desc: 'Your mounted units +1 move.', needs: { stone: 3, timber: 2 } },
  mirelabyrinth:{ name: 'Mire Labyrinth', special: 'marsh', cost: 18, desc: 'Your foreign cities integrate 3× faster.', needs: { stone: 3, timber: 2 } },
  eaglethrone:  { name: 'Eagle Throne', special: 'mountain', cost: 22, desc: '+4 gold; all your cities +1 vision.', needs: { stone: 3, timber: 2 } },
};

// ---------------- AI temperaments ----------------
// Temperaments are weights, not rules. Every AI weighs the same three forces:
//   threat      – nearby, long-bordered, well-armed or stronger neighbours (self-preservation)
//   grudges     – damage recently taken from a tribe
//   containment – stopping a runaway leader, scaled by how far away it is and by how
//                 pressing the AI's other threats are
// Ranges are [min, max]; each AI rolls its own values.
//   balance:   weight on containment          caution:   weight on threat
//   vengeance: weight on grudges              appease:   reluctance to provoke the leader (threat overrides it)
//   bully:     appetite for much weaker prey  opportunism: floor for kills and undefended cities
//   threshold: containment level at which it calls itself a coalition member; patience: leaves below threshold × patience
export const TEMPERAMENTS = {
  balancer:    { name: 'Balancer',    desc: 'Cares most about the balance of power. Joins coalitions early, if the leader is within reach.', balance: [1.3, 1.7], caution: [0.6, 0.9], vengeance: [0.4, 0.8], appease: [0, 0], bully: [0, 0.15], opportunism: [0.6, 0.8], threshold: [0.1, 0.18], patience: [0.5, 0.7] },
  opportunist: { name: 'Opportunist', desc: 'Preys on whoever is weakest nearby; rarely bothers with distant giants.', balance: [0.4, 0.7], caution: [0.5, 0.8], vengeance: [0.3, 0.6], appease: [0, 0.2], bully: [0.6, 1.0], opportunism: [0.95, 1.1], threshold: [0.25, 0.35], patience: [0.5, 0.7] },
  vengeful:    { name: 'Vengeful',    desc: 'Never forgets who struck it.', balance: [0.6, 0.9], caution: [0.7, 1.0], vengeance: [1.4, 2.0], appease: [0, 0.1], bully: [0.1, 0.3], opportunism: [0.7, 0.9], threshold: [0.2, 0.3], patience: [0.4, 0.6] },
  appeaser:    { name: 'Appeaser',    desc: 'Avoids provoking the strong and picks on the weak — but fights hard when its own cities are threatened.', balance: [0.1, 0.25], caution: [1.1, 1.5], vengeance: [0.5, 0.9], appease: [0.6, 0.9], bully: [0.4, 0.8], opportunism: [0.85, 1.0], threshold: [0.15, 0.2], patience: [0.5, 0.6] },
  steadfast:   { name: 'Steadfast',   desc: 'Slow to commit, slower to give up.', balance: [0.8, 1.1], caution: [0.8, 1.1], vengeance: [0.6, 1.0], appease: [0, 0.1], bully: [0.1, 0.3], opportunism: [0.6, 0.8], threshold: [0.25, 0.35], patience: [0.15, 0.3] },
};

// ---------------- Techs ----------------
export const TECHS = {
  agriculture: { name: 'Agriculture', tier: 1, req: [], desc: 'Farms on plains & steppe.' },
  forestry:    { name: 'Forestry', tier: 1, req: [], desc: 'Lumber camps in forests.' },
  mining:      { name: 'Mining', tier: 1, req: [], desc: 'Mines and quarries on hills/mountains.' },
  fishing:     { name: 'Fishing', tier: 1, req: [], desc: 'Fisheries on shallows.' },
  husbandry:   { name: 'Husbandry', tier: 1, req: [], desc: 'Pastures on horses.' },
  archery:     { name: 'Archery', tier: 2, req: ['forestry'], desc: 'Archers. Rangers in forest cities.' },
  riding:      { name: 'Riding', tier: 2, req: ['husbandry'], desc: 'Riders, Lancers, Camels, Horse Archers.' },
  masonry:     { name: 'Masonry', tier: 2, req: ['mining'], desc: 'Defenders, Walls, Highlanders.' },
  climbing:    { name: 'Climbing', tier: 2, req: ['mining'], desc: 'Move onto mountains, settle them.' },
  sailing:     { name: 'Sailing', tier: 2, req: ['fishing'], desc: 'Units embark onto shallows. Corsairs.' },
  irrigation:  { name: 'Irrigation', tier: 2, req: ['agriculture'], desc: 'Irrigate desert near rivers/oases.' },
  drainage:    { name: 'Drainage', tier: 2, req: ['agriculture'], desc: 'Reed beds in marshes; marsh move cost 1.' },
  bronze:      { name: 'Bronze Working', tier: 3, req: ['masonry'], desc: 'Bronze Workshops (copper + tin → bronze). Swordsmen, Pikemen.' },
  navigation:  { name: 'Navigation', tier: 3, req: ['sailing'], desc: 'Embark on ocean, boats +1 move, whaling.' },
  trade:       { name: 'Trade', tier: 3, req: ['irrigation'], desc: '+1 gold in every city of level 3+.' },
  roads:       { name: 'Pathfinding', tier: 3, req: ['forestry', 'husbandry'], desc: 'Forest & hills move cost 1 for all units.' },
  engineering: { name: 'Engineering', tier: 4, req: ['bronze'], desc: 'Catapults.' },
  chivalry:    { name: 'Chivalry', tier: 4, req: ['riding', 'bronze'], desc: 'Knights.' },
  philosophy:  { name: 'Philosophy', tier: 4, req: ['trade'], desc: 'Shrines. Techs 25% cheaper.' },
  assimilation:{ name: 'Assimilation', tier: 4, req: ['trade'], desc: 'Foreign & alien penalties reduced by one step.' },
};

export function techCost(tier, nCities, hasPhilosophy, hasPyramid = false) {
  let c = tier * (4 + 2 * nCities) + 1;
  if (hasPhilosophy) c *= 0.75;
  if (hasPyramid) c *= 0.8;
  return Math.max(1, Math.round(c));
}

// Terrain at a city tile -> specialty (before river/coast overrides).
export const TERRAIN_TO_SPECIALTY = {
  plains: 'plains', steppe: 'steppe', desert: 'desert', forest: 'forest',
  marsh: 'marsh', hills: 'hilltop', mountain: 'mountain',
};

export const TRIBE_NAMES = {
  plains: ['Golden Meadow', 'Harvest Folk', 'Sunfield Clans'],
  hilltop: ['Crag Watch', 'Tor Kindred', 'Highfort League'],
  coastal: ['Saltborn', 'Tide Callers', 'Gull Shore'],
  riverside: ['Delta Guild', 'Ferrymen', 'Reedwater Union'],
  forest: ['Oakhearts', 'Greenwardens', 'Thornwood'],
  desert: ['Dune Walkers', 'Sandscript', 'Mirage Court'],
  steppe: ['Windriders', 'Grass Khans', 'Long Sky Horde'],
  marsh: ['Fenfolk', 'Mire Kin', 'Bogmother\'s Brood'],
  mountain: ['Stonecrowns', 'Peakborn', 'Eagle Thrones'],
};

export const CITY_NAMES = [
  'Aldra', 'Brennoc', 'Caelis', 'Duvan', 'Esk', 'Faro', 'Galen', 'Hesk', 'Ilmar', 'Jorun',
  'Kesh', 'Lorin', 'Mardu', 'Norvik', 'Ostra', 'Pell', 'Quessa', 'Rhun', 'Sivar', 'Tarn',
  'Ulmo', 'Vesk', 'Wend', 'Xarid', 'Yorra', 'Zhal', 'Arvel', 'Bastu', 'Corrin', 'Dremm',
  'Elvar', 'Fenn', 'Gorm', 'Harth', 'Isk', 'Jessa', 'Korr', 'Lusk', 'Morrow', 'Nim',
  'Orn', 'Prax', 'Quill', 'Rook', 'Sable', 'Thorne', 'Umber', 'Vail', 'Wyke', 'Yarrow',
  'Zenn', 'Ash', 'Brae', 'Cairn', 'Dun', 'Ember', 'Ford', 'Glen', 'Holt', 'Ivy',
  'Kell', 'Lea', 'Moor', 'Ness', 'Oak', 'Pike', 'Rill', 'Shaw', 'Tor', 'Vale', 'Weir',
];

// Two-tone tribe identities: [fill, border/accent]. Tribes are assigned the pair that is
// perceptually farthest (CIELAB) from every tribe still alive; see pickTribeColors().
export const TRIBE_PALETTE = [
  ['#d7263d', '#ffd23f'], // red / gold
  ['#1b62c4', '#f4f4f4'], // blue / white
  ['#2a9d3c', '#111111'], // green / black
  ['#f2c014', '#3a1d70'], // yellow / deep purple
  ['#8e44ad', '#f7e1a0'], // purple / cream
  ['#f07c1e', '#13294b'], // orange / navy
  ['#19b5b0', '#5a1020'], // teal / maroon
  ['#e94fa8', '#1d1d1d'], // pink / black
  ['#f4f4f4', '#c0392b'], // white / red
  ['#6b3e1f', '#9ae66e'], // brown / lime
  ['#1d2b5c', '#f2a541'], // navy / amber
  ['#7fd13b', '#2b2b80'], // lime / indigo
  ['#5fa8e8', '#7a2a00'], // sky / rust
  ['#4a4a4a', '#ff6f3c'], // charcoal / flame
  ['#c9a227', '#0b3d2e'], // ochre / pine
  ['#00755e', '#ffb3c6'], // jade / rose
  ['#b9a3f5', '#3b1f00'], // lavender / umber
  ['#8c1c13', '#9fd8cb'], // oxblood / mint
];
export const PLAYER_COLORS = TRIBE_PALETTE.map(p => p[0]);

