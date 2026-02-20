from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import engine
from app.models.models import Base
from app.api.routes import auth, users, entities, clients, invoices, audit

# Create all tables on startup (dev mode; use Alembic for production)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="safetec_core API",
    description="Centralized Business Management System",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://safetec-core-frontend-git-production-larissas-projects-452e33a2.vercel.app",
        "https://safetec-core-frontend-ghdmfdve3-larissas-projects-452e33a2.vercel.app",
        "https://larissa-engelbrecht-safetec-core.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(entities.router)
app.include_router(clients.router)
app.include_router(invoices.router)
app.include_router(audit.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "safetec_core"}
