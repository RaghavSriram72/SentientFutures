"""Rules the pipeline applies when a run starts, checked here when the settings are saved.

The pipeline only finds out that a search can't be translated, or that the
model has no price, once a run is going. By then the settings page has said
"Saved", and the run either skips that search or stops triage. So
PUT /pipeline/config asks the pipeline's own code the same questions first.

The pipeline package is optional for the API (only the local runner needs
it), so each check is skipped when it isn't installed. The Docker image
installs it, so the production API always checks.
"""

import logging
from collections.abc import Callable

log = logging.getLogger(__name__)


def priced_models() -> list[str] | None:
    """The model ids the pipeline has prices for, cheapest first.

    None when the pipeline package isn't installed, because then the API
    can't tell which models would work.
    """
    try:
        from sf_pipeline.pricing import PRICES
    except ImportError:
        return None
    return list(PRICES)


def model_problem(model: str) -> str | None:
    """Why the pipeline would refuse to triage with this model, or None if it wouldn't."""
    models = priced_models()
    if models is None:
        log.warning("The pipeline package isn't installed, so the model isn't checked before saving.")
        return None
    if model in models:
        return None
    return (
        f'the pipeline has no price for "{model}", so it couldn\'t keep to the cost limit and would skip triage. '
        f"Use one of: {', '.join(models)}"
    )


def search_text_problems(text: str, collectors: list[str]) -> list[str]:
    """Why the collectors this search runs on couldn't translate its text. Empty when they all can."""
    try:
        from sf_pipeline.collectors.query import QuerySyntaxError, to_arxiv_query, to_semantic_scholar_query
    except ImportError:
        log.warning("The pipeline package isn't installed, so search text isn't checked before saving.")
        return []
    translators: dict[str, Callable[[str], str]] = {
        "arxiv": to_arxiv_query,
        "semantic_scholar": to_semantic_scholar_query,
    }

    problems = []
    for collector in collectors:
        try:
            translators[collector](text)
        except QuerySyntaxError as error:
            # Both collectors share one parser, so they usually say the same thing.
            message = str(error)
            if message not in problems:
                problems.append(message)
    return problems
