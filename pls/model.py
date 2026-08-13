"""Data structures describing a PLS-SEM model definition submitted by the UI."""

from __future__ import annotations

from dataclasses import dataclass, field

from i18n import DEFAULT_LANG, t


class ModelError(ValueError):
    """Raised when a submitted model definition is invalid."""


@dataclass
class Construct:
    id: str
    name: str
    mode: str  # "A" (reflective) or "B" (formative)
    indicators: list[str] = field(default_factory=list)


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
            if mode not in ("A", "B"):
                raise ModelError(t("err_construct_invalid_mode", lang, name=name))
            if len(indicators) < 1:
                raise ModelError(t("err_construct_min_indicators", lang, name=name))
            if mode == "A" and len(indicators) < 2:
                raise ModelError(t("err_construct_reflective_min2", lang, name=name))
            if cid in constructs:
                raise ModelError(t("err_construct_duplicate_id", lang, cid=cid))

            constructs[cid] = Construct(id=cid, name=name, mode=mode, indicators=indicators)

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

        return cls(constructs=constructs, paths=paths)

    def predecessors(self, construct_id: str) -> list[str]:
        return [p.source for p in self.paths if p.target == construct_id]

    def successors(self, construct_id: str) -> list[str]:
        return [p.target for p in self.paths if p.source == construct_id]

    def endogenous_ids(self) -> list[str]:
        """Constructs that have at least one incoming path."""
        return [cid for cid in self.constructs if self.predecessors(cid)]

    def exogenous_ids(self) -> list[str]:
        return [cid for cid in self.constructs if not self.predecessors(cid)]

    def all_indicators(self) -> list[str]:
        out: list[str] = []
        for c in self.constructs.values():
            out.extend(c.indicators)
        return out
