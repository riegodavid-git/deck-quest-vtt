#!/usr/bin/env node
// Reorganize Deck Quest open-source assets (Battlemaps + Weapons) into a clean
// sibling folder. Copies, never moves — originals stay intact.
//
//   Source:  Deck Quest Open Source PNGs/
//   Output:  Deck Quest Open Source PNGs Organized/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Deck Quest Open Source PNGs');
const OUT = path.join(ROOT, 'Deck Quest Open Source PNGs Organized');

// ---------- battlemap taxonomy ----------

const BATTLEMAP_CATEGORIES = [
  '01 Forests & Nature',
  '02 Grasslands & Plains',
  '03 Swamps & Marshes',
  '04 Mountains & Canyons',
  '05 Deserts & Wastelands',
  '06 Arctic & Snow',
  '07 Volcanic & Hellish',
  '08 Coasts, Beaches & Islands',
  '09 Underwater & Aquatic',
  '10 Rivers, Lakes & Waterfalls',
  '11 Caves & Caverns',
  '12 Crypts, Dungeons & Underground',
  '13 Villages, Towns & Cities',
  '14 Castles, Fortresses & Citadels',
  '15 Temples & Churches',
  '16 Taverns, Inns & Shops',
  '17 Houses, Mansions & Huts',
  '18 Towers',
  '19 Camps & Hideouts',
  '20 Farms, Vineyards & Orchards',
  '21 Ports, Docks & Ships',
  '22 Bridges & Roads',
  '23 Ruins',
  '24 Graveyards & Cemeteries',
  '25 Demonic & Hellish Places',
  '26 Mystic, Fey & Druid',
  '27 Arenas',
  '28 World Maps',
  '29 Sci-Fi',
  '30 Cyberpunk',
  '31 Post-Apocalyptic',
  '32 Other',
];

// Map: Battlemaps 3 top-level subfolder name → [category, optional subcategory]
const B3_TOPLEVEL_MAP = {
  '---CyberPunk maps---': ['30 Cyberpunk'],
  '---Post Apocalyptic Maps---': ['31 Post-Apocalyptic'],
  '--Sci-Fi battlemaps--': ['29 Sci-Fi'],
  'Alley - Streets': ['13 Villages, Towns & Cities'],
  'Arctic Maps': ['06 Arctic & Snow'],
  'Bloody': ['25 Demonic & Hellish Places'],
  'Boats - Shipwreck': ['21 Ports, Docks & Ships'],
  'Boulder field': ['04 Mountains & Canyons'],
  'Bridges': ['22 Bridges & Roads'],
  'Camps - Nomads - hideouts': ['19 Camps & Hideouts'],
  'Canyon, mountains': ['04 Mountains & Canyons'],
  'Castle entrance': ['14 Castles, Fortresses & Citadels'],
  'Castles - Fortress - Stronghold': ['14 Castles, Fortresses & Citadels'],
  'Cave - Crypt  Entrance': ['11 Caves & Caverns'],
  'Caverns - Caves': ['11 Caves & Caverns'],
  'Cemetery - graveyards': ['24 Graveyards & Cemeteries'],
  'Demonic places': ['25 Demonic & Hellish Places'],
  'Desert - Sand Maps': ['05 Deserts & Wastelands'],
  'Druid - Fairy': ['26 Mystic, Fey & Druid'],
  'Farms - vineyards - orchards': ['20 Farms, Vineyards & Orchards'],
  'Fire camps': ['19 Camps & Hideouts'],
  'Forest  - various  nature': ['01 Forests & Nature'],
  'Gardens': ['26 Mystic, Fey & Druid'],
  'Hut - Cabin': ['17 Houses, Mansions & Huts'],
  'Libraries - Study': ['17 Houses, Mansions & Huts'],
  'Mansion - Houses': ['17 Houses, Mansions & Huts'],
  'Meteor crater': ['04 Mountains & Canyons'],
  'Monster Nest - Lair': ['11 Caves & Caverns'],
  'Mystic places': ['26 Mystic, Fey & Druid'],
  'Oasis': ['05 Deserts & Wastelands'],
  'Pirate- Islands - Beach - cliff': ['08 Coasts, Beaches & Islands'],
  'Plateau-Mountain': ['04 Mountains & Canyons'],
  'Ports - Docks': ['21 Ports, Docks & Ships'],
  'Prisons': ['12 Crypts, Dungeons & Underground'],
  'Roads - passages': ['22 Bridges & Roads'],
  'Ruins': ['23 Ruins'],
  'Shops': ['16 Taverns, Inns & Shops'],
  'Swamp': ['03 Swamps & Marshes'],
  'Taverns - Clubs': ['16 Taverns, Inns & Shops'],
  'Temples': ['15 Temples & Churches'],
  'Towers': ['18 Towers'],
  'Treasure room': ['12 Crypts, Dungeons & Underground'],
  'Various lands': ['32 Other'],
  'Volcanic surfaces': ['07 Volcanic & Hellish'],
  'World Maps': ['28 World Maps'],
  'church - chapels': ['15 Temples & Churches'],
  'crypt - dungeons - undergrounds': ['12 Crypts, Dungeons & Underground'],
  'gladiator arenas': ['27 Arenas'],
  'other': ['32 Other'],
  'other rooms': ['17 Houses, Mansions & Huts'],
  'varied surfaces': ['32 Other'],
  'various archways - gateways': ['22 Bridges & Roads'],
  'villages - Town - Cities': ['13 Villages, Towns & Cities'],
};

