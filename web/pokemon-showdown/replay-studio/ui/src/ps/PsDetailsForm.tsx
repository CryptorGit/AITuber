import React, { useEffect, useRef } from 'react';
import { DexListItem, SpeciesDetail } from '../api';
import { PokemonSet } from './showdownTeams';

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(lo, Math.min(hi, v));
}

export function PsDetailsForm(props: {
  set: PokemonSet;
  speciesDetail: SpeciesDetail | null;
  typeOptions: DexListItem[];
  onChange: (next: PokemonSet) => void;
}): React.ReactElement {
  const { set, speciesDetail, typeOptions, onChange } = props;
  const levelRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    levelRef.current?.focus();
  }, []);

  const speciesName = String(set.species ?? '').trim();
  const level = clampInt(set.level ?? 50, 1, 100, 50);
  const gender = set.gender === 'M' || set.gender === 'F' ? set.gender : '';
  const isShiny = Boolean(set.shiny);
  const baseTera = String(speciesDetail?.types?.[0] ?? '').trim();
  const teraValue = String(set.teraType ?? '').trim() || baseTera || '';

  if (!speciesName) {
    return (
      <div className="teambuilder-results">
        <div className="resultheader">
          <h3>Details</h3>
        </div>
        <div className="result" style={{ padding: '8px 10px' }}>
          Select a Pokemon to edit details.
        </div>
      </div>
    );
  }

  if (!speciesDetail) {
    return (
      <div className="teambuilder-results">
        <div className="resultheader">
          <h3>Details</h3>
        </div>
        <div className="result" style={{ padding: '8px 10px' }}>
          Loading details...
        </div>
      </div>
    );
  }

  const typeNames = typeOptions.length
    ? typeOptions.map((t) => t.name).filter(Boolean)
    : (speciesDetail.types ?? []);

  return (
    <div className="teambuilder-results">
      <div className="resultheader">
        <h3>Details</h3>
      </div>
      <form
        className="detailsform"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="formrow">
          <label className="formlabel">Level:</label>
          <div>
            <input
              ref={levelRef}
              type="number"
              min={1}
              max={100}
              step={1}
              name="level"
              value={level}
              className="textbox inputform numform"
              onChange={(e) => {
                const v = clampInt(Number(e.target.value), 1, 100, 50);
                onChange({ ...set, level: v });
              }}
            />
          </div>
        </div>

        <div className="formrow">
          <label className="formlabel">Gender:</label>
          <div>
            <label className="checkbox inline">
              <input
                type="radio"
                name="gender"
                value="M"
                checked={gender === 'M'}
                onChange={() => onChange({ ...set, gender: 'M' })}
              />{' '}
              Male
            </label>
            <label className="checkbox inline">
              <input
                type="radio"
                name="gender"
                value="F"
                checked={gender === 'F'}
                onChange={() => onChange({ ...set, gender: 'F' })}
              />{' '}
              Female
            </label>
            <label className="checkbox inline">
              <input
                type="radio"
                name="gender"
                value="N"
                checked={!gender}
                onChange={() => onChange({ ...set, gender: '' })}
              />{' '}
              Random
            </label>
          </div>
        </div>

        <div className="formrow">
          <label className="formlabel">Shiny:</label>
          <div>
            <label className="checkbox inline">
              <input
                type="radio"
                name="shiny"
                value="yes"
                checked={isShiny}
                onChange={() => onChange({ ...set, shiny: true })}
              />{' '}
              Yes
            </label>
            <label className="checkbox inline">
              <input
                type="radio"
                name="shiny"
                value="no"
                checked={!isShiny}
                onChange={() => onChange({ ...set, shiny: false })}
              />{' '}
              No
            </label>
          </div>
        </div>

        <div className="formrow">
          <label className="formlabel" title="Tera Type">Tera Type:</label>
          <div>
            <select
              name="teratype"
              className="button"
              value={teraValue}
              onChange={(e) => {
                const next = String(e.target.value ?? '').trim();
                if (next && baseTera && next !== baseTera) {
                  onChange({ ...set, teraType: next });
                } else if (next && !baseTera) {
                  onChange({ ...set, teraType: next });
                } else {
                  onChange({ ...set, teraType: '' });
                }
              }}
            >
              {typeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </div>
  );
}
