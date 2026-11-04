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
  rider:     { name: 'Rider',     atk: 2, def: 1, hp: 10, mv: 2, rng: 1, cost: 3, glyph: 'R', tech: 'riding', traits: ['mounted'] },
  defender:  { name: 'Defender',  atk: 1, def: 3, hp: 15, mv: 1, rng: 1, cost: 3, glyph: 'D', tech: 'masonry' },
  swordsman: { name: 'Swordsman', atk: 3, def: 3, hp: 15, mv: 1, rng: 1, cost: 5, glyph: 'X', tech: 'bronze' },
  catapult:  { name: 'Catapult',  atk: 4, def: 0, hp: 10, mv: 1, rng: 3, cost: 8, glyph: 'C', tech: 'engineering' },
  knight:    { name: 'Knight',    atk: 3.5, def: 1, hp: 15, mv: 3, rng: 1, cost: 8, glyph: 'K', tech: 'chivalry', traits: ['mounted'] },
  // specialty uniques
  lancer:     { name: 'Lancer',      atk: 4, def: 1, hp: 12, mv: 2, rng: 1, cost: 5, glyph: 'L', tech: 'riding', traits: ['mounted'], unique: 'plains' },
  slinger:    { name: 'Slinger',     atk: 2, def: 1, hp: 8,  mv: 1, rng: 2, cost: 3, glyph: 's', unique: 'hilltop', traits: ['hillwalk'] },
  corsair:    { name: 'Corsair',     atk: 3, def: 2, hp: 12, mv: 3, rng: 1, cost: 6, glyph: 'Q', tech: 'sailing', traits: ['naval'], unique: 'coastal' },
  pikeman:    { name: 'Pikeman',     atk: 2, def: 3, hp: 12, mv: 1, rng: 1, cost: 4, glyph: 'P', tech: 'bronze', traits: ['antimount'], unique: 'riverside' },
  ranger:     { name: 'Ranger',      atk: 3, def: 1, hp: 10, mv: 1, rng: 2, cost: 5, glyph: 'G', tech: 'archery', traits: ['forestwalk'], unique: 'forest' },
  camel:      { name: 'Camel Raider',atk: 3, def: 1, hp: 12, mv: 3, rng: 1, cost: 5, glyph: 'M', tech: 'riding', traits: ['mounted', 'desertwalk'], unique: 'desert' },
  horsearcher:{ name: 'Horse Archer',atk: 2, def: 1, hp: 10, mv: 2, rng: 2, cost: 5, glyph: 'H', tech: 'riding', traits: ['mounted', 'skirmish'], unique: 'steppe' },
  bogstalker: { name: 'Bog Stalker', atk: 3, def: 1, hp: 10, mv: 2, rng: 1, cost: 4, glyph: 'B', traits: ['marshwalk', 'stealth'], unique: 'marsh' },
  highlander: { name: 'Highlander',  atk: 2, def: 4, hp: 15, mv: 1, rng: 1, cost: 5, glyph: 'U', tech: 'masonry', traits: ['mountainwalk', 'hillwalk'], unique: 'mountain' },
};

export const EMBARKED = { name: 'Boat', atk: 1, def: 1, mv: 2, rng: 1 };

// ---------------- Improvements ----------------
// pop: growth given to owning city; gold: one-off? no -> permanent income bonus
export const IMPROVEMENTS = {
  farm:     { name: 'Farm',        terrain: ['plains', 'steppe'], tech: 'agriculture', cost: 4, pop: 1 },
  irrigate: { name: 'Irrigation',  terrain: ['desert'], tech: 'irrigation', cost: 4, pop: 1, needRiverOrOasis: true },
  pasture:  { name: 'Pasture',     terrain: ['steppe', 'plains'], tech: 'husbandry', cost: 4, pop: 1, resource: 'horses' },
  lumber:   { name: 'Lumber Camp', terrain: ['forest'], tech: 'forestry', cost: 4, pop: 1 },
  hunt:     { name: 'Hunting Lodge', terrain: ['forest'], tech: null, cost: 2, pop: 1, resource: 'game', consume: true },
  gather:   { name: 'Forage',      terrain: ['plains', 'steppe', 'desert', 'marsh', 'hills'], tech: null, cost: 2, pop: 1, resource: 'fruit', consume: true },
  mine:     { name: 'Mine',        terrain: ['hills', 'mountain'], tech: 'mining', cost: 5, pop: 2, resource: 'ore' },
  quarry:   { name: 'Quarry',      terrain: ['hills'], tech: 'mining', cost: 4, pop: 1 },
  fishery:  { name: 'Fishery',     terrain: ['shallows'], tech: 'fishing', cost: 3, pop: 1, resource: 'fish', consume: true },
  whaling:  { name: 'Whaling',     terrain: ['ocean'], tech: 'navigation', cost: 5, pop: 2, resource: 'whales', consume: true },
  reedbeds: { name: 'Reed Beds',   terrain: ['marsh'], tech: 'drainage', cost: 4, pop: 1 },
};