// Sci-Fi sub-bucket map (the immediate child folder under "--Sci-Fi battlemaps--")
const B3_SCIFI_SUB = {
  '1-Spaceships-Wrecks': 'Spaceships & Wrecks',
  'Alien outposts': 'Alien Outposts',
  'Alien Swamps': 'Alien Swamps',
  'Alien Temples': 'Alien Temples',
  'aliens moons': 'Alien Moons',
  'Base': 'Facilities & Bases',
  'Bio DOmes': 'Bio-Domes',
  'camps': 'Camps',
  'Citadels': 'Citadels',
  'Cities - villages': 'Cities & Villages',
  'Derelict places': 'Derelict Places',
  'Desert planets': 'Desert Planets',
  'Facilities': 'Facilities & Bases',
  'hex grids Sci-Fi Battlemaps': 'Gridded',
  'Jungle - Forest planets': 'Jungle & Forest Planets',
  'Junkyards': 'Junkyards',
  'Mars-Like Planets - colonies': 'Mars-Like Planets',
  'Mining Facilities': 'Mining',
  'OTHER': 'Other',
  'Post apo': 'Post-Apocalyptic',
  'Rifts': 'Rifts',
  'square grids Sci-Fi Battlemaps': 'Gridded',
};

// Post-Apoc sub-bucket
const B3_POSTAPO_SUB = {
  'Amusement park': 'Other',
  'Bases': 'Camps & Bases',
  'Beach - islands': 'Other',
  'Bomb crater sites': 'Wastelands',
  'Bridges': 'Roads & Highways',
  'Camps': 'Camps & Bases',
  'City scenes': 'Cities & Streets',
  'Factories - Facilities': 'Factories & Labs',
  'Farms': 'Other',
  'Ghost towns': 'Cities & Streets',
  'GRIDDED': 'Other',
  'Hordes': 'Other',
  'Labs': 'Factories & Labs',
  'Marketplaces - Trading': 'Cities & Streets',
  'Mines': 'Factories & Labs',
  'Missiles sites - Silos': 'Factories & Labs',
  'nuclear center': 'Factories & Labs',
  'Oasis': 'Wastelands',
  'Offshore oil platform': 'Other',
  'Other various post apo places': 'Other',
  'Overgrown places': 'Wastelands',
  'Polluted nature': 'Wastelands',
  'Prison': 'Other',
  'Roads - Highways': 'Roads & Highways',
  'Scrapyard and dunpsites': 'Wrecks & Scrapyards',
  'Snow': 'Wastelands',
  'Stadium': 'Other',
  'Streets': 'Cities & Streets',
  'Supermarkets': 'Cities & Streets',
  'Theatre': 'Other',
  'Trains - railroads': 'Wrecks & Scrapyards',
  'Undergrounds': 'Other',
  'Various other buildings': 'Other',
  'Villages': 'Cities & Streets',
  'Wastelands': 'Wastelands',
  'Wrecks': 'Wrecks & Scrapyards',
};

// Cyberpunk sub-bucket — group the deeply nested Cyberpunk-Upscaled child folders
// into a small set. For brevity we coarse-bucket by keyword on the immediate child.
function cyberpunkSub(childName) {
  const n = childName.toLowerCase();
  if (/alley|street|road|highway/.test(n)) return 'Streets & Alleys';
  if (/club|bar|casino|concert|brothel|venue/.test(n)) return 'Clubs & Bars';
  if (/market|shop|store|mall|arcade|supermarket/.test(n)) return 'Markets & Shops';
  if (/lab|clinic|hospital|research|facility|factory/.test(n)) return 'Labs & Facilities';
  if (/bunker|base|hideout|underground/.test(n)) return 'Bunkers & Hideouts';
  if (/rooftop|sky|tower|skyscraper/.test(n)) return 'Rooftops & Towers';
  if (/airport|train|garage|parking|dock/.test(n)) return 'Transit & Docks';
  if (/control|server|tech|hack/.test(n)) return 'Control & Tech';
  if (/church|temple|cathedral/.test(n)) return 'Churches & Temples';
  if (/grid/.test(n)) return 'Gridded';
  return 'Other';
}

