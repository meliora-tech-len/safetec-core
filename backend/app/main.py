from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.db.database import engine, SessionLocal
from app.models.models import Base, Role
from app.api.routes import auth, users, entities, suppliers, invoices, audit, settings, roles, fleet, drivers, payroll_settings, payroll_mine_groups, mines, truck_loads, driver_salary_configs, supplier_invoices, diesel

Base.metadata.create_all(bind=engine)


def _seed_default_roles():
    """Ensure default roles exist in the roles table on startup."""
    db = SessionLocal()
    try:
        if db.query(Role).count() == 0:
            db.add_all([
                Role(key="admin", display_name="System Administrator", is_protected=True),
                Role(key="standard", display_name="Admin Assistant", is_protected=True),
            ])
            db.commit()
    finally:
        db.close()


_seed_default_roles()

app = FastAPI(
    title="safetec_core API",
    description="Centralized Business Management System",
    version="1.1.0",
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://safetec-core.vercel.app",
        "https://larissa-engelbrecht-safetec-core.vercel.app",
        "https://safetec-core-frontend-git-production-larissas-projects-452e33a2.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files (local dev logo storage) ────────────────────────────────────
STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
STATIC_DIR.mkdir(exist_ok=True)
(STATIC_DIR / "logos").mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(entities.router)
app.include_router(suppliers.router)
app.include_router(invoices.router)
app.include_router(audit.router)
app.include_router(settings.router)
app.include_router(roles.router)
app.include_router(fleet.router)
app.include_router(drivers.router)
app.include_router(payroll_settings.router)
app.include_router(payroll_mine_groups.router)
app.include_router(mines.router)
app.include_router(truck_loads.router)
app.include_router(driver_salary_configs.router)
app.include_router(supplier_invoices.router)
app.include_router(diesel.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "safetec_core", "version": "1.1.0"}
