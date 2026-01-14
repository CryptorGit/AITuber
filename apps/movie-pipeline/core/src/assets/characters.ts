import fs from 'node:fs';
import path from 'node:path';
import { charactersRoot, ensureDir } from '../paths.ts';
import { readJson } from '../utils/io.ts';
import type { CharacterProfile } from '../types.ts';

export function defaultCharacterProfile(): CharacterProfile {
  return {
    character_id: 'builtin_simple',
    name: 'Simple Avatar',
    renderer: 'simple_canvas',
    avatar: {
      body_color: '#242424',
      accent_color: '#ff7a59',
      mouth_color: '#ffffff',
    },
    chroma_key: '#00ff00',
    width: 720,
    height: 720,
    fps: 30,
  };
}

export function listCharacters(): CharacterProfile[] {
  const root = charactersRoot();
  ensureDir(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: CharacterProfile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const profilePath = path.join(root, id, 'character.json');
    if (!fs.existsSync(profilePath)) continue;
    const profile = readJson<CharacterProfile | null>(profilePath, null);
    if (profile) {
      out.push({ ...profile, character_id: profile.character_id || id });
    }
  }
  return out;
}

export function loadCharacter(characterId: string | null | undefined): CharacterProfile {
  if (!characterId || characterId === 'builtin_simple') {
    const maoPath = path.join(charactersRoot(), 'mao_pro_en', 'character.json');
    if (fs.existsSync(maoPath)) {
      const mao = readJson<CharacterProfile | null>(maoPath, null);
      if (mao) return { ...mao, character_id: mao.character_id || 'mao_pro_en' };
    }
    return defaultCharacterProfile();
  }
  const profilePath = path.join(charactersRoot(), characterId, 'character.json');
  if (!fs.existsSync(profilePath)) return defaultCharacterProfile();
  const profile = readJson<CharacterProfile | null>(profilePath, null);
  if (!profile) return defaultCharacterProfile();
  return { ...profile, character_id: profile.character_id || characterId };
}
