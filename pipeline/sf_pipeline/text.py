"""Small helpers for the run log, which people read in the admin dashboard."""


def plural(count: int, singular: str, plural_form: str | None = None) -> str:
    """For example "1 paper", "2 papers" and "0 papers"."""
    word = singular if count == 1 else (plural_form or singular + "s")
    return f"{count} {word}"
