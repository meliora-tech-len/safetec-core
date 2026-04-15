from decimal import Decimal, ROUND_HALF_UP
from app.models.models import DriverPayCycle, PayrollSettings


def calculate_pay_cycle(cycle: DriverPayCycle, settings: PayrollSettings) -> dict:
    """
    Returns a dict of all calculated values for a pay cycle.
    All arithmetic in Decimal. Rounded to 2dp at the end.
    """
    def d(v):
        return Decimal(str(v)) if v is not None else Decimal(0)

    def r(v):
        return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # Total loads per group
    hotazel_total  = (cycle.hotazel_base_loads or 0) + (cycle.hotazel_extra_loads or 0)
    lohatla_total  = (cycle.lohatla_base_loads or 0) + (cycle.lohatla_extra_loads or 0)
    grand_total    = hotazel_total + lohatla_total

    # Basic salary — whichever groups have base loads
    basic_salary = Decimal(0)
    if (cycle.hotazel_base_loads or 0) > 0:
        basic_salary += d(settings.hotazel_base_salary)
    if (cycle.lohatla_base_loads or 0) > 0:
        basic_salary += d(settings.lohatla_base_salary)

    # Subsistence — all loads (base + extra) × rate per group
    subs_hotazel   = d(settings.hotazel_subs_per_load) * hotazel_total
    subs_lohatla   = d(settings.lohatla_subs_per_load) * lohatla_total
    total_subs     = subs_hotazel + subs_lohatla

    # Load incentive — only extra loads
    inc_hotazel    = d(settings.hotazel_incentive_per_load) * (cycle.hotazel_extra_loads or 0)
    inc_lohatla    = d(settings.lohatla_incentive_per_load) * (cycle.lohatla_extra_loads or 0)
    total_inc      = inc_hotazel + inc_lohatla

    # Assmang bonus — ALL loads × R150
    assmang_bonus  = d(settings.assmang_bonus_per_load) * grand_total

    # Additional loads total
    additional_total    = sum((d(al.amount) for al in (cycle.additional_loads or [])), Decimal(0))
    additional_verified = sum((d(al.amount) for al in (cycle.additional_loads or []) if al.is_verified), Decimal(0))

    # Gross
    gross = basic_salary + total_subs + total_inc + assmang_bonus + additional_total

    # Statutory deductions (permanent drivers only — caller checks driver_type)
    monthly_base  = basic_salary * d(settings.weekly_to_monthly_factor)
    nbcrfli       = monthly_base * d(settings.nbcrfli_rate)
    provident     = monthly_base * d(settings.provident_rate)
    wellness      = monthly_base * d(settings.wellness_rate)
    sick_fund     = basic_salary * d(settings.sick_fund_rate)
    holiday_fund  = basic_salary * d(settings.holiday_fund_rate)
    leave_pay     = basic_salary * d(settings.leave_pay_rate)
    paye          = d(settings.paye_fixed)
    uif           = Decimal(0)

    total_statutory = nbcrfli + provident + wellness + sick_fund + holiday_fund + leave_pay + paye + uif

    # Subsistence advance
    subs_advance  = d(cycle.subsistence_advance_paid)
    subs_variance = subs_advance - total_subs   # positive = overpaid

    # Loan deductions
    loan_deduction = d(cycle.staff_loan_deduction)
    cash_deduction = d(cycle.cash_advance_deduction)

    total_deductions = total_statutory + subs_advance + loan_deduction + cash_deduction
    net_payable      = gross - total_deductions

    return {
        "grand_total_loads":         grand_total,
        "hotazel_total_loads":        hotazel_total,
        "lohatla_total_loads":        lohatla_total,
        "basic_salary":               r(basic_salary),
        "total_subsistence":          r(total_subs),
        "subs_hotazel":               r(subs_hotazel),
        "subs_lohatla":               r(subs_lohatla),
        "total_incentive":            r(total_inc),
        "incentive_hotazel":          r(inc_hotazel),
        "incentive_lohatla":          r(inc_lohatla),
        "assmang_bonus":              r(assmang_bonus),
        "additional_loads_total":     r(additional_total),
        "additional_loads_verified":  r(additional_verified),
        "gross":                      r(gross),
        "nbcrfli":                    r(nbcrfli),
        "provident":                  r(provident),
        "wellness":                   r(wellness),
        "sick_fund":                  r(sick_fund),
        "holiday_fund":               r(holiday_fund),
        "leave_pay":                  r(leave_pay),
        "paye":                       r(paye),
        "uif":                        r(uif),
        "total_statutory":            r(total_statutory),
        "subsistence_advance_paid":   r(subs_advance),
        "subsistence_budgeted":       r(total_subs),
        "subsistence_variance":       r(subs_variance),
        "loan_deduction":             r(loan_deduction),
        "cash_deduction":             r(cash_deduction),
        "total_deductions":           r(total_deductions),
        "net_payable":                r(net_payable),
    }
