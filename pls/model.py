"""Data structures describing a PLS-SEM/CB-SEM model definition submitted by
the UI, including "interaction" constructs used for two-stage moderation
analysis (see pls/moderation.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from i18n import DEFAULT_LANG, t


class ModelError(ValueError):
    """Raised when a submitted model definition is invalid."""


@dataclass
class Construct:
    id: str
    name: str
    mode: str  # "A" (reflective), "B" (formative), or "I" (interaction/moderation term)
    indicators: list[str] = field(default_factory=list)
    interaction_of: list[str] | None = None  # for mode "I": [source_a_id, source_b_id]


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
                constructs[cid] = Construct(id=cid, name=name, mode=mode, indicators=[],
                                             interaction_of=interaction_of)
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

    def has_interactions(self) -> bool:
        return any(c.mode == "I" for c in self.constructs.values())

    def base_model_json(self) -> dict:
        """This model's definition with interaction constructs (and any paths that
        touch them) removed — the "stage 1" model for two-stage moderation analysis."""
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

    def all_indicators(self) -> list[str]:
        out: list[str] = []
        for c in self.constructs.values():
            out.extend(c.indicators)
        return out
