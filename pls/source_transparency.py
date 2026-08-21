"""Surfaces the *actual* Python source of the functions that computed a given
analysis result, for the "Computation Transparency" section rendered at the
bottom of the results page. Uses `inspect.getsource()` on the live function
objects rather than a hand-maintained copy, so what's shown can never drift
out of sync with what really ran — and automatically reflects future edits
to the underlying modules with no extra upkeep here.

Each section is built only when the corresponding computation actually ran
for this analysis (e.g. the bootstrap section is omitted when bootstrapping
was off), so the page always matches what was really computed — never a
generic, possibly-misleading full listing.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass

from cbsem import estimator as cbsem_estimator
from cbsem import moderation as cbsem_moderation
from pls import algorithm as pls_algorithm
from pls import blindfolding as pls_blindfolding
from pls import bootstrap as pls_bootstrap
from pls import effects as pls_effects
from pls import metrics as pls_metrics
from pls import moderation as pls_moderation
from pls.model import Model


@dataclass
class SourceSection:
    key: str  # frontend i18n key for the section title
    code: str


def _source(*funcs) -> str:
    """Concatenates the source of one or more functions, in the given order.
    Falls back to a placeholder instead of raising if the source isn't
    available — notably inside the packaged .exe, where PyInstaller's bundle
    doesn't ship the original .py files `inspect` needs to read from."""
    try:
        return "\n\n".join(inspect.getsource(f) for f in funcs)
    except OSError:
        return (
            "# Source not available in this build.\n"
            "# See: https://github.com/thinhdt-ueh/ueh-websem"
        )


def pls_sections(model: Model, bootstrap_enabled: bool, blindfolding_ran: bool) -> list[SourceSection]:
    sections = [
        SourceSection(
            "src_section_core_algorithm",
            _source(pls_algorithm._fit, pls_algorithm.structural_regression, pls_algorithm.run_pls_algorithm),
        ),
        SourceSection(
            "src_section_measurement_metrics",
            _source(
                pls_metrics.cronbachs_alpha, pls_metrics.rho_a, pls_metrics.composite_reliability,
                pls_metrics.ave, pls_metrics.htmt, pls_metrics.f_squared,
            ),
        ),
        SourceSection("src_section_cmb", _source(pls_metrics.full_collinearity_vif)),
        SourceSection("src_section_mediation", _source(pls_effects.total_effects)),
    ]
    if model.has_interactions():
        sections.append(SourceSection(
            "src_section_moderation",
            _source(
                pls_moderation.build_product_indicators, pls_moderation.compute_interaction_scores,
                pls_moderation.run_pls_with_moderation,
            ),
        ))
    if bootstrap_enabled:
        fn = pls_bootstrap.run_bootstrap_with_moderation if model.has_interactions() else pls_bootstrap.run_bootstrap
        sections.append(SourceSection("src_section_bootstrap", _source(fn)))
    if blindfolding_ran:
        sections.append(SourceSection("src_section_blindfolding", _source(pls_blindfolding.run_blindfolding)))
    return sections


def cbsem_sections(model: Model) -> list[SourceSection]:
    sections = [
        SourceSection("src_section_core_algorithm", _source(cbsem_estimator.run_cbsem)),
        SourceSection(
            "src_section_measurement_metrics",
            _source(
                pls_metrics.cronbachs_alpha, pls_metrics.composite_reliability, pls_metrics.ave, pls_metrics.htmt,
            ),
        ),
        SourceSection("src_section_cmb", _source(pls_metrics.full_collinearity_vif)),
        SourceSection("src_section_mediation", _source(pls_effects.total_effects)),
    ]
    if model.has_interactions():
        sections.append(SourceSection("src_section_moderation", _source(cbsem_moderation.run_cbsem_with_moderation)))
    return sections
