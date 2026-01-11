/**
 * Pokemon Showdown Teams import/export (ported)
 *
 * Ported/adapted from:
 * - tools/pokemon-showdown/pokemon-showdown-client/play.pokemonshowdown.com/src/battle-teams.ts
 * - tools/pokemon-showdown/pokemon-showdown-client/play.pokemonshowdown.com/src/battle-dex-data.ts
 *
 * Licensing note from upstream (battle-dex-data.ts):
 * - The battle replay/animation engine (battle-*.ts) by itself is MIT
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license MIT
 */

export type StatName = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatsTable = Record<StatName, number>;

export type NatureName =
  | 'Adamant'
  | 'Bashful'
  | 'Bold'
  | 'Brave'
  | 'Calm'
  | 'Careful'
  | 'Docile'
  | 'Gentle'
  | 'Hardy'
  | 'Hasty'
  | 'Impish'
  | 'Jolly'
  | 'Lax'
  | 'Lonely'
  | 'Mild'
  | 'Modest'
  | 'Naive'
  | 'Naughty'
  | 'Quiet'
  | 'Quirky'
  | 'Rash'
  | 'Relaxed'
  | 'Sassy'
  | 'Serious'
  | 'Timid';

export type NatureEffect = { plus?: Exclude<StatName, 'hp'>; minus?: Exclude<StatName, 'hp'> };

