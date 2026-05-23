"""
Payslip PDF generator — matches the Safetec letterhead style used in pdf_generator.py.
"""

import io
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse

import httpx
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable, Image as RLImage, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle,
)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _hex(h: str) -> colors.Color:
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return colors.Color(int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def _darken(c: colors.Color, f: float = 0.8) -> colors.Color:
    return colors.Color(c.red * f, c.green * f, c.blue * f)


def _fmt(v) -> str:
    try:
        val = Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        parts = f"{abs(val):,.2f}".replace(",", " ")
        return f"R {parts}" if val >= 0 else f"-R {parts}"
    except Exception:
        return "R 0.00"


def _load_logo(logo_url, logo_path=None) -> bytes | None:
    if logo_path:
        try:
            p = Path(logo_path)
            if p.is_file():
                return p.read_bytes()
        except Exception:
            pass
    if not logo_url:
        return None
    parsed = urlparse(logo_url)
    if parsed.hostname in ("localhost", "127.0.0.1"):
        local = _BACKEND_ROOT / parsed.path.lstrip("/")
        try:
            if local.is_file():
                return local.read_bytes()
        except Exception:
            pass
        return None
    try:
        resp = httpx.get(logo_url, timeout=5.0)
        if resp.status_code == 200:
            return resp.content
    except Exception:
        pass
    return None


def generate_payslip_pdf(driver, cycle, calc: dict, entity) -> bytes:
    """
    Generate a one-page payslip PDF for a driver pay cycle.
    calc is the serialisable dict from calculate_pay_cycle().
    """
    # ── Colours ───────────────────────────────────────────────────────────────
    accent = _hex(getattr(entity, "primary_color", None) or "#1a1a2e")
    accent_dark = _darken(accent, 0.85)
    white = colors.white
    black = colors.HexColor("#111111")
    gray_dark = colors.HexColor("#333333")
    gray_mid = colors.HexColor("#666666")
    gray_light = colors.HexColor("#f5f5f5")
    red = colors.HexColor("#dc2626")
    green = colors.HexColor("#16a34a")

    # ── Document ──────────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm,
    )
    story = []

    def st(name, **kw):
        d = dict(fontName="Helvetica", fontSize=9, textColor=black, leading=12)
        d.update(kw)
        return ParagraphStyle(name, **d)

    s_co = st("co", fontSize=10, fontName="Helvetica-Bold", leading=14)
    s_co_sub = st("co_sub", fontSize=7.5, textColor=gray_mid, leading=10)
    s_contact = st("ct", fontSize=8, textColor=gray_dark, leading=11)
    s_title = st("title", fontSize=14, fontName="Helvetica-Bold", textColor=white, leading=18, alignment=TA_CENTER)
    s_section = st("sec", fontSize=8, fontName="Helvetica-Bold", textColor=white, leading=11, alignment=TA_LEFT)
    s_label = st("lbl", fontSize=9, textColor=gray_mid, leading=12)
    s_value = st("val", fontSize=9, textColor=black, leading=12)
    s_bold = st("bold", fontSize=9, fontName="Helvetica-Bold", textColor=black, leading=12)
    s_r = st("r", fontSize=9, textColor=gray_dark, alignment=TA_RIGHT, leading=12)
    s_r_bold = st("rb", fontSize=9, fontName="Helvetica-Bold", textColor=black, alignment=TA_RIGHT, leading=12)
    s_r_red = st("rr", fontSize=9, fontName="Helvetica-Bold", textColor=red, alignment=TA_RIGHT, leading=12)
    s_r_green = st("rg", fontSize=9, fontName="Helvetica-Bold", textColor=green, alignment=TA_RIGHT, leading=12)
    s_net_label = st("nl", fontSize=12, fontName="Helvetica-Bold", textColor=white, alignment=TA_LEFT, leading=16)
    s_net_value = st("nv", fontSize=12, fontName="Helvetica-Bold", textColor=white, alignment=TA_RIGHT, leading=16)
    s_footer = st("ft", fontSize=7, textColor=gray_mid, alignment=TA_CENTER, leading=9)

    # ── Logo ──────────────────────────────────────────────────────────────────
    logo_img = None
    logo_bytes = _load_logo(getattr(entity, "logo_url", None), getattr(entity, "logo_path", None))
    if logo_bytes:
        try:
            logo_img = RLImage(io.BytesIO(logo_bytes), width=110 * mm, height=35 * mm, kind="proportional")
        except Exception:
            logo_img = None

    # ── Header row ────────────────────────────────────────────────────────────
    company_name = entity.trading_name or entity.name
    left = [Paragraph(company_name, s_co)]
    if entity.registration_number:
        left.append(Paragraph(f"Reg {entity.registration_number}", s_co_sub))
    if entity.vat_number:
        left.append(Paragraph(f"VAT No: {entity.vat_number}", s_co_sub))
    if entity.phone or entity.email:
        left.append(Spacer(1, 2 * mm))
    if entity.phone:
        left.append(Paragraph(f"Tel: {entity.phone}", s_contact))
    if entity.email:
        left.append(Paragraph(entity.email, s_contact))

    right = [logo_img] if logo_img else []

    hdr = Table([[left, right]], colWidths=[80 * mm, 94 * mm])
    hdr.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    story.append(hdr)
    story.append(HRFlowable(width="100%", thickness=1, color=accent))
    story.append(Spacer(1, 3 * mm))

    # ── PAYSLIP title bar ─────────────────────────────────────────────────────
    month_str = MONTHS[cycle.pay_month - 1]
    title_tbl = Table(
        [[Paragraph(f"PAYSLIP — {month_str.upper()} {cycle.pay_year}", s_title)]],
        colWidths=[174 * mm],
    )
    title_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), accent),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    story.append(title_tbl)
    story.append(Spacer(1, 4 * mm))

    # ── Employee info ─────────────────────────────────────────────────────────
    driver_type_label = "Permanent" if driver.driver_type.value == "permanent" else "Casual"
    emp_rows = [
        ["Employee", f"{driver.first_name} {driver.last_name}", "Employee #", driver.employee_number or "—"],
        ["Driver Type", driver_type_label, "ID Number", driver.id_number or "—"],
        ["Tax Number", driver.tax_number or "—", "Bank", driver.bank_name or "—"],
        ["Account No.", driver.bank_account_number or "—", "Entity", company_name],
    ]
    emp_data = [[
        Paragraph(r[0], s_label), Paragraph(r[1], s_bold),
        Paragraph(r[2], s_label), Paragraph(r[3], s_bold),
    ] for r in emp_rows]

    emp_tbl = Table(emp_data, colWidths=[28 * mm, 58 * mm, 28 * mm, 60 * mm])
    emp_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), gray_light),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [gray_light, white]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#dddddd")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(emp_tbl)
    story.append(Spacer(1, 4 * mm))

    # ── Helper: section header bar ────────────────────────────────────────────
    def section_bar(text):
        t = Table([[Paragraph(text, s_section)]], colWidths=[174 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), accent_dark),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t

    def line_row(label, value, value_style=None):
        vs = value_style or s_r
        return [Paragraph(label, s_label), Paragraph(value, vs)]

    def table_2col(rows, col_widths=None):
        cw = col_widths or [120 * mm, 54 * mm]
        t = Table(rows, colWidths=cw)
        t.setStyle(TableStyle([
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [white, gray_light]),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return t

    is_casual = calc.get("driver_type") == "casual"

    # ── INCOME section ────────────────────────────────────────────────────────
    story.append(section_bar("INCOME"))
    income_rows = []
    if is_casual:
        if calc.get("load_earnings", 0):
            total_loads = calc.get("lohatla_total_loads", 0)
            rate = calc.get("casual_rate_per_load", 0)
            income_rows.append(line_row(
                f"Load earnings  ({total_loads} loads × {_fmt(rate)})",
                _fmt(calc.get("load_earnings", 0)),
            ))
    else:
        total_loads = calc.get("lohatla_total_loads", 0)
        income_rows.append(line_row(
            f"Basic salary  ({total_loads} Lohatla loads)",
            _fmt(calc.get("basic_salary", 0)),
        ))
        subs = calc.get("total_subsistence", 0)
        if float(subs) > 0:
            income_rows.append(line_row(
                f"Subsistence  ({total_loads} × {_fmt(float(subs) / total_loads if total_loads else 0)})",
                _fmt(subs),
            ))
        if float(calc.get("total_incentive", 0)) > 0:
            income_rows.append(line_row("Load incentive  (extra loads)", _fmt(calc.get("total_incentive", 0))))
        if float(calc.get("assmang_bonus", 0)) > 0:
            income_rows.append(line_row(f"Assmang bonus  ({total_loads} × R150)", _fmt(calc.get("assmang_bonus", 0))))

    if float(calc.get("additional_loads_total", 0)) > 0:
        income_rows.append(line_row("Additional loads", _fmt(calc.get("additional_loads_total", 0))))

    # gross subtotal row
    income_rows.append([
        Paragraph("GROSS INCOME", s_bold),
        Paragraph(_fmt(calc.get("gross", 0)), s_r_bold),
    ])

    story.append(table_2col(income_rows))
    story.append(Spacer(1, 4 * mm))

    # ── DEDUCTIONS section ────────────────────────────────────────────────────
    story.append(section_bar("DEDUCTIONS"))
    ded_rows = []

    if not is_casual:
        for label, key in [
            ("NBCRFLI", "nbcrfli"),
            ("Provident fund", "provident"),
            ("Wellness fund", "wellness"),
            ("Sick fund", "sick_fund"),
            ("Holiday fund", "holiday_fund"),
            ("Leave pay", "leave_pay"),
            ("PAYE", "paye"),
        ]:
            v = float(calc.get(key, 0))
            if v > 0:
                ded_rows.append(line_row(label, f"({_fmt(v)})", s_r_red))

        subs_adv = float(calc.get("subsistence_advance_paid", 0))
        if subs_adv > 0:
            ded_rows.append(line_row("Subsistence advance paid", f"({_fmt(subs_adv)})", s_r_red))

    loan = float(calc.get("loan_deduction", 0))
    if loan > 0:
        ded_rows.append(line_row("Staff loan deduction", f"({_fmt(loan)})", s_r_red))

    cash = float(calc.get("cash_deduction", 0))
    if cash > 0:
        ded_rows.append(line_row("Cash advance deduction", f"({_fmt(cash)})", s_r_red))

    food = float(calc.get("food_deduction", 0))
    if food > 0:
        ded_rows.append(line_row("Food allowance (Kosgelde)", f"({_fmt(food)})", s_r_red))

    if not ded_rows:
        ded_rows.append(line_row("No deductions this cycle", "—"))

    # total deductions row
    ded_rows.append([
        Paragraph("TOTAL DEDUCTIONS", s_bold),
        Paragraph(f"({_fmt(calc.get('total_deductions', 0))})", s_r_red),
    ])

    story.append(table_2col(ded_rows))
    story.append(Spacer(1, 4 * mm))

    # ── NET PAYABLE bar ───────────────────────────────────────────────────────
    net = calc.get("net_payable", 0)
    net_tbl = Table(
        [[Paragraph("NET PAYABLE", s_net_label), Paragraph(_fmt(net), s_net_value)]],
        colWidths=[120 * mm, 54 * mm],
    )
    net_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), accent),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(net_tbl)

    # ── Comments ──────────────────────────────────────────────────────────────
    if cycle.comments:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph("Comments:", ParagraphStyle("c_lbl", fontName="Helvetica-Bold", fontSize=8, textColor=gray_dark, leading=11)))
        story.append(Paragraph(cycle.comments, ParagraphStyle("c_txt", fontSize=8, textColor=gray_dark, leading=12)))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cccccc")))
    story.append(Spacer(1, 2 * mm))
    generated_at = datetime.now().strftime("%d %B %Y at %H:%M")
    story.append(Paragraph(
        f"Generated {generated_at}  ·  {company_name}",
        s_footer,
    ))

    doc.build(story)
    return buf.getvalue()