// Keyword fallback — used for Battlemaps 1 & 2 (flat) and any B3 file whose
// top-level subfolder isn't in the map. Order matters: most specific first.
const KEYWORD_RULES = [
  [/sci.?fi|spaceship|starship|alien|exoplan|bio.?dome|android|robot.?uprising/i, '29 Sci-Fi'],
  [/cyberpunk|neon.?city|cyber.?city/i, '30 Cyberpunk'],
  [/post.?apoc|wasteland|nuclear|scrapyard|dumpsite/i, '31 Post-Apocalyptic'],
  [/world.?map|continent|kingdom.?map/i, '28 World Maps'],
  [/arena|colosseum|gladiator/i, '27 Arenas'],
  [/cemetery|graveyard|tomb.?of|barrow|crypt/i, '24 Graveyards & Cemeteries'],
  [/demonic|hellish|infernal|abyss|underworld|bloody|styx|purgatory|hell\b|pride|wrath|greed|lust|gluttony|sloth|envy/i, '25 Demonic & Hellish Places'],
  [/volcanic|lava|magma|volcano|fire.?giant|forge/i, '07 Volcanic & Hellish'],
  [/iceberg|arctic|tundra|frozen|glacier|snow|ice\b|ice.?lake|ice.?cave|remorhaz/i, '06 Arctic & Snow'],
  [/desert|sand\b|dune|oasis|equator/i, '05 Deserts & Wastelands'],
  [/underwater|underdark|sea.?floor|ocean.?floor|whirlpool|sahuagin|sunken|astral.?sea/i, '09 Underwater & Aquatic'],
  [/swamp|marsh|bog|fen|sea.?hag/i, '03 Swamps & Marshes'],
  [/cave|cavern|grotto|den\b|nest|lair/i, '11 Caves & Caverns'],
  [/dungeon|undergroun|catacomb|jail|prison|barrack|basement/i, '12 Crypts, Dungeons & Underground'],
  [/castle|fortress|stronghold|citadel|keep\b|imperial|throne/i, '14 Castles, Fortresses & Citadels'],
  [/temple|shrine|chapel|cathedral|monastery|sanctuary|book.?of/i, '15 Temples & Churches'],
  [/tavern|inn\b|baku.?inn|pub|hotel/i, '16 Taverns, Inns & Shops'],
  [/tower|spire|lighthouse|wizards?.?tower|bell.?tower/i, '18 Towers'],
  [/farm|vineyard|orchard|pasture|wheat|garden/i, '20 Farms, Vineyards & Orchards'],
  [/pirate|ship|boat|sail|wreck|port\b|dock|harbor|harbour|rowboat|warship|ghostship|smuggler/i, '21 Ports, Docks & Ships'],
  [/bridge|road|path|trail|junction|crossing|pass\b/i, '22 Bridges & Roads'],
  [/mansion|house|hut|cabin|library|libary|office|parking|skyscraper|classroom|academy|interrogation|hall\b|inn.?built|ruined.?house/i, '17 Houses, Mansions & Huts'],
  [/village|town|city|streets|markets|market.?place|courtyard|port.?town|viking.?port/i, '13 Villages, Towns & Cities'],
  [/camp|hideout|nomad|outpost|commune/i, '19 Camps & Hideouts'],
  [/ruin|abandoned|dilapidated|forbidden|ouroboros|titan/i, '23 Ruins'],
  [/fey|druid|fairy|mystic|enchanted|magical|sundial|moon.?door|colour.?extractor|way.?gate|equator|yin.?yang|hespirides|tree.?of.?life/i, '26 Mystic, Fey & Druid'],
  [/forest|jungle|grove|woods|treetop|webbed.?walk|spooky.?forest|soul.?of.?the.?forest|vine|harpy/i, '01 Forests & Nature'],
  [/canyon|mountain|cliff|plateau|mesa|climb|hill\b/i, '04 Mountains & Canyons'],
  [/river|lake|waterfall|stream|pool/i, '10 Rivers, Lakes & Waterfalls'],
  [/beach|island|coast|cove|shore/i, '08 Coasts, Beaches & Islands'],
  [/field|plain|meadow|grass/i, '02 Grasslands & Plains'],
];

