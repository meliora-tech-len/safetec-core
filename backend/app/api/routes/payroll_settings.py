from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user
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
    current_user: User = Depends(get_current_user),
):
    """Create a new settings record (keeps history). Never overwrites old rows."""
    current = _get_current(db)

    # Build a dict merging current values with the payload
    fields = [
        "lohatla_base_salary",
        "lohatla_incentive_per_load",
        "lohatla_subs_per_load",
        "lohatla_casual_rate_per_load",
        "casual_rate_group_a",
        "casual_rate_group_b",
        "assmang_bonus_per_load",
        "nbcrfli_amount", "provident_amount", "wellness_amount", "sick_fund_amount",
        "holiday_fund_amount", "leave_pay_amount", "paye_fixed",
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
    """Auto-generate gross income reference table for 7-12 loads per mine group.

    Gross here is the guaranteed Lohatla earnings (basic + subsistence + incentive)
    only. The Assmang bonus is NOT included — it is paid per load delivered to the
    ASSMANG mine, which a load-count reference table cannot know. The per-load bonus
    rate is returned separately as `assmang_bonus_per_load` for reference.
    """
    s = _get_current(db)

    def calc_row(base_loads: int, extra_loads: int) -> dict:
        total = base_loads + extra_loads
        basic  = Decimal(str(s.lohatla_base_salary)) if base_loads > 0 else Decimal(0)
        subs   = Decimal(str(s.lohatla_subs_per_load)) * total
        inc    = Decimal(str(s.lohatla_incentive_per_load)) * extra_loads
        gross  = basic + subs + inc
        return {
            "base_loads":  base_loads,
            "extra_loads": extra_loads,
            "total_loads": total,
            "basic_salary": float(basic.quantize(Decimal("0.01"))),
            "subsistence":  float(subs.quantize(Decimal("0.01"))),
            "incentive":    float(inc.quantize(Decimal("0.01"))),
            "gross":        float(gross.quantize(Decimal("0.01"))),
        }

    rows = []
    for total_loads in range(7, 13):
        base  = min(total_loads, 7)
        extra = total_loads - base
        rows.append({
            "total_loads": total_loads,
            "lohatla": calc_row(base, extra),
        })

    return {
        "rows": rows,
        "assmang_bonus_per_load": float(Decimal(str(s.assmang_bonus_per_load)).quantize(Decimal("0.01"))),
    }
