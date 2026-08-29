"""Surfaces the actual Python source of the ML Comparison code that ran for
a given request, mirroring pls/source_transparency.py's pattern: uses
`inspect.getsource()` on the live function objects so what's shown can never
drift out of sync with what really ran. Per-algorithm factory source is only
included for the algorithms the user actually selected, not the full
9-algorithm registry.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass

from . import engine as ml_engine
from .registry import ALGORITHMS


@dataclass
class SourceSection:
    key: str  # frontend i18n key for the section title
    code: str


def _source(*funcs) -> str:
    try:
        return "\n\n".join(inspect.getsource(f) for f in funcs)
    except OSError:
        return (
            "# Source not available in this build.\n"
            "# See: https://github.com/thinhdt-ueh/ueh-websem"
        )


def ml_compare_sections(algorithm_ids: list[str]) -> list[SourceSection]:
    sections = [
        SourceSection(
            "src_section_ml_engine",
            _source(
                ml_engine.run_ml_comparison,
                ml_engine._run_algorithm_on_target,
                ml_engine._extract_native_importance,
            ),
        ),
    ]
    factory_funcs = [ALGORITHMS[a].factory for a in algorithm_ids if a in ALGORITHMS]
    if factory_funcs:
        sections.append(SourceSection("src_section_ml_algorithms", _source(*factory_funcs)))
    return sections
