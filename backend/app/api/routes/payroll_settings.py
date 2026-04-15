from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.models import User, PayrollSettings
from app.schemas.schemas import PayrollSettingsOut, PayrollSettingsUpdate

router = APIRouter(prefix="/api/payroll-settings", tags=["payroll-settings"])


def _get_current(db: Session) -> PayrollSettings:
    """Return the most recent PayrollSettings row, seeding a default if none exist."""
    row = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
    if not row:
        row = PayrollSettings(effective_date=datetime(2023, 3, 1, tzinfo=timezone.utc))
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("", response_model=PayrollSettingsOut)
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_current(db)


@router.put("", response_model=PayrollSettingsOut)
def update_settings(
    payload: PayrollSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new settings record (keeps history). Never overwrites old rows."""
    current = _get_current(db)

    # Build a dict merging current values with the payload
    fields = [
        "hotazel_base_salary", "lohatla_base_salary",
        "hotazel_incentive_per_load", "lohatla_incentive_per_load",
        "hotazel_subs_per_load", "lohatla_subs_per_load",
        "assmang_bonus_per_load",
        "nbcrfli_rate", "provident_rate", "wellness_rate", "sick_fund_rate",
        "holiday_fund_rate", "leave_pay_rate", "paye_fixed",
        "weekly_to_monthly_factor",
    ]
    new_vals = {}
    update_data = payload.model_dump(exclude_none=True)
    for f in fields:
        new_vals[f] = update_data.get(f, getattr(current, f))

    eff = update_data.get("effective_date", datetime.now(tz=timezone.utc))
    new_row = PayrollSettings(
        effective_date=eff,
        updated_by=current_user.id,
        **new_vals,
    )
    db.add(new_row)
    db.commit()
    db.refresh(new_row)
    return new_row


@router.get("/lookup-table")
def lookup_table(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-generate gross income reference table for 7-12 loads per mine group."""
    s = _get_current(db)

    def calc_row(group: str, base_loads: int, extra_loads: int) -> dict:
        total = base_loads + extra_loads
        if group == "hotazel":
            basic   = Decimal(str(s.hotazel_base_salary)) if base_loads > 0 else Decimal(0)
            subs    = Decimal(str(s.hotazel_subs_per_load)) * total
            inc     = Decimal(str(s.hotazel_incentive_per_load)) * extra_loads
        else:
            basic   = Decimal(str(s.lohatla_base_salary)) if base_loads > 0 else Decimal(0)
            subs    = Decimal(str(s.lohatla_subs_per_load)) * total
            inc     = Decimal(str(s.lohatla_incentive_per_load)) * extra_loads
        bonus   = Decimal(str(s.assmang_bonus_per_load)) * total
        gross   = basic + subs + inc + bonus
        return {
            "base_loads":  base_loads,
            "extra_loads": extra_loads,
            "total_loads": total,
            "basic_salary": float(basic.quantize(Decimal("0.01"))),
            "subsistence":  float(subs.quantize(Decimal("0.01"))),
            "incentive":    float(inc.quantize(Decimal("0.01"))),
            "assmang_bonus":float(bonus.quantize(Decimal("0.01"))),
            "gross":        float(gross.quantize(Decimal("0.01"))),
        }

    rows = []
    for total_loads in range(7, 13):
        base  = min(total_loads, 7)
        extra = total_loads - base
        rows.append({
            "total_loads": total_loads,
            "hotazel": calc_row("hotazel", base, extra),
            "lohatla": calc_row("lohatla", base, extra),
        })

    return {"rows": rows}
