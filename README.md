# safetec_core

Centralized Business Management System — Multi-tenant invoicing, client management, and audit logging across 6 business entities.

## Business Entities

| Code | Entity |
|------|--------|
| BTP  | Border Tradepost (Pty) Ltd |
| OBHI | OBHI (Pty) Ltd |
| SFT  | Safetec (Pty) Ltd |
| TP   | Thembis People (Pty) Ltd |
| BKMO | Bokamosho (Pty) Ltd |
| KS   | Kholiswa Services (Pty) Ltd |

## Tech Stack

- **Backend**: Python FastAPI + SQLAlchemy + JWT auth
- **Frontend**: React + Vite
- **Database**: SQLite (local dev) / PostgreSQL (production)
- **PDF**: ReportLab

---

## Local Development Setup

### 1. Backend

```bash
cd backend

# Copy environment file
cp .env.example .env
# For local dev, the default SQLite config works as-is

# Create virtual environment
python -m venv venv
source venv/bin/activate       # Linux/Mac
# venv\Scripts\activate        # Windows

# Install dependencies
pip install -r requirements.txt

# Seed database (creates tables + admin user + all 6 entities)
python seed.py

# Start development server
uvicorn app.main:app --reload --port 8000
```

API available at: `http://localhost:8000`  
Swagger docs at: `http://localhost:8000/docs`

**Default admin credentials:**
- Email: `admin@safetec.co.za`
- Password: `Admin@1234!`  
  ⚠️ Change immediately after first login

### 2. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (proxies /api to localhost:8000)
npm run dev
```

Frontend available at: `http://localhost:3000`

---

## Project Structure

```
safetec_core/
├── backend/
│   ├── app/
│   │   ├── api/routes/      # auth, users, entities, clients, invoices, audit
│   │   ├── core/            # config, security (JWT)
│   │   ├── db/              # SQLAlchemy engine + session
│   │   ├── models/          # All DB models (User, Client, Invoice, etc.)
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   ├── services/        # audit.py, pdf_generator.py, invoice_numbering.py
│   │   └── main.py          # FastAPI app + CORS + routes
│   ├── seed.py              # DB seeder (entities + admin)
│   └── requirements.txt
└── frontend/
    └── src/
        ├── pages/           # LoginPage, DashboardPage, ClientsPage, etc.
        ├── components/      # Sidebar, AppLayout
        ├── hooks/           # useAuth (AuthContext)
        ├── services/        # api.js (axios wrapper)
        ├── utils/           # helpers.js (format currency, dates, etc.)
        └── styles/          # globals.css (dark theme)
```

---

## Features Implemented

### ✅ Authentication & RBAC
- JWT-based login with 8-hour tokens
- Admin role: full access to all 6 entities
- Standard user: access only to assigned entities
- `UserEntityAccess` table controls per-entity permissions

### ✅ Dashboard
- Outstanding invoices total
- Paid this month
- Overdue count
- Draft count
- Recent documents table
- Entity breakdown with totals
- Filter by entity

### ✅ Client Management
- Create/edit/soft-delete clients
- Per-entity scoping
- Search by name, trading name, contact, email
- Filter by entity
- Full contact details (reg no, VAT, address, etc.)

### ✅ Invoicing Engine
- **Auto-numbering** per entity: `OBHI0001`, `SFT0023`, `TP0005`, etc.
- **Invoices and Quotes** as separate document types
- Quote numbering: `QOBHI0001`, `QSFT0005`, etc.
- CRUD with line items (description, qty, unit price)
- 15% VAT auto-calculation (configurable per entity)
- Status workflow: `draft → sent → paid / overdue → cancelled`
- PDF generation (dark-themed, professional layout with banking details)
- Direct PDF download button on list and detail views

### ✅ Audit Logging
- Every create/edit/delete/login action is logged
- Records: user, entity, action, resource type+id, description, IP, timestamp
- Filterable by entity and resource type
- Admin-only access

---

## Production Deployment (Hetzner)

### 1. PostgreSQL

```bash
# .env for production
DATABASE_URL=postgresql://safetec:STRONG_PASSWORD@localhost:5432/safetec_core
SECRET_KEY=generate-with-openssl-rand-hex-32
```

### 2. Systemd service

```ini
# /etc/systemd/system/safetec_core.service
[Unit]
Description=safetec_core API
After=network.target postgresql.service

[Service]
User=www-data
WorkingDirectory=/opt/safetec_core/backend
Environment=PATH=/opt/safetec_core/venv/bin
ExecStart=/opt/safetec_core/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

### 3. Nginx reverse proxy

```nginx
server {
    server_name yourdomain.co.za;
    
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location / {
        root /opt/safetec_core/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

### 4. Build frontend for production

```bash
cd frontend && npm run build
```

---

## Adding Clients from Excel

Use the `/api/clients/` POST endpoint or run a one-time import script:

```python
# Example: import_clients.py
import pandas as pd, requests, json

df = pd.read_excel('your_client_list.xlsx')
headers = {'Authorization': 'Bearer YOUR_TOKEN'}

for _, row in df.iterrows():
    requests.post('http://localhost:8000/api/clients/', 
        json={'entity_id': 1, 'name': row['Name'], 'email': row.get('Email', '')},
        headers=headers)
```

---

## Invoice Number Format

| Entity | Invoice | Quote |
|--------|---------|-------|
| OBHI | OBHI0001, OBHI0002... | QOBHI0001... |
| SFT  | SFT0001, SFT0002... | QSFT0001... |
| TP   | TP0001, TP0002... | QTP0001... |
| BTP  | BTP0001... | QBTP0001... |
| BKMO | BKMO0001... | QBKMO0001... |
| KS   | KS0001... | QKS0001... |

Counters are per-entity and auto-increment atomically (no gaps, no duplicates).
