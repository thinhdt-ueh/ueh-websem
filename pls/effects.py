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


@dataclass
class ModeratedMediationOpportunity:
    """A mediated route with exactly one moderated edge, i.e. a construct
    `w` such that its interaction with `route[i]` (`interaction_id`) has a
    direct path into `route[i + 1]`. Index of moderated mediation (Hayes,
    2015): the indirect effect through this route is a linear function of
    the moderator, θ(w) = (product of the route's other edges) * (a_i +
    a_interaction * w); the "index" is its slope, (product of other edges)
    * a_interaction — how much the indirect effect changes per unit of w."""

    route: list[str]
    moderated_index: int  # position i in `route` such that route[i]->route[i+1] is moderated
    interaction_id: str
    moderator_id: str


def find_moderated_mediation_opportunities(model: Model) -> list[ModeratedMediationOpportunity]:
    """Every mediated route (see `enumerate_indirect_routes`) that has
    exactly one edge moderated by an interaction construct. A route with
    zero such edges is plain (unmoderated) mediation — nothing to report
    here. A route with *two or more* moderated edges ("both-stage"
    moderated mediation, e.g. PROCESS Model 58/59, or two different
    moderators each targeting the same edge) is deliberately skipped: the
    indirect effect there is a bilinear — not linear — function of the
    moderator(s) (θ(w1, w2) picks up a w1*w2 cross-term), so Hayes (2015)
    doesn't define a single scalar "index" for it; reporting one anyway
    would misrepresent the model as simpler than it is. That case needs
    conditional probing at representative values instead, which this
    function does not attempt.
    """
    # (focal_source, target) -> [interaction construct ids that moderate it]
    moderators_of_edge: dict[tuple[str, str], list[str]] = {}
    for c in model.constructs.values():
        if c.mode != "I" or not c.interaction_of:
            continue
        a, b = c.interaction_of
        for target in model.successors(c.id):
            moderators_of_edge.setdefault((a, target), []).append(c.id)
            moderators_of_edge.setdefault((b, target), []).append(c.id)

    candidates: list[ModeratedMediationOpportunity] = []
    for route in enumerate_indirect_routes(model):
        # A route starting *at* an interaction construct itself (its own
        # a3-style edge into the mediator) isn't a moderated-mediation
        # opportunity in Hayes' sense — an interaction term is a structural
        # byproduct (X*W), never a substantive variable a researcher treats
        # as the start of a mediation chain. Without this guard, a route
        # like [x_w1, m, y] where m->y also happens to be moderated by a
        # second construct would be misread as ordinary first-stage-style
        # moderated mediation, when it's really a fragment of a both-stage
        # model (already excluded below) attached to the wrong edge.
        if model.constructs[route[0]].mode == "I":
            continue
        hits = [
            (i, moderators_of_edge[(a, b)][0])
            for i, (a, b) in enumerate(zip(route, route[1:]))
            if len(moderators_of_edge.get((a, b), [])) == 1
        ]
        if len(hits) != 1:
            continue
        i, interaction_id = hits[0]
        ic = model.constructs[interaction_id]
        focal = route[i]
        moderator_id = ic.interaction_of[1] if ic.interaction_of[0] == focal else ic.interaction_of[0]
        candidates.append(ModeratedMediationOpportunity(
            route=route, moderated_index=i, interaction_id=interaction_id, moderator_id=moderator_id,
        ))

    # Both of an interaction's sources independently satisfy the model's
    # "both sources need a direct main-effect path to the interaction's
    # target" requirement, so when the moderated edge is a route's very
    # first edge, BOTH "focal-starts-the-route" directions get discovered
    # as separate routes (e.g. x->m->y moderated by w, and w->m->y
    # moderated by x) — but the index (interaction coefficient * the rest
    # of the route) is the exact same number either way, since which
    # source is called "focal" vs. "moderator" doesn't change what's being
    # multiplied. Keep one canonical direction per distinct downstream
    # effect (same interaction, same route *after* the moderated edge),
    # picked deterministically by the focal construct's id so results don't
    # depend on dict/DFS iteration order.
    seen: dict[tuple[str, tuple[str, ...]], ModeratedMediationOpportunity] = {}
    for opp in candidates:
        key = (opp.interaction_id, tuple(opp.route[opp.moderated_index + 1:]))
        current = seen.get(key)
        if current is None or opp.route[opp.moderated_index] < current.route[current.moderated_index]:
            seen[key] = opp
    return list(seen.values())


@dataclass
class ModeratedMediationRow:
    route: list[str]
    moderated_index: int
    interaction_id: str
    moderator_id: str
    index: float


def moderated_mediation_indices(
    model: Model, coef: dict[str, dict[str, float]]
) -> list[ModeratedMediationRow]:
    """Point-estimate index of moderated mediation for each opportunity
    found by `find_moderated_mediation_opportunities`: the product of the
    route's edges, with the moderated edge's coefficient replaced by the
    moderating interaction construct's own coefficient into the same
    target (see `ModeratedMediationOpportunity`'s docstring for why that
    substitution is exactly the index)."""
    rows: list[ModeratedMediationRow] = []
    for opp in find_moderated_mediation_opportunities(model):
        index = 1.0
        for i, (a, b) in enumerate(zip(opp.route, opp.route[1:])):
            if i == opp.moderated_index:
                index *= float(coef.get(opp.interaction_id, {}).get(b, 0.0))
            else:
                index *= float(coef.get(a, {}).get(b, 0.0))
        rows.append(ModeratedMediationRow(
            route=opp.route, moderated_index=opp.moderated_index,
            interaction_id=opp.interaction_id, moderator_id=opp.moderator_id, index=index,
        ))
    return rows
