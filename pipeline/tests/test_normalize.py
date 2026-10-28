"""The title and identifier helpers in sf_shared.normalize, which dedupe relies on."""

import pytest
from sf_shared.normalize import normalize_arxiv_id, normalize_doi, title_key


def test_title_key_ignores_case_punctuation_and_accents():
    assert title_key("Whole-Brain Emulation: A Roadmap") == "whole brain emulation a roadmap"
    assert title_key("  whole brain   EMULATION, a roadmap!") == "whole brain emulation a roadmap"
    assert title_key("Émulation cérébrale") == "emulation cerebrale"


def test_title_key_of_punctuation_only_is_empty():
    assert title_key("?!") == ""


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("10.1000/ABC.123", "10.1000/abc.123"),
        ("https://doi.org/10.3389/fnhum.2022.806517", "10.3389/fnhum.2022.806517"),
        ("http://dx.doi.org/10.1080/0952813X.2017.1354081", "10.1080/0952813x.2017.1354081"),
        ("doi:10.1002/brx2.70035.", "10.1002/brx2.70035"),
        ("not a doi", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_doi(value, expected):
    assert normalize_doi(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2411.18526", "2411.18526"),
        ("2411.18526v3", "2411.18526"),
        ("arXiv:2411.18526v1", "2411.18526"),
        ("https://arxiv.org/abs/2411.18526v2", "2411.18526"),
        ("http://arxiv.org/pdf/2411.18526v2.pdf", "2411.18526"),
        ("http://arxiv.org/abs/hep-th/9901001v1", "hep-th/9901001"),
        ("math.GT/0309136", "math.GT/0309136"),
        ("0704.0001", "0704.0001"),
        ("10.1000/abc", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_arxiv_id(value, expected):
    assert normalize_arxiv_id(value) == expected
