from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
import io
from decimal import Decimal
from datetime import datetime


# ── Theme palettes ─────────────────────────────────────────────────────────────

def _get_palette(theme: str = "dark"):
    if theme == "light":
        return {
            "header_bg":   colors.HexColor("#1e3a5f"),
            "header_text": colors.white,
            "header_sub":  colors.HexColor("#a0b4c8"),
            "accent":      colors.HexColor("#2563eb"),
            "row_alt":     colors.HexColor("#f3f4f6"),
            "row_base":    colors.white,
            "meta_bg":     colors.HexColor("#f9fafb"),
            "bill_bg":     colors.HexColor("#f0f4ff"),
            "bank_bg":     colors.HexColor("#f9fafb"),
            "total_bg":    colors.HexColor("#1e3a5f"),
            "total_text":  colors.white,
            "grid_color":  colors.HexColor("#e5e7eb"),
            "text_dark":   colors.HexColor("#111827"),
            "text_muted":  colors.HexColor("#6b7280"),
            "footer_text": colors.HexColor("#9ca3af"),
            "line_color":  colors.HexColor("#e5e7eb"),
        }
    else:  # dark
        return {
            "header_bg":   colors.HexColor("#1a1a2e"),
            "header_text": colors.white,
            "header_sub":  colors.HexColor("#aaaaaa"),
            "accent":      colors.HexColor("#4f8ef7"),
            "row_alt":     colors.HexColor("#f5f5f5"),
            "row_base":    colors.white,
            "meta_bg":     colors.HexColor("#f5f5f5"),
            "bill_bg":     colors.HexColor("#f0f4ff"),
            "bank_bg":     colors.HexColor("#f5f5f5"),
            "total_bg":    colors.HexColor("#1a1a2e"),
            "total_text":  colors.white,
            "grid_color":  colors.HexColor("#e0e0e0"),
            "text_dark":   colors.HexColor("#1a1a2e"),
            "text_muted":  colors.HexColor("#555555"),
            "footer_text": colors.HexColor("#aaaaaa"),
            "line_color":  colors.HexColor("#e0e0e0"),
        }


def format_currency(amount) -> str:
    try:
        return f"R {Decimal(str(amount)):,.2f}"
    except Exception:
        return "R 0.00"


def format_date(dt) -> str:
    if dt is None:
        return "—"
    if isinstance(dt, str):
        return dt
    return dt.strftime("%d %B %Y")


