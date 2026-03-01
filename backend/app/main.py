from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.db.database import engine
from app.models.models import Base
from app.api.routes import auth, users, entities, suppliers, invoices, audit, settings

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="safetec_core API",
    description="Centralized Business Management System",
    version="1.1.0",
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


@app.get("/health")
def health():
    return {"status": "ok", "service": "safetec_core", "version": "1.1.0"}
