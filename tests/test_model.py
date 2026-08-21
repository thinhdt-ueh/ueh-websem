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


def test_rejects_reflective_construct_with_one_indicator():
    payload = {
        "constructs": [
            {"id": "a", "name": "A", "mode": "A", "indicators": ["a1"]},
            {"id": "b", "name": "B", "mode": "A", "indicators": ["b1", "b2"]},
        ],
        "paths": [{"source": "a", "target": "b"}],
    }
    with pytest.raises(ModelError):
        Model.from_json(payload)


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


def test_topological_order_respects_predecessors(tam_model_json):
    model = Model.from_json(tam_model_json)
    order = model.topological_order()
    pos = {cid: i for i, cid in enumerate(order)}
    for p in model.paths:
        assert pos[p.source] < pos[p.target]
