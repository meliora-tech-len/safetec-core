"""
Truck Totals (fleet summary) PDF export — reportlab.

Mirrors the Truck Loads → Summary tab: one row per truck with load count,
tonnes, amounts and missing-invoice count for the selected statement period,
plus a grand-total row. Includes the entity letterhead/logo header when a
single entity is selected (same fallback chain as the costing export).
"""

import io

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _fmt(v) -> str:
    try:
        return f"R {float(v):,.2f}"
    except (TypeError, ValueError):
        return "—"


def _tonnes(v) -> str:
    try:
        return f"{float(v):,.2f} t"
    except (TypeError, ValueError):
        return "—"


def generate_fleet_summary_pdf(rows, entity, month: int, year: int) -> bytes:
    """Render the fleet summary as a branded PDF.

    `rows` are TruckFleetSummaryRow objects (already access-filtered and ordered
    by entity/fleet number). `entity` is the BusinessEntity when a single entity
    was selected, else None — in that case an Entity column is added and the
    header is plain text.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
        Image as RLImage,
    )
    from app.services.pdf_generator import _load_logo, _FONT_NORMAL, _FONT_BOLD

    black    = colors.HexColor("#111111")
    gray_mid = colors.HexColor("#6b7280")
    gray_lt  = colors.HexColor("#f3f4f6")
    white    = colors.white
    hdr_bg   = colors.HexColor("#4B5563")
    warn_col = colors.HexColor("#d97706")
    ok_col   = colors.HexColor("#15803d")
    border_c = colors.HexColor("#e5e7eb")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            rightMargin=16*mm, leftMargin=16*mm,
                            topMargin=10*mm, bottomMargin=14*mm)

    def sty(name, **kw):
        d = dict(fontName=_FONT_NORMAL, fontSize=9, textColor=black, leading=12)
        d.update(kw)
        return ParagraphStyle(name, **d)

    s_title  = sty("title", fontSize=13, fontName=_FONT_BOLD, leading=17)
    s_sub    = sty("sub",   fontSize=9,  textColor=gray_mid,  leading=13)
    s_hdr    = sty("hdr",   fontSize=8,  fontName=_FONT_BOLD, textColor=white)
    s_hdr_r  = sty("hdr_r", fontSize=8,  fontName=_FONT_BOLD, textColor=white, alignment=TA_RIGHT)
    s_lbl    = sty("lbl",   fontSize=8,  textColor=black)
    s_mono   = sty("mono",  fontSize=8,  fontName=_FONT_BOLD, textColor=black)
    s_val    = sty("val",   fontSize=8,  textColor=black, alignment=TA_RIGHT)
    s_warn   = sty("warn",  fontSize=8,  fontName=_FONT_BOLD, textColor=warn_col, alignment=TA_RIGHT)
    s_ok     = sty("ok",    fontSize=8,  textColor=ok_col, alignment=TA_RIGHT)
    s_tot    = sty("tot",   fontSize=8,  fontName=_FONT_BOLD, textColor=white)
    s_tot_r  = sty("totr",  fontSize=8,  fontName=_FONT_BOLD, textColor=white, alignment=TA_RIGHT)

    story = []

    # ── Letterhead / logo (single-entity export only) ─────────────────────────
    added_header = False
    if entity is not None:
        lh_url  = getattr(entity, "letterhead_url",  None)
        lh_path = getattr(entity, "letterhead_path", None)
        if lh_url or lh_path:
            lh_bytes = _load_logo(lh_url, lh_path)
            if lh_bytes:
                try:
                    img = RLImage(io.BytesIO(lh_bytes), width=174*mm, height=105*mm, kind="proportional")
                    img.hAlign = "CENTER"
                    story.append(img)
                    story.append(Spacer(1, 4*mm))
                    added_header = True
                except Exception:
                    pass
        if not added_header:
            logo_url  = getattr(entity, "logo_url",  None)
            logo_path = getattr(entity, "logo_path", None)
            if logo_url or logo_path:
                lb = _load_logo(logo_url, logo_path)
                if lb:
                    try:
                        img = RLImage(io.BytesIO(lb), width=55*mm, height=30*mm, kind="proportional")
                        img.hAlign = "LEFT"
                        story.append(img)
                        story.append(Spacer(1, 3*mm))
                        added_header = True
                    except Exception:
                        pass
        if not added_header:
            ent_name = getattr(entity, "name", "") or ""
            story.append(Paragraph(ent_name, sty("en", fontSize=14, fontName=_FONT_BOLD)))
            story.append(Spacer(1, 3*mm))

    # ── Title ─────────────────────────────────────────────────────────────────
    period = f"{MONTH_NAMES[month]} {year}"
    story.append(Paragraph("Truck Totals", s_title))
    sub_bits = [f"Period: {period}"]
    if entity is None:
        sub_bits.append("All entities")
    story.append(Paragraph("  ·  ".join(sub_bits), s_sub))
    story.append(Spacer(1, 5*mm))

    # ── Table ─────────────────────────────────────────────────────────────────
    def P(txt, style): return Paragraph(str(txt), style)

    multi_entity = entity is None
    header = [P("Fleet #", s_hdr), P("Registration", s_hdr)]
    if multi_entity:
        header.insert(0, P("Entity", s_hdr))
    header += [P("Loads", s_hdr_r), P("Tonnes", s_hdr_r),
               P("Excl VAT", s_hdr_r), P("Incl VAT", s_hdr_r),
               P("Missing Invoice", s_hdr_r)]

    data = [header]
    for r in rows:
        cells = [P(r.fleet_number or "—", s_lbl), P(r.truck_registration, s_mono)]
        if multi_entity:
            cells.insert(0, P(r.entity_code or r.entity_name or "—", s_lbl))
        missing = int(r.loads_missing_invoice or 0)
        cells += [
            P(r.total_loads, s_val),
            P(_tonnes(r.total_tonnes), s_val),
            P(_fmt(r.total_excl_vat), s_val),
            P(_fmt(r.total_incl_vat), s_val),
            # Plain text (no ⚠/✓ glyphs — not covered by the PDF fonts)
            P(missing, s_warn) if missing > 0 else P("0", s_ok),
        ]
        data.append(cells)

    tot_loads   = sum(r.total_loads for r in rows)
    tot_tonnes  = sum(float(r.total_tonnes or 0) for r in rows)
    tot_excl    = sum(float(r.total_excl_vat or 0) for r in rows)
    tot_incl    = sum(float(r.total_incl_vat or 0) for r in rows)
    tot_missing = sum(int(r.loads_missing_invoice or 0) for r in rows)

    tot_row = [P("Total", s_tot), P("", s_tot)]
    if multi_entity:
        tot_row.insert(1, P("", s_tot))
    tot_row += [
        P(tot_loads, s_tot_r),
        P(_tonnes(tot_tonnes), s_tot_r),
        P(_fmt(tot_excl), s_tot_r),
        P(_fmt(tot_incl), s_tot_r),
        P(tot_missing if tot_missing > 0 else "All linked", s_tot_r),
    ]
    data.append(tot_row)

    if multi_entity:
        col_w = [18*mm, 16*mm, 30*mm, 18*mm, 24*mm, 28*mm, 28*mm, 16*mm]
    else:
        col_w = [20*mm, 36*mm, 20*mm, 26*mm, 30*mm, 30*mm, 16*mm]

    tbl = Table(data, colWidths=col_w, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), hdr_bg),
        ("LEFTPADDING",  (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
        ("GRID",         (0, 0), (-1, -1), 0.4, border_c),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))
    # Alternate row shading (body rows only)
    for i in range(1, len(data) - 1):
        if i % 2 == 0:
            tbl.setStyle(TableStyle([("BACKGROUND", (0, i), (-1, i), gray_lt)]))
    # Totals row
    last = len(data) - 1
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, last), (-1, last), colors.HexColor("#374151")),
    ]))
    story.append(tbl)

    doc.build(story)
    return buf.getvalue()