// ---------- filename cleanup ----------

function cleanB3Name(name) {
  const ext = path.extname(name);
  let base = name.slice(0, -ext.length);
  // Replace underscores with spaces
  base = base.replace(/_/g, ' ');
  // Strip various sacred-arts-designs-Etsy suffixes
  const suffixPatterns = [
    /-art-by-sacred-arts-designs-Etsy$/i,
    /-design-by-sacred-arts-designs-Etsy$/i,
    /-made-by-sacred-arts-designs-Etsy$/i,
    /-created-by-sacred-arts-designs-Etsy$/i,
    /-crafted-by-sacred-arts-designs-Etsy$/i,
    /-by-sacred-arts-designs-Etsy$/i,
    /-sacred-arts-designs-Etsy-(made|created|crafts|crafted)$/i,
    /-createdBySacred-Arts-Designs-Etsy$/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of suffixPatterns) {
      if (p.test(base)) { base = base.replace(p, ''); changed = true; }
    }
  }
  // Strip trailing UUID-like fragments: e.g. " 38a1f2cf-..." or "_38a1f2cf-..."
  base = base.replace(/[\s_-][0-9a-f]{6,8}-[0-9a-f-]{4,}$/i, '');
  // Strip dangling trailing dashes / underscores / spaces
  base = base.replace(/[\s_-]+$/g, '');
  // Collapse whitespace
  base = base.replace(/\s+/g, ' ').trim();
  // Title-case
  base = base.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  return base + ext;
}

function cleanB2Name(name) {
  return name.replace(/\s*\(DnDavid\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- classification ----------

function classifyB3(relPath) {
  // relPath: e.g. "Battlemaps 3/--Sci-Fi battlemaps--/Alien outposts/Foo.webp"
  const parts = relPath.split(/[/\\]/);
  // parts[0] = "Battlemaps 3", parts[1] = top-level B3 subfolder
  if (parts.length < 3) return ['32 Other'];
  const top = parts[1];
  const mapping = B3_TOPLEVEL_MAP[top];
  if (!mapping) return classifyByKeyword(parts[parts.length - 1]);

  const cat = mapping[0];

  if (cat === '29 Sci-Fi') {
    const sub = parts[2];
    return [cat, B3_SCIFI_SUB[sub] || 'Other'];
  }
  if (cat === '31 Post-Apocalyptic') {
    const sub = parts[2];
    return [cat, B3_POSTAPO_SUB[sub] || 'Other'];
  }
  if (cat === '30 Cyberpunk') {
    // The Cyberpunk tree has very deep nesting. Bucket by the deepest interesting folder.
    // parts: ["Battlemaps 3", "---CyberPunk maps---", "Cyberpunk Maps - Upscaled" | "Grids", <category>, ...]
    const lastFolder = parts[parts.length - 2]; // immediate parent folder
    return [cat, cyberpunkSub(lastFolder)];
  }
  if (cat === '13 Villages, Towns & Cities') {
    const sub = parts[2];
    if (/^Abandoned/i.test(sub)) return [cat, 'Abandoned'];
    if (/Forest/i.test(sub)) return [cat, 'Forest'];
    if (/Medieval City/i.test(sub)) return [cat, 'Medieval'];
    if (/Medieval Village/i.test(sub)) return [cat, 'Medieval'];
    return [cat];
  }

  return [cat];
}

function classifyByKeyword(filename) {
  const name = filename.toLowerCase();
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(name)) return [cat];
  }
  return ['32 Other'];
}

// ---------- weapons ----------

function classifyWeapon(filename) {
  const n = filename.toLowerCase();
  if (n.startsWith('arrow')) return 'Arrows';
  if (n.startsWith('bow_quiver') || n.startsWith('longbow') || n.startsWith('shortbow')) return 'Bows';
  if (n.startsWith('crossbow')) return 'Crossbows';
  if (n.startsWith('dagger')) return 'Daggers';
  if (/^(greatsword|longsword|rapier|scimitar|shortsword)/.test(n)) return 'Swords';
  if (/^(battleaxe|greataxe|handaxe)/.test(n)) return 'Axes';
  if (/^(light_hammer|warhammer|maul)/.test(n)) return 'Hammers';
  if (/^(mace|morningstar|club|greatclub|flail)/.test(n)) return 'Maces & Clubs';
  if (/^(glaive|halberd|lance|pike|quarterstaff|spear)/.test(n)) return 'Polearms';
  if (/^(javelin|sickle|trident)/.test(n)) return 'Thrown';
  if (n.startsWith('warpick')) return 'Picks';
  if (n.startsWith('whip')) return 'Whips';
  if (n.startsWith('shield')) return 'Shields';
  return 'Other';
}

// ---------- walker ----------

function walk(dir, base = dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, base, files);
    else if (entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
      files.push(path.relative(base, p));
    }
  }
  return files;
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target);
  const base = target.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

