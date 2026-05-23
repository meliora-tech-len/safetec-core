from decimal import Decimal, ROUND_HALF_UP
from app.models.models import DriverPayCycle, PayrollSettings


def calculate_pay_cycle(
    cycle: DriverPayCycle,
    settings: PayrollSettings,
    driver_type: str = "permanent",
) -> dict:
    """
    Returns a dict of all calculated values for a pay cycle.
    All arithmetic in Decimal; rounded to 2dp at the end.

    Permanent drivers: Bargaining Council rules — basic salary floor for 7 loads,
    incentive per extra load, subsistence per load, statutory deductions.

    Casual drivers: pure per-load rate (Lohatla only), no basic salary, no BC deductions.
    """
    def d(v):
        return Decimal(str(v)) if v is not None else Decimal(0)

    def r(v):
        return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    lohatla_total = (cycle.lohatla_base_loads or 0) + (cycle.lohatla_extra_loads or 0)
    grand_total   = lohatla_total

    additional_total    = sum((d(al.amount) for al in (cycle.additional_loads or [])), Decimal(0))
    additional_verified = sum((d(al.amount) for al in (cycle.additional_loads or []) if al.is_verified), Decimal(0))

    loan_deduction = d(cycle.staff_loan_deduction)
    cash_deduction = d(cycle.cash_advance_deduction)
    food_deduction = sum((d(fp.amount) for fp in (cycle.food_payments or [])), Decimal(0))

    if driver_type == "casual":
        # ── Casual: flat per-load rate, no basic salary, no BC deductions ──────
        casual_rate = d(settings.lohatla_casual_rate_per_load)
        load_earnings = casual_rate * lohatla_total
        gross = load_earnings + additional_total

        total_deductions = loan_deduction + cash_deduction + food_deduction
        net_payable = gross - total_deductions

        return {
            "driver_type":               "casual",
            "grand_total_loads":          grand_total,
            "lohatla_total_loads":         lohatla_total,
            "casual_rate_per_load":        r(casual_rate),
            "load_earnings":               r(load_earnings),
            "basic_salary":                Decimal("0.00"),
            "total_subsistence":           Decimal("0.00"),
            "subs_lohatla":                Decimal("0.00"),
            "total_incentive":             Decimal("0.00"),
            "incentive_lohatla":           Decimal("0.00"),
            "assmang_bonus":               Decimal("0.00"),
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
            "uif":                         Decimal("0.00"),
            "total_statutory":             Decimal("0.00"),
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

    # Basic salary — floor for 7 loads
    basic_salary = d(settings.lohatla_base_salary) if (cycle.lohatla_base_loads or 0) > 0 else Decimal(0)

    # Subsistence — all loads × rate
    subs_lohatla = d(settings.lohatla_subs_per_load) * lohatla_total
    total_subs   = subs_lohatla

    # Load incentive — only extra loads
    inc_lohatla = d(settings.lohatla_incentive_per_load) * (cycle.lohatla_extra_loads or 0)
    total_inc   = inc_lohatla

    # Assmang bonus — ALL loads × rate
    assmang_bonus = d(settings.assmang_bonus_per_load) * grand_total

    gross = basic_salary + total_subs + total_inc + assmang_bonus + additional_total

    # Statutory deductions
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

    subs_advance  = d(cycle.subsistence_advance_paid)
    subs_variance = subs_advance - total_subs

    total_deductions = total_statutory + subs_advance + loan_deduction + cash_deduction + food_deduction
    net_payable      = gross - total_deductions

    return {
        "driver_type":               "permanent",
        "grand_total_loads":          grand_total,
        "lohatla_total_loads":         lohatla_total,
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
        "uif":                         r(uif),
        "total_statutory":             r(total_statutory),
        "subsistence_advance_paid":    r(subs_advance),
        "subsistence_budgeted":        r(total_subs),
        "subsistence_variance":        r(subs_variance),
        "loan_deduction":              r(loan_deduction),
        "cash_deduction":              r(cash_deduction),
        "food_deduction":              r(food_deduction),
        "total_deductions":            r(total_deductions),
        "net_payable":                 r(net_payable),
    }
