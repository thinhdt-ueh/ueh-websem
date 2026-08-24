"""Total & specific indirect effects — the standard way SEM tools (SmartPLS's
"Total Effects" / "Specific Indirect Effects" reports) quantify mediation: for
any pair of constructs connected through one or more intermediate constructs,
the *indirect* effect is the sum, over every directed path between them, of
the product of that path's edge coefficients; the *total* effect is direct +
indirect. Works on any {source: {target: coefficient}}-shaped path-coefficient
table, so the same function serves both PLS-SEM (path_coefficients) and
CB-SEM (its structural "std" column, pivoted the same way) — mediation is a
structural-model property, independent of how the outer/measurement model was
estimated.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import Model


@dataclass
class EffectRow:
    source: str
    target: str
    direct: float
    indirect: float
    total: float


def total_effects(model: Model, coef: dict[str, dict[str, float]]) -> list[EffectRow]:
    """`coef[source][target]` must give the direct structural coefficient for that
    edge (only defined where model.paths has that edge). The model is guaranteed
    acyclic (validated at load time), so plain memoized recursion terminates."""
    memo: dict[tuple[str, str], tuple[float, float, float]] = {}

    def resolve(s: str, t: str) -> tuple[float, float, float]:
        key = (s, t)
        if key in memo:
            return memo[key]
        direct = float(coef.get(s, {}).get(t, 0.0)) if t in model.successors(s) else 0.0
        indirect = 0.0
        for m in model.successors(s):
            if m == t:
                continue
            coef_sm = float(coef.get(s, {}).get(m, 0.0))
            if coef_sm == 0.0:
                continue
            _, _, total_mt = resolve(m, t)
            indirect += coef_sm * total_mt
        total = direct + indirect
        memo[key] = (direct, indirect, total)
        return memo[key]

    rows: list[EffectRow] = []
    ids = list(model.constructs.keys())
    for s in ids:
        for t in ids:
            if s == t:
                continue
            direct, indirect, total = resolve(s, t)
            if direct != 0.0 or indirect != 0.0:
                rows.append(EffectRow(source=s, target=t, direct=direct, indirect=indirect, total=total))
    return rows


@dataclass
class SpecificIndirectRow:
    path: list[str]
    effect: float


def enumerate_indirect_routes(model: Model) -> list[list[str]]:
    """Every distinct directed simple route of two or more edges between any
    two constructs — i.e. every specific mediated path a "Specific Indirect
    Effects" report breaks the aggregate indirect effect into (SmartPLS's
    report of the same name). The model graph is guaranteed acyclic
    (validated at load time), so a plain DFS that refuses to revisit a
    construct already on the current route both terminates and never double
    counts a path."""
    routes: list[list[str]] = []

    def dfs(path: list[str]) -> None:
        current = path[-1]
        for nxt in model.successors(current):
            if nxt in path:
                continue
            extended = path + [nxt]
            if len(extended) >= 3:
                routes.append(extended)
            dfs(extended)

    for start in model.constructs:
        dfs([start])
    return routes


def specific_indirect_effects(
    model: Model, coef: dict[str, dict[str, float]]
) -> list[SpecificIndirectRow]:
    """Point-estimate specific indirect effects: the product of the direct
    structural coefficients along each individual mediated route (as opposed
    to `total_effects`, which sums these across every route between a pair)."""
    rows: list[SpecificIndirectRow] = []
    for route in enumerate_indirect_routes(model):
        effect = 1.0
        for a, b in zip(route, route[1:]):
            effect *= float(coef.get(a, {}).get(b, 0.0))
        rows.append(SpecificIndirectRow(path=route, effect=effect))
    return rows
