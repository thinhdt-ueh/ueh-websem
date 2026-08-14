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
