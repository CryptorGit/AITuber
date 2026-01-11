import React, { useEffect, useState } from 'react';
import { SpeciesDetail } from '../api';
import { BattleNatures, BattleStatNames, PokemonSet, StatName } from './showdownTeams';

type StatKey = StatName;
type StatTable = Record<StatKey, number>;

const STAT_ORDER: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk.',
  spd: 'Sp. Def.',
  spe: 'Speed',
};

const DEFAULT_EVS: StatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS: StatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(lo, Math.min(hi, v));
}

function normalizeStats(
  stats: Partial<Record<StatKey, number>> | undefined,
  defaults: StatTable,
  min: number,
  max: number,
): StatTable {
  const out = { ...defaults };
  for (const stat of STAT_ORDER) {
    const raw = stats?.[stat];
    const val = Number.isFinite(raw) ? Number(raw) : defaults[stat];
    out[stat] = clampInt(val, min, max, defaults[stat]);
  }
  return out;
}

function getNatureMult(natureName: string | undefined, stat: StatKey): number {
  const entry = BattleNatures[natureName as keyof typeof BattleNatures];
  if (!entry || !entry.plus || !entry.minus) return 1;
  if (stat === entry.plus) return 1.1;
  if (stat === entry.minus) return 0.9;
  return 1;
}

function getNatureFromPlusMinus(plus: StatKey | null, minus: StatKey | null): string | null {
  if (!plus || !minus) return null;
  for (const [name, effect] of Object.entries(BattleNatures)) {
    if (effect?.plus === plus && effect?.minus === minus) return name;
  }
  return null;
}

function calcStat(args: {
  base: number;
  iv: number;
  ev: number;
  level: number;
  nature: number;
  isHp: boolean;
}): number {
  const { base, iv, ev, level, nature, isHp } = args;
  const evPart = Math.floor(ev / 4);
  const inner = Math.floor(((2 * base + iv + evPart) * level) / 100);
  if (isHp) return inner + level + 10;
  return Math.floor((inner + 5) * nature);
}

function statBarStyle(stat: number, statID: StatKey): React.CSSProperties {
  let width = Math.floor((stat * 180) / 504);
  if (statID === 'hp') width = Math.floor((stat * 180) / 704);
  if (width > 179) width = 179;
  let hue = Math.floor((stat * 180) / 714);
  if (hue > 360) hue = 360;
  return {
    width: `${width}px`,
    background: `hsl(${hue},85%,45%)`,
    borderColor: `hsl(${hue},85%,35%)`,
  };
}

