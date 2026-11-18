"""Small helpers for the run log, which people read in the admin dashboard."""


def plural(count: int, singular: str, plural_form: str | None = None) -> str:
    """For example "1 paper", "2 papers" and "0 papers"."""
    word = singular if count == 1 else (plural_form or singular + "s")
    return f"{count} {word}"


def cost_text(usd: float) -> str:
    """For example "$0.00", "$0.0040", "$0.125" and "$2.50".

    The same rules as formatCost in frontend/components/admin/adminFormat.ts,
    so the log's cost matches the dashboard's Recent runs table. Triage costs
    fractions of a cent per paper, so small amounts keep more digits. A change
    to one belongs in the other too.
    """
    if usd == 0:
        return "$0.00"
    if usd < 0.01:
        return f"${usd:.4f}"
    if usd < 1:
        return f"${usd:.3f}"
    return f"${usd:.2f}"
