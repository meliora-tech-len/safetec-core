from sqlalchemy import text


def upgrade(conn):
    entities = conn.execute(text(
        "SELECT id, name, trading_name, registration_number, vat_number, email, phone "
        "FROM business_entities WHERE is_active = TRUE"
    )).fetchall()

    for source in entities:
        for target in entities:
            if source.id == target.id:
                continue
            existing = conn.execute(text(
                "SELECT id FROM customers WHERE entity_id = :eid AND name = :name"
            ), {"eid": target.id, "name": source.name}).fetchone()
            if not existing:
                conn.execute(text("""
                    INSERT INTO customers (entity_id, name, trading_name, registration_number, vat_number, email, phone, is_active)
                    VALUES (:entity_id, :name, :trading_name, :reg, :vat, :email, :phone, TRUE)
                """), {
                    "entity_id": target.id,
                    "name": source.name,
                    "trading_name": source.trading_name,
                    "reg": source.registration_number,
                    "vat": source.vat_number,
                    "email": source.email,
                    "phone": source.phone,
                })

    subs = conn.execute(text(
        "SELECT entity_id, name, trading_name, contact_person, email, phone, registration_number, vat_number "
        "FROM subcontractors WHERE is_active = TRUE"
    )).fetchall()

    for sub in subs:
        existing = conn.execute(text(
            "SELECT id FROM customers WHERE entity_id = :eid AND name = :name"
        ), {"eid": sub.entity_id, "name": sub.name}).fetchone()
        if not existing:
            conn.execute(text("""
                INSERT INTO customers (entity_id, name, trading_name, contact_person, email, phone, registration_number, vat_number, is_active)
                VALUES (:entity_id, :name, :trading_name, :contact, :email, :phone, :reg, :vat, TRUE)
            """), {
                "entity_id": sub.entity_id,
                "name": sub.name,
                "trading_name": sub.trading_name,
                "contact": sub.contact_person,
                "email": sub.email,
                "phone": sub.phone,
                "reg": sub.registration_number,
                "vat": sub.vat_number,
            })

    conn.commit()
