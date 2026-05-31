"""
PDF Generator — safetec_core
Matches the Safetec letterhead style:
  - Logo + company name/reg/VAT left
  - Contact details right with vertical divider
  - TAX INVOICE TO block with Inv No / Date right
  - Dark header bar for line items
  - Subtotal / VAT / Total bottom right
  - No status printed
  - Non-VAT lines excluded from VAT calculation
"""

import io
import httpx
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

# Resolve backend root so we can read local logos directly from disk
_BACKEND_ROOT = Path(__file__).resolve().parents[2]  # backend/app/services/ → backend/

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable, Image as RLImage
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hex_to_color(hex_str: str) -> colors.Color:
    """Convert #RRGGBB to ReportLab Color."""
    hex_str = hex_str.strip().lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join(c * 2 for c in hex_str)
    r = int(hex_str[0:2], 16) / 255
    g = int(hex_str[2:4], 16) / 255
    b = int(hex_str[4:6], 16) / 255
    return colors.Color(r, g, b)


def _darken(color: colors.Color, factor: float = 0.8) -> colors.Color:
    return colors.Color(
        color.red * factor,
        color.green * factor,
        color.blue * factor,
    )


def format_currency(amount) -> str:
    try:
        val = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        # South African format: space as thousands separator
        parts = f"{abs(val):,.2f}".replace(",", " ")
        return f"R {parts}" if val >= 0 else f"-R {parts}"
    except Exception:
        return "R 0.00"


def format_date(dt) -> str:
    if dt is None:
        return "—"
    if isinstance(dt, str):
        return dt
    return dt.strftime("%d.%m.%Y")


def _load_logo(logo_url: str | None, logo_path: str | None = None) -> bytes | None:
    """
    Load logo bytes, adapting to the storage backend in use:
      - logo_path (legacy local path)  → read directly from disk
      - logo_url starting with localhost/127.0.0.1 → local dev, read from disk
      - logo_url with HTTPS (Supabase / CDN)       → fetch over HTTP
    Returns None on any failure so the PDF still generates without a logo.
    """
    # 1. Legacy local file path
    if logo_path:
        try:
            p = Path(logo_path)
            if p.is_file():
                return p.read_bytes()
        except Exception:
            pass

    if not logo_url:
        return None

    # 2. Local dev URL — avoid a self-HTTP round-trip and read from disk directly
    parsed = urlparse(logo_url)
    if parsed.hostname in ("localhost", "127.0.0.1"):
        local_path = _BACKEND_ROOT / parsed.path.lstrip("/")
        try:
            if local_path.is_file():
                return local_path.read_bytes()
        except Exception:
            pass
        return None

    # 3. Remote URL (Supabase or other CDN)
    try:
        resp = httpx.get(logo_url, timeout=5.0)
        if resp.status_code == 200:
            return resp.content
    except Exception:
        pass
    return None


