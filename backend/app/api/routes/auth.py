import secrets
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from app.db.database import get_db
from app.core.security import verify_password, create_access_token, get_current_user, get_password_hash
from app.core.config import settings
from app.models.models import User
from app.schemas.schemas import Token, UserOut
from app.services.audit import log_action
from app.services.email import send_password_reset_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    user.last_login = datetime.now(timezone.utc)
    log_action(
        db, action="auth.login", user_id=user.id,
        description=f"User {user.email} logged in",
        ip_address=request.client.host if request.client else None,
    )
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ── Password reset request / confirm ─────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/forgot-password", status_code=204)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Generate a password-reset token and email it to the user.
    Always returns 204 to avoid leaking whether the email exists.
    """
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not user.is_active:
        return  # silent no-op

    token = secrets.token_urlsafe(32)
    user.password_reset_token = token
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()

    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    try:
        send_password_reset_email(to=user.email, full_name=user.full_name, reset_url=reset_url)
    except Exception as e:
        logger.error(f"Failed to send reset email to {user.email}: {e}")
        logger.info(f"Password reset URL for {user.email}: {reset_url}")


@router.post("/reset-password", status_code=204)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Validate reset token and set a new password."""
    if not body.token or len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user = db.query(User).filter(User.password_reset_token == body.token).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    if user.password_reset_expires is None:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    expires = user.password_reset_expires
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    user.hashed_password = get_password_hash(body.new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    db.commit()