// ---------- main ----------

const stats = {};
const otherSamples = [];
let total = 0;

function bump(cat, sub) {
  const k = sub ? `${cat} / ${sub}` : cat;
  stats[k] = (stats[k] || 0) + 1;
}

function copyBattlemapFile(srcAbs, relInSource, sourceLabel) {
  let cat, sub, cleanedName;
  const fileName = path.basename(relInSource);

  if (sourceLabel === 'B1') {
    const c = classifyByKeyword(fileName);
    cat = c[0];
    cleanedName = fileName;
  } else if (sourceLabel === 'B2') {
    cleanedName = cleanB2Name(fileName);
    const c = classifyByKeyword(cleanedName);
    cat = c[0];
  } else { // B3
    const c = classifyB3(relInSource);
    cat = c[0]; sub = c[1];
    cleanedName = cleanB3Name(fileName);
  }

  const dir = sub
    ? path.join(OUT, 'Battlemaps', cat, sub)
    : path.join(OUT, 'Battlemaps', cat);
  ensureDir(dir);
  const target = uniquePath(path.join(dir, cleanedName));
  fs.copyFileSync(srcAbs, target);
  bump(cat, sub);
  total++;
  if (cat === '32 Other' && otherSamples.length < 100) otherSamples.push(relInSource);
}

function run() {
  console.log('Source:', SRC);
  console.log('Output:', OUT);
  if (!fs.existsSync(SRC)) { console.error('Source folder not found.'); process.exit(1); }
  ensureDir(OUT);

  // Battlemaps 1
  const b1Root = path.join(SRC, 'Battlemaps', 'Battlemaps 1');
  if (fs.existsSync(b1Root)) {
    const files = walk(b1Root);
    console.log(`Battlemaps 1: ${files.length} files`);
    for (const rel of files) copyBattlemapFile(path.join(b1Root, rel), path.join('Battlemaps 1', rel), 'B1');
  }

  // Battlemaps 2
  const b2Root = path.join(SRC, 'Battlemaps', 'Battlemaps 2');
  if (fs.existsSync(b2Root)) {
    const files = walk(b2Root);
    console.log(`Battlemaps 2: ${files.length} files`);
    for (const rel of files) copyBattlemapFile(path.join(b2Root, rel), path.join('Battlemaps 2', rel), 'B2');
  }

  // Battlemaps 3
  const b3Root = path.join(SRC, 'Battlemaps', 'Battlemaps 3');
  if (fs.existsSync(b3Root)) {
    const files = walk(b3Root);
    console.log(`Battlemaps 3: ${files.length} files`);
    for (const rel of files) copyBattlemapFile(path.join(b3Root, rel), path.join('Battlemaps 3', rel), 'B3');
  }

  // Weapons
  const wRoot = path.join(SRC, 'Weapons', 'Weapons');
  if (fs.existsSync(wRoot)) {
    const files = walk(wRoot);
    console.log(`Weapons: ${files.length} files`);
    for (const rel of files) {
      const fileName = path.basename(rel);
      const fam = classifyWeapon(fileName);
      const dir = path.join(OUT, 'Weapons', fam);
      ensureDir(dir);
      fs.copyFileSync(path.join(wRoot, rel), uniquePath(path.join(dir, fileName)));
      bump(`Weapons / ${fam}`);
      total++;
    }
  }

  // Report
  const reportLines = [];
  reportLines.push(`Deck Quest asset reorganization`);
  reportLines.push(`Run: ${new Date().toISOString()}`);
  reportLines.push(`Total copied: ${total}`);
  reportLines.push('');
  reportLines.push('=== Per-category counts ===');
  const sortedKeys = Object.keys(stats).sort();
  for (const k of sortedKeys) reportLines.push(`  ${k.padEnd(60)} ${stats[k]}`);
  reportLines.push('');
  reportLines.push(`=== Files placed in 32 Other (first ${otherSamples.length}) ===`);
  for (const s of otherSamples) reportLines.push(`  ${s}`);

  const reportPath = path.join(OUT, 'organize-report.txt');
  fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
  console.log('\nDone.');
  console.log(`Report: ${reportPath}`);
  console.log(`Total copied: ${total}`);
}

run();
