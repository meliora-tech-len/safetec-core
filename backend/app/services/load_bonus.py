"""
Per-load bonus qualifying mines
===============================
Single source of truth for which mines earn the per-load bonus
(``PayrollSettings.assmang_bonus_per_load``, default R150).

Originally the bonus applied to the ASSMANG mine only. It now also applies to
the other Group-A mines — Mokala, Tawana and Sebilo. The setting/column names
keep the ``assmang_`` prefix for backward compatibility, but the qualifying set
lives here so the drivers and truck-loads routes can't drift apart.
"""

from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from app.models.models import Mine

# Matched case-insensitively against Mine.code / Mine.name.
BONUS_MINE_CODES = {"ass", "mok", "taw", "seb"}
BONUS_MINE_NAMES = {"assmang", "mokala", "tawana", "sebilo"}


def bonus_mine_ids(db: Session) -> list:
    """IDs of mines whose loads earn the per-load bonus (Assmang + Mokala/Tawana/Sebilo)."""
    rows = db.query(Mine.id).filter(
        or_(
            func.lower(Mine.code).in_(BONUS_MINE_CODES),
            func.lower(Mine.name).in_(BONUS_MINE_NAMES),
        )
    ).all()
    return [r[0] for r in rows]
