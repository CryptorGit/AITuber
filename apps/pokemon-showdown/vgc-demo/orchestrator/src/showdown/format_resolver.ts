import * as DexMod from '../../../../../../tools/pokemon-showdown/pokemon-showdown/sim/dex';

const Dex: any = (DexMod as any).default?.Dex ?? (DexMod as any).Dex ?? (DexMod as any).default;

export type FormatResolution =
  | { ok: true; id: string }
  | { ok: false; error: string; candidates: { id: string; name: string }[] };

export function resolveFormatIdOrSuggest(inputId: string): FormatResolution {
  try {
    Dex.includeFormats();
    const fmt = Dex.formats.get(inputId, true);
    if (fmt?.exists) return { ok: true, id: fmt.id };
    const candidates = listVgcFormatCandidates();
    return {
      ok: false,
      error: `Format not found: ${inputId}`,
      candidates,
    };
  } catch (e: any) {
    const candidates = listVgcFormatCandidates();
    return {
      ok: false,
      error: `Failed to resolve format: ${inputId} (${e?.message ?? e})`,
      candidates,
    };
  }
}

export function listVgcFormatCandidates(): { id: string; name: string }[] {
  Dex.includeFormats();
  return Dex.formats
    .all()
    .filter((f) => (f?.name ?? '').toLowerCase().includes('vgc'))
    .map((f) => ({ id: f.id, name: f.name }))
    .slice(0, 200);
}
