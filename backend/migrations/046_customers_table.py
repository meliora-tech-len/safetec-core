from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            name VARCHAR(300) NOT NULL,
            trading_name VARCHAR(300),
            contact_person VARCHAR(200),
            email VARCHAR(200),
            phone VARCHAR(50),
            address TEXT,
            city VARCHAR(100),
            postal_code VARCHAR(20),
            vat_number VARCHAR(50),
            registration_number VARCHAR(100),
            notes TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    conn.commit()
