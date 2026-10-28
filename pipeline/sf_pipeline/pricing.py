"""What each triage call costs, from the token counts the API reports.

Prices are US dollars per million tokens, from
https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-27).
The pipeline only writes 5-minute cache entries, so that's the write price
listed. If you switch search_config.model to a model that isn't here, triage
stops with an error until you add its prices, because the per-run cost limit
can't work without them. When you add a model, check every row against the
pricing page again, since the cache prices don't follow one ratio across
models (Opus 5.5 cache reads are 0.05x its input price, Sonnet 5.5's 0.1x).
"""

from dataclasses import dataclass

from sf_shared.pipeline_models import TokenUsage

PER_MILLION = 1_000_000


@dataclass(frozen=True)
class ModelPrice:
    input: float
    cache_write: float  # 5-minute cache writes
    cache_read: float
    output: float


@dataclass(frozen=True)
class PriceTable:
    standard: ModelPrice
    # Claude Haiku 5.5 charges more for a request whose prompt (input, cache
    # reads and cache writes together) is over 100,000 tokens.
    long_prompt_threshold: int | None = None
    long_prompt: ModelPrice | None = None


PRICES: dict[str, PriceTable] = {
    "claude-haiku-5-5": PriceTable(
        standard=ModelPrice(input=0.10, cache_write=0.125, cache_read=0.01, output=0.50),
        long_prompt_threshold=100_000,
        long_prompt=ModelPrice(input=0.50, cache_write=0.625, cache_read=0.05, output=2.50),
    ),
    "claude-sonnet-5-5": PriceTable(standard=ModelPrice(input=2.00, cache_write=2.50, cache_read=0.20, output=10.00)),
    "claude-opus-5-5": PriceTable(standard=ModelPrice(input=4.00, cache_write=5.00, cache_read=0.20, output=20.00)),
}


class UnknownModelPrice(Exception):
    def __init__(self, model: str) -> None:
        super().__init__(
            f'There\'s no price for the model "{model}", so the cost limit can\'t be enforced. '
            "Add it to PRICES in pipeline/sf_pipeline/pricing.py, or pick a listed model in the search config."
        )
        self.model = model


def price_table(model: str) -> PriceTable:
    if model not in PRICES:
        raise UnknownModelPrice(model)
    return PRICES[model]


def cost_usd(model: str, usage: TokenUsage) -> float:
    table = price_table(model)
    prompt_tokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    price = table.standard
    if table.long_prompt and table.long_prompt_threshold and prompt_tokens > table.long_prompt_threshold:
        price = table.long_prompt

    dollars = (
        usage.input_tokens * price.input
        + usage.cache_creation_input_tokens * price.cache_write
        + usage.cache_read_input_tokens * price.cache_read
        + usage.output_tokens * price.output
    ) / PER_MILLION
    return round(dollars, 8)
