import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  apiDexList,
  apiGet,
  apiMoveSearch,
  apiPut,
  apiSpeciesDetail,
  DexListItem,
  DexMoveDetail,
  SpeciesDetail,
} from '../api';
import IconCombobox from '../components/IconCombobox';
import { PsDetailsForm } from '../ps/PsDetailsForm';
import { PsSetChart } from '../ps/PsSetChart';
import { PsStatsForm } from '../ps/PsStatsForm';
import { DexListItem as SimpleDexItem, PsSearchMode, PsTeambuilderResults } from '../ps/PsTeambuilderResults';
import { blankSet, exportSet, importTeam, PokemonSet } from '../ps/showdownTeams';
import '../ps/ps-teambuilder.css';

function normalizeSetText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function toIDLike(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function scoreQueryMatch(name: string, id: string, qRaw: string): number | null {
  const q = String(qRaw ?? '').trim().toLowerCase();
  if (!q) return 0;

  const qId = toIDLike(q);
  if (!qId) return null;

  const idLower = String(id ?? '').toLowerCase();
  const nameLower = String(name ?? '').toLowerCase();
  const nameId = toIDLike(nameLower);

  const tokens = q.split(/\s+/g).filter(Boolean);
  for (const t of tokens) {
    const tId = toIDLike(t);
    if (!tId) continue;
    if (!nameId.includes(tId) && !idLower.includes(tId) && !nameLower.includes(t)) return null;
  }

  if (idLower === qId) return 0;
  if (nameId === qId) return 1;
  if (idLower.startsWith(qId)) return 2;
  if (nameId.startsWith(qId)) return 3;
  if (nameLower.startsWith(q)) return 4;

  const words = nameLower.split(/[\s\-]+/g).filter(Boolean);
  for (const w of words) {
    if (toIDLike(w).startsWith(qId)) return 5;
  }

  if (nameId.includes(qId) || idLower.includes(qId)) return 6;
  if (nameLower.includes(q)) return 7;
  return null;
}

function applyQuery<T extends { id: string; name: string }>(rows: readonly T[], q: string, limit: number): T[] {
  if (!q) return rows.slice(0, limit);
  const scored: Array<{ row: T; score: number }> = [];
  for (const r of rows) {
    const score = scoreQueryMatch(r.name, r.id, q);
    if (score === null) continue;
    scored.push({ row: r, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const an = a.row.name.length;
    const bn = b.row.name.length;
    if (an !== bn) return an - bn;
    return a.row.name.localeCompare(b.row.name);
  });
  return scored.slice(0, limit).map((x) => x.row);
}

function findDexItemByName<T extends { id: string; name: string }>(items: readonly T[], value: string): T | null {
  const target = toIDLike(value);
  if (!target) return null;
  return (
    items.find((it) => toIDLike(it.id) === target) ??
    items.find((it) => toIDLike(it.name) === target) ??
    null
  );
}

function ensureMoves4(moves: string[] | undefined): string[] {
  const out = (moves ?? []).slice(0, 4).map((m) => String(m ?? ''));
  while (out.length < 4) out.push('');
  return out;
}

function newEntryId() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type PoolEntry = {
  id: string;
  species: string;
  setText?: string;
  setObj?: PokemonSet;
  name?: string;
  level?: number;
  gender?: '' | 'M' | 'F';
  shiny?: boolean;
  happiness?: number;
  item?: string;
  ability?: string;
  nature?: string;
  evs?: any;
  ivs?: any;
  moves?: string[];
  teraType?: string;
  hpType?: string;
  pokeball?: string;
  gigantamax?: boolean;
  dynamaxLevel?: number;
};

type PoolConfig = {
  version: 1;
  updated_at?: string;
  team6?: string[];
  pool: PoolEntry[];
};

function hasLegacyFields(entry: PoolEntry): boolean {
  return (
    entry.name !== undefined ||
    entry.item !== undefined ||
    entry.ability !== undefined ||
    entry.nature !== undefined ||
    entry.gender !== undefined ||
    entry.level !== undefined ||
    entry.shiny !== undefined ||
    entry.happiness !== undefined ||
    entry.moves !== undefined ||
    entry.evs !== undefined ||
    entry.ivs !== undefined ||
    entry.teraType !== undefined ||
    entry.hpType !== undefined ||
    entry.pokeball !== undefined ||
    entry.gigantamax !== undefined ||
    entry.dynamaxLevel !== undefined
  );
}

function legacyEntryToSet(entry: PoolEntry): PokemonSet {
  const species = String(entry.species ?? '').trim();
  const base = blankSet(species);
  return {
    ...base,
    name: entry.name ?? base.name,
    species,
    item: entry.item ?? base.item,
    ability: entry.ability ?? base.ability,
    moves: ensureMoves4(entry.moves ?? base.moves),
    nature: entry.nature ?? base.nature,
    gender: (entry.gender ?? base.gender) as any,
    evs: entry.evs ?? base.evs,
    ivs: entry.ivs ?? base.ivs,
    level: entry.level ?? base.level,
    shiny: entry.shiny ?? base.shiny,
    happiness: entry.happiness ?? base.happiness,
    pokeball: entry.pokeball ?? base.pokeball,
    hpType: entry.hpType ?? base.hpType,
    dynamaxLevel: entry.dynamaxLevel ?? base.dynamaxLevel,
    gigantamax: entry.gigantamax ?? base.gigantamax,
    teraType: entry.teraType ?? base.teraType,
  };
}

function normalizePoolConfig(cfg: PoolConfig): { cfg: PoolConfig; dirty: boolean } {
  let dirty = false;
  const pool = (cfg.pool ?? []).map((entry) => {
    const next: PoolEntry = { ...entry };
    const rawId = String(entry.id ?? '').trim();
    if (!rawId) {
      next.id = newEntryId();
      dirty = true;
    } else {
      next.id = rawId;
    }

    const rawText = typeof entry.setText === 'string' ? entry.setText : '';
    let parsedSet: PokemonSet | null = null;
    let parsedOk = false;

    if (rawText.trim()) {
      try {
        const parsed = importTeam(rawText);
        if (parsed.length) {
          parsedSet = parsed[0];
          parsedOk = true;
        }
      } catch {
        parsedSet = null;
      }
    }

    if (!parsedSet && entry.setObj) {
      parsedSet = entry.setObj as PokemonSet;
    }

    if (!parsedSet && hasLegacyFields(entry)) {
      parsedSet = legacyEntryToSet(entry);
    }

    if (!parsedSet) {
      parsedSet = blankSet(String(entry.species ?? '').trim());
    }

    const derivedSpecies = String(parsedSet.species ?? '').trim();
    const nextSpecies = derivedSpecies || String(entry.species ?? '').trim();
    if (nextSpecies !== String(entry.species ?? '').trim()) {
      next.species = nextSpecies;
      dirty = true;
    }

    if (parsedOk || (!rawText.trim() && parsedSet)) {
      const canonical = derivedSpecies ? exportSet(parsedSet) : '';
      if (normalizeSetText(canonical) !== normalizeSetText(rawText)) {
        next.setText = canonical;
        dirty = true;
      } else if (entry.setText == null) {
        next.setText = canonical;
        dirty = true;
      }
    } else if (entry.setText == null) {
      next.setText = '';
      dirty = true;
    } else {
      next.setText = rawText;
    }

    if (next.species == null) next.species = '';
    if (next.setText == null) next.setText = '';

    return next;
  });

  // Normalize team6 selection (ids must exist in pool; max 6; default to first 6 entries).
  const poolIds = new Set(pool.map((p) => p.id));
  let team6 = Array.isArray(cfg.team6) ? cfg.team6.map((id) => String(id ?? '').trim()).filter(Boolean) : [];
  team6 = team6.filter((id) => poolIds.has(id));
  if (team6.length > 6) {
    team6 = team6.slice(0, 6);
    dirty = true;
  }
  if (team6.length === 0 && pool.length > 0) {
    team6 = pool
      .map((p) => p.id)
      .filter(Boolean)
      .slice(0, 6);
    dirty = true;
  }

  return { cfg: { ...cfg, pool, team6 }, dirty };
}

function sanitizePoolConfig(cfg: PoolConfig): PoolConfig {
  return {
    ...cfg,
    team6: Array.isArray(cfg.team6) ? cfg.team6.map((id) => String(id ?? '').trim()).filter(Boolean).slice(0, 6) : [],
    pool: (cfg.pool ?? []).map((entry) => ({
      id: String(entry.id ?? '').trim(),
      species: String(entry.species ?? '').trim(),
      setText: String(entry.setText ?? ''),
    })),
  };
}

function makeEntryFromSet(set: PokemonSet): PoolEntry {
  const species = String(set.species ?? '').trim();
  return {
    id: newEntryId(),
    species,
    setText: species ? exportSet(set) : '',
  };
}

function toSimple(items: DexListItem[]): SimpleDexItem[] {
  return items.map((it) => ({
    id: it.id,
    name: it.name,
    num: it.num,
    icon_url: it.icon_url,
    icon: it.icon,
    desc: it.desc,
    type: it.type,
    types: it.types,
    abilities: it.abilities,
    baseStats: it.baseStats,
    category: it.category,
    basePower: it.basePower,
    accuracy: it.accuracy,
    pp: it.pp,
  }));
}

function toMoveItem(move: DexMoveDetail): SimpleDexItem {
  return {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    basePower: move.basePower,
    accuracy: move.accuracy,
    pp: move.pp,
    desc: move.desc,
  } as SimpleDexItem;
}

export default function PoolPage() {
  const [cfg, setCfg] = useState<PoolConfig | null>(null);
  const [err, setErr] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [cfgDirty, setCfgDirty] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [speciesDetail, setSpeciesDetail] = useState<SpeciesDetail | null>(null);

  const [speciesList, setSpeciesList] = useState<DexListItem[]>([]);
  const [itemList, setItemList] = useState<DexListItem[]>([]);
  const [abilityList, setAbilityList] = useState<DexListItem[]>([]);
  const [moveList, setMoveList] = useState<DexListItem[]>([]);
  const [natureList, setNatureList] = useState<DexListItem[]>([]);
  const [typeList, setTypeList] = useState<DexListItem[]>([]);

  const [searchMode, setSearchMode] = useState<PsSearchMode>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMoveIndex, setSearchMoveIndex] = useState<number | undefined>(undefined);
  const [resultsCursor, setResultsCursor] = useState(0);
  const focusSeq = useRef(0);
  const [focusField, setFocusField] = useState<{
    mode: 'pokemon' | 'item' | 'ability' | 'move' | 'nature' | 'teraType';
    moveIndex?: number;
    seq: number;
  } | null>(null);

  const [importExportText, setImportExportText] = useState('');

  const [draftSet, setDraftSet] = useState<PokemonSet>(blankSet(''));
  const [draftBaseText, setDraftBaseText] = useState('');
  const [draftErr, setDraftErr] = useState('');

  const [addSpecies, setAddSpecies] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');

  const [moveSearchItems, setMoveSearchItems] = useState<SimpleDexItem[]>([]);
  const [moveSearchErr, setMoveSearchErr] = useState('');
  const [moveSearchLoading, setMoveSearchLoading] = useState(false);
  const teambuilderRef = useRef<HTMLDivElement | null>(null);

  const requestFocus = (mode: 'pokemon' | 'item' | 'ability' | 'move' | 'nature' | 'teraType', moveIndex?: number) => {
    focusSeq.current += 1;
    setFocusField({ mode, moveIndex, seq: focusSeq.current });
    setResultsCursor(0);
  };

  useEffect(() => {
    setErr('');
    apiGet<PoolConfig>('/api/config/pool')
      .then((r) => {
        const normalized = normalizePoolConfig(r);
        setCfg(normalized.cfg);
        setCfgDirty(normalized.dirty);
        setSaveMsg('');
        setErr('');
        if (normalized.cfg.pool?.length) {
          setSelectedEntryId(normalized.cfg.pool[0].id);
        } else {
          setSelectedEntryId(null);
        }
      })
      .catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  useLayoutEffect(() => {
    const root = teambuilderRef.current;
    if (!root) return;
    const applyScale = () => {
      const wrapper = root.querySelector<HTMLElement>('.teamwrapper');
      if (!wrapper) return;
      const width = root.clientWidth;
      if (!width) return;
      const scale = width < 640 ? width / 640 : 1;
      if (scale < 1) {
        wrapper.style.transform = `scale(${scale})`;
        wrapper.classList.add('scaled');
      } else {
        wrapper.style.transform = 'none';
        wrapper.classList.remove('scaled');
      }
    };

    applyScale();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => applyScale());
      ro.observe(root);
    } else {
      window.addEventListener('resize', applyScale);
    }

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', applyScale);
    };
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiDexList('species', { detail: '1' }),
      apiDexList('items'),
      apiDexList('abilities'),
      apiDexList('moves', { detail: '1' }),
      apiDexList('natures'),
      apiDexList('types'),
    ])
      .then(([s, it, ab, mv, nat, types]) => {
        if (cancelled) return;
        setSpeciesList(s.items);
        setItemList(it.items);
        setAbilityList(ab.items);
        setMoveList(mv.items);
        setNatureList(nat.items);
        setTypeList(types.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const pool = cfg?.pool ?? [];
  const selected = useMemo(() => {
    if (!cfg) return null;
    if (!selectedEntryId) return null;
    return cfg.pool.find((p) => p.id === selectedEntryId) ?? null;
  }, [cfg, selectedEntryId]);

  const loadDraftFromEntry = (entry: PoolEntry | null) => {
    if (!entry) {
      setDraftSet(blankSet(''));
      setDraftBaseText('');
      setDraftErr('');
      return;
    }

    const rawText = String(entry.setText ?? '');
    if (rawText.trim()) {
      try {
        const parsed = importTeam(rawText);
        if (parsed.length) {
          const set = parsed[0];
          const canonical = exportSet(set);
          setDraftSet(set);
          setDraftBaseText(normalizeSetText(canonical));
          setDraftErr('');
          return;
        }
      } catch (e: any) {
        setDraftErr(String(e?.message ?? e));
      }
    }

    if (hasLegacyFields(entry)) {
      const set = legacyEntryToSet(entry);
      const canonical = exportSet(set);
      setDraftSet(set);
      setDraftBaseText(normalizeSetText(canonical));
      if (rawText.trim()) {
        setDraftErr('Stored setText failed to import; loaded legacy fields instead.');
      } else {
        setDraftErr('');
      }
      return;
    }

    const fallback = blankSet(String(entry.species ?? '').trim());
    setDraftSet(fallback);
    setDraftBaseText(normalizeSetText(rawText));
    if (rawText.trim()) {
      setDraftErr('Stored setText failed to import; showing a blank draft.');
    } else {
      setDraftErr('');
    }
  };

  useEffect(() => {
    loadDraftFromEntry(selected);
    setSearchMode(null);
    setSearchQuery('');
    setSearchMoveIndex(undefined);
  }, [selectedEntryId, selected?.setText, selected?.species]);

  useEffect(() => {
    let cancelled = false;
    const sp = String(draftSet?.species ?? '').trim();
    if (!sp) {
      setSpeciesDetail(null);
      return () => {
        cancelled = true;
      };
    }
    apiSpeciesDetail(sp)
      .then((d) => {
        if (cancelled) return;
        setSpeciesDetail(d);
      })
      .catch(() => {
        if (cancelled) return;
        setSpeciesDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [draftSet?.species]);

  useEffect(() => {
    if (searchMode !== 'move') {
      setMoveSearchItems([]);
      setMoveSearchErr('');
      setMoveSearchLoading(false);
      return;
    }

    const q = searchQuery.trim();
    if (!q) {
      setMoveSearchItems([]);
      setMoveSearchErr('');
      setMoveSearchLoading(false);
      return;
    }

    let cancelled = false;
    setMoveSearchLoading(true);
    setMoveSearchErr('');

    const t = setTimeout(() => {
      apiMoveSearch(q, 120)
        .then((r) => {
          if (cancelled) return;
          setMoveSearchItems(r.items.map(toMoveItem));
        })
        .catch((e) => {
          if (cancelled) return;
          setMoveSearchErr(String(e?.message ?? e));
        })
        .finally(() => {
          if (cancelled) return;
          setMoveSearchLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchMode, searchQuery]);

  const draftExportText = useMemo(() => exportSet(draftSet), [draftSet]);
  const draftDirty = useMemo(() => {
    if (!selected) return false;
    if (draftErr) return true;
    return normalizeSetText(draftExportText) !== normalizeSetText(draftBaseText);
  }, [draftErr, draftExportText, draftBaseText, selected]);
  const canSave = Boolean(cfg) && (cfgDirty || (draftDirty && selected));

  const updateDraftSet = (next: PokemonSet) => {
    setDraftSet(next);
    if (draftErr) setDraftErr('');
  };

  const addBlank = () => {
    if (!cfg) return;
    const id = newEntryId();
    const entry: PoolEntry = { id, species: '', setText: '' };
    const nextCfg: PoolConfig = { ...cfg, pool: [...cfg.pool, entry] };
    setCfg(nextCfg);
    setCfgDirty(true);
    setSaveMsg('');
    setSelectedEntryId(id);
  };

  const addFromSpecies = () => {
    if (!cfg) return;
    const sp = addSpecies.trim();
    if (!sp) return;
    const entry = makeEntryFromSet(blankSet(sp));
    const nextCfg: PoolConfig = { ...cfg, pool: [...cfg.pool, entry] };
    setCfg(nextCfg);
    setCfgDirty(true);
    setSaveMsg('');
    setSelectedEntryId(entry.id);
    setAddSpecies('');
  };

  const bulkAdd = () => {
    if (!cfg) return;
    setErr('');
    setBulkMsg('');
    let sets: PokemonSet[] = [];
    try {
      sets = importTeam(bulkText);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      return;
    }
    if (!sets.length) {
      setBulkMsg('No valid sets found.');
      return;
    }

    const existing = new Set(pool.map((p) => normalizeSetText(String(p.setText ?? ''))).filter(Boolean));
    const nextEntries: PoolEntry[] = [];
    let skipped = 0;
    for (const set of sets) {
      const sp = String(set.species ?? '').trim();
      if (!sp) {
        skipped += 1;
        continue;
      }
      const text = exportSet(set);
      const key = normalizeSetText(text);
      if (!key || existing.has(key)) {
        skipped += 1;
        continue;
      }
      existing.add(key);
      nextEntries.push(makeEntryFromSet(set));
    }

    if (!nextEntries.length) {
      setBulkMsg('All sets were duplicates or invalid.');
      return;
    }

    const nextCfg: PoolConfig = { ...cfg, pool: [...cfg.pool, ...nextEntries] };
    setCfg(nextCfg);
    setCfgDirty(true);
    setSaveMsg('');
    setBulkMsg(`Added ${nextEntries.length}, skipped ${skipped}.`);
    if (!selectedEntryId) {
      setSelectedEntryId(nextEntries[0].id);
    }
  };

  const deleteSelected = () => {
    if (!cfg) return;
    if (!selectedEntryId) return;
    const idx = cfg.pool.findIndex((p) => p.id === selectedEntryId);
    if (idx < 0) return;
    const nextPool = cfg.pool.filter((p) => p.id !== selectedEntryId);
    const nextCfg: PoolConfig = { ...cfg, pool: nextPool };
    setCfg(nextCfg);
    setCfgDirty(true);
    setSaveMsg('');
    if (nextPool.length === 0) {
      setSelectedEntryId(null);
      return;
    }
    const nextIdx = Math.min(idx, nextPool.length - 1);
    setSelectedEntryId(nextPool[nextIdx].id);
  };

  const applyDraft = () => {
    if (!cfg || !selected) return;
    const nextText = String(draftExportText ?? '');
    const nextSpecies = String(draftSet.species ?? '').trim();
    const updated: PoolEntry = { ...selected, species: nextSpecies, setText: nextText };
    const nextCfg: PoolConfig = {
      ...cfg,
      pool: cfg.pool.map((p) => (p.id === selected.id ? updated : p)),
    };
    setCfg(nextCfg);
    setCfgDirty(true);
    setSaveMsg('');
    setDraftBaseText(normalizeSetText(nextText));
    setDraftErr('');
  };

  const resetDraft = () => {
    loadDraftFromEntry(selected);
  };

  const speciesIconUrl = (sp: string): string | undefined => {
    const s = (sp ?? '').trim().toLowerCase();
    const it = speciesList.find((x) => x.name.toLowerCase() === s);
    return it?.icon_url;
  };

  const allowedAbilities = useMemo(() => {
    const allowed = new Set(
      (speciesDetail?.abilities ?? [])
        .map((a) => String(a ?? '').trim())
        .filter(Boolean)
        .map((n) => n.toLowerCase()),
    );
    if (!allowed.size) return toSimple(abilityList);
    return toSimple(abilityList).filter((a) => String(a?.name ?? '').toLowerCase() && allowed.has(String(a?.name ?? '').toLowerCase()));
  }, [abilityList, speciesDetail]);

  const itemIcon = useMemo(() => {
    const found = findDexItemByName(itemList, draftSet.item ?? '');
    return found?.icon ?? null;
  }, [itemList, draftSet.item]);

  const resultsSpec = useMemo(() => {
    if (!selected) {
      return {
        mode: null as PsSearchMode,
        header: 'Results',
        items: [] as SimpleDexItem[],
        currentValue: '',
      };
    }

    if (searchMode === 'pokemon') {
      return { mode: searchMode, header: 'Pokemon', items: toSimple(speciesList), currentValue: draftSet.species ?? '' };
    }
    if (searchMode === 'item') {
      return { mode: searchMode, header: 'Items', items: toSimple(itemList), currentValue: draftSet.item ?? '' };
    }
    if (searchMode === 'ability') {
      return { mode: searchMode, header: 'Abilities', items: allowedAbilities, currentValue: draftSet.ability ?? '' };
    }
    if (searchMode === 'move') {
      const cur = (draftSet.moves ?? [])[searchMoveIndex ?? 0] ?? '';
      const items = searchQuery.trim() ? moveSearchItems : toSimple(moveList);
      return { mode: searchMode, header: 'Moves', items, currentValue: cur };
    }
    if (searchMode === 'stats') {
      return { mode: searchMode, header: 'EVs, IVs, and Nature', items: [] as SimpleDexItem[], currentValue: '' };
    }
    if (searchMode === 'details') {
      return { mode: searchMode, header: 'Details', items: [] as SimpleDexItem[], currentValue: '' };
    }
    if (searchMode === 'nature') {
      return { mode: searchMode, header: 'Nature', items: toSimple(natureList), currentValue: draftSet.nature ?? '' };
    }
    if (searchMode === 'teraType') {
      return { mode: searchMode, header: 'Tera Type', items: toSimple(typeList), currentValue: draftSet.teraType ?? '' };
    }
    return { mode: searchMode, header: 'Results', items: [] as SimpleDexItem[], currentValue: '' };
  }, [selected, draftSet, searchMode, searchMoveIndex, speciesList, itemList, allowedAbilities, moveList, natureList, typeList, searchQuery, moveSearchItems]);

  const pinnedResult = useMemo(
    () => findDexItemByName(resultsSpec.items, resultsSpec.currentValue || ''),
    [resultsSpec.items, resultsSpec.currentValue],
  );
  const pinnedPoolResults = useMemo(() => {
    if (searchMode !== 'pokemon') return [] as SimpleDexItem[];
    const names = Array.from(
      new Set(
        pool
          .map((entry) => String(entry.species ?? '').trim())
          .filter(Boolean),
      ),
    );
    const resolved: SimpleDexItem[] = [];
    for (const name of names) {
      const hit = findDexItemByName(resultsSpec.items, name);
      if (hit) resolved.push(hit);
    }
    return resolved;
  }, [searchMode, pool, resultsSpec.items]);

  const visibleResults = useMemo(() => {
    if (!resultsSpec.mode) return [] as SimpleDexItem[];
    if (resultsSpec.mode === 'import' || resultsSpec.mode === 'stats' || resultsSpec.mode === 'details') return [] as SimpleDexItem[];
    const base =
      resultsSpec.mode === 'move' && searchQuery.trim()
        ? resultsSpec.items.slice(0, 60)
        : applyQuery(resultsSpec.items, searchQuery.trim(), 60);
    const seen = new Set<string>();
    const merged: SimpleDexItem[] = [];
    const pushUnique = (it: SimpleDexItem | null) => {
      if (!it) return;
      const key = toIDLike(it.id || it.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(it);
    };
    for (const it of pinnedPoolResults) pushUnique(it);
    pushUnique(pinnedResult);
    for (const it of base) pushUnique(it);
    return merged;
  }, [resultsSpec.mode, resultsSpec.items, searchQuery, pinnedResult, pinnedPoolResults]);

  useEffect(() => {
    if (!visibleResults.length) {
      setResultsCursor(0);
      return;
    }
    setResultsCursor((c) => Math.max(0, Math.min(c, visibleResults.length - 1)));
  }, [visibleResults.length]);

  useEffect(() => {
    const active = searchMode && searchMode !== 'import';
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!searchMode || searchMode === 'import') return;
      if (searchMode === 'stats' || searchMode === 'details') {
        if (e.key === 'Escape') {
          e.preventDefault();
          setSearchMode(null);
          setSearchQuery('');
          setSearchMoveIndex(undefined);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        if (!visibleResults.length) return;
        e.preventDefault();
        setResultsCursor((c) => Math.min(c + 1, visibleResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        if (!visibleResults.length) return;
        e.preventDefault();
        setResultsCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        if (!visibleResults.length) return;
        e.preventDefault();
        const picked = visibleResults[Math.max(0, Math.min(resultsCursor, visibleResults.length - 1))];
        if (picked) onChooseResult(picked.name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSearchMode(null);
        setSearchQuery('');
        setSearchMoveIndex(undefined);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchMode, visibleResults, resultsCursor]);

  const nextMoveSlot = (moves: string[], fromIndex: number) => {
    for (let i = fromIndex + 1; i < 4; i++) {
      if (!moves[i]) return i;
    }
    for (let i = 0; i < 4; i++) {
      if (!moves[i]) return i;
    }
    return Math.min(fromIndex + 1, 3);
  };

  const onChooseResult = (name: string) => {
    if (!selected) return;

    if (searchMode === 'pokemon') {
      updateDraftSet({ ...draftSet, species: name });
      setSearchMode('ability');
      setSearchQuery('');
      setSearchMoveIndex(undefined);
      requestFocus('ability');
      return;
    }
    if (searchMode === 'item') {
      updateDraftSet({ ...draftSet, item: name });
      const nextIndex = nextMoveSlot(ensureMoves4(draftSet.moves), -1);
      setSearchMode('move');
      setSearchQuery('');
      setSearchMoveIndex(nextIndex);
      requestFocus('move', nextIndex);
      return;
    }
    if (searchMode === 'ability') {
      updateDraftSet({ ...draftSet, ability: name });
      setSearchMode('item');
      setSearchQuery('');
      setSearchMoveIndex(undefined);
      requestFocus('item');
      return;
    }
    if (searchMode === 'move') {
      const idx = searchMoveIndex ?? 0;
      const moves = ensureMoves4(draftSet.moves);
      while (moves.length < 4) moves.push('');
      const existingIndex = moves.findIndex((m, i) => i !== idx && toIDLike(m) === toIDLike(name));
      if (existingIndex >= 0) moves[existingIndex] = '';
      moves[idx] = name;
      updateDraftSet({ ...draftSet, moves });
      if (moves.every((m) => String(m ?? '').trim())) {
        setSearchMode('stats');
        setSearchQuery('');
        setSearchMoveIndex(undefined);
      } else {
        const nextIndex = nextMoveSlot(moves, idx);
        setSearchMode('move');
        setSearchQuery('');
        setSearchMoveIndex(nextIndex);
        requestFocus('move', nextIndex);
      }
      return;
    }
    if (searchMode === 'nature') {
      updateDraftSet({ ...draftSet, nature: name as any });
      setSearchMode(null);
      setSearchQuery('');
      setSearchMoveIndex(undefined);
      return;
    }
    if (searchMode === 'teraType') {
      updateDraftSet({ ...draftSet, teraType: name });
      setSearchMode(null);
      setSearchQuery('');
      setSearchMoveIndex(undefined);
      return;
    }
  };

  const openImportExport = () => {
    if (!selected) return;
    setSearchMode('import');
    setSearchQuery('');
    setSearchMoveIndex(undefined);
    setImportExportText(draftExportText);
  };

  const doImport = () => {
    if (!selected) return;
    try {
      const sets = importTeam(importExportText);
      if (!sets.length) {
        setDraftErr('Import failed: no valid set found.');
        return;
      }
      const next = sets[0];
      if (!String(next.species ?? '').trim()) {
        setDraftErr('Import failed: Species is empty.');
        return;
      }
      updateDraftSet({ ...blankSet(next.species), ...next, moves: next.moves });
      setDraftErr('');
    } catch (e: any) {
      setDraftErr(String(e?.message ?? e));
    }
  };

  const entryLabel = (entry: PoolEntry) => {
    const sp = String(entry.species ?? '').trim();
    return sp || '(blank)';
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => {
            setErr('');
            setSaveMsg('');
            if (!cfg) return;
            let nextCfg: PoolConfig = cfg;
            let nextDraftBase: string | null = null;
            if (selected && draftDirty) {
              const nextText = String(draftExportText ?? '');
              const nextSpecies = String(draftSet.species ?? '').trim();
              const updated: PoolEntry = { ...selected, species: nextSpecies, setText: nextText };
              nextCfg = {
                ...cfg,
                pool: cfg.pool.map((p) => (p.id === selected.id ? updated : p)),
              };
              nextDraftBase = normalizeSetText(nextText);
            }
            const payload = sanitizePoolConfig(nextCfg);
            apiPut<PoolConfig>('/api/config/pool', payload)
              .then((saved) => {
                const normalized = normalizePoolConfig(saved);
                setCfg(normalized.cfg);
                setCfgDirty(normalized.dirty);
                if (nextDraftBase !== null) {
                  setDraftBaseText(nextDraftBase);
                  setDraftErr('');
                }
                setSaveMsg('Saved');
              })
              .catch((e) => setErr(String(e?.message ?? e)));
          }}
        >
          Save
        </button>
        {saveMsg ? <span style={{ fontSize: 12, color: '#0a7', fontWeight: 700 }}>{saveMsg}</span> : null}
        {err ? <span style={{ fontSize: 12, color: 'crimson' }}>{err}</span> : null}
      </div>

      {!cfg ? (
        <div style={{ padding: 10 }}>{err ? <span style={{ color: 'crimson' }}>{err}</span> : 'loading...'}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 150px)', minHeight: 520 }}>
          <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ border: '1px solid #ddd', borderRadius: 8, background: 'white', padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Add to pool</div>
              <IconCombobox
                label="species"
                value={addSpecies}
                onChange={setAddSpecies}
                items={speciesList}
                placeholder="Search species"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={addFromSpecies} disabled={!addSpecies.trim()}>
                  Add
                </button>
                <button type="button" onClick={addBlank}>
                  Add blank
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkOpen((o) => !o);
                    setBulkMsg('');
                  }}
                >
                  {bulkOpen ? 'Close bulk' : 'Bulk add'}
                </button>
              </div>
              {bulkOpen ? (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    rows={8}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={'Paste multiple sets (Showdown export)'}
                    style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button type="button" onClick={bulkAdd}>
                      Add sets
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkText('');
                        setBulkMsg('');
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  {bulkMsg ? <div style={{ marginTop: 6, fontSize: 12, color: '#444' }}>{bulkMsg}</div> : null}
                </div>
              ) : null}
            </div>

            <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, background: 'white', overflow: 'auto' }}>
              {pool.length === 0 ? (
                <div style={{ padding: 10, color: '#666' }}>No entries yet.</div>
              ) : (
                pool.map((p, idx) => {
                  const active = p.id === selectedEntryId;
                  const label = entryLabel(p);
                  const icon = speciesIconUrl(p.species);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedEntryId(p.id);
                        setSearchMode(null);
                        setSearchQuery('');
                        setSearchMoveIndex(undefined);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        border: 0,
                        borderBottom: '1px solid #f0f0f0',
                        background: active ? '#f5f5f5' : 'white',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 32, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        {icon ? <img src={icon} alt="" width={32} height={24} /> : null}
                      </span>
                      <span style={{ flex: 1, fontWeight: active ? 700 : 500 }}>{label}</span>
                      <span style={{ fontSize: 12, color: '#999' }}>{idx + 1}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 640 }}>
            <div
              ref={teambuilderRef}
              className="ps-teambuilder"
              style={{ position: 'relative', height: '100%', minHeight: 520, minWidth: 0 }}
            >
              <div id="room-teambuilder" className="ps-room ps-room-light scrollable">
                <div className="teamwrapper" style={{ position: 'relative', height: '100%' }}>
                  <div className="pad" />

                  <div className="teamchartbox individual">
                    <ol className="teamchart">
                      {selected ? (
                        <PsSetChart
                          set={draftSet}
                          speciesDetail={speciesDetail}
                          itemIcon={itemIcon}
                          onChange={updateDraftSet}
                          onDelete={deleteSelected}
                          onApply={applyDraft}
                          onReset={resetDraft}
                          canApply={draftDirty}
                          canReset={draftDirty}
                          onOpenImportExport={openImportExport}
                          onFocusField={(mode, q, moveIndex) => {
                            setSearchMode(mode);
                            setSearchQuery(q);
                            setSearchMoveIndex(moveIndex);
                            setResultsCursor(0);
                          }}
                          focusField={focusField}
                          onOpenStats={() => {
                            setSearchMode('stats');
                            setSearchQuery('');
                            setSearchMoveIndex(undefined);
                            setResultsCursor(0);
                          }}
                          onOpenDetails={() => {
                            setSearchMode('details');
                            setSearchQuery('');
                            setSearchMoveIndex(undefined);
                            setResultsCursor(0);
                          }}
                        />
                      ) : (
                        <li>
                          <div className="pad" style={{ color: '#666' }}>
                            Select an entry or add a new one.
                          </div>
                        </li>
                      )}
                    </ol>
                  </div>

                  {searchMode === 'stats' ? (
                    <PsStatsForm
                      set={draftSet}
                      speciesDetail={speciesDetail}
                      onChange={updateDraftSet}
                    />
                  ) : searchMode === 'details' ? (
                    <PsDetailsForm
                      set={draftSet}
                      speciesDetail={speciesDetail}
                      typeOptions={typeList}
                      onChange={updateDraftSet}
                    />
                  ) : (
                    <PsTeambuilderResults
                      mode={resultsSpec.mode}
                      query={searchQuery}
                      header={resultsSpec.header}
                      items={resultsSpec.items}
                      visibleItems={visibleResults}
                      currentValue={resultsSpec.currentValue}
                      onChoose={onChooseResult}
                      cursorIndex={resultsSpec.mode && resultsSpec.mode !== 'import' ? resultsCursor : undefined}
                    />
                  )}

                <div
                  className="teambuilder-pokemon-import"
                  style={{
                    display: resultsSpec.mode === 'import' ? 'block' : 'none',
                    zIndex: 2,
                  }}
                >
                    <div className="pokemonedit-buttons" style={{ marginBottom: 6, display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setSearchMode(null);
                          setSearchQuery('');
                          setSearchMoveIndex(undefined);
                        }}
                      >
                        Back
                      </button>{' '}
                      <button type="button" className="button" onClick={doImport}>
                        Import
                      </button>
                    </div>
                    <textarea
                      className="pokemonedit textbox"
                      rows={14}
                      value={importExportText}
                      onChange={(e) => setImportExportText(e.target.value)}
                      spellCheck={false}
                    />
                    <div className="teambuilder-import-smogon-sets" />
                    <div className="teambuilder-import-user-sets" />
                    <div style={{ marginTop: 8 }}>
                      <div className="resultheader">
                        <h3>Export</h3>
                      </div>
                      <textarea className="textbox" rows={14} value={draftExportText ?? ''} readOnly spellCheck={false} />
                    </div>
                  </div>

                  {draftErr ? (
                    <div style={{ position: 'absolute', bottom: 28, left: 8, right: 8, color: 'crimson', fontSize: 12 }}>
                      {draftErr}
                    </div>
                  ) : null}

                  {searchMode === 'move' && moveSearchLoading ? (
                    <div style={{ position: 'absolute', bottom: 8, left: 8, color: '#666', fontSize: 12 }}>
                      loading moves...
                    </div>
                  ) : null}

                  {searchMode === 'move' && moveSearchErr ? (
                    <div style={{ position: 'absolute', bottom: 8, left: 8, color: 'crimson', fontSize: 12 }}>
                      {moveSearchErr}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
