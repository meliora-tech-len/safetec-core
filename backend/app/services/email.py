"""
Email service — sends transactional emails via SMTP.
If SMTP is not configured, the message is printed to the server console
so a dev/admin can relay the reset link manually.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from app.core.config import settings

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD)


def send_email(to: str, subject: str, body_html: str, body_text: str) -> None:
    """Send an email. Falls back to console logging if SMTP is not configured."""
    if not _smtp_configured():
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

    try:
        if settings.SMTP_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.ehlo()
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(msg["From"], [to], msg.as_string())
        else:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(msg["From"], [to], msg.as_string())
    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        raise


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


def send_invoice_email(
    to: str,
    invoice_number: str,
    document_type: str,
    supplier_name: str,
    pdf_bytes: bytes,
) -> None:
    """Send an invoice/quote email with the PDF attached."""
    doc_label = "Invoice" if document_type == "invoice" else "Quote"
    subject = f"{doc_label} {invoice_number}"

    body_text = (
        f"Dear {supplier_name},\n\n"
        f"Please find attached {doc_label.lower()} {invoice_number}.\n\n"
        "Kind regards"
    )

    body_html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <p style="color:#555">Dear {supplier_name},</p>
      <p style="color:#555">Please find attached <strong>{doc_label} {invoice_number}</strong>.</p>
      <p style="color:#555">Kind regards</p>
    </div>
    """

    if not _smtp_configured():
        logger.warning("SMTP not configured — cannot send invoice email")
        return

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(body_text, "plain"))
    alt.attach(MIMEText(body_html, "html"))
    msg.attach(alt)

    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_bytes)
    encoders.encode_base64(attachment)
    attachment.add_header("Content-Disposition", f'attachment; filename="{invoice_number}.pdf"')
    msg.attach(attachment)

    try:
        if settings.SMTP_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.ehlo()
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(msg["From"], [to], msg.as_string())
        else:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(msg["From"], [to], msg.as_string())
    except Exception as e:
        logger.error(f"Failed to send invoice email to {to}: {e}")
        raise
