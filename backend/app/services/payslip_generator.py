"""
Payslip PDF generator.

Permanent drivers: Sage-style two-copies-per-A4-page layout with bordered header,
side-by-side earnings/deductions, NETT PAY bar, YTD totals, and current-period
employer contributions.

Casual drivers: existing single-page letterhead style.
"""

import calendar as _cal
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


# ── Colour / formatting helpers ───────────────────────────────────────────────

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


def _fmt_plain(v) -> str:
    """SA internal format — no R prefix, comma decimal, e.g. 12100,00."""
    try:
        val = Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return f"{float(abs(val)):.2f}".replace(".", ",")
    except Exception:
        return "0,00"


def _fmt_date(d) -> str:
    if not d:
        return "—"
    try:
        if hasattr(d, "strftime"):
            return d.strftime("%d/%m/%Y")
        return str(d)
    except Exception:
        return "—"


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


# ── Permanent driver payslip (Sage-style) ─────────────────────────────────────

def _build_permanent_payslip(driver, cycle, calc: dict, entity, ytd: dict, avail_w: float):
    """
    Returns a list of flowables for ONE copy of the permanent driver payslip.
    Two copies are printed per A4 page.
    """
    # ── palette ──────────────────────────────────────────────────────────────
    black   = colors.HexColor("#111111")
    white   = colors.white
    gray    = colors.HexColor("#f5f5f5")
    border  = colors.HexColor("#aaaaaa")
    dark    = colors.HexColor("#555555")
    mid     = colors.HexColor("#444444")

    def sty(name, **kw):
        base = dict(fontName="Helvetica", fontSize=7.5, textColor=black, leading=10)
        base.update(kw)
        return ParagraphStyle(name, **base)

    s_lbl   = sty("lbl",  fontName="Helvetica-Bold", fontSize=7,   textColor=mid)
    s_val   = sty("val",  fontSize=7.5)
    s_bold  = sty("bold", fontName="Helvetica-Bold", fontSize=7.5)
    s_hdr   = sty("hdr",  fontName="Helvetica-Bold", fontSize=7.5, textColor=white, alignment=TA_CENTER)
    s_chdr  = sty("chdr", fontName="Helvetica-Bold", fontSize=7, textColor=black)
    s_r     = sty("r",    fontSize=7.5, alignment=TA_RIGHT)
    s_rb    = sty("rb",   fontName="Helvetica-Bold", fontSize=7.5, alignment=TA_RIGHT)
    s_nll   = sty("nll",  fontName="Helvetica-Bold", fontSize=10, textColor=white, alignment=TA_LEFT,  leading=14)
    s_nlv   = sty("nlv",  fontName="Helvetica-Bold", fontSize=11, textColor=white, alignment=TA_RIGHT, leading=14)
    s_ysl   = sty("ysl",  fontName="Helvetica-Bold", fontSize=7.5, textColor=white, alignment=TA_CENTER)

    def P(text, style):
        return Paragraph(text, style)

    def lv(label, value):
        """Bold label + value in one Paragraph."""
        return P(f"<b>{label}</b>  {value}", s_val)

    # ── driver / company data ─────────────────────────────────────────────────
    company = entity.trading_name or entity.name
    addr_raw = (getattr(entity, "address", "") or "").replace("\r\n", "\n").replace("\r", "\n")
    addr_lines = [l.strip() for l in addr_raw.split("\n") if l.strip()]
    # pad to 4 lines
    while len(addr_lines) < 4:
        addr_lines.append("")

    pay_last = _cal.monthrange(cycle.pay_year, cycle.pay_month)[1]
    pay_dt   = f"{pay_last:02d}/{cycle.pay_month:02d}/{cycle.pay_year}"
    eng_dt   = _fmt_date(getattr(driver, "date_engaged", None))

    emp_code   = driver.employee_number or "—"
    emp_name   = f"{driver.first_name} {driver.last_name}"
    emp_addr   = (getattr(driver, "address", None) or "—")
    job_title  = (getattr(driver, "job_title", None) or "Code 14 Driver")
    account_no = driver.bank_account_number or "—"
    branch_cd  = (getattr(driver, "branch_code", None) or "—")

    # ── header table ─────────────────────────────────────────────────────────
    # 3-column table: [left emp info | middle company address | right dates/bank]
    # rows 0-3: Co.Name/EmpCode/EmpName/Addr — address lines — payment info
    # row 4 (span 1-2): emp address

    c0, c1, c2 = 58 * mm, 70 * mm, 58 * mm  # = 186mm

    hdr_rows = [
        # row 0
        [P("<b>Co. Name</b>", s_lbl),   P("<b>Co. Address</b>", s_lbl), lv("Payment Dt", pay_dt)],
        # row 1
        [P(company, s_bold),             P(addr_lines[0], s_val),        lv("Dt Engaged", eng_dt)],
        # row 2
        [P("<b>Emp Code</b>", s_lbl),   P(addr_lines[1], s_val),        lv("Account No", account_no)],
        # row 3
        [P(emp_code, s_val),             P(addr_lines[2], s_val),        lv("Branch Code", branch_cd)],
        # row 4
        [P("<b>Emp Name</b>", s_lbl),   P(addr_lines[3], s_val),        P("", s_val)],
        # row 5
        [P(emp_name, s_bold),            lv("Job Title", job_title),     P("", s_val)],
        # row 6 — emp address spans cols 1+2
        [P("<b>Emp Address</b>", s_lbl), P(emp_addr, s_val),             P("", s_val)],
    ]

    hdr_style = TableStyle([
        ("GRID",        (0, 0), (-1, -1), 0.4, border),
        ("TOPPADDING",  (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0,0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",(0, 0), (-1, -1), 4),
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
        # emp address row — merge cols 1 & 2
        ("SPAN",        (1, 6), (2, 6)),
    ])
    hdr_tbl = Table(hdr_rows, colWidths=[c0, c1, c2])
    hdr_tbl.setStyle(hdr_style)

    # ── earnings / deductions data ────────────────────────────────────────────
    basic    = float(calc.get("basic_salary", 0))
    sick     = float(calc.get("sick_fund", 0))
    holiday  = float(calc.get("holiday_fund", 0))
    leave    = float(calc.get("leave_pay", 0))
    inc      = float(calc.get("total_incentive", 0)) + float(calc.get("assmang_bonus", 0))
    subs_inc = float(calc.get("total_subsistence", 0))
    addl     = float(calc.get("additional_loads_total", 0))

    # display gross includes sick/holiday/leave in earnings (SA payslip convention)
    disp_gross = basic + sick + holiday + leave + inc + subs_inc + addl

    earn = []
    if basic    > 0: earn.append(("Basic Salary",     _fmt(basic)))
    if sick     > 0: earn.append(("Sick Fund",         _fmt(sick)))
    if holiday  > 0: earn.append(("Holiday Fund",      _fmt(holiday)))
    if leave    > 0: earn.append(("Leave Pay",         _fmt(leave)))
    if inc      > 0: earn.append(("Load Incentive",    _fmt(inc)))
    if subs_inc > 0: earn.append(("BC-Subs Allowance", _fmt(subs_inc)))
    if addl     > 0: earn.append(("Additional Loads",  _fmt(addl)))

    paye      = float(calc.get("paye", 0))
    uif       = float(calc.get("uif", 0))
    provident = float(calc.get("provident", 0))
    wellness  = float(calc.get("wellness", 0))
    nbcrfli   = float(calc.get("nbcrfli", 0))
    subs_adv  = float(calc.get("subsistence_advance_paid", 0))
    loan_ded  = float(calc.get("loan_deduction", 0))
    cash_ded  = float(calc.get("cash_deduction", 0))
    food_ded  = float(calc.get("food_deduction", 0))

    disp_ded = (paye + uif + provident + sick + holiday + leave +
                nbcrfli + wellness + subs_adv + loan_ded + cash_ded + food_ded)

    ded = []
    if paye     > 0: ded.append(("Tax",              _fmt(paye)))
    if uif      > 0: ded.append(("UIF",              _fmt(uif)))
    if provident> 0: ded.append(("Provident Fund",   _fmt(provident)))
    if sick     > 0: ded.append(("Sick Fund",        _fmt(sick)))
    if holiday  > 0: ded.append(("Holiday Fund",     _fmt(holiday)))
    if leave    > 0: ded.append(("Leave Pay",        _fmt(leave)))
    if nbcrfli  > 0: ded.append(("NBCRFLI Levy",     _fmt(nbcrfli)))
    if wellness > 0: ded.append(("Wellness Fund",    _fmt(wellness)))
    if subs_adv > 0: ded.append(("Subsistence Adv",  _fmt(subs_adv)))
    if loan_ded > 0: ded.append(("Staff Loan",       _fmt(loan_ded)))
    if cash_ded > 0: ded.append(("Cash Advance",     _fmt(cash_ded)))
    if food_ded > 0: ded.append(("Food Allowance",   _fmt(food_ded)))

    n = max(len(earn), len(ded), 5)
    while len(earn) < n: earn.append(("", ""))
    while len(ded)  < n: ded.append(("", ""))

    # column widths: earn [desc 56, hrs 13, amt 20] | ded [desc 46, hrs 13, amt 20, ob 18] = 186mm
    e_d, e_h, e_a = 56 * mm, 13 * mm, 20 * mm
    d_d, d_h, d_a, d_o = 46 * mm, 13 * mm, 20 * mm, 18 * mm
    ed_cols = [e_d, e_h, e_a, d_d, d_h, d_a, d_o]

    ed_rows = []
    # row 0: section headings
    ed_rows.append([
        P("EARNINGS", s_hdr), "", "",
        P("DEDUCTIONS", s_hdr), "", "", "",
    ])
    # row 1: column headings
    ed_rows.append([
        P("Description", s_chdr), P("Hrs/Units", s_chdr), P("Amount", s_chdr),
        P("Description", s_chdr), P("Hrs/Units", s_chdr), P("Amount", s_chdr), P("Opening Balance", s_chdr),
    ])
    # data rows
    for e_row, d_row in zip(earn, ded):
        ed_rows.append([
            P(e_row[0], s_val), P("", s_val), P(e_row[1], s_r),
            P(d_row[0], s_val), P("", s_val), P(d_row[1], s_r), P("", s_r),
        ])
    # totals row
    n_rows = len(ed_rows)
    ed_rows.append([
        P("Total Earnings", s_bold), P("", s_val), P(_fmt(disp_gross), s_rb),
        P("Total Deductions", s_bold), P("", s_val), P(_fmt(disp_ded), s_rb), P("", s_r),
    ])
    tot_row = len(ed_rows) - 1

    ed_style = TableStyle([
        ("GRID",          (0, 0), (-1, -1), 0.3, border),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 3),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 3),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        # section header row spans
        ("SPAN",          (0, 0), (2, 0)),
        ("SPAN",          (3, 0), (6, 0)),
        ("BACKGROUND",    (0, 0), (2, 0), dark),
        ("BACKGROUND",    (3, 0), (6, 0), dark),
        # column header row
        ("BACKGROUND",    (0, 1), (-1, 1), gray),
        # totals row
        ("BACKGROUND",    (0, tot_row), (2, tot_row), gray),
        ("BACKGROUND",    (3, tot_row), (6, tot_row), gray),
        ("LINEABOVE",     (0, tot_row), (-1, tot_row), 0.5, border),
        # vertical divider
        ("LINEAFTER",     (2, 0), (2, -1), 1.0, colors.HexColor("#555555")),
    ])
    ed_tbl = Table(ed_rows, colWidths=ed_cols)
    ed_tbl.setStyle(ed_style)

    # ── NETT PAY bar ─────────────────────────────────────────────────────────
    nett = float(calc.get("net_payable", 0))

    logo_bytes = _load_logo(getattr(entity, "logo_url", None), getattr(entity, "logo_path", None))
    if logo_bytes:
        try:
            logo_cell = RLImage(io.BytesIO(logo_bytes), width=36 * mm, height=14 * mm, kind="proportional")
        except Exception:
            logo_cell = P(company, sty("lc", fontSize=7))
    else:
        logo_cell = P(company, sty("lc", fontSize=7))

    nett_tbl = Table(
        [[logo_cell, P("NETT PAY", s_nll), P(_fmt(nett), s_nlv)]],
        colWidths=[50 * mm, 96 * mm, 40 * mm],
    )
    nett_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (1, 0), (2, 0), dark),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("GRID",          (0, 0), (-1, -1), 0.3, border),
    ]))

    # ── YEAR TO DATE TOTALS ───────────────────────────────────────────────────
    ytd_earn = float(ytd.get("taxable_earnings", 0))
    ytd_perk = float(ytd.get("taxable_perks", 0))
    ytd_prov = float(ytd.get("provident", 0))
    ytd_tax  = float(ytd.get("tax_paid", 0))

    ytd_rows = [
        [P("YEAR TO DATE TOTALS", s_ysl), "", P("ADDITIONAL INFO", s_ysl), ""],
        [P("Taxable Earnings", s_lbl), P(_fmt(ytd_earn), s_r), P("", s_val), P("", s_val)],
        [P("Taxable Perks",    s_lbl), P(_fmt(ytd_perk), s_r), P("", s_val), P("", s_val)],
        [P("Provident Fund",   s_lbl), P(_fmt(ytd_prov), s_r), P("", s_val), P("", s_val)],
        [P("Tax Paid",         s_lbl), P(_fmt(ytd_tax),  s_r), P("", s_val), P("", s_val)],
    ]

    ytd_tbl = Table(ytd_rows, colWidths=[62 * mm, 31 * mm, 62 * mm, 31 * mm])
    ytd_tbl.setStyle(TableStyle([
        ("SPAN",          (0, 0), (1, 0)),
        ("SPAN",          (2, 0), (3, 0)),
        ("BACKGROUND",    (0, 0), (1, 0), dark),
        ("BACKGROUND",    (2, 0), (3, 0), dark),
        ("GRID",          (0, 0), (-1, -1), 0.3, border),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [white, gray]),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LINEAFTER",     (1, 0), (1, -1), 0.5, border),
    ]))

    # ── CURRENT PERIOD ────────────────────────────────────────────────────────
    total_perks   = float(provident)
    co_contrib    = float(provident + nbcrfli + wellness)

    cp_rows = [
        [P("CURRENT PERIOD", s_ysl), ""],
        [P("Total Perks",       s_lbl), P(_fmt(total_perks),  s_r)],
        [P("Co. Contributions", s_lbl), P(_fmt(co_contrib),   s_r)],
    ]
    cp_tbl = Table(cp_rows, colWidths=[130 * mm, 56 * mm])
    cp_tbl.setStyle(TableStyle([
        ("SPAN",          (0, 0), (1, 0)),
        ("BACKGROUND",    (0, 0), (1, 0), dark),
        ("GRID",          (0, 0), (-1, -1), 0.3, border),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [white, gray]),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))

    # ── comments ─────────────────────────────────────────────────────────────
    notes = []
    if cycle.comments:
        notes.append(Spacer(1, 2 * mm))
        notes.append(P(
            f"<b>Notes:</b> {cycle.comments}",
            sty("note", fontSize=7, textColor=mid),
        ))

    return [
        hdr_tbl,
        Spacer(1, 2 * mm),
        ed_tbl,
        Spacer(1, 2 * mm),
        nett_tbl,
        Spacer(1, 2 * mm),
        ytd_tbl,
        Spacer(1, 1 * mm),
        cp_tbl,
        *notes,
    ]


