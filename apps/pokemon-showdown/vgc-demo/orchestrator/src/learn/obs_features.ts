export function extractRequestFeatures(req: any) {
  const side = req?.side ?? {};
  const pokemon = Array.isArray(side?.pokemon) ? side.pokemon : [];
  const activeSide = pokemon
    .filter((p: any) => p && typeof p === 'object')
    .map((p: any) => ({
      active: !!p.active,
      fainted: !!p.fainted,
      condition: String(p.condition ?? ''),
      ident: String(p.ident ?? ''),
    }));

  const active = Array.isArray(req?.active) ? req.active : [];
  const activeMoves = active
    .filter((a: any) => a && typeof a === 'object')
    .slice(0, 2)
    .map((a: any) => {
      const moves = Array.isArray(a?.moves) ? a.moves : [];
      return {
        canDynamax: !!a?.canDynamax,
        moves: moves.slice(0, 4).map((m: any) => ({
          id: String(m?.id ?? ''),
          target: m?.target,
          disabled: !!m?.disabled,
        })),
      };
    });

  return {
    teamPreview: !!req?.teamPreview,
    wait: !!req?.wait,
    canSwitch: !!req?.canSwitch,
    forceSwitch: req?.forceSwitch,
    activeCount: active.length,
    activeMoves,
    side: { pokemon: activeSide },
  };
}
