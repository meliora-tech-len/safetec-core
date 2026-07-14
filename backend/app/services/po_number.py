"""Canonical PO ("POH") number extraction for customer invoices.

The purchase-order number an invoice was generated from is written into the
invoice's free-text notes as "PO Ref: POH10126050000191" by the PO import, and is
echoed inside the header line item's description
("ASSMANG POH 10126050000191 - TDK/..."). Nothing ever stored it as a field, so
several frontend pages each re-derived it by regex, with patterns that didn't
agree (one accepted a bare "PO Ref", another demanded POH + 6 digits).

This is the single definition. Invoice.po_number is set from here on every
create/update, so consumers (budget income grouping, statements, reports) can
filter and GROUP BY in SQL instead of loading every invoice and regexing it.
"""
import re
from typing import Optional

# "POH" followed by its digits, tolerating the space the PO PDFs sometimes carry
# ("POH 10126050000191"). Digits only — the trailing " - TDK/..." in a header
# line item is not part of the number.
_POH_RE = re.compile(r"POH\s*(\d+)", re.IGNORECASE)


def extract_po_number(*sources: Optional[str]) -> Optional[str]:
    """First POH number found across `sources`, normalised to "POH<digits>".

    Sources are tried in order, so callers pass the most authoritative first
    (notes, then the header line item). Returns None when nothing matches — a
    hand-keyed invoice that never came from a PO import has no PO number, and
    that is a normal state, not an error.
    """
    for src in sources:
        if not src:
            continue
        m = _POH_RE.search(str(src))
        if m:
            return f"POH{m.group(1)}"
    return None


def po_number_for_invoice(notes: Optional[str], line_items) -> Optional[str]:
    """PO number for an invoice, from its notes then its header line item.

    `line_items` may be ORM rows or inbound payload objects — anything with
    `.line_type` and `.description`.
    """
    header = next(
        (li for li in (line_items or []) if getattr(li, "line_type", None) == "header"),
        None,
    )
    return extract_po_number(notes, getattr(header, "description", None))
