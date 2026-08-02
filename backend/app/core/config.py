from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./safetec_core.db"
    SECRET_KEY: str = "dev-secret-key-change-in-production-32chars!!"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    BASE_URL: Optional[str] = None
    FRONTEND_URL: str = "http://localhost:5173"

    ENVIRONMENT: str = "development"  # Set to "production" on server to disable /docs

    # Linear integration — optional. If not set, feedback submission is disabled.
    LINEAR_API_TOKEN: Optional[str] = None
    LINEAR_TEAM_ID: Optional[str] = None

    # SMTP — outside production, reset links are printed to the server console
    # when unset. In production an unset/broken relay is a hard error.
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    SMTP_TLS: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