def _compute_totals(invoice, line_items):
    """
    Compute subtotal, vat_amount, total respecting per-line is_vat_exempt.
    If invoice.is_vat_exempt is True, no VAT on any line.
    """
    subtotal = Decimal("0")
    vat_base = Decimal("0")
    vat_rate = Decimal(str(invoice.vat_rate)) if invoice.vat_rate else Decimal("0.15")

    for item in line_items:
        # header, note, spacer rows contribute nothing to totals
        if getattr(item, 'line_type', 'item') != 'item':
            continue
        amount = Decimal(str(item.amount))
        subtotal += amount
        # Apply VAT if: invoice not fully exempt AND this line not exempt
        line_exempt = invoice.is_vat_exempt or getattr(item, "is_vat_exempt", False)
        if not line_exempt:
            vat_base += amount

    vat_amount = (vat_base * vat_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total = subtotal + vat_amount
    return subtotal, vat_amount, total, vat_rate


# ── Main generator ────────────────────────────────────────────────────────────

def generate_invoice_pdf(invoice, entity, supplier, *, customer=None, theme: str = "light") -> bytes:
    """
    Generate a professional PDF matching the Safetec letterhead style.
    theme: "light" (default, for printing) | "dark"
    Entity's primary_color is used as the accent/header color.
    """
    # ── Colors ────────────────────────────────────────────────────────────────
    entity_color_hex = getattr(entity, "primary_color", None) or "#1a1a2e"
    accent = _hex_to_color(entity_color_hex)
    accent_dark = _darken(accent, 0.85)
    accent_text = colors.white

    black = colors.HexColor("#111111")
    gray_dark = colors.HexColor("#333333")
    gray_mid = colors.HexColor("#666666")
    gray_light = colors.HexColor("#f5f5f5")
    white = colors.white
    divider = colors.HexColor("#cccccc")

    # ── Document ──────────────────────────────────────────────────────────────
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18*mm,
        leftMargin=18*mm,
        topMargin=14*mm,
        bottomMargin=16*mm,
    )
    story = []

    # ── Styles ────────────────────────────────────────────────────────────────
    def st(name, **kw):
        defaults = dict(fontName="Helvetica", fontSize=9, textColor=black, leading=12)
        defaults.update(kw)
        return ParagraphStyle(name, **defaults)

    s_company_name = st("co_name", fontSize=10, fontName="Helvetica-Bold", textColor=black, leading=14)
    s_company_sub = st("co_sub", fontSize=7.5, textColor=gray_mid, leading=10)
    s_contact_label = st("ct_lbl", fontSize=8, textColor=gray_mid, leading=11)
    s_contact_val = st("ct_val", fontSize=8, textColor=gray_dark, leading=11)
    s_section_label = st("sec_lbl", fontSize=8, fontName="Helvetica-Bold", textColor=black,
                         spaceBefore=1, spaceAfter=1)
    s_client_name = st("cl_name", fontSize=11, fontName="Helvetica-Bold", textColor=black, leading=15)
    s_client_detail = st("cl_det", fontSize=9, textColor=gray_dark, leading=12)
    s_inv_label = st("inv_lbl", fontSize=8, textColor=gray_mid, alignment=TA_RIGHT, leading=11)
    s_inv_value = st("inv_val", fontSize=9, fontName="Helvetica-Bold", textColor=black,
                     alignment=TA_RIGHT, leading=12)
    s_col_header = st("col_hdr", fontSize=9, fontName="Helvetica-Bold", textColor=accent_text,
                      alignment=TA_CENTER, leading=12)
    s_col_hdr_r = st("col_hdr_r", fontSize=9, fontName="Helvetica-Bold", textColor=accent_text,
                     alignment=TA_RIGHT, leading=12)
    s_line_desc = st("ln_desc", fontSize=9, textColor=gray_dark, leading=12)
    s_line_num = st("ln_num", fontSize=9, textColor=gray_dark, alignment=TA_RIGHT, leading=12)
    s_total_label = st("tot_lbl", fontSize=9, textColor=gray_dark, alignment=TA_RIGHT, leading=12)
    s_total_value = st("tot_val", fontSize=9, fontName="Helvetica-Bold", textColor=black,
                       alignment=TA_RIGHT, leading=12)
    s_grand_label = st("gr_lbl", fontSize=11, fontName="Helvetica-Bold", textColor=accent_text,
                       alignment=TA_RIGHT, leading=14)
    s_grand_value = st("gr_val", fontSize=11, fontName="Helvetica-Bold", textColor=accent_text,
                       alignment=TA_RIGHT, leading=14)
    s_bank_title = st("bk_title", fontSize=8, fontName="Helvetica-Bold", textColor=gray_dark, leading=11)
    s_bank_detail = st("bk_det", fontSize=8, textColor=gray_mid, leading=11)
    s_note_title = st("note_title", fontSize=8, fontName="Helvetica-Bold", textColor=gray_dark, leading=11)
    s_note_text = st("note_text", fontSize=8, textColor=gray_dark, leading=12)
    s_footer = st("footer", fontSize=7, textColor=gray_mid, alignment=TA_CENTER, leading=9)
    s_exempt_tag = st("exempt", fontSize=7, textColor=gray_mid, leading=9)
    s_sec_hdr = st("sec_hdr", fontSize=10, fontName="Helvetica-Bold",
                   textColor=accent_text, leading=13)
    s_note_ln = st("note_ln", fontSize=8.5, fontName="Helvetica-Oblique",
                   textColor=gray_mid, leading=12)

    # ── Logo ──────────────────────────────────────────────────────────────────
    logo_img = None
    logo_url = getattr(entity, "logo_url", None)
    logo_path = getattr(entity, "logo_path", None)
    if logo_url or logo_path:
        logo_bytes = _load_logo(logo_url, logo_path)
        if logo_bytes:
            try:
                logo_img = RLImage(io.BytesIO(logo_bytes), width=110*mm, height=45*mm, kind="proportional")
            except Exception:
                logo_img = None

    # ── Pre-compute totals (needed for Total Due in inv details block) ────────
    sorted_items = sorted(invoice.line_items, key=lambda x: x.sort_order)
    subtotal, vat_amount, total, vat_rate_dec = _compute_totals(invoice, sorted_items)

    # ── Header — Business info left | Logo right ──────────────────────────────
    company_name = entity.trading_name or entity.name

    # Left column: company name, reg, VAT, contact details
    left_col = []
    left_col.append(Paragraph(company_name, s_company_name))
    if entity.registration_number:
        left_col.append(Paragraph(f"Reg {entity.registration_number}", s_company_sub))
    if entity.vat_number:
        left_col.append(Paragraph(f"VAT No: {entity.vat_number}", s_company_sub))
    if entity.phone or entity.email or entity.address:
        left_col.append(Spacer(1, 2*mm))
    if entity.phone:
        left_col.append(Paragraph(f"Tel:  {entity.phone}", s_contact_val))
    if entity.email:
        left_col.append(Paragraph(entity.email, s_contact_val))
    if entity.address:
        addr_lines = [l.strip() for l in entity.address.replace(",", "\n").split("\n") if l.strip()]
        for line in addr_lines:
            left_col.append(Paragraph(line, s_contact_val))

    # Right column: logo (larger, right-aligned)
    if logo_img:
        logo_cell = Table([[logo_img]], colWidths=[100*mm])
        logo_cell.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ]))
        right_col = [logo_cell]
    else:
        right_col = []

    header_table = Table(
        [[left_col, right_col]],
        colWidths=[74*mm, 100*mm],
        hAlign="LEFT",
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=1, color=accent))
    story.append(Spacer(1, 4*mm))

    # ── Document type title ───────────────────────────────────────────────────
    doc_type = str(invoice.document_type).upper().split(".")[-1]
    if doc_type == "INVOICE":
        doc_title = "TAX INVOICE TO"
    elif doc_type == "QUOTE":
        doc_title = "QUOTATION TO"
    else:
        doc_title = f"{doc_type} TO"

    if invoice.is_vat_exempt:
        doc_title = "INVOICE TO"  # Non-VAT invoices shouldn't say TAX INVOICE

    # ── Bill To + Inv details ─────────────────────────────────────────────────
    bill_to = supplier or customer
    bill_to_name = bill_to.name if bill_to else "—"
    bill_lines = [Paragraph(doc_title, s_section_label), Paragraph(bill_to_name, s_client_name)]

    if bill_to:
        if bill_to.address:
            for addr_line in bill_to.address.split("\n"):
                if addr_line.strip():
                    bill_lines.append(Paragraph(addr_line.strip(), s_client_detail))
        if bill_to.city:
            postal = f"{bill_to.city}, {bill_to.postal_code}" if bill_to.postal_code else bill_to.city
            bill_lines.append(Paragraph(postal, s_client_detail))
        if bill_to.vat_number:
            bill_lines.append(Paragraph(f"VAT NO:  {bill_to.vat_number}", s_client_detail))

    inv_details = [
        [Paragraph("Inv No", s_inv_label), Paragraph(invoice.invoice_number, s_inv_value)],
        [Paragraph("Date", s_inv_label), Paragraph(format_date(invoice.issue_date), s_inv_value)],
    ]
    if invoice.due_date:
        inv_details.append([
            Paragraph("Due Date", s_inv_label),
            Paragraph(format_date(invoice.due_date), s_inv_value),
        ])
    inv_details.append([
        Paragraph("Total Due", s_inv_label),
        Paragraph(format_currency(total), s_inv_value),
    ])

    inv_meta_table = Table(inv_details, colWidths=[22*mm, 32*mm])
    inv_meta_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    bill_section = Table(
        [[bill_lines, inv_meta_table]],
        colWidths=[108*mm, 66*mm],
    )
    bill_section.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(bill_section)
    story.append(Spacer(1, 5*mm))

    # ── Line Items ────────────────────────────────────────────────────────────
    # Detect PO-import layout.
    # Primary: any item line carries loading/offloading numbers (new imports).
    # Fallback: invoice notes contain "PO Ref:" (older imports before the fix).
    is_po_layout = (
        "PO Ref:" in (invoice.notes or "")
        or any(
            (getattr(it, 'loading_number', None) or getattr(it, 'offloading_number', None))
            for it in sorted_items
            if (getattr(it, 'line_type', 'item') or 'item') == 'item'
        )
    )

    if is_po_layout:
        # Tradekor PO import: DESCRIPTION | LOADING # | OFF-LOADING # | RATE | TOTAL
        col_desc_w    = 70*mm
        col_load_w    = 24*mm
        col_offload_w = 24*mm
        col_rate_w    = 26*mm
        col_total_w   = 30*mm
        col_widths    = [col_desc_w, col_load_w, col_offload_w, col_rate_w, col_total_w]
        last_col      = 4
        line_rows = [[
            Paragraph("DESCRIPTION",   s_col_header),
            Paragraph("LOADING #",     s_col_hdr_r),
            Paragraph("OFF-LOADING #", s_col_hdr_r),
            Paragraph("RATE",          s_col_hdr_r),
            Paragraph("TOTAL",         s_col_hdr_r),
        ]]
    else:
        # Standard layout: DESCRIPTION | QTY | RATE | TOTAL
        col_desc_w  = 95*mm
        col_qty_w   = 18*mm
        col_rate_w  = 30*mm
        col_total_w = 31*mm
        col_widths  = [col_desc_w, col_qty_w, col_rate_w, col_total_w]
        last_col    = 3
        line_rows = [[
            Paragraph("DESCRIPTION", s_col_header),
            Paragraph("QTY",         s_col_hdr_r),
            Paragraph("RATE",        s_col_hdr_r),
            Paragraph("TOTAL",       s_col_hdr_r),
        ]]

    # Accumulators for type-aware row building
    span_cmds      = []   # SPAN directives for full-width rows
    bg_cmds        = []   # per-row background / padding overrides
    item_row_idxs  = []   # indices of 'item' rows (for alternating shading only)
    empty_row      = [""] * (last_col + 1)

    for item in sorted_items:
        row_idx = len(line_rows)   # header is index 0; data starts at 1
        lt = getattr(item, 'line_type', 'item') or 'item'
        desc = item.description or ""

        if lt == 'header':
            line_rows.append([Paragraph(desc, s_sec_hdr)] + [''] * last_col)
            span_cmds.append(("SPAN", (0, row_idx), (last_col, row_idx)))
            bg_cmds.extend([
                ("BACKGROUND",    (0, row_idx), (-1, row_idx), accent_dark),
                ("TOPPADDING",    (0, row_idx), (-1, row_idx), 5),
                ("BOTTOMPADDING", (0, row_idx), (-1, row_idx), 5),
            ])

        elif lt == 'note':
            line_rows.append([Paragraph(desc, s_note_ln)] + [''] * last_col)
            span_cmds.append(("SPAN", (0, row_idx), (last_col, row_idx)))

        elif lt == 'spacer':
            line_rows.append(list(empty_row))
            span_cmds.append(("SPAN", (0, row_idx), (last_col, row_idx)))
            bg_cmds.extend([
                ("TOPPADDING",    (0, row_idx), (-1, row_idx), 2),
                ("BOTTOMPADDING", (0, row_idx), (-1, row_idx), 2),
            ])

        else:  # 'item' (default)
            is_line_exempt = getattr(item, "is_vat_exempt", False)
            if is_line_exempt and not invoice.is_vat_exempt:
                desc_para = [Paragraph(desc, s_line_desc), Paragraph("No VAT", s_exempt_tag)]
            else:
                desc_para = Paragraph(desc, s_line_desc)

            if is_po_layout:
                load_no    = getattr(item, 'loading_number',    None) or ''
                offload_no = getattr(item, 'offloading_number', None) or ''
                line_rows.append([
                    desc_para,
                    Paragraph(load_no,    s_line_num),
                    Paragraph(offload_no, s_line_num),
                    Paragraph(format_currency(item.unit_price), s_line_num),
                    Paragraph(format_currency(item.amount),     s_line_num),
                ])
            else:
                qty = Decimal(str(item.quantity)) if item.quantity is not None else Decimal('0')
                qty_str = f"{qty:.2f}" if qty != qty.to_integral_value() else f"{int(qty)}"
                line_rows.append([
                    desc_para,
                    Paragraph(qty_str, s_line_num),
                    Paragraph(format_currency(item.unit_price), s_line_num),
                    Paragraph(format_currency(item.amount), s_line_num),
                ])
            item_row_idxs.append(row_idx)

    # Pad to minimum rows (item-type blank rows)
    min_rows = 8
    while len(line_rows) < min_rows + 1:
        line_rows.append(list(empty_row))

    items_table = Table(line_rows, colWidths=col_widths)
    row_styles = [
        # Column header row
        ("BACKGROUND", (0, 0), (-1, 0), accent),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        # All data cells (default padding)
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        # Grid lines (light)
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, divider),
    ]
    # Alternating shading on item rows only
    for r in item_row_idxs:
        if r % 2 == 0:
            row_styles.append(("BACKGROUND", (0, r), (-1, r), gray_light))
    # SPAN and per-row overrides applied last (they win over base rules)
    row_styles.extend(span_cmds)
    row_styles.extend(bg_cmds)

    items_table.setStyle(TableStyle(row_styles))
    story.append(items_table)
    story.append(Spacer(1, 4*mm))

    # ── Totals + Banking Details (side by side) ───────────────────────────────
    vat_pct = int(vat_rate_dec * 100)

    if invoice.is_vat_exempt:
        vat_label = "VAT (Exempt)"
        vat_display = "—"
    else:
        vat_label = f"VAT ({vat_pct}%)"
        vat_display = format_currency(vat_amount)

    # Left: banking details
    bank_content = []
    if entity.bank_account_number:
        bank_content.append(Paragraph("Banking Details", s_bank_title))
        bank_content.append(Spacer(1, 2*mm))
        if entity.bank_name:
            bank_content.append(Paragraph(f"Bank:  {entity.bank_name}", s_bank_detail))
        if entity.bank_branch:
            bank_content.append(Paragraph(f"Branch:  {entity.bank_branch}", s_bank_detail))
        if entity.bank_branch_code:
            bank_content.append(Paragraph(f"Branch Code:  {entity.bank_branch_code}", s_bank_detail))
        bank_content.append(Paragraph(f"Account No:  {entity.bank_account_number}", s_bank_detail))
        if entity.bank_reference:
            bank_content.append(Paragraph(f"Reference:  {entity.bank_reference}", s_bank_detail))

    # Right: subtotal / VAT / grand total as a nested table
    totals_label_w = 30*mm
    totals_value_w = 36*mm

    totals_right_data = [
        [Paragraph("Sub Total", s_total_label), Paragraph(format_currency(subtotal), s_total_value)],
        [Paragraph(vat_label, s_total_label),   Paragraph(vat_display, s_total_value)],
        [Paragraph("Total", s_grand_label),     Paragraph(format_currency(total), s_grand_value)],
    ]
    totals_right = Table(totals_right_data, colWidths=[totals_label_w, totals_value_w])
    totals_right.setStyle(TableStyle([
        ("BACKGROUND", (0, 2), (-1, 2), accent),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, divider),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    # Combined bottom row: banking (left 108mm) + totals (right 66mm)
    bottom_table = Table(
        [[bank_content, totals_right]],
        colWidths=[108*mm, 66*mm],
    )
    bottom_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(bottom_table)
    story.append(Spacer(1, 6*mm))

    # ── Notes (printed only if print_note is True) ────────────────────────────
    if getattr(invoice, "print_note", False) and invoice.notes:
        story.append(Spacer(1, 2*mm))
        story.append(Paragraph("Notes", s_note_title))
        story.append(Spacer(1, 1*mm))
        story.append(Paragraph(invoice.notes.replace("\n", "<br/>"), s_note_text))
        story.append(Spacer(1, 4*mm))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=divider))
    story.append(Spacer(1, 2*mm))
    footer_text = f"{entity.name}"
    if entity.vat_number:
        footer_text += f"  |  VAT: {entity.vat_number}"
    story.append(Paragraph(footer_text, s_footer))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()