def generate_permanent_payslip_pdf(driver, cycle, calc: dict, entity, ytd: dict = None) -> bytes:
    """Two-per-A4-page permanent driver payslip (Sage-style)."""
    if ytd is None:
        ytd = {}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=12 * mm, leftMargin=12 * mm,
        topMargin=10 * mm, bottomMargin=10 * mm,
    )
    avail_w = A4[0] - 24 * mm

    story: list = []
    story.extend(_build_permanent_payslip(driver, cycle, calc, entity, ytd, avail_w))

    doc.build(story)
    return buf.getvalue()


# ── Casual payslip (Excel-style) ──────────────────────────────────────────────

def generate_casual_payslip_pdf(driver, cycle, calc: dict, entity) -> bytes:
    """
    Excel-style casual driver payslip:
    - Minimal header (Payment Dt, Emp Name, Job Title)
    - Side-by-side EARNINGS / DEDUCTIONS grid with a thick vertical divider
    - EARNINGS: load breakdown lines, Assmang incentive, additional loads, TOTAL LOADS
    - DEDUCTIONS: food payments by date, TOTAL box, green bar, manual deductions
    - Total Earnings | Total Deductions row
    - NETT PAY (right side, bordered)
    """
    black      = colors.HexColor("#111111")
    white      = colors.white
    gray       = colors.HexColor("#f0f0f0")
    border_c   = colors.HexColor("#888888")
    thick_div  = colors.HexColor("#333333")
    green_bar  = colors.HexColor("#92d050")

    def sty(name, **kw):
        base = dict(fontName="Helvetica", fontSize=8.5, textColor=black, leading=12)
        base.update(kw)
        return ParagraphStyle(name, **base)

    s_lbl    = sty("lbl",  fontName="Helvetica-Bold", fontSize=8.5)
    s_val    = sty("val",  fontSize=8.5)
    s_sec    = sty("sec",  fontName="Helvetica-Bold", fontSize=9,
                   alignment=TA_CENTER, underlineWidth=0.5, underlineOffset=-2)
    s_subhdr = sty("sh",   fontName="Helvetica-Bold", fontSize=8.5)
    s_food   = sty("food", fontName="Helvetica-Bold", fontSize=8.5, alignment=TA_CENTER)
    s_amt    = sty("amt",  fontSize=8.5, alignment=TA_RIGHT)
    s_bold   = sty("bold", fontName="Helvetica-Bold", fontSize=8.5)
    s_bolt   = sty("bolt", fontName="Helvetica-Bold", fontSize=8.5, alignment=TA_RIGHT)
    s_nett_l = sty("nl",   fontName="Helvetica-Bold", fontSize=11, alignment=TA_CENTER)
    s_nett_v = sty("nv",   fontName="Helvetica-Bold", fontSize=12, alignment=TA_RIGHT)

    def P(text, style=None):
        return Paragraph(text, style or s_val)

    company = entity.trading_name or entity.name
    pay_month_str = f"{MONTHS[cycle.pay_month - 1][:3]}-{str(cycle.pay_year)[-2:]}"
    emp_name  = f"{driver.first_name} {driver.last_name}".upper()
    job_title = (getattr(driver, "job_title", None) or "Code 14 CASUAL Driver").upper()

    # ── Header ────────────────────────────────────────────────────────────────
    # 3-column borderless: left (emp name), centre (job title), right (payment dt)
    hdr_rows = [
        [P(""), P(""), P(f"<b>Payment Dt</b>   {pay_month_str}", s_lbl)],
        [P(""), P(""), P("")],
        [P(f"<b>Emp Name</b>   {emp_name}", s_lbl), P(""), P("")],
        [P(""), P(""), P("")],
        [P(""), P(f"<b>Job Title</b>   {job_title}", s_lbl), P("")],
    ]
    hdr_tbl = Table(hdr_rows, colWidths=[62 * mm, 80 * mm, 44 * mm])
    hdr_tbl.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("BOX",           (0, 0), (-1, -1), 0.5, border_c),
    ]))

    # ── Build earnings items ──────────────────────────────────────────────────
    # Each item: (label, amount_str, row_type)
    # row_type: 'normal' | 'subhdr' | 'total' | 'spacer'
    earn = []
    earn.append(("", "", "spacer"))

    breakdown = calc.get("casual_breakdown") or []
    if breakdown:
        earn.append(("<u>Salary loads</u>", "", "subhdr"))
        for item in breakdown:
            eff = item["loads"]
            earn.append((f"{eff:g} LOADS", _fmt_plain(item["amount"]), "normal"))
    else:
        earn.append(("<u>Salary loads</u>", "", "subhdr"))
        eff = float(calc.get("grand_total_loads", calc.get("lohatla_total_loads", 0)))
        le  = float(calc.get("load_earnings", 0))
        if eff > 0:
            earn.append((f"{eff:g} LOADS", _fmt_plain(le), "normal"))

    assmang = float(calc.get("assmang_bonus", 0))
    if assmang > 0:
        earn.append(("MINE INCENTIVE", _fmt_plain(assmang), "normal"))

    for al in (cycle.additional_loads or []):
        al_amt = float(al.amount or 0)
        if al_amt > 0:
            lbl = (getattr(al, "route_name", None) or "backloads").lower()
            earn.append((lbl, _fmt_plain(al_amt), "normal"))

    earn.append(("", "", "spacer"))
    earn_total = float(calc.get("gross", 0))
    earn.append(("<b>TOTAL LOADS</b>", _fmt_plain(earn_total), "total"))

    # ── Build deductions items ────────────────────────────────────────────────
    ded = []
    food_payments = list(cycle.food_payments or [])
    food_total = sum(float(fp.amount or 0) for fp in food_payments)
    loan_ded   = float(calc.get("loan_deduction", 0))
    cash_ded   = float(calc.get("cash_deduction", 0))

    if food_payments:
        ded.append(("<b><u>FOOD ALLOWANCE : PAID IN ADVANCE</u></b>", "", "food_hdr"))
        for fp in food_payments:
            try:
                dt_str = fp.payment_date.strftime("%d.%m.%Y") if fp.payment_date else "—"
            except Exception:
                dt_str = "—"
            ded.append((dt_str, _fmt_plain(float(fp.amount or 0)), "normal"))
        ded.append(("", "", "spacer"))
        ded.append(("<b>TOTAL</b>", _fmt_plain(food_total), "total_box"))
        ded.append(("", "", "green_bar"))

    ded.append(("<b>DEDUCTIONS</b>", "", "subhdr"))
    if loan_ded > 0:
        ded.append(("Staff Loan", _fmt_plain(loan_ded), "normal"))
    if cash_ded > 0:
        ded.append(("Cash Advance", _fmt_plain(cash_ded), "normal"))

    ded_total = float(calc.get("total_deductions", 0))
    nett_pay  = float(calc.get("net_payable", 0))

    # ── Combine into flat 4-column table ─────────────────────────────────────
    # cols: [earn_desc=60mm, earn_amt=28mm | ded_desc=64mm, ded_amt=34mm] = 186mm
    e_d, e_a, d_d, d_a = 60 * mm, 28 * mm, 64 * mm, 34 * mm
    col_w = [e_d, e_a, d_d, d_a]

    # Pad to equal length
    n = max(len(earn), len(ded))
    while len(earn) < n: earn.append(("", "", "spacer"))
    while len(ded)  < n: ded.append(("", "", "spacer"))

    all_rows: list = []

    # Row 0: section headers
    all_rows.append([
        P("<u>EARNINGS</u>",    s_sec), P(""),
        P("<u>DEDUCTIONS</u>",  s_sec), P(""),
    ])

    # Row 1: column sub-headers
    all_rows.append([
        P("Description", s_subhdr), P("Amount", s_bold),
        P(""), P(""),
    ])

    style_cmds = [
        ("GRID",         (0, 0), (-1, -1), 0.3, border_c),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
        ("LEFTPADDING",  (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        # Section header row
        ("SPAN",         (0, 0), (1, 0)),
        ("SPAN",         (2, 0), (3, 0)),
        # Thick vertical divider
        ("LINEAFTER",    (1, 0), (1, -1), 1.5, thick_div),
        # Column header row
        ("BACKGROUND",   (0, 1), (1, 1), gray),
    ]

    for i, (e_item, d_item) in enumerate(zip(earn, ded)):
        ri = 2 + i  # actual row index in all_rows
        e_lbl, e_amt, e_type = e_item
        d_lbl, d_amt, d_type = d_item

        def cell_p(text, is_amt=False, rtype="normal"):
            if rtype == "total" or rtype == "total_box":
                return P(text, s_bolt if is_amt else s_bold)
            if rtype == "food_hdr":
                return P(text, s_food)
            if rtype == "subhdr":
                return P(text, s_subhdr)
            if rtype == "green_bar":
                return P("")
            return P(text, s_amt if is_amt else s_val)

        row = [
            cell_p(e_lbl, False, e_type),
            cell_p(e_amt, True,  e_type) if e_amt else P(""),
            cell_p(d_lbl, False, d_type),
            cell_p(d_amt, True,  d_type) if d_amt else P(""),
        ]
        all_rows.append(row)

        # Special style commands for this row
        if e_type == "subhdr":
            style_cmds.append(("BACKGROUND", (0, ri), (1, ri), gray))
        if d_type == "food_hdr":
            style_cmds.append(("SPAN",       (2, ri), (3, ri)))
            style_cmds.append(("BACKGROUND", (2, ri), (3, ri), gray))
        if d_type == "green_bar":
            style_cmds.append(("SPAN",          (2, ri), (3, ri)))
            style_cmds.append(("BACKGROUND",    (2, ri), (3, ri), green_bar))
            style_cmds.append(("TOPPADDING",    (2, ri), (3, ri), 7))
            style_cmds.append(("BOTTOMPADDING", (2, ri), (3, ri), 7))
        if d_type == "total_box":
            style_cmds.append(("BOX",        (2, ri), (3, ri), 1.0, black))
        if e_type == "total":
            style_cmds.append(("BACKGROUND", (0, ri), (1, ri), gray))
            style_cmds.append(("LINEABOVE",  (0, ri), (1, ri), 0.5, thick_div))
        if d_type == "subhdr":
            style_cmds.append(("BACKGROUND", (2, ri), (3, ri), gray))

    # Totals row
    tot_ri = len(all_rows)
    all_rows.append([
        P("Total Earnings",   s_bold), P(_fmt_plain(earn_total), s_bolt),
        P("Total Deductions", s_bold), P(_fmt_plain(ded_total),  s_bolt),
    ])
    style_cmds += [
        ("BACKGROUND", (0, tot_ri), (1, tot_ri), gray),
        ("BACKGROUND", (2, tot_ri), (3, tot_ri), gray),
        ("LINEABOVE",  (0, tot_ri), (-1, tot_ri), 0.5, thick_div),
    ]

    # NETT PAY row — right side only, bordered
    nett_ri = len(all_rows)
    all_rows.append([
        P(""), P(""),
        P("NETT PAY", s_nett_l),
        P(_fmt_plain(nett_pay), s_nett_v),
    ])
    style_cmds += [
        ("SPAN",       (0, nett_ri), (1, nett_ri)),
        ("BOX",        (2, nett_ri), (3, nett_ri), 1.5, black),
        ("TOPPADDING", (2, nett_ri), (3, nett_ri), 5),
        ("BOTTOMPADDING",(2, nett_ri),(3, nett_ri), 5),
        ("NOSPLIT",    (0, nett_ri), (-1, nett_ri)),
    ]

    main_tbl = Table(all_rows, colWidths=col_w)
    main_tbl.setStyle(TableStyle(style_cmds))

    # ── Assemble document ─────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=14 * mm, leftMargin=14 * mm,
        topMargin=12 * mm, bottomMargin=14 * mm,
    )
    doc.build([hdr_tbl, Spacer(1, 5 * mm), main_tbl])
    return buf.getvalue()


# ── Dispatch ──────────────────────────────────────────────────────────────────

def generate_payslip_pdf(driver, cycle, calc: dict, entity, ytd: dict = None) -> bytes:
    """Route to the correct format based on driver type."""
    driver_type = calc.get("driver_type", "permanent")
    if driver_type == "permanent":
        return generate_permanent_payslip_pdf(driver, cycle, calc, entity, ytd or {})
    return generate_casual_payslip_pdf(driver, cycle, calc, entity)
