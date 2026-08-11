from datetime import datetime, timedelta, timezone
import random
import smtplib
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import OTPChallenge, User


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def send_otp_email(user: User, code: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured for OTP delivery")

    msg = EmailMessage()
    msg["Subject"] = "Your verification code"
    msg["From"] = settings.smtp_from
    msg["To"] = user.email
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


def create_or_replace_otp(db: Session, user: User, purpose: str = "login") -> OTPChallenge:
    code = _generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
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
    if otp.expires_at < datetime.now(timezone.utc):
        return False
    otp.consumed = True
    db.commit()
    return True