def generate_invoice_pdf(invoice, entity, client, theme: str = "dark") -> bytes:
    p = _get_palette(theme)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20*mm,
        leftMargin=20*mm,
        topMargin=15*mm,
        bottomMargin=20*mm,
    )

    story = []

    # ── Header ────────────────────────────────────────────────────────────────
    title_style = ParagraphStyle("title", fontSize=22, textColor=p["header_text"], fontName="Helvetica-Bold", leading=28)
    entity_right = ParagraphStyle("er", fontSize=9, textColor=p["header_text"], fontName="Helvetica", alignment=TA_RIGHT)

    doc_type = invoice.document_type.upper() if hasattr(invoice.document_type, 'upper') else str(invoice.document_type).upper()
    if '.' in doc_type:
        doc_type = doc_type.split('.')[-1]

    header_data = [[
        Paragraph(doc_type, title_style),
        Paragraph(
            f"<b>{entity.name}</b><br/>"
            + (f"{entity.address}<br/>" if entity.address else "")
            + (f"VAT: {entity.vat_number}" if entity.vat_number else ""),
            entity_right
        )
    ]]
    header_table = Table(header_data, colWidths=[90*mm, 80*mm])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), p["header_bg"]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING", (0, 0), (0, -1), 8),
        ("RIGHTPADDING", (-1, 0), (-1, -1), 8),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 6*mm))

    # ── Invoice Meta ──────────────────────────────────────────────────────────
    meta_label = ParagraphStyle("ml", fontSize=8, textColor=p["text_muted"], fontName="Helvetica")
    meta_value = ParagraphStyle("mv", fontSize=10, textColor=p["text_dark"], fontName="Helvetica-Bold")

    status_str = str(invoice.status).upper().split('.')[-1]
    meta_data = [
        [Paragraph("INVOICE NO.", meta_label), Paragraph("DATE ISSUED", meta_label),
         Paragraph("DUE DATE", meta_label), Paragraph("STATUS", meta_label)],
        [Paragraph(invoice.invoice_number, meta_value), Paragraph(format_date(invoice.issue_date), meta_value),
         Paragraph(format_date(invoice.due_date), meta_value), Paragraph(status_str, meta_value)],
    ]
    meta_table = Table(meta_data, colWidths=[42.5*mm, 42.5*mm, 42.5*mm, 42.5*mm])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), p["meta_bg"]),
        ("GRID", (0, 0), (-1, -1), 0.5, p["grid_color"]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 6*mm))

    # ── Bill To ───────────────────────────────────────────────────────────────
    bill_style = ParagraphStyle("bs", fontSize=8, textColor=p["text_muted"], fontName="Helvetica")
    bill_value = ParagraphStyle("bv", fontSize=10, textColor=p["text_dark"], fontName="Helvetica-Bold")
    bill_detail = ParagraphStyle("bd", fontSize=9, textColor=p["text_dark"], fontName="Helvetica")

    client_name = client.name if client else "—"
    bill_content = [
        Paragraph("BILL TO", bill_style),
        Paragraph(client_name, bill_value),
    ]
    for val in [client.address if client else None, client.email if client else None, client.phone if client else None]:
        if val:
            bill_content.append(Paragraph(val, bill_detail))

    bill_table = Table([[bill_content, []]], colWidths=[85*mm, 85*mm])
    bill_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), p["bill_bg"]),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (0, -1), 10),
        ("BOX", (0, 0), (0, 0), 0.5, p["grid_color"]),
    ]))
    story.append(bill_table)
    story.append(Spacer(1, 6*mm))

    # ── Line Items ────────────────────────────────────────────────────────────
    li_header = ParagraphStyle("lih", fontSize=9, textColor=p["header_text"], fontName="Helvetica-Bold")
    li_cell = ParagraphStyle("lic", fontSize=9, textColor=p["text_dark"], fontName="Helvetica")
    li_cell_r = ParagraphStyle("licr", fontSize=9, textColor=p["text_dark"], fontName="Helvetica", alignment=TA_RIGHT)

    line_rows = [[
        Paragraph("DESCRIPTION", li_header),
        Paragraph("QTY", ParagraphStyle("qh", fontSize=9, textColor=p["header_text"], fontName="Helvetica-Bold", alignment=TA_RIGHT)),
        Paragraph("UNIT PRICE", ParagraphStyle("uh", fontSize=9, textColor=p["header_text"], fontName="Helvetica-Bold", alignment=TA_RIGHT)),
        Paragraph("AMOUNT", ParagraphStyle("ah", fontSize=9, textColor=p["header_text"], fontName="Helvetica-Bold", alignment=TA_RIGHT)),
    ]]

    sorted_items = sorted(invoice.line_items, key=lambda x: x.sort_order)
    for item in sorted_items:
        line_rows.append([
            Paragraph(item.description or "", li_cell),
            Paragraph(f"{Decimal(str(item.quantity)):.2f}", li_cell_r),
            Paragraph(format_currency(item.unit_price), li_cell_r),
            Paragraph(format_currency(item.amount), li_cell_r),
        ])

    while len(line_rows) < 7:
        line_rows.append(["", "", "", ""])

    items_table = Table(line_rows, colWidths=[90*mm, 20*mm, 35*mm, 25*mm])
    item_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), p["header_bg"]),
        ("GRID", (0, 0), (-1, -1), 0.3, p["grid_color"]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for i in range(1, len(line_rows)):
        if i % 2 == 0:
            item_styles.append(("BACKGROUND", (0, i), (-1, i), p["row_alt"]))
    items_table.setStyle(TableStyle(item_styles))
    story.append(items_table)
    story.append(Spacer(1, 4*mm))

    # ── Totals ────────────────────────────────────────────────────────────────
    total_label = ParagraphStyle("tl", fontSize=9, textColor=p["text_dark"], fontName="Helvetica", alignment=TA_RIGHT)
    total_value = ParagraphStyle("tv", fontSize=9, textColor=p["text_dark"], fontName="Helvetica-Bold", alignment=TA_RIGHT)
    grand_label = ParagraphStyle("gl", fontSize=11, textColor=p["total_text"], fontName="Helvetica-Bold", alignment=TA_RIGHT)
    grand_value = ParagraphStyle("gv", fontSize=11, textColor=p["total_text"], fontName="Helvetica-Bold", alignment=TA_RIGHT)

    vat_pct = int(Decimal(str(invoice.vat_rate)) * 100)
    totals_data = [
        ["", Paragraph("Subtotal", total_label), Paragraph(format_currency(invoice.subtotal), total_value)],
        ["", Paragraph(f"VAT ({vat_pct}%)", total_label), Paragraph(format_currency(invoice.vat_amount), total_value)],
        ["", Paragraph("TOTAL DUE", grand_label), Paragraph(format_currency(invoice.total), grand_value)],
    ]
    totals_table = Table(totals_data, colWidths=[95*mm, 50*mm, 25*mm])
    totals_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 2), (-1, 2), p["total_bg"]),
        ("LINEABOVE", (1, 0), (-1, 0), 0.5, p["grid_color"]),
        ("LINEABOVE", (1, 2), (-1, 2), 1, p["total_bg"]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(totals_table)
    story.append(Spacer(1, 8*mm))

    # ── Banking Details ───────────────────────────────────────────────────────
    bank_title = ParagraphStyle("bt", fontSize=9, textColor=p["text_dark"], fontName="Helvetica-Bold")
    bank_detail = ParagraphStyle("bd2", fontSize=8, textColor=p["text_dark"], fontName="Helvetica")

    if entity.bank_account_number:
        bank_content = [Paragraph("Banking Details", bank_title), Spacer(1, 2*mm)]
        bank_content.append(Paragraph(f"{entity.name}", bank_detail))
        bank_content.append(Paragraph(f"Bank: {entity.bank_name or ''} | Branch: {entity.bank_branch or ''}", bank_detail))
        bank_content.append(Paragraph(f"Account: {entity.bank_account_number}", bank_detail))
        if entity.bank_branch_code:
            bank_content.append(Paragraph(f"Branch Code: {entity.bank_branch_code}", bank_detail))
        if entity.bank_reference:
            bank_content.append(Paragraph(f"Reference: {entity.bank_reference}", bank_detail))

        bank_table = Table([[bank_content]], colWidths=[170*mm])
        bank_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), p["bank_bg"]),
            ("BOX", (0, 0), (-1, -1), 0.5, p["grid_color"]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(bank_table)

    if invoice.notes:
        story.append(Spacer(1, 4*mm))
        story.append(Paragraph("Notes:", ParagraphStyle("nt", fontSize=9, fontName="Helvetica-Bold", textColor=p["text_dark"])))
        story.append(Paragraph(invoice.notes, ParagraphStyle("nd", fontSize=8, fontName="Helvetica", textColor=p["text_dark"])))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 8*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=p["line_color"]))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        f"Generated by safetec_core | {entity.name} | {format_date(datetime.now())}",
        ParagraphStyle("footer", fontSize=7, textColor=p["footer_text"], fontName="Helvetica", alignment=TA_CENTER)
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()

