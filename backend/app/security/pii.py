"""PII detection + masking. Applied to anything that could reach logs."""
import re

_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE = re.compile(r"\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b")
_CARD = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b")


def mask_pii(text: str) -> str:
    """Replace all PII with typed placeholders. Order matters (card before phone)."""
    if not text:
        return text
    text = _EMAIL.sub("[EMAIL]", text)
    text = _SSN.sub("[SSN]", text)
    text = _IBAN.sub("[BANK]", text)
    text = _CARD.sub("[CARD]", text)
    text = _PHONE.sub("[PHONE]", text)
    return text


def _mask_sensitive(text: str) -> str:
    """National-id / financial PII — masked for everyone regardless of role."""
    text = _SSN.sub("[SSN]", text)
    text = _IBAN.sub("[BANK]", text)
    text = _CARD.sub("[CARD]", text)
    return text


def _mask_contact(text: str) -> str:
    """Contact PII — masked only for low-trust roles."""
    text = _EMAIL.sub("[EMAIL]", text)
    text = _PHONE.sub("[PHONE]", text)
    return text


# Only these roles may see contact PII (email/phone) in answers; everyone else is masked.
# Government-ID / financial PII is masked for ALL roles. Mirrors the Team capability matrix.
_CONTACT_PII_ROLES = {"ADMIN", "HR"}


def mask_for_role(text: str, role: str) -> str:
    """Category- and role-aware masking for responses shown to users.
    - Government-ID / financial PII (SSN, card, IBAN): masked for everyone.
    - Contact PII (email, phone): visible only to ADMIN / HR; masked for all other roles."""
    if not text:
        return text
    text = _mask_sensitive(text)
    if str(role).upper() not in _CONTACT_PII_ROLES:
        text = _mask_contact(text)
    return text
