import base64
from datetime import datetime, timedelta, timezone
import logging
import random
import smtplib
from email.message import EmailMessage

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import OTPChallenge, PendingRegistration, User

logger = logging.getLogger(__name__)

_SUBJECT = "Your verification code"
_TTL_MINUTES = 10


class MailDeliveryError(RuntimeError):
    """The verification email could not be handed to a transport. Callers turn this into a
    503 rather than letting a mail outage surface as an unhandled 500."""


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _expired(moment: datetime) -> bool:
    """Postgres returns tz-aware timestamps; a naive one (SQLite, or a column created
    without a timezone) is read as UTC rather than raising on the comparison."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment < datetime.now(timezone.utc)


def _send_smtp(to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        raise MailDeliveryError("SMTP_HOST is not set")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f'"AegisRAG Support" <{settings.smtp_from}>' 
    msg["To"] = to
    msg.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def _send_resend(to: str, subject: str, body: str) -> None:
    """Resend's HTTPS API — port 443, so it works where SMTP egress is blocked."""
    if not settings.resend_api_key:
        raise MailDeliveryError("MAIL_PROVIDER=resend but RESEND_API_KEY is not set")
    res = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": f'"AegisRAG Support" <{settings.smtp_from}>', "to": [to], "subject": subject, "text": body},
        timeout=20,
    )
    if res.status_code >= 400:
        raise MailDeliveryError(f"Resend returned {res.status_code}: {res.text[:200]}")


def _send_gmail(to: str, subject: str, body: str) -> None:
    """Gmail API over HTTPS. Two calls on port 443: trade the long-lived refresh token for
    a short-lived access token, then post the RFC-822 message base64url-encoded. Delivers
    from your own mailbox to any recipient, so no domain has to be verified."""
    if not (settings.gmail_client_id and settings.gmail_client_secret and settings.gmail_refresh_token):
        raise MailDeliveryError(
            "MAIL_PROVIDER=gmail needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN"
        )
    tok = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "refresh_token": settings.gmail_refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=20,
    )
    if tok.status_code >= 400:
        raise MailDeliveryError(f"Google token refresh failed ({tok.status_code}): {tok.text[:200]}")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f'"AegisRAG Support" <{settings.smtp_from}>'  # must be the authenticated mailbox or one of its aliases
    msg["To"] = to
    msg.set_content(body)

    res = httpx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={"Authorization": f"Bearer {tok.json()['access_token']}"},
        json={"raw": base64.urlsafe_b64encode(msg.as_bytes()).decode()},
        timeout=20,
    )
    if res.status_code >= 400:
        raise MailDeliveryError(f"Gmail API returned {res.status_code}: {res.text[:200]}")


def _send_console(to: str, subject: str, body: str) -> None:
    """Development transport: the code goes to the application log, never to a mailbox.
    Anyone who can read the logs can complete a sign-in, so keep it out of production."""
    logger.warning("MAIL_PROVIDER=console, not delivering to %s:\n%s\n%s", to, subject, body)


_TRANSPORTS = {
    "gmail": _send_gmail, "smtp": _send_smtp, "resend": _send_resend, "console": _send_console,
}


def send_otp_email(recipient: str, code: str) -> None:
    """Takes an address rather than a User: a pending registration has no user row yet."""
    provider = settings.resolved_mail_provider
    transport = _TRANSPORTS.get(provider)
    if transport is None:
        raise MailDeliveryError(
            f"Unknown MAIL_PROVIDER {settings.mail_provider!r} (expected one of {sorted(_TRANSPORTS)})"
        )
    body = (
        f"Your one-time verification code is: {code}\n\n"
        f"It expires in {_TTL_MINUTES} minutes. If you did not request this, please ignore this email."
    )
    try:
        transport(recipient, _SUBJECT, body)
    except MailDeliveryError:
        raise
    except Exception as exc:
        # OSError/ENETUNREACH when the host blocks SMTP egress, plus DNS, TLS and timeouts.
        raise MailDeliveryError(f"{provider} transport failed: {type(exc).__name__}: {exc}") from exc


# ---------------------------------------------------------------- pending registrations


def create_or_replace_pending_registration(
    db: Session, *, tenant_name: str, tenant_slug: str, email: str, hashed_password: str
) -> PendingRegistration:
    """Park a signup until its code is verified. Re-registering the same address replaces
    the previous attempt, and expired rows are swept on the way through."""
    now = datetime.now(timezone.utc)
    for stale in db.scalars(
        select(PendingRegistration).where(
            (PendingRegistration.email == email) | (PendingRegistration.expires_at < now)
        )
    ).all():
        db.delete(stale)

    pending = PendingRegistration(
        tenant_name=tenant_name,
        tenant_slug=tenant_slug,
        email=email,
        hashed_password=hashed_password,
        code=_generate_code(),
        expires_at=now + timedelta(minutes=_TTL_MINUTES),
    )
    db.add(pending)
    db.commit()
    db.refresh(pending)
    return pending


def find_valid_pending_registration(
    db: Session, *, email: str, code: str
) -> PendingRegistration | None:
    """The matching, unexpired signup, or None. Deleting it is the caller's job, so the
    tenant can still be created in the same transaction that consumes it."""
    pending = db.scalar(
        select(PendingRegistration)
        .where(PendingRegistration.email == email, PendingRegistration.code == code)
        .order_by(PendingRegistration.created_at.desc())
    )
    if not pending or _expired(pending.expires_at):
        return None
    return pending


# ---------------------------------------------------------------- login challenges


def create_or_replace_otp(db: Session, user: User, purpose: str = "login") -> OTPChallenge:
    code = _generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_TTL_MINUTES)
    otp = OTPChallenge(
        user_id=user.id,
        code=code,
        purpose=purpose,
        expires_at=expires_at,
        consumed=False,
    )
    db.add(otp)
    db.commit()
    db.refresh(otp)
    return otp


def validate_otp(db: Session, user: User, code: str, purpose: str = "login") -> bool:
    otp = db.scalar(
        select(OTPChallenge)
        .where(
            OTPChallenge.user_id == user.id,
            OTPChallenge.purpose == purpose,
            OTPChallenge.code == code,
            OTPChallenge.consumed == False,
        )
        .order_by(OTPChallenge.created_at.desc())
    )
    if not otp:
        return False
    if _expired(otp.expires_at):
        return False
    otp.consumed = True
    db.commit()
    return True
