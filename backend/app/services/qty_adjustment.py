"""Document-level quantity adjustment (migration 127).

Some documents bill a quantity that is the captured figure plus a fixed
percentage — Border Trade Post's POs bill weighbridge net mass +1.53%, so
32.56 t captured becomes 33.06 t billed.

The user captures the net figure and the percentage; this module is the single
place that turns those into the billed quantity, so the form preview, the saved
record and the PDF can never disagree. ROUND_HALF_UP matches what the browser
shows via toFixed(2), and 2 decimals matches the tonnage sheets.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

QTY_EXP = Decimal("0.01")

SCOPE_ALL      = "all"
SCOPE_SELECTED = "selected"
VALID_SCOPES   = {SCOPE_ALL, SCOPE_SELECTED}


def exact_adjusted_quantity(base, pct) -> Decimal:
    """base + pct%, NOT rounded. e.g. (32.56, 1.53) -> 33.058168

    This is the figure the line is billed on. Rounding the tonnage to 2 dp
    before multiplying by the rate puts the amount a few cents out against the
    customer's own sheet, which multiplies the full-precision tonnage — so the
    rounding happens once, at the cent, and never to the tonnage first.
    """
    return Decimal(str(base)) * (Decimal("1") + Decimal(str(pct)) / Decimal("100"))


def adjusted_quantity(base, pct) -> Decimal:
    """The DISPLAYED/printed tonnage: base + pct%, rounded to 2 dp.

    e.g. (32.56, 1.53) -> 33.06. Deliberately not what the amount is derived
    from — see exact_adjusted_quantity. A printed line therefore does not
    always multiply out to the printed amount, matching the source sheet.
    """
    return exact_adjusted_quantity(base, pct).quantize(QTY_EXP, rounding=ROUND_HALF_UP)


def line_amount(base, pct, unit_price) -> Decimal:
    """Bill the line on the exact tonnage, rounding only the rand result."""
    exact = exact_adjusted_quantity(base, pct)
    return (exact * Decimal(str(unit_price))).quantize(QTY_EXP, rounding=ROUND_HALF_UP)


def line_takes_adjustment(item, pct, scope: str) -> bool:
    """Whether this line's quantity should be uplifted.

    Only item rows ever carry a quantity, and 'selected' scope means the user
    picked specific lines (a partial load, a line billed at actual mass).
    """
    if pct is None or Decimal(str(pct)) == 0:
        return False
    if (getattr(item, "line_type", "item") or "item") != "item":
        return False
    if scope == SCOPE_SELECTED:
        return bool(getattr(item, "qty_adjusted", False))
    return True


def resolve_quantities(item, pct, scope: str):
    """Return (billed_quantity, base_quantity) for a line item payload.

    Callers store the first as `quantity` — the figure everything downstream
    already reads — and the second as `base_quantity`. When no adjustment
    applies, base_quantity is None and quantity is exactly what was sent.
    """
    if not line_takes_adjustment(item, pct, scope):
        return item.quantity, None

    # The client sends the captured (net) figure in base_quantity; fall back to
    # quantity so an API caller that only knows about `quantity` still works.
    base = item.base_quantity if item.base_quantity is not None else item.quantity
    if base is None:
        return item.quantity, None
    return adjusted_quantity(base, pct), Decimal(str(base))


def normalize_scope(scope: Optional[str]) -> str:
    return scope if scope in VALID_SCOPES else SCOPE_ALL