export function PsStatsForm(props: {
  set: PokemonSet;
  speciesDetail: SpeciesDetail | null;
  onChange: (next: PokemonSet) => void;
}): React.ReactElement {
  const { set, speciesDetail, onChange } = props;

  const speciesName = String(set.species ?? '').trim();
  const level = clampInt(set.level ?? 50, 1, 100, 50);

  const evs = normalizeStats(set.evs, DEFAULT_EVS, 0, 252);
  const ivs = normalizeStats(set.ivs, DEFAULT_IVS, 0, 31);

  const natureName = String(set.nature ?? '').trim();
  const maxTotalEv = 510;
  const [plusMinus, setPlusMinus] = useState<{ plus: StatKey | null; minus: StatKey | null }>({
    plus: null,
    minus: null,
  });
  const [ivSpread, setIvSpread] = useState('');

  useEffect(() => {
    const nature = BattleNatures[natureName as keyof typeof BattleNatures];
    if (nature?.plus && nature?.minus) {
      setPlusMinus({ plus: nature.plus, minus: nature.minus });
      return;
    }
    setPlusMinus((prev) => (prev.plus && prev.minus ? { plus: null, minus: null } : prev));
  }, [natureName]);

  const updateEvs = (stat: StatKey, raw: string, viaSlider: boolean) => {
    const rawValue = String(raw ?? '');
    const hasPlus = rawValue.includes('+');
    const hasMinus = rawValue.includes('-') || rawValue.includes('\u2212');
    let nextPlus = plusMinus.plus;
    let nextMinus = plusMinus.minus;
    let natureChanged = false;
    if (stat !== 'hp') {
      if (hasPlus) {
        if (nextPlus !== stat) natureChanged = true;
        nextPlus = stat;
      } else if (nextPlus === stat) {
        nextPlus = null;
        natureChanged = true;
      }
      if (hasMinus) {
        if (nextMinus !== stat) natureChanged = true;
        nextMinus = stat;
      } else if (nextMinus === stat) {
        nextMinus = null;
        natureChanged = true;
      }
    }

    const parsed = parseInt(rawValue.replace(/[+\-−]/g, ''), 10);
    let nextEv = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    nextEv = clampInt(nextEv, 0, 252, 0);

    let nextEvs = { ...evs, [stat]: nextEv };
    if (viaSlider) {
      const otherTotal = STAT_ORDER.reduce((acc, s) => acc + (s === stat ? 0 : nextEvs[s]), 0);
      if (otherTotal + nextEv > maxTotalEv) {
        let allowed = maxTotalEv - otherTotal;
        if (allowed < 0) allowed = 0;
        allowed -= allowed % 4;
        nextEv = allowed;
        nextEvs = { ...nextEvs, [stat]: nextEv };
      }
    }

    let nextSet: PokemonSet = { ...set, evs: nextEvs };
    if (natureChanged) {
      const nextNature = getNatureFromPlusMinus(nextPlus, nextMinus);
      nextSet = { ...nextSet, nature: nextNature ?? '' };
      setPlusMinus({ plus: nextPlus, minus: nextMinus });
    }
    onChange(nextSet);
  };

  const updateIvs = (stat: StatKey, raw: string) => {
    const parsed = parseInt(raw, 10);
    let nextIv = Number.isFinite(parsed) ? Math.abs(parsed) : DEFAULT_IVS[stat];
    nextIv = clampInt(nextIv, 0, 31, DEFAULT_IVS[stat]);
    onChange({ ...set, ivs: { ...ivs, [stat]: nextIv } });
  };

  const applyIvSpread = (value: string) => {
    if (!value) return;
    const parts = value.split('/').map((v) => parseInt(v, 10));
    if (parts.length !== 6 || parts.some((v) => !Number.isFinite(v))) return;
    const [hp, atk, def, spa, spd, spe] = parts;
    onChange({ ...set, ivs: { hp, atk, def, spa, spd, spe } });
  };

  const updateNature = (value: string) => {
    if (value === 'Serious' || !value) {
      onChange({ ...set, nature: '' });
      return;
    }
    onChange({ ...set, nature: value });
  };

  if (!speciesName) {
    return (
      <div className="teambuilder-results">
        <div className="resultheader">
          <h3>EVs</h3>
        </div>
        <div className="result" style={{ padding: '8px 10px' }}>
          Select a Pokemon to edit stats.
        </div>
      </div>
    );
  }

  if (!speciesDetail) {
    return (
      <div className="teambuilder-results">
        <div className="resultheader">
          <h3>EVs</h3>
        </div>
        <div className="result" style={{ padding: '8px 10px' }}>
          Loading stats...
        </div>
      </div>
    );
  }

  const baseStats = speciesDetail.baseStats;
  const statRows = STAT_ORDER.map((stat) => {
    const base = clampInt(baseStats[stat], 1, 255, 1);
    const ev = evs[stat];
    const iv = ivs[stat];
    const value = calcStat({
      base,
      ev,
      iv,
      level,
      nature: getNatureMult(natureName, stat),
      isHp: stat === 'hp',
    });
    return { stat, base, ev, iv, value };
  });

  const totalEv = statRows.reduce((acc, row) => acc + row.ev, 0);
  let remaining = 0;
  if (totalEv <= maxTotalEv) {
    remaining = totalEv > maxTotalEv - 2 ? 0 : maxTotalEv - 2 - totalEv;
  } else {
    remaining = maxTotalEv - totalEv;
  }

  return (
    <div className="teambuilder-results">
      <div className="resultheader">
        <h3>EVs</h3>
      </div>
      <div className="statform statsform">
        <div className="col labelcol">
          <div></div>
          {STAT_ORDER.map((stat) => (
            <div key={stat}>
              <label>{STAT_LABELS[stat]}</label>
            </div>
          ))}
        </div>

        <div className="col basestatscol">
          <div>
            <em>Base</em>
          </div>
          {statRows.map((row) => (
            <div key={row.stat}>
              <b>{row.base}</b>
            </div>
          ))}
        </div>

        <div className="col graphcol">
          <div></div>
          {statRows.map((row) => (
            <div key={row.stat}>
              <em>
                <span style={statBarStyle(row.value, row.stat)}></span>
              </em>
            </div>
          ))}
          <div>
            <em>Remaining:</em>
          </div>
        </div>

        <div className="col evcol">
          <div>
            <strong>EVs</strong>
          </div>
          {statRows.map((row) => {
            let evText = row.ev ? String(row.ev) : '';
            if (plusMinus.plus === row.stat) evText += '+';
            if (plusMinus.minus === row.stat) evText += '-';
            return (
              <div key={row.stat}>
                <input
                  type="text"
                  name={`stat-${row.stat}`}
                  value={evText}
                  className="textbox inputform numform"
                  inputMode="numeric"
                  onChange={(e) => updateEvs(row.stat, e.target.value, false)}
                />
              </div>
            );
          })}
          <div className="totalev">
            {remaining < 0 ? <b>{remaining}</b> : <em>{remaining}</em>}
          </div>
        </div>

        <div className="col evslidercol">
          <div></div>
          {statRows.map((row) => (
            <div key={row.stat}>
              <input
                type="range"
                name={`evslider-${row.stat}`}
                value={row.ev}
                min={0}
                max={252}
                step={4}
                className="evslider"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => updateEvs(row.stat, e.target.value, true)}
              />
            </div>
          ))}
        </div>

        <div className="col ivcol">
          <div>
            <strong>IVs</strong>
          </div>
          {statRows.map((row) => (
            <div key={row.stat}>
              <input
                type="number"
                name={`iv-${row.stat}`}
                value={row.iv}
                min={0}
                max={31}
                step={1}
                className="textbox inputform numform"
                inputMode="numeric"
                onChange={(e) => updateIvs(row.stat, e.target.value)}
              />
            </div>
          ))}
          <div>
            <select
              name="ivspread"
              className="button"
              value={ivSpread}
              onChange={(e) => {
                const value = e.target.value;
                applyIvSpread(value);
                setIvSpread('');
              }}
            >
              <option value="">IV spreads</option>
              <optgroup label="min Atk">
                <option value="31/0/31/31/31/31">31/0/31/31/31/31</option>
              </optgroup>
              <optgroup label="min Atk, min Spe">
                <option value="31/0/31/31/31/0">31/0/31/31/31/0</option>
              </optgroup>
              <optgroup label="max all">
                <option value="31/31/31/31/31/31">31/31/31/31/31/31</option>
              </optgroup>
              <optgroup label="min Spe">
                <option value="31/31/31/31/31/0">31/31/31/31/31/0</option>
              </optgroup>
            </select>
          </div>
        </div>

        <div className="col statscol">
          <div></div>
          {statRows.map((row) => (
            <div key={row.stat}>
              <b>{row.value}</b>
            </div>
          ))}
        </div>

        <p style={{ clear: 'both' }}>
          Nature:{' '}
          <select
            name="nature"
            className="button"
            value={natureName || 'Serious'}
            onChange={(e) => updateNature(e.target.value)}
          >
            {Object.keys(BattleNatures).map((name) => {
              const effect = BattleNatures[name as keyof typeof BattleNatures];
              const label = effect?.plus
                ? `${name} (+${BattleStatNames[effect.plus]}, -${BattleStatNames[effect.minus!]})`
                : name;
              return (
                <option key={name} value={name}>
                  {label}
                </option>
              );
            })}
          </select>
        </p>
        <p>
          <small>
            <em>Protip:</em> You can also set natures by typing <kbd>+</kbd> and <kbd>-</kbd> next to a stat.
          </small>
        </p>
      </div>
    </div>
  );
}
