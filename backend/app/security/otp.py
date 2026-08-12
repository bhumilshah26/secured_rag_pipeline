from datetime import datetime, timedelta, timezone
import random
import smtplib
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import OTPChallenge, PendingRegistration, User

_TTL_MINUTES = 10


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _expired(moment: datetime) -> bool:
    """Postgres returns tz-aware timestamps; a naive one (SQLite, or a column created
    without a timezone) is read as UTC rather than raising on the comparison."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment < datetime.now(timezone.utc)


def send_otp_email(recipient: str, code: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured for OTP delivery")

    msg = EmailMessage()
    msg["Subject"] = "Your verification code"
    msg["From"] = settings.smtp_from
    msg["To"] = recipient
    msg.set_content(
        f"Your one-time verification code is: {code}\n\n"
        "It expires in 10 minutes. If you did not request this, please ignore this email."
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


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
