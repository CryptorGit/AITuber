import React, { useMemo } from 'react';

export type PsSearchMode =
  | 'pokemon'
  | 'item'
  | 'ability'
  | 'move'
  | 'nature'
  | 'teraType'
  | 'details'
  | 'import'
  | 'stats'
  | null;

export type DexListIconSheet = { kind: 'sheet'; url: string; size: number; x: number; y: number };
export type DexAbilitySlot = { slot: string; name: string };

export type DexListItem = {
  id: string;
  name: string;
  num?: number;
  icon_url?: string;
  icon?: DexListIconSheet;
  type?: string;
  types?: string[];
  category?: string;
  basePower?: number;
  accuracy?: number;
  pp?: number;
  desc?: string;
  abilities?: DexAbilitySlot[];
  baseStats?: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function fmtAcc(acc: number | undefined) {
  if (!Number.isFinite(acc) || acc === 0) return '--';
  return String(acc);
}

function fmtPow(p: number | undefined) {
  if (!Number.isFinite(p) || p === 0) return '--';
  return String(p);
}

function fmtPP(pp: number | undefined) {
  if (!Number.isFinite(pp) || pp === 0) return '--';
  if (pp === 1) return '1';
  return String(Math.floor(pp * 8 / 5));
}

function score(name: string, query: string): number {
  const n = norm(name);
  const q = norm(query);
  if (!q) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 800;
  const idx = n.indexOf(q);
  if (idx >= 0) return 500 - idx;
  const tokens = q.split(/\s+/g).filter(Boolean);
  let matched = 0;
  for (const t of tokens) {
    if (n.includes(t)) matched += 1;
  }
  if (matched) return 100 + matched;
  return -1;
}

function typeIcon(type: string): React.ReactNode {
  const t = String(type ?? '').trim();
  if (!t) return null;
  return (
    <img
      key={t}
      src={`/sprites/types/${encodeURIComponent(t)}.png`}
      alt={t}
      width={32}
      height={14}
      className="pixelated"
    />
  );
}

function categoryIcon(category: string | undefined): React.ReactNode {
  const raw = String(category ?? '').trim();
  if (!raw) return null;
  const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return (
    <img
      key={name}
      src={`/sprites/categories/${encodeURIComponent(name)}.png`}
      alt={name}
      width={32}
      height={14}
      className="pixelated"
    />
  );
}

function itemIconStyle(icon: DexListIconSheet | undefined): React.CSSProperties | undefined {
  if (!icon?.url) return undefined;
  return {
    backgroundImage: `url(${icon.url})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `-${icon.x}px -${icon.y}px`,
  };
}

function abilitySlots(abilities: DexAbilitySlot[] | undefined) {
  const slots = new Map<string, string>();
  for (const entry of abilities ?? []) {
    const slot = String(entry?.slot ?? '').trim();
    const name = String(entry?.name ?? '').trim();
    if (slot && name) slots.set(slot, name);
  }
  return {
    primary: slots.get('0') ?? '',
    secondary: slots.get('1') ?? '',
    hidden: slots.get('H') ?? '',
    special: slots.get('S') ?? '',
  };
}

export function PsTeambuilderResults(props: {
  mode: PsSearchMode;
  query: string;
  header: string;
  items: DexListItem[];
  visibleItems?: DexListItem[];
  currentValue?: string;
  onChoose: (name: string) => void;
  cursorIndex?: number;
}): React.ReactElement {
  const { mode, query, header, items, visibleItems, currentValue, onChoose, cursorIndex } = props;

  if (mode === 'import' || mode === 'stats' || mode === 'details') {
    return <div className="teambuilder-results" />;
  }

  if (!mode) {
    return <div className="teambuilder-results" />;
  }

  const show = useMemo(() => {
    if (visibleItems) return visibleItems;
    const q = norm(query);
    if (!q) return items.slice(0, 60);

    const scored: Array<{ it: DexListItem; s: number; i: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const s = score(it.name, q);
      if (s >= 0) scored.push({ it, s, i });
    }
    scored.sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      return a.i - b.i;
    });
    return scored.slice(0, 60).map((x) => x.it);
  }, [items, query, visibleItems]);

  const cur = (currentValue ?? '').trim().toLowerCase();

  const renderRow = (it: DexListItem, idx: number) => {
    const isCur = it.name.trim().toLowerCase() === cur;
    const isHover = typeof cursorIndex === 'number' && cursorIndex >= 0 && idx === cursorIndex;

    if (mode === 'item') {
      return (
        <li className="result" key={it.id}>
          <a
            className={isCur ? 'cur' : isHover ? 'hover' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(it.name);
            }}
          >
            <span className="col itemiconcol">
              <span className="itemicon" style={itemIconStyle(it.icon)} />
            </span>
            <span className="col namecol">{it.name}</span>
            <span className="col itemdesccol">{it.desc ?? ''}</span>
          </a>
        </li>
      );
    }

    if (mode === 'ability') {
      return (
        <li className="result" key={it.id}>
          <a
            className={isCur ? 'cur' : isHover ? 'hover' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(it.name);
            }}
          >
            <span className="col namecol">{it.name}</span>
            <span className="col abilitydesccol">{it.desc ?? ''}</span>
          </a>
        </li>
      );
    }

    if (mode === 'move') {
      const type = String(it.type ?? '').trim();
      const category = String(it.category ?? '').trim();
      return (
        <li className="result" key={it.id}>
          <a
            className={isCur ? 'cur' : isHover ? 'hover' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(it.name);
            }}
          >
            <span className="col movenamecol">{it.name}</span>
            <span className="col typecol">
              {type ? typeIcon(type) : null}
              {category ? categoryIcon(category) : null}
            </span>
            <span className="col labelcol">
              {category && category.toLowerCase() !== 'status' ? (
                <>
                  <em>Power</em>
                  <br />
                  {fmtPow(it.basePower)}
                </>
              ) : null}
            </span>
            <span className="col widelabelcol">
              <em>Accuracy</em>
              <br />
              {fmtAcc(it.accuracy)}
            </span>
            <span className="col pplabelcol">
              <em>PP</em>
              <br />
              {fmtPP(it.pp)}
            </span>
            <span className="col movedesccol">{it.desc ?? ''}</span>
          </a>
        </li>
      );
    }

    if (mode === 'pokemon') {
      const num = Number.isFinite(it.num) ? Number(it.num) : null;
      const numLabel = num && num > 0 ? String(num) : num === 0 ? '' : num ? String(num) : '';
      const types = it.types ?? [];
      const stats = it.baseStats;
      const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;
      const abilities = abilitySlots(it.abilities);
      const abilityMain = abilities.secondary ? (
        <span className="col twoabilitycol">
          {abilities.primary}
          <br />
          {abilities.secondary}
        </span>
      ) : (
        <span className="col abilitycol">{abilities.primary}</span>
      );
      const abilityHidden =
        abilities.hidden || abilities.special ? (
          <span className={`col ${abilities.hidden && abilities.special ? 'twoabilitycol' : 'abilitycol'}${abilities.hidden ? ' hacol' : ''}`}>
            {abilities.hidden ? abilities.hidden : `(${abilities.special})`}
            {abilities.hidden && abilities.special ? (
              <>
                <br />
                ({abilities.special})
              </>
            ) : null}
          </span>
        ) : (
          <span className="col abilitycol"></span>
        );
      const iconRecognized = Boolean(it.icon_url);
      return (
        <li className="result" key={it.id}>
          <a
            className={isCur ? 'cur' : isHover ? 'hover' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(it.name);
            }}
          >
            <span className="col numcol">{numLabel}</span>
            <span className="col iconcol">
              {iconRecognized ? <img src={it.icon_url} alt="" width={40} height={30} className="picon" /> : null}
            </span>
            <span className="col pokemonnamecol">{it.name}</span>
            <span className="col typecol">{types.map(typeIcon)}</span>
            {abilityMain}
            {abilityHidden}
            <span className="col statcol">
              <em>HP</em>
              <br />
              {stats ? stats.hp : ''}
            </span>
            <span className="col statcol">
              <em>Atk</em>
              <br />
              {stats ? stats.atk : ''}
            </span>
            <span className="col statcol">
              <em>Def</em>
              <br />
              {stats ? stats.def : ''}
            </span>
            <span className="col statcol">
              <em>SpA</em>
              <br />
              {stats ? stats.spa : ''}
            </span>
            <span className="col statcol">
              <em>SpD</em>
              <br />
              {stats ? stats.spd : ''}
            </span>
            <span className="col statcol">
              <em>Spe</em>
              <br />
              {stats ? stats.spe : ''}
            </span>
            <span className="col bstcol">
              <em>
                BST
                <br />
                {bst ?? ''}
              </em>
            </span>
          </a>
        </li>
      );
    }

    return (
      <li className="result" key={it.id}>
        <a
          className={isCur ? 'cur' : isHover ? 'hover' : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(it.name);
          }}
        >
          <span className="col namecol">{it.name}</span>
        </a>
      </li>
    );
  };

  const renderSortRow = () => {
    if (mode === 'pokemon') {
      return (
        <li className="result">
          <div className="sortrow">
            <button type="button" className="sortcol numsortcol cur">Sort:</button>
            <button type="button" className="sortcol pnamesortcol">Name</button>
            <button type="button" className="sortcol typesortcol">Types</button>
            <button type="button" className="sortcol abilitysortcol">Abilities</button>
            <button type="button" className="sortcol statsortcol">HP</button>
            <button type="button" className="sortcol statsortcol">Atk</button>
            <button type="button" className="sortcol statsortcol">Def</button>
            <button type="button" className="sortcol statsortcol">SpA</button>
            <button type="button" className="sortcol statsortcol">SpD</button>
            <button type="button" className="sortcol statsortcol">Spe</button>
            <button type="button" className="sortcol statsortcol">BST</button>
          </div>
        </li>
      );
    }

    if (mode === 'move') {
      return (
        <li className="result">
          <div className="sortrow">
            <button type="button" className="sortcol movenamesortcol">Name</button>
            <button type="button" className="sortcol movetypesortcol">Type</button>
            <button type="button" className="sortcol movetypesortcol">Cat</button>
            <button type="button" className="sortcol powersortcol">Pow</button>
            <button type="button" className="sortcol accuracysortcol">Acc</button>
            <button type="button" className="sortcol ppsortcol">PP</button>
          </div>
        </li>
      );
    }

    return null;
  };

  return (
    <div className="teambuilder-results">
      <ul className="utilichart">
        <li className="resultheader">
          <h3>{header}</h3>
        </li>
        {renderSortRow()}
        {show.length === 0 ? (
          <li className="result">
            <p>No results</p>
          </li>
        ) : (
          show.map(renderRow)
        )}
        <li style={{ clear: 'both' }}></li>
      </ul>
    </div>
  );
}