export const BattleNatures: Record<NatureName, NatureEffect> = {
  Adamant: { plus: 'atk', minus: 'spa' },
  Bashful: {},
  Bold: { plus: 'def', minus: 'atk' },
  Brave: { plus: 'atk', minus: 'spe' },
  Calm: { plus: 'spd', minus: 'atk' },
  Careful: { plus: 'spd', minus: 'spa' },
  Docile: {},
  Gentle: { plus: 'spd', minus: 'def' },
  Hardy: {},
  Hasty: { plus: 'spe', minus: 'def' },
  Impish: { plus: 'def', minus: 'spa' },
  Jolly: { plus: 'spe', minus: 'spa' },
  Lax: { plus: 'def', minus: 'spd' },
  Lonely: { plus: 'atk', minus: 'def' },
  Mild: { plus: 'spa', minus: 'def' },
  Modest: { plus: 'spa', minus: 'atk' },
  Naive: { plus: 'spe', minus: 'spd' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Quiet: { plus: 'spa', minus: 'spe' },
  Quirky: {},
  Rash: { plus: 'spa', minus: 'spd' },
  Relaxed: { plus: 'def', minus: 'spe' },
  Sassy: { plus: 'spd', minus: 'spe' },
  Serious: {},
  Timid: { plus: 'spe', minus: 'atk' },
};

export const BattleStatIDs: Record<string, StatName | undefined> = {
  HP: 'hp',
  hp: 'hp',
  Atk: 'atk',
  atk: 'atk',
  Def: 'def',
  def: 'def',
  SpA: 'spa',
  SAtk: 'spa',
  SpAtk: 'spa',
  spa: 'spa',
  spc: 'spa',
  Spc: 'spa',
  SpD: 'spd',
  SDef: 'spd',
  SpDef: 'spd',
  spd: 'spd',
  Spe: 'spe',
  Spd: 'spe',
  spe: 'spe',
};

export const BattleStatNames: Record<StatName, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

export function toID(text: any): string {
  if (text?.id) text = text.id;
  else if (text?.userid) text = text.userid;
  if (typeof text !== 'string' && typeof text !== 'number') return '';
  return `${text}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export type PokemonSet = {
  name?: string;
  species: string;
  item?: string;
  ability?: string;
  moves: string[];
  nature?: NatureName | string;
  gender?: '' | 'M' | 'F' | string;
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
  level?: number;
  shiny?: boolean;
  happiness?: number;
  pokeball?: string;
  hpType?: string;
  dynamaxLevel?: number;
  gigantamax?: boolean;
  teraType?: string;
};

export function blankSet(species = ''): PokemonSet {
  return {
    name: '',
    species,
    item: '',
    ability: '',
    moves: ['', '', '', ''],
    nature: '',
    gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    shiny: false,
    happiness: 255,
    pokeball: '',
    hpType: '',
    dynamaxLevel: 10,
    gigantamax: false,
    teraType: '',
  };
}

function getNatureFromPlusMinus(
  plus: Exclude<StatName, 'hp'> | '' | null,
  minus: Exclude<StatName, 'hp'> | '' | null,
): NatureName | null {
  if (!plus || !minus) return null;
  const entries = Object.entries(BattleNatures) as Array<[NatureName, NatureEffect]>;
  for (const [name, eff] of entries) {
    if (eff.plus === plus && eff.minus === minus) return name;
  }
  return null;
}

function ensureMoves4(moves: string[] | undefined): string[] {
  const out = (moves ?? []).slice(0, 4).map((m) => String(m ?? ''));
  while (out.length < 4) out.push('');
  return out;
}

function normalizeStatsTable(
  stats: Partial<StatsTable> | undefined,
  defaults: StatsTable,
): StatsTable {
  return {
    hp: Number.isFinite(Number(stats?.hp)) ? Number(stats?.hp) : defaults.hp,
    atk: Number.isFinite(Number(stats?.atk)) ? Number(stats?.atk) : defaults.atk,
    def: Number.isFinite(Number(stats?.def)) ? Number(stats?.def) : defaults.def,
    spa: Number.isFinite(Number(stats?.spa)) ? Number(stats?.spa) : defaults.spa,
    spd: Number.isFinite(Number(stats?.spd)) ? Number(stats?.spd) : defaults.spd,
    spe: Number.isFinite(Number(stats?.spe)) ? Number(stats?.spe) : defaults.spe,
  };
}

export function exportSet(set: PokemonSet): string {
  // Adapted from Teams.exportSet (newFormat=false) in battle-teams.ts
  let text = '';

  const species = String(set.species ?? '').trim();
  if (!species) return '';
  const name = String(set.name ?? '').trim();
  const item = String(set.item ?? '').trim();
  const ability = String(set.ability ?? '').trim();
  const gender = String(set.gender ?? '').trim();

  // core
  if (name && name !== species) {
    text += `${name} (${species})`;
  } else {
    text += `${species}`;
  }
  if (gender === 'M') text += ` (M)`;
  if (gender === 'F') text += ` (F)`;
  if (item) {
    text += ` @ ${item}`;
  }
  text += `\n`;

  if (ability && ability !== 'No Ability') {
    text += `Ability: ${ability}\n`;
  }

  const evs = normalizeStatsTable(set.evs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  const ivs = normalizeStatsTable(set.ivs, { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });

  // stats
  let first = true;
  for (const stat of (['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const)) {
    const v = evs[stat] || 0;
    if (!v) continue;
    text += first ? `EVs: ` : ` / `;
    first = false;
    text += `${v} ${BattleStatNames[stat]}`;
  }
  if (!first) text += `\n`;

  if (set.nature) {
    text += `${set.nature} Nature\n`;
  }

  first = true;
  for (const stat of (['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const)) {
    const v = ivs[stat];
    if (v === undefined || Number.isNaN(v) || v === 31) continue;
    text += first ? `IVs: ` : ` / `;
    first = false;
    text += `${v} ${BattleStatNames[stat]}`;
  }
  if (!first) text += `\n`;

  // details
  if (set.level && set.level !== 100) {
    text += `Level: ${set.level}\n`;
  }
  if (set.shiny) {
    text += `Shiny: Yes\n`;
  }
  if (typeof set.happiness === 'number' && set.happiness !== 255 && !Number.isNaN(set.happiness)) {
    text += `Happiness: ${set.happiness}\n`;
  }
  if (set.pokeball) {
    text += `Pokeball: ${set.pokeball}\n`;
  }
  if (set.hpType) {
    text += `Hidden Power: ${set.hpType}\n`;
  }
  if (typeof set.dynamaxLevel === 'number' && set.dynamaxLevel !== 10 && !Number.isNaN(set.dynamaxLevel)) {
    text += `Dynamax Level: ${set.dynamaxLevel}\n`;
  }
  if (set.gigantamax) {
    text += `Gigantamax: Yes\n`;
  }
  if (set.teraType) {
    text += `Tera Type: ${set.teraType}\n`;
  }

  // moves
  const moves = ensureMoves4(set.moves);
  for (let move of moves) {
    move = String(move ?? '').trim();
    if (move.startsWith('Hidden Power ') && move.charAt(13) !== '[') {
      const hpType = move.slice(13);
      move = `Hidden Power [${hpType}]`;
    }
    text += `- ${move}\n`;
  }

  return text.trimEnd();
}

function parseExportedTeamLine(line: string, isFirstLine: boolean, set: PokemonSet) {
  // Adapted from Teams.parseExportedTeamLine in battle-teams.ts.
  // Differences: no Dex canonicalization; we keep names as-is.
  if (isFirstLine || line.startsWith('[')) {
    let item: string | undefined;
    [line, item] = line.split('@');
    line = line.trim();
    item = item?.trim();
    if (item) {
      set.item = item;
      if (toID(set.item) === 'noitem') set.item = '';
    }
    if (line.endsWith(' (M)')) {
      set.gender = 'M';
      line = line.slice(0, -4);
    }
    if (line.endsWith(' (F)')) {
      set.gender = 'F';
      line = line.slice(0, -4);
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      set.ability = line.slice(1, -1);
      if (toID(set.ability) === 'selectability') set.ability = '';
    } else if (line) {
      const parenIndex = line.lastIndexOf(' (');
      if (line.endsWith(')') && parenIndex !== -1) {
        set.species = line.slice(parenIndex + 2, -1).trim();
        set.name = line.slice(0, parenIndex).trim();
      } else {
        set.species = line.trim();
        set.name = '';
      }
    }
  } else if (line.startsWith('Trait: ')) {
    set.ability = line.slice(7).trim();
  } else if (line.startsWith('Ability: ')) {
    set.ability = line.slice(9).trim();
  } else if (line.startsWith('Item: ')) {
    set.item = line.slice(6).trim();
  } else if (line.startsWith('Nickname: ')) {
    set.name = line.slice(10).trim();
  } else if (line.startsWith('Species: ')) {
    set.species = line.slice(9).trim();
  } else if (line === 'Shiny: Yes' || line === 'Shiny') {
    set.shiny = true;
  } else if (line.startsWith('Level: ')) {
    set.level = Number(line.slice(7).trim());
  } else if (line.startsWith('Happiness: ')) {
    set.happiness = Number(line.slice(11).trim());
  } else if (line.startsWith('Pokeball: ')) {
    set.pokeball = line.slice(10).trim();
  } else if (line.startsWith('Hidden Power: ')) {
    set.hpType = line.slice(14).trim();
  } else if (line.startsWith('Dynamax Level: ')) {
    set.dynamaxLevel = Number(line.slice(15).trim());
  } else if (line === 'Gigantamax: Yes' || line === 'Gigantamax') {
    set.gigantamax = true;
  } else if (line.startsWith('Tera Type: ')) {
    set.teraType = line.slice(11).trim();
  } else if (line.startsWith('EVs: ')) {
    const evLines = line.slice(5).split('(')[0].split('/');
    set.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    let plus: '' | Exclude<StatName, 'hp'> = '';
    let minus: '' | Exclude<StatName, 'hp'> = '';
    for (let evLine of evLines) {
      evLine = evLine.trim();
      const spaceIndex = evLine.indexOf(' ');
      if (spaceIndex === -1) continue;
      const statToken = evLine.slice(spaceIndex + 1).trim();
      const statid = BattleStatIDs[statToken];
      if (!statid) continue;
      if (statid !== 'hp') {
        if (evLine.charAt(spaceIndex - 1) === '+') plus = statid;
        if (evLine.charAt(spaceIndex - 1) === '-') minus = statid;
      }
      const rawVal = evLine.slice(0, spaceIndex).replace(/[+\-]$/, '');
      (set.evs as any)[statid] = parseInt(rawVal, 10) || 0;
    }
    const nature = getNatureFromPlusMinus(plus, minus);
    if (nature) set.nature = nature;
  } else if (line.startsWith('IVs: ')) {
    const ivLines = line.slice(5).split(' / ');
    set.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    for (let ivLine of ivLines) {
      ivLine = ivLine.trim();
      const spaceIndex = ivLine.indexOf(' ');
      if (spaceIndex === -1) continue;
      const statToken = ivLine.slice(spaceIndex + 1).trim();
      const statid = BattleStatIDs[statToken];
      if (!statid) continue;
      let statval = parseInt(ivLine.slice(0, spaceIndex), 10);
      if (Number.isNaN(statval)) statval = 31;
      (set.ivs as any)[statid] = statval;
    }
  } else if (/^[A-Za-z]+ (N|n)ature/.exec(line)) {
    let natureIndex = line.indexOf(' Nature');
    if (natureIndex === -1) natureIndex = line.indexOf(' nature');
    if (natureIndex === -1) return;
    const nat = line.slice(0, natureIndex).trim();
    if (nat !== 'undefined') set.nature = nat;
  } else if (line.startsWith('-') || line.startsWith('~') || line.startsWith('Move:')) {
    if (line.startsWith('Move:')) line = line.slice(4);
    line = line.slice(line.charAt(1) === ' ' ? 2 : 1);
    if (line.startsWith('Hidden Power [')) {
      const close = line.indexOf(']');
      let hpType = close >= 0 ? line.slice(14, close) : '';
      if (hpType.includes(']') || hpType.includes('[')) hpType = '';
      line = `Hidden Power ${hpType}`.trimEnd();
      set.hpType = hpType;
    }
    if (line === 'Frustration' && set.happiness === undefined) {
      set.happiness = 0;
    }
    set.moves.push(line);
  }
}

export function importTeam(buffer: string): PokemonSet[] {
  const lines = String(buffer ?? '').split('\n');

  const sets: PokemonSet[] = [];
  let curSet: PokemonSet | null = null;

  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  // Packed format uses Dex lookups; not supported here.
  if (lines.length === 1 && lines[0].includes('|')) {
    throw new Error('Packed team format (with "|") is not supported in this editor. Please paste the Showdown text export.');
  }

  for (let line of lines) {
    line = line.trim();
    if (line === '' || line === '---') {
      curSet = null;
    } else if (line.startsWith('===')) {
      // team backup format; ignore
    } else if (line.includes('|')) {
      throw new Error('Packed team format (with "|") is not supported in this editor. Please paste the Showdown text export.');
    } else if (!curSet) {
      curSet = { name: '', species: '', gender: '', moves: [] };
      sets.push(curSet);
      parseExportedTeamLine(line, true, curSet);
    } else {
      parseExportedTeamLine(line, false, curSet);
    }
  }

  for (const s of sets) {
    s.moves = ensureMoves4(s.moves);
    if (s.level == null) s.level = 50;
    if (s.shiny == null) s.shiny = false;
    if (s.happiness == null) s.happiness = 255;
    if (!s.evs) s.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    if (!s.ivs) s.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  }

  return sets;
}
