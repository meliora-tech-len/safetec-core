from pathlib import Path
import logging
import logging.handlers
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse
from app.core.config import settings
from app.core.limiter import limiter
from app.db.database import engine, SessionLocal
from app.models.models import Base, Role
from app.api.routes import auth, users, entities, suppliers, invoices, audit, roles, fleet, drivers, payroll_settings, payroll_mine_groups, mines, truck_loads, driver_salary_configs, supplier_invoices, diesel, payroll_entries, reports, feedback, subcontractors, customers, invoice_templates
from app.api.routes import settings as settings_router

Base.metadata.create_all(bind=engine)

# ── File logger ───────────────────────────────────────────────────────────────
_log_dir = Path(__file__).resolve().parents[1] / "logs"
_log_dir.mkdir(exist_ok=True)
_log_file = _log_dir / "safetec.log"

def _setup_file_logging():
    """Wire up the file handler. Called at startup AFTER uvicorn configures logging."""
    fh = logging.handlers.RotatingFileHandler(
        _log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s — %(message)s"))
    fh.setLevel(logging.DEBUG)
    root = logging.getLogger()
    root.addHandler(fh)
    for name in ("safetec", "safetec.drivers", "safetec.truck_loads"):
        lg = logging.getLogger(name)
        lg.setLevel(logging.DEBUG)
        lg.addHandler(fh)
        lg.propagate = True
    logging.getLogger("safetec").info("=== Safetec logging initialised (post-uvicorn) ===")


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

_is_dev = settings.ENVIRONMENT == "development"

app = FastAPI(
    title="safetec_core API",
    description="Centralized Business Management System",
    version="1.1.0",
    redirect_slashes=False,
    docs_url="/docs" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: StarletteResponse = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response


app.add_middleware(_SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://safetec-core.vercel.app",
        "https://larissa-engelbrecht-safetec-core.vercel.app",
        "https://safetec-core-frontend-git-production-larissas-projects-452e33a2.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# ── Static files (local dev logo storage) ────────────────────────────────────
STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
STATIC_DIR.mkdir(exist_ok=True)
(STATIC_DIR / "logos").mkdir(exist_ok=True)
(STATIC_DIR / "letterheads").mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(entities.router)
app.include_router(suppliers.router)
app.include_router(subcontractors.router)
app.include_router(customers.router)
app.include_router(invoices.router)
app.include_router(audit.router)
app.include_router(settings_router.router)
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
app.include_router(payroll_entries.router)
app.include_router(reports.router)
app.include_router(feedback.router)
app.include_router(invoice_templates.router)


@app.on_event("startup")
async def startup_event():
    _setup_file_logging()


@app.get("/health")
def health():
    return {"status": "ok", "service": "safetec_core", "version": "1.1.0"}
