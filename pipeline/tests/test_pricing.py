"""Cost from token usage."""

import pytest
from sf_shared.pipeline_models import TokenUsage

from sf_pipeline.pricing import UnknownModelPrice, cost_usd


def test_haiku_cost_counts_each_kind_of_token():
    usage = TokenUsage(input_tokens=1_000_000, output_tokens=1_000_000, cache_read_input_tokens=1_000_000, cache_creation_input_tokens=0)
    # Over 100,000 prompt tokens, so the long-prompt prices apply: 0.50 + 2.50 + 0.05
    assert cost_usd("claude-haiku-5-5", usage) == pytest.approx(3.05)


def test_haiku_short_prompt_prices():
    usage = TokenUsage(input_tokens=400, output_tokens=600, cache_read_input_tokens=1_800, cache_creation_input_tokens=1_000)
    expected = (400 * 0.10 + 600 * 0.50 + 1_800 * 0.01 + 1_000 * 0.125) / 1_000_000
    assert cost_usd("claude-haiku-5-5", usage) == pytest.approx(expected)


def test_a_model_with_no_price_raises():
    with pytest.raises(UnknownModelPrice, match="pricing.py"):
        cost_usd("claude-made-up", TokenUsage())


def test_sonnet_cache_reads_cost_a_tenth_of_input():
    usage = TokenUsage(cache_read_input_tokens=1_000_000)
    assert cost_usd("claude-sonnet-5-5", usage) == pytest.approx(0.20)
