from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple


def _extract_candidates_from_request(req: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return (moves, switches) candidate lists from a player-view request JSON.

    This function intentionally only uses fields present in request JSON.
    """
    active = (req.get("active") or [])
    side = (req.get("side") or {})

    moves: List[Dict[str, Any]] = []
    # In doubles, active is usually length 2. Each element has a 'moves' list.
    for active_index, a in enumerate(active):
        if not isinstance(a, dict):
            continue
        for move_index, m in enumerate(a.get("moves") or []):
            if m.get("disabled"):
                continue
            # Some formats include "pp"/"maxpp" etc; we just pass through.
            moves.append({
                "active": active_index,
                "move_index": move_index,
                "id": m.get("id"),
                "move": m.get("move"),
                "target": m.get("target"),
            })

    switches: List[Dict[str, Any]] = []
    can_switch = bool(req.get("canSwitch"))
    force_switch = bool(req.get("forceSwitch"))

    if can_switch or force_switch:
        pokemon = side.get("pokemon") or []
        # Convention: side.pokemon includes active mons at the front with active:true
        for slot_index, p in enumerate(pokemon, start=1):
            if p.get("active"):
                continue
            if p.get("condition") in ("0 fnt", "0fnt"):
                continue
            if p.get("fainted"):
                continue
            switches.append({"slot": slot_index, "ident": p.get("ident"), "details": p.get("details")})

    return moves, switches


def _target_suffix(move_target: Optional[str], move_id: Optional[str] = None, move_name: Optional[str] = None) -> str:
    """Return a minimal target suffix for Showdown choose strings.

    Only add a target when the request target indicates a selectable target.
    """
    mid = (move_id or "").strip().lower()
    mname = (move_name or "").strip().lower()
    # Some request payloads can report `target` as "normal" for moves that should not
    # accept a target arg (e.g. Protect, Rock Slide). Use request-visible id/name to override.
    no_target_ids = {
        # Protect family / guards
        "protect",
        "detect",
        "spikyshield",
        "kingsshield",
        "banefulbunker",
        "silktrap",
        "obstruct",
        "endure",
        "wideguard",
        "quickguard",
        "craftyshield",
        "matblock",
        # Common VGC spread/no-target moves in our demo pool
        "rockslide",
        "icywind",
        "makeitrain",
        "bleakwindstorm",
        # Redirection
        "followme",
        "ragepowder",
        # Side/self setup
        "tailwind",
        "nastyplot",
    }
    no_target_names = {
        "protect",
        "spiky shield",
        "rock slide",
        "icy wind",
        "make it rain",
        "bleakwind storm",
        "follow me",
        "rage powder",
        "tailwind",
        "nasty plot",
    }
    if mid in no_target_ids or mname in no_target_names:
        return ""

    if not move_target:
        return ""
    t = str(move_target)
    if t in ("normal", "adjacentFoe"):
        return " 1"  # first foe
    if t in ("adjacentAlly", "ally", "adjacentAllyOrSelf"):
        return " -1"  # partner
    return ""


def random_policy_choose(req: Dict[str, Any], rng: random.Random) -> str:
    # Team preview: choose team order (first two are leads in doubles).
    if req.get("teamPreview"):
        pokemon = (req.get("side") or {}).get("pokemon") or []
        order = list(range(1, len(pokemon) + 1))
        rng.shuffle(order)
        return f"team {''.join(str(i) for i in order)}"

    moves, switches = _extract_candidates_from_request(req)

    # Forced switch (doubles may require multiple switches).
    force_switch = req.get("forceSwitch")
    if isinstance(force_switch, list) and any(force_switch):
        available = list(switches)
        picks: List[str] = []
        for need in force_switch:
            if not need:
                continue
            if available:
                s = rng.choice(available)
                available.remove(s)
                picks.append(f"switch {s['slot']}")
            else:
                picks.append("pass")
        if picks:
            return ", ".join(picks)

    # If forced switch and switch exists, prefer switching.
    if req.get("forceSwitch") and switches:
        target = rng.choice(switches)
        return f"switch {target['slot']}"

    candidates: List[str] = []

    # Moves: default choose is "move <n>"; for doubles, we need per-active choices.
    # For simplicity we choose a single move for the first active unless request specifies otherwise.
    # If request indicates multiple actives, we will return a comma-separated set of choices.
    side_pokemon = (req.get("side") or {}).get("pokemon") or []
    active_count_side = 0
    for p in side_pokemon:
        if not isinstance(p, dict):
            continue
        if not p.get("active"):
            continue
        if p.get("fainted"):
            continue
        cond = str(p.get("condition") or "")
        if cond in ("0 fnt", "0fnt"):
            continue
        active_count_side += 1
    active_count_req = sum(1 for a in (req.get("active") or []) if isinstance(a, dict))
    active_count = active_count_side or active_count_req

    if active_count <= 1:
        if moves:
            m = rng.choice(moves)
            move_slot = m["move_index"] + 1
            return f"move {move_slot}{_target_suffix(m.get('target'), m.get('id'), m.get('move'))}"
        if switches:
            target = rng.choice(switches)
            return f"switch {target['slot']}"
        return "default"

    # Doubles: build one action per active index.
    per_active: List[str] = []
    active_indices = sorted({m["active"] for m in moves})
    if not active_indices:
        active_indices = list(range(active_count))
    for active_index in active_indices[:active_count]:
        moves_ai = [m for m in moves if m["active"] == active_index]
        if moves_ai:
            m = rng.choice(moves_ai)
            per_active.append(
                f"move {m['move_index'] + 1}{_target_suffix(m.get('target'), m.get('id'), m.get('move'))}"
            )
        elif switches:
            target = rng.choice(switches)
            per_active.append(f"switch {target['slot']}")
        else:
            per_active.append("default")

    return ", ".join(per_active)


def heuristic_policy_choose(req: Dict[str, Any], rng: random.Random) -> str:
    """A simple demo policy: prefer damaging moves; rarely Protect; occasional switch."""
    # Team preview: choose team order (first two are leads in doubles).
    if req.get("teamPreview"):
        pokemon = (req.get("side") or {}).get("pokemon") or []
        order = list(range(1, len(pokemon) + 1))
        rng.shuffle(order)
        return f"team {''.join(str(i) for i in order)}"

    moves, switches = _extract_candidates_from_request(req)

    # Forced switch (doubles may require multiple switches).
    force_switch = req.get("forceSwitch")
    if isinstance(force_switch, list) and any(force_switch):
        available = list(switches)
        picks: List[str] = []
        for need in force_switch:
            if not need:
                continue
            if available:
                s = rng.choice(available)
                available.remove(s)
                picks.append(f"switch {s['slot']}")
            else:
                picks.append("pass")
        if picks:
            return ", ".join(picks)

    if req.get("forceSwitch") and switches:
        target = rng.choice(switches)
        return f"switch {target['slot']}"

    side_pokemon = (req.get("side") or {}).get("pokemon") or []
    active_count_side = 0
    for p in side_pokemon:
        if not isinstance(p, dict):
            continue
        if not p.get("active"):
            continue
        if p.get("fainted"):
            continue
        cond = str(p.get("condition") or "")
        if cond in ("0 fnt", "0fnt"):
            continue
        active_count_side += 1
    active_count_req = sum(1 for a in (req.get("active") or []) if isinstance(a, dict))
    active_count = active_count_side or active_count_req

    def score_move(m: Dict[str, Any]) -> float:
        name = (m.get("move") or "").lower()
        if "protect" in name or "spiky shield" in name or "detect" in name:
            return 0.2
        if "tailwind" in name or "trick room" in name:
            return 0.8
        # default: prefer likely-damaging
        return 1.0

    def pick_for_active(active_index: int) -> str:
        moves_ai = [m for m in moves if m["active"] == active_index]
        if switches and rng.random() < 0.08:
            target = rng.choice(switches)
            return f"switch {target['slot']}"
        if moves_ai:
            # weighted choice
            weights = [score_move(m) for m in moves_ai]
            total = sum(weights)
            if total <= 0:
                m = rng.choice(moves_ai)
            else:
                r = rng.random() * total
                acc = 0.0
                m = moves_ai[-1]
                for mm, w in zip(moves_ai, weights):
                    acc += w
                    if r <= acc:
                        m = mm
                        break
            return f"move {m['move_index'] + 1}{_target_suffix(m.get('target'), m.get('id'), m.get('move'))}"
        if switches:
            target = rng.choice(switches)
            return f"switch {target['slot']}"
        return "default"

    if active_count <= 1:
        return pick_for_active(0)

    active_indices = sorted({m["active"] for m in moves})
    if not active_indices:
        active_indices = list(range(active_count))
    return ", ".join(pick_for_active(i) for i in active_indices[:active_count])


def random_policy_select4(team_size: int, battle_size: int, rng: random.Random) -> List[int]:
    idxs = list(range(team_size))
    rng.shuffle(idxs)
    return sorted(idxs[:battle_size])


def heuristic_policy_select4(team6: Any, rng: random.Random) -> List[int]:
    """Very simple: pick first 4, but shuffle a bit to avoid deterministic mirror."""
    # team6 might be a request-derived structure; we treat as list-ish.
    team_size = 6
    try:
        if isinstance(team6, list):
            team_size = len(team6)
    except Exception:
        pass

    idxs = list(range(team_size))
    # Small shuffle, but keep mostly front-loaded
    if team_size >= 6:
        # swap two random positions
        a, b = rng.randrange(team_size), rng.randrange(team_size)
        idxs[a], idxs[b] = idxs[b], idxs[a]
    return sorted(idxs[:4])