export const RESOURCES = {
  fruit:  { name: 'Wild Fruit', color: '#e44f6f' },
  game:   { name: 'Game',       color: '#a0673a' },
  horses: { name: 'Horses',     color: '#6a4a2a' },
  ore:    { name: 'Ore',        color: '#c0c0d8' },
  fish:   { name: 'Fish',       color: '#e0f0ff' },
  whales: { name: 'Whales',     color: '#b0c8e0' },
  oasis:  { name: 'Oasis',      color: '#30b0a0' },
  wheat:  { name: 'Wheat',      color: '#f0d050' },
};

// ---------------- Buildings ----------------
export const BUILDINGS = {
  walls:        { name: 'Walls', cost: 6, tech: 'masonry', desc: 'City defense x2 (stacks with specialty).' },
  courthouse:   { name: 'Courthouse', cost: 5, calm: 1, desc: '-1 unrest pressure.' },
  amphitheater: { name: 'Amphitheater', cost: 9, tech: 'masonry', calm: 2, desc: '-2 unrest pressure.' },
  temple:       { name: 'Shrine', cost: 8, tech: 'philosophy', calm: 2, desc: '+1 pop, +1 gold, -2 unrest. Integration twice as fast.' },
  granary:      { name: 'Granary', cost: 6, special: 'plains', desc: '+2 pop.' , pop: 2 },
  watchtower:   { name: 'Watchtower', cost: 5, special: 'hilltop', desc: '+2 vision, city defense +50%.' },
  harbor:       { name: 'Harbor', cost: 7, special: 'coastal', desc: '+2 gold per turn.', gold: 2 },
  market:       { name: 'Market', cost: 8, special: 'riverside', desc: '+1 gold per 2 city levels.' },
  sawmill:      { name: 'Sawmill', cost: 6, special: 'forest', desc: '+1 gold per lumber camp in territory.' },
  caravanserai: { name: 'Caravanserai', cost: 7, special: 'desert', desc: '+2 gold, +1 pop.', gold: 2, pop: 1 },
  stables:      { name: 'Stables', cost: 6, special: 'steppe', desc: 'Mounted units cost -1, +1 pop.', pop: 1 },
  peatworks:    { name: 'Peat Works', cost: 6, special: 'marsh', desc: '+1 gold per marsh tile in territory (max 3).' },
  deepmine:     { name: 'Deep Mine', cost: 8, special: 'mountain', desc: '+3 gold per turn.', gold: 3 },
};

// ---------------- Wonders ----------------
// One per specialty, unique in the world, need a level 5+ city of that specialty.
export const WONDERS = {
  greatgranary: { name: 'Great Granary', special: 'plains', cost: 20, desc: 'Every city you own gains +2 pop now.' },
  skycitadel:   { name: 'Sky Citadel', special: 'hilltop', cost: 20, desc: 'All your cities +25% defense.' },
  lighthouse:   { name: 'Lighthouse', special: 'coastal', cost: 18, desc: 'Your boats +1 move; all coastal tiles revealed.' },
  grandbazaar:  { name: 'Grand Bazaar', special: 'riverside', cost: 22, desc: '+1 gold in every city you own.' },
  worldtree:    { name: 'World Tree', special: 'forest', cost: 18, desc: 'All your units heal +3 extra.' },
  sunpyramid:   { name: 'Sun Pyramid', special: 'desert', cost: 20, desc: 'Techs 20% cheaper.' },
  khansbanner:  { name: "Khan's Banner", special: 'steppe', cost: 20, desc: 'Your mounted units +1 move.' },
  mirelabyrinth:{ name: 'Mire Labyrinth', special: 'marsh', cost: 18, desc: 'Your foreign cities integrate 3× faster.' },
  eaglethrone:  { name: 'Eagle Throne', special: 'mountain', cost: 22, desc: '+4 gold; all your cities +1 vision.' },
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
  bronze:      { name: 'Bronze Working', tier: 3, req: ['masonry'], desc: 'Swordsmen, Pikemen.' },
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

export const PLAYER_COLORS = [
  '#e0453a', '#3a7be0', '#f0c419', '#9b4ae0', '#20c0a0', '#f07c20', '#e04aa8', '#e8e8e8',
  '#6b4423', '#80e040',
];
