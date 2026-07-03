from decimal import Decimal, ROUND_HALF_UP
from app.models.models import DriverPayCycle, PayrollSettings


def calculate_pay_cycle(
    cycle: DriverPayCycle,
    settings: PayrollSettings,
    driver_type: str = "permanent",
    exclude_mine_bonus: bool = False,
) -> dict:
    """
    Returns a dict of all calculated values for a pay cycle.
    All arithmetic in Decimal; rounded to 2dp at the end.

    Permanent drivers: Bargaining Council rules — basic salary floor for 7 loads,
    incentive per extra load, subsistence per load, statutory deductions.

    Casual drivers: pure per-load rate (Lohatla only), no basic salary, no BC deductions.

    `exclude_mine_bonus` (a per-driver flag) forces the Mine/Assmang bonus to zero.
    The cycle's *_override columns replace individual computed earnings lines when set
    (null = use the computed value); they flow through to gross, statutory and net.
    """
    def d(v):
        return Decimal(str(v)) if v is not None else Decimal(0)

    def r(v):
        return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def ov(field):
        """Return a manual override (as Decimal) for `field`, or None if unset."""
        v = getattr(cycle, field, None)
        return d(v) if v is not None else None

    lohatla_full  = (cycle.lohatla_base_loads or 0) + (cycle.lohatla_extra_loads or 0)
    lohatla_total = lohatla_full  # kept for permanent path below
    grand_total   = lohatla_total

    additional_total    = sum((d(al.amount) for al in (cycle.additional_loads or [])), Decimal(0))
    additional_verified = sum((d(al.amount) for al in (cycle.additional_loads or []) if al.is_verified), Decimal(0))

    loan_deduction = d(cycle.staff_loan_deduction)
    cash_deduction = d(cycle.cash_advance_deduction)
    food_deduction = sum((d(fp.amount) for fp in (cycle.food_payments or [])), Decimal(0))

    if driver_type == "casual":
        # ── Casual: group-based per-load rate, R150 bonus, no BC deductions ────
        casual_rate_a = d(settings.casual_rate_group_a)
        casual_rate_b = d(settings.casual_rate_group_b)
        loads_a  = cycle.casual_group_a_loads or 0
        loads_b  = cycle.casual_group_b_loads or 0
        split_a  = getattr(cycle, 'casual_split_group_a_loads', 0) or 0
        split_b  = getattr(cycle, 'casual_split_group_b_loads', 0) or 0

        earnings_a    = casual_rate_a * Decimal(loads_a) + (casual_rate_a / 2) * Decimal(split_a)
        earnings_b    = casual_rate_b * Decimal(loads_b) + (casual_rate_b / 2) * Decimal(split_b)
        load_earnings = earnings_a + earnings_b

        effective_total = Decimal(loads_a + loads_b) + Decimal(split_a + split_b) * Decimal("0.5")
        casual_total    = effective_total

        # Per-load bonus — loads delivered to the bonus mines (Assmang/Mokala/Tawana/Sebilo)
        assmang_effective = (Decimal(cycle.assmang_loads or 0)
                             + Decimal(getattr(cycle, 'assmang_split_loads', 0) or 0) * Decimal("0.5"))
        mine_ov = ov('mine_bonus_override')
        if exclude_mine_bonus:
            assmang_bonus = Decimal(0)
        elif mine_ov is not None:
            assmang_bonus = mine_ov
        else:
            assmang_bonus = d(settings.assmang_bonus_per_load) * assmang_effective
        gross = load_earnings + assmang_bonus + additional_total

        total_deductions = loan_deduction + cash_deduction + food_deduction
        net_payable = gross - total_deductions

        return {
            "driver_type":               "casual",
            "grand_total_loads":          effective_total,
            "lohatla_total_loads":         effective_total,
            "casual_rate_per_load":        Decimal("0.00"),
            "load_earnings":               r(load_earnings),
            "basic_salary":                Decimal("0.00"),
            "total_subsistence":           Decimal("0.00"),
            "subs_lohatla":                Decimal("0.00"),
            "total_incentive":             Decimal("0.00"),
            "incentive_lohatla":           Decimal("0.00"),
            "assmang_bonus":               r(assmang_bonus),
            "additional_loads_total":      r(additional_total),
            "additional_loads_verified":   r(additional_verified),
            "gross":                       r(gross),
            "nbcrfli":                     Decimal("0.00"),
            "provident":                   Decimal("0.00"),
            "wellness":                    Decimal("0.00"),
            "sick_fund":                   Decimal("0.00"),
            "holiday_fund":                Decimal("0.00"),
            "leave_pay":                   Decimal("0.00"),
            "paye":                        Decimal("0.00"),
            "tax_sars":                    Decimal("0.00"),
            "uif":                         Decimal("0.00"),
            "total_statutory":             Decimal("0.00"),
            "ctc":                         r(gross),
            "subsistence_advance_paid":    Decimal("0.00"),
            "subsistence_budgeted":        Decimal("0.00"),
            "subsistence_variance":        Decimal("0.00"),
            "loan_deduction":              r(loan_deduction),
            "cash_deduction":              r(cash_deduction),
            "food_deduction":              r(food_deduction),
            "total_deductions":            r(total_deductions),
            "net_payable":                 r(net_payable),
        }

    # ── Permanent: Bargaining Council rules ─────────────────────────────────────

    split_count      = getattr(cycle, 'permanent_split_loads', 0) or 0
    lohatla_effective = Decimal(lohatla_total) + Decimal(split_count) * Decimal("0.5")
    grand_total      = lohatla_effective

    # Basic salary — floor for 7 effective loads (manual override wins when set)
    basic_ov = ov('basic_salary_override')
    basic_salary = basic_ov if basic_ov is not None else (
        d(settings.lohatla_base_salary) if lohatla_effective > 0 else Decimal(0))

    # Subsistence — all effective loads × rate (manual override wins when set)
    subs_ov = ov('subsistence_override')
    subs_lohatla = subs_ov if subs_ov is not None else (d(settings.lohatla_subs_per_load) * lohatla_effective)
    total_subs   = subs_lohatla

    # Load incentive — effective loads above 7 (manual override wins when set)
    inc_ov = ov('load_incentive_override')
    inc_lohatla = inc_ov if inc_ov is not None else (
        d(settings.lohatla_incentive_per_load) * max(Decimal(0), lohatla_effective - Decimal(7)))
    total_inc   = inc_lohatla

    # Assmang bonus — only loads delivered to the ASSMANG mine
    assmang_effective = (Decimal(cycle.assmang_loads or 0)
                         + Decimal(getattr(cycle, 'assmang_split_loads', 0) or 0) * Decimal("0.5"))
    mine_ov = ov('mine_bonus_override')
    if exclude_mine_bonus:
        assmang_bonus = Decimal(0)
    elif mine_ov is not None:
        assmang_bonus = mine_ov
    else:
        assmang_bonus = d(settings.assmang_bonus_per_load) * assmang_effective

    gross = basic_salary + total_subs + total_inc + assmang_bonus + additional_total

    # Statutory deductions — fixed rand amounts per pay cycle, captured directly
    # in Payroll Rates (no longer % of salary, migration 104). Skipped when no
    # basic salary was earned this cycle, matching the old %-of-zero behaviour.
    # Each line takes a per-cycle manual override when set (migration 105).
    # paye_fixed holds the capped UIF amount (R177.12); real SARS income tax is
    # the manual tax_sars amount below.
    has_salary = basic_salary > 0

    def stat(field, amount):
        ovr = ov(field)
        if ovr is not None:
            return ovr
        return d(amount) if has_salary else Decimal(0)

    nbcrfli       = stat('nbcrfli_override', settings.nbcrfli_amount)
    provident     = stat('provident_override', settings.provident_amount)
    wellness      = stat('wellness_override', settings.wellness_amount)
    sick_fund     = stat('sick_fund_override', settings.sick_fund_amount)
    holiday_fund  = stat('holiday_fund_override', settings.holiday_fund_amount)
    leave_pay     = stat('leave_pay_override', settings.leave_pay_amount)
    paye_ovr      = ov('paye_override')
    paye          = paye_ovr if paye_ovr is not None else d(settings.paye_fixed)
    tax_sars      = d(getattr(cycle, 'tax_sars', 0) or 0)
    uif           = Decimal(0)

    total_statutory = (nbcrfli + provident + wellness + sick_fund + holiday_fund
                       + leave_pay + paye + tax_sars + uif)

    subs_advance  = d(cycle.subsistence_advance_paid)
    subs_variance = subs_advance - total_subs

    # Sick/Holiday/Leave are accruals — part of the wage (earnings) AND withheld
    # into their funds (deductions), so they net to zero in take-home. They live in
    # total_statutory for the payslip's deduction column, so credit them back here
    # instead of letting them reduce the payout.
    accrual_offset   = sick_fund + holiday_fund + leave_pay
    total_deductions = total_statutory + subs_advance + loan_deduction + cash_deduction + food_deduction
    net_payable      = gross + accrual_offset - total_deductions

    # Cost to Company — total earnings (incl. the accruals) + company
    # contributions (provident + NBCRFLI + wellness, matching the payslip's
    # "Co. Contributions"). Display line only; never part of net payable.
    ctc_ovr = ov('ctc_override')
    ctc = ctc_ovr if ctc_ovr is not None else (
        gross + accrual_offset + provident + nbcrfli + wellness)

    return {
        "driver_type":               "permanent",
        "grand_total_loads":          lohatla_effective,
        "lohatla_total_loads":         lohatla_effective,
        "casual_rate_per_load":        Decimal("0.00"),
        "load_earnings":               Decimal("0.00"),
        "basic_salary":                r(basic_salary),
        "total_subsistence":           r(total_subs),
        "subs_lohatla":                r(subs_lohatla),
        "total_incentive":             r(total_inc),
        "incentive_lohatla":           r(inc_lohatla),
        "assmang_bonus":               r(assmang_bonus),
        "additional_loads_total":      r(additional_total),
        "additional_loads_verified":   r(additional_verified),
        "gross":                       r(gross),
        "nbcrfli":                     r(nbcrfli),
        "provident":                   r(provident),
        "wellness":                    r(wellness),
        "sick_fund":                   r(sick_fund),
        "holiday_fund":                r(holiday_fund),
        "leave_pay":                   r(leave_pay),
        "paye":                        r(paye),
        "tax_sars":                    r(tax_sars),
        "uif":                         r(uif),
        "total_statutory":             r(total_statutory),
        "ctc":                         r(ctc),
        "subsistence_advance_paid":    r(subs_advance),
        "subsistence_budgeted":        r(total_subs),
        "subsistence_variance":        r(subs_variance),
        "loan_deduction":              r(loan_deduction),
        "cash_deduction":              r(cash_deduction),
        "food_deduction":              r(food_deduction),
        "total_deductions":            r(total_deductions),
        "net_payable":                 r(net_payable),
    }
