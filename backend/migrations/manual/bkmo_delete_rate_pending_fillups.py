"""One-off cleanup (2026-08-12, requested by the user in Afrikaans):

Delete ALL rate-pending diesel fill-up placeholders. The July BOKAMOSHO
summary was imported before litres-fallback matching existed, so the 25 July
placeholders (captured with depot PUMP slip numbers that never match the
summary's transaction ids) now sit as zero-amount duplicates next to the
imported rows. The 3 August placeholders are removed too per the request —
the August summary import will land them as normal rows.

Also archives supplier invoice 3097: an R0.00 ghost auto-created off pending
fill-up 6658, whose "invoice number" is the litres value (756.68) typed into
the wrong field. Nothing else links to it.

Writes bkmo_delete_rate_pending_fillups_undo.sql (full INSERTs) BEFORE
deleting. Run from backend/:  venv/Scripts/python.exe migrations/manual/bkmo_delete_rate_pending_fillups.py
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

GHOST_INVOICE_ID = 3097
UNDO_PATH = Path(__file__).with_name("bkmo_delete_rate_pending_fillups_undo.sql")


def sql_literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def main():
    eng = create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        cols = [r[0] for r in c.execute(text(
            "select column_name from information_schema.columns "
            "where table_name='diesel_fillups' order by ordinal_position"
        ))]
        rows = c.execute(text(
            f"select {', '.join(cols)} from diesel_fillups where rate_pending = true"
        )).fetchall()
        if not rows:
            print("No rate-pending fill-ups found — nothing to do.")
            return

        lines = [
            "-- UNDO for bkmo_delete_rate_pending_fillups.py (generated from live rows before delete)",
            f"-- {len(rows)} rate-pending fill-ups deleted on 2026-08-12",
            "BEGIN;",
        ]
        for r in rows:
            vals = ", ".join(sql_literal(v) for v in r)
            lines.append(
                f"INSERT INTO diesel_fillups ({', '.join(cols)}) VALUES ({vals});"
            )
        lines += [
            f"UPDATE supplier_invoices SET is_archived = false WHERE id = {GHOST_INVOICE_ID};",
            "SELECT setval('diesel_fillups_id_seq', (SELECT MAX(id) FROM diesel_fillups));",
            "COMMIT;",
        ]
        UNDO_PATH.write_text("\n".join(lines), encoding="utf-8")
        print(f"Undo file written: {UNDO_PATH} ({len(rows)} rows)")

        ids = [r[cols.index("id")] for r in rows]
        deleted = c.execute(text(
            "delete from diesel_fillups where rate_pending = true"
        )).rowcount
        c.execute(text(
            "update supplier_invoices set is_archived = true where id = :i and amount = 0"
        ), {"i": GHOST_INVOICE_ID})
        print(f"Deleted {deleted} rate-pending fill-ups: {sorted(ids)}")
        print(f"Archived ghost supplier invoice {GHOST_INVOICE_ID} (R0.00).")


if __name__ == "__main__":
    main()
