"""
Email service — sends the password-reset link via SMTP.

That reset link is the only mail this system sends; there is deliberately no
other sender here. Outside production, a message that cannot be sent because
SMTP is unconfigured is printed to the server console so a dev/admin can relay
the link manually. In production a missing or broken relay raises
EmailDeliveryError: reporting a phantom success is what let a missing DNS
record go unnoticed.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

logger = logging.getLogger(__name__)

# Guards against a worker hanging on the OS default connect timeout when the
# relay host resolves but silently drops the connection (firewall, dead box).
SMTP_TIMEOUT = 20


class EmailDeliveryError(RuntimeError):
    """Raised when a message could not be handed to the SMTP relay."""


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD)


def _unconfigured_reason() -> str:
    missing = [
        name for name in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD")
        if not getattr(settings, name)
    ]
    return f"SMTP is not configured (missing: {', '.join(missing)})"


def _deliver(msg: MIMEMultipart, to: str) -> None:
    """Hand a built message to the relay. Raises EmailDeliveryError on failure."""
    sender = msg["From"]
    try:
        if settings.SMTP_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT) as server:
                server.ehlo()
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(sender, [to], msg.as_string())
        else:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT) as server:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(sender, [to], msg.as_string())
    except Exception as e:
        logger.error(
            f"SMTP delivery to {to} failed via {settings.SMTP_HOST}:{settings.SMTP_PORT} "
            f"— {type(e).__name__}: {e}"
        )
        raise EmailDeliveryError(
            f"SMTP relay {settings.SMTP_HOST}:{settings.SMTP_PORT} did not accept the message"
        ) from e


def send_email(to: str, subject: str, body_html: str, body_text: str) -> None:
    """Send an email. Console fallback outside production; raises in production."""
    if not _smtp_configured():
        if settings.ENVIRONMENT == "production":
            raise EmailDeliveryError(_unconfigured_reason())
        logger.warning("SMTP not configured — printing email to console instead")
        print("\n" + "=" * 60)
        print(f"TO:      {to}")
        print(f"SUBJECT: {subject}")
        print("-" * 60)
        print(body_text)
        print("=" * 60 + "\n")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    _deliver(msg, to)


def send_password_reset_email(to: str, full_name: str, reset_url: str) -> None:
    subject = "Password Reset — safetec_core"

    body_text = (
        f"Hi {full_name},\n\n"
        "You requested a password reset for your safetec_core account.\n\n"
        f"Click the link below to reset your password (valid for 1 hour):\n{reset_url}\n\n"
        "If you did not request this, you can safely ignore this email.\n\n"
        "— safetec_core"
    )

    body_html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="margin-bottom:8px">Password Reset</h2>
      <p style="color:#555">Hi {full_name},</p>
      <p style="color:#555">You requested a password reset for your <strong>safetec_core</strong> account.</p>
      <p style="margin:24px 0">
        <a href="{reset_url}"
           style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
      </p>
      <p style="color:#888;font-size:13px">This link expires in 1 hour. If you did not request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#bbb;font-size:11px">safetec_core — Business Management System</p>
    </div>
    """

    send_email(to, subject, body_html, body_text)
