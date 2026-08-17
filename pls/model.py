"""Data structures describing a PLS-SEM/CB-SEM model definition submitted by
the UI, including "interaction" constructs used for two-stage moderation
analysis (see pls/moderation.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from i18n import DEFAULT_LANG, t


class ModelError(ValueError):
    """Raised when a submitted model definition is invalid."""


# How an interaction/moderation construct's score is formed:
# - "two_stage": multiply the two source constructs' STAGE-1 FACTOR SCORES
#   (Henseler & Chin 2010) — no indicators of its own, needs a two-pass estimation.
# - "product_indicator": multiply every pair of raw indicators from the two
#   source blocks (Chin, Marcolin & Newsted 2003) — becomes a real Mode A
#   construct with those products as its indicator block, estimated in a
#   single pass together with everything else.
# - "orthogonalization": same product-indicator construction, but each product
#   is first residualized against all main-effect indicators of both source
#   blocks to remove their collinearity (Little, Bovaird & Widaman 2006).
CALC_METHODS = ("product_indicator", "two_stage", "orthogonalization")
# How each source indicator is transformed before the pairwise product is taken
# (only meaningful for "product_indicator"/"orthogonalization" — "two_stage"
# always works on already-standardized composite scores).
PRODUCT_TERM_METHODS = ("unstandardized", "mean_centered", "standardized")


@dataclass
class Construct:
    id: str
    name: str
    mode: str  # "A" (reflective), "B" (formative), or "I" (interaction/moderation term)
    indicators: list[str] = field(default_factory=list)
    interaction_of: list[str] | None = None  # for mode "I": [source_a_id, source_b_id]
    calc_method: str = "two_stage"  # for mode "I": one of CALC_METHODS
    product_term_generation: str = "standardized"  # for mode "I": one of PRODUCT_TERM_METHODS


@dataclass
class Path:
    source: str
    target: str


@dataclass
class Model:
    constructs: dict[str, Construct]
    paths: list[Path]

    @classmethod
    def from_json(cls, payload: dict, lang: str = DEFAULT_LANG) -> "Model":
        raw_constructs = payload.get("constructs") or []
        raw_paths = payload.get("paths") or []

        if len(raw_constructs) < 2:
            raise ModelError(t("err_model_min_constructs", lang))

        constructs: dict[str, Construct] = {}
        for c in raw_constructs:
            cid = str(c.get("id", "")).strip()
            name = str(c.get("name", "")).strip()
            mode = str(c.get("mode", "A")).strip().upper()
            indicators = [str(i).strip() for i in (c.get("indicators") or []) if str(i).strip()]

            if not cid or not name:
                raise ModelError(t("err_construct_missing_id_name", lang))
            if mode not in ("A", "B", "I"):
                raise ModelError(t("err_construct_invalid_mode", lang, name=name))
            if cid in constructs:
                raise ModelError(t("err_construct_duplicate_id", lang, cid=cid))

            if mode == "I":
                raw_pair = c.get("interaction_of") or []
                interaction_of = [str(x).strip() for x in raw_pair if str(x).strip()]
                if len(interaction_of) != 2 or interaction_of[0] == interaction_of[1]:
                    raise ModelError(t("err_interaction_invalid_sources", lang, name=name))
                calc_method = str(c.get("calc_method") or "two_stage").strip().lower()
                if calc_method not in CALC_METHODS:
                    raise ModelError(t("err_interaction_invalid_calc_method", lang, name=name))
                product_term_generation = str(c.get("product_term_generation") or "standardized").strip().lower()
                if product_term_generation not in PRODUCT_TERM_METHODS:
                    raise ModelError(t("err_interaction_invalid_product_term", lang, name=name))
                constructs[cid] = Construct(id=cid, name=name, mode=mode, indicators=[],
                                             interaction_of=interaction_of, calc_method=calc_method,
                                             product_term_generation=product_term_generation)
                continue

            if len(indicators) < 1:
                raise ModelError(t("err_construct_min_indicators", lang, name=name))
            if mode == "A" and len(indicators) < 2:
                raise ModelError(t("err_construct_reflective_min2", lang, name=name))

            constructs[cid] = Construct(id=cid, name=name, mode=mode, indicators=indicators)

        # Second pass: interaction constructs reference other constructs, which may have
        # appeared later in the payload than the interaction construct itself.
        for c in constructs.values():
            if c.mode != "I":
                continue
            a, b = c.interaction_of
            for ref in (a, b):
                if ref not in constructs:
                    raise ModelError(t("err_interaction_invalid_sources", lang, name=c.name))
                if constructs[ref].mode == "I":
                    raise ModelError(t("err_interaction_of_interaction", lang, name=c.name))

        seen_indicators: dict[str, str] = {}
        for c in constructs.values():
            for ind in c.indicators:
                if ind in seen_indicators:
                    raise ModelError(
                        t("err_indicator_duplicate", lang, ind=ind, a=seen_indicators[ind], b=c.name)
                    )
                seen_indicators[ind] = c.name

        paths: list[Path] = []
        seen_edges = set()
        for p in raw_paths:
            src = str(p.get("source", "")).strip()
            tgt = str(p.get("target", "")).strip()
            if src not in constructs or tgt not in constructs:
                raise ModelError(t("err_path_unknown_construct", lang))
            if src == tgt:
                raise ModelError(t("err_path_self_loop", lang))
            edge = (src, tgt)
            if edge in seen_edges:
                continue
            seen_edges.add(edge)
            paths.append(Path(source=src, target=tgt))

        if not paths:
            raise ModelError(t("err_model_min_paths", lang))

        # Reject cycles: PLS path weighting scheme assumes a recursive (acyclic) structural model.
        graph: dict[str, list[str]] = {cid: [] for cid in constructs}
        for p in paths:
            graph[p.source].append(p.target)

        WHITE, GRAY, BLACK = 0, 1, 2
        color = {cid: WHITE for cid in constructs}

        def has_cycle(node: str) -> bool:
            color[node] = GRAY
            for nxt in graph[node]:
                if color[nxt] == GRAY:
                    return True
                if color[nxt] == WHITE and has_cycle(nxt):
                    return True
            color[node] = BLACK
            return False

        for cid in constructs:
            if color[cid] == WHITE and has_cycle(cid):
                raise ModelError(t("err_model_cycle", lang))

        model = cls(constructs=constructs, paths=paths)

        # Interaction constructs are always exogenous (their score is derived from a
        # stage-1 fit, not predicted within the structural model), and standard
        # moderation practice requires both multiplicand constructs to also carry a
        # direct "main effect" path to whatever the interaction predicts — otherwise
        # the interaction path would silently absorb variance that belongs to the
        # main effects. Both are enforced here so the diagram, the model, and the
        # reported results can never drift apart.
        for c in constructs.values():
            if c.mode != "I":
                continue
            if model.predecessors(c.id):
                raise ModelError(t("err_interaction_has_predecessor", lang, name=c.name))
            targets = model.successors(c.id)
            if not targets:
                raise ModelError(t("err_interaction_no_target", lang, name=c.name))
            a, b = c.interaction_of
            for target in targets:
                for src in (a, b):
                    if target not in model.successors(src):
                        raise ModelError(t(
                            "err_interaction_missing_main_effect", lang,
                            src=constructs[src].name, target=constructs[target].name, name=c.name,
                        ))

        return model

    def predecessors(self, construct_id: str) -> list[str]:
        return [p.source for p in self.paths if p.target == construct_id]

    def successors(self, construct_id: str) -> list[str]:
        return [p.target for p in self.paths if p.source == construct_id]

    def endogenous_ids(self) -> list[str]:
        """Constructs that have at least one incoming path."""
        return [cid for cid in self.constructs if self.predecessors(cid)]

    def exogenous_ids(self) -> list[str]:
        return [cid for cid in self.constructs if not self.predecessors(cid)]

    def interaction_ids(self) -> list[str]:
        return [cid for cid, c in self.constructs.items() if c.mode == "I"]

    def two_stage_interaction_ids(self) -> list[str]:
        """Interaction constructs needing the two-pass estimation (their score
        isn't knowable until stage 1 produces factor scores for their sources)."""
        return [cid for cid in self.interaction_ids() if self.constructs[cid].calc_method == "two_stage"]

    def indicator_based_interaction_ids(self) -> list[str]:
        """Interaction constructs estimated in a single pass, as a real Mode A
        block over their auto-generated product-indicator columns."""
        return [cid for cid in self.interaction_ids() if self.constructs[cid].calc_method != "two_stage"]

    def has_interactions(self) -> bool:
        return any(c.mode == "I" for c in self.constructs.values())

    def base_model_json(self) -> dict:
        """This model's definition with ALL interaction constructs (and any paths
        that touch them) removed — used where every interaction must be handled
        via the two-stage approach regardless of its configured calc_method
        (currently: CB-SEM moderation, which doesn't support product-indicator
        methods). See `stage1_model_json` for PLS-SEM's per-method handling."""
        interaction_ids = set(self.interaction_ids())
        return {
            "constructs": [
                {"id": c.id, "name": c.name, "mode": c.mode, "indicators": c.indicators}
                for c in self.constructs.values() if c.id not in interaction_ids
            ],
            "paths": [
                {"source": p.source, "target": p.target}
                for p in self.paths if p.source not in interaction_ids and p.target not in interaction_ids
            ],
        }

    def stage1_model_json(self, generated_indicators: dict[str, list[str]]) -> dict:
        """Model used for PLS-SEM's single main estimation pass: two-stage
        interaction constructs are stripped entirely (handled afterwards from
        stage-1 factor scores); product-indicator/orthogonalization interaction
        constructs are kept but turned into a real Mode A construct over their
        auto-generated product-indicator columns (`generated_indicators[cid]`),
        so they're estimated together with everything else in this one pass.
        """
        two_stage = set(self.two_stage_interaction_ids())
        constructs = []
        for c in self.constructs.values():
            if c.id in two_stage:
                continue
            if c.mode == "I":
                constructs.append({"id": c.id, "name": c.name, "mode": "A",
                                    "indicators": generated_indicators[c.id]})
            else:
                constructs.append({"id": c.id, "name": c.name, "mode": c.mode, "indicators": c.indicators})
        paths = [
            {"source": p.source, "target": p.target}
            for p in self.paths if p.source not in two_stage and p.target not in two_stage
        ]
        return {"constructs": constructs, "paths": paths}

    def all_indicators(self) -> list[str]:
        out: list[str] = []
        for c in self.constructs.values():
            out.extend(c.indicators)
        return out
