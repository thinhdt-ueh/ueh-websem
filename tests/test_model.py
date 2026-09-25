import pytest

from pls.model import Model, ModelError


def test_valid_tam_model_loads(tam_model_json):
    model = Model.from_json(tam_model_json)
    assert set(model.constructs) == {"peou", "pu", "att", "int"}
    assert model.exogenous_ids() == ["peou"]
    assert set(model.endogenous_ids()) == {"pu", "att", "int"}


def test_rejects_fewer_than_two_constructs():
    with pytest.raises(ModelError):
        Model.from_json({"constructs": [{"id": "a", "name": "A", "mode": "A", "indicators": ["a1", "a2"]}],
                          "paths": []})


def test_rejects_cycle():
    payload = {
        "constructs": [
            {"id": "a", "name": "A", "mode": "A", "indicators": ["a1", "a2"]},
            {"id": "b", "name": "B", "mode": "A", "indicators": ["b1", "b2"]},
        ],
        "paths": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    with pytest.raises(ModelError):
        Model.from_json(payload)


def test_allows_reflective_construct_with_one_indicator():
    # A single-indicator reflective (Mode A) construct is a legitimate
    # modeling choice (e.g. a single-item measure) -- it must load, not be
    # rejected. Reliability metrics undefined for a 1-item scale are simply
    # omitted for it downstream (see pls/metrics.py), not blocked here.
    payload = {
        "constructs": [
            {"id": "a", "name": "A", "mode": "A", "indicators": ["a1"]},
            {"id": "b", "name": "B", "mode": "A", "indicators": ["b1", "b2"]},
        ],
        "paths": [{"source": "a", "target": "b"}],
    }
    model = Model.from_json(payload)
    assert model.constructs["a"].indicators == ["a1"]


def test_interaction_requires_main_effect_paths(moderation_model_json):
    # drop the peou -> int main-effect path the interaction construct needs
    payload = {
        "constructs": moderation_model_json["constructs"],
        "paths": [p for p in moderation_model_json["paths"] if p != {"source": "peou", "target": "int"}],
    }
    with pytest.raises(ModelError):
        Model.from_json(payload)


def test_interaction_cannot_have_a_predecessor(moderation_model_json):
    payload = {
        "constructs": moderation_model_json["constructs"],
        "paths": moderation_model_json["paths"] + [{"source": "pu", "target": "peou_x_exp"}],
    }
    with pytest.raises(ModelError):
        Model.from_json(payload)


def test_valid_moderation_model_loads(moderation_model_json):
    model = Model.from_json(moderation_model_json)
    assert model.has_interactions()
    assert model.interaction_ids() == ["peou_x_exp"]
    assert model.two_stage_interaction_ids() == ["peou_x_exp"]
    assert model.indicator_based_interaction_ids() == []


def _three_way_payload(calc_method="two_stage"):
    construct = {"id": "abc", "name": "A x B x C", "mode": "I", "interaction_of": ["a", "b", "c"],
                 "calc_method": calc_method}
    return {
        "constructs": [
            {"id": "a", "name": "A", "mode": "A", "indicators": ["a1", "a2"]},
            {"id": "b", "name": "B", "mode": "A", "indicators": ["b1", "b2"]},
            {"id": "c", "name": "C", "mode": "A", "indicators": ["c1", "c2"]},
            {"id": "y", "name": "Y", "mode": "A", "indicators": ["y1", "y2"]},
            construct,
        ],
        "paths": [
            {"source": "a", "target": "y"}, {"source": "b", "target": "y"},
            {"source": "c", "target": "y"}, {"source": "abc", "target": "y"},
        ],
    }


def test_three_way_interaction_accepted_with_two_stage():
    model = Model.from_json(_three_way_payload("two_stage"))
    assert model.constructs["abc"].interaction_of == ["a", "b", "c"]
    assert model.interaction_ids() == ["abc"]
    assert model.two_stage_interaction_ids() == ["abc"]
    assert model.indicator_based_interaction_ids() == []


@pytest.mark.parametrize("calc_method", ["product_indicator", "orthogonalization"])
def test_three_way_interaction_rejected_for_non_two_stage(calc_method):
    with pytest.raises(ModelError):
        Model.from_json(_three_way_payload(calc_method))


def test_four_way_interaction_rejected():
    payload = _three_way_payload("two_stage")
    payload["constructs"].append({"id": "d", "name": "D", "mode": "A", "indicators": ["d1"]})
    abc = next(c for c in payload["constructs"] if c["id"] == "abc")
    abc["interaction_of"] = ["a", "b", "c", "d"]
    payload["paths"].append({"source": "d", "target": "y"})
    with pytest.raises(ModelError):
        Model.from_json(payload)


def test_three_way_interaction_missing_one_main_effect_rejected():
    payload = _three_way_payload("two_stage")
    payload["paths"] = [p for p in payload["paths"] if p != {"source": "c", "target": "y"}]
    with pytest.raises(ModelError):
        Model.from_json(payload)


def test_topological_order_respects_predecessors(tam_model_json):
    model = Model.from_json(tam_model_json)
    order = model.topological_order()
    pos = {cid: i for i, cid in enumerate(order)}
    for p in model.paths:
        assert pos[p.source] < pos[p.target]
