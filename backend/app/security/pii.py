"""PII detection + masking. Applied to anything that could reach logs."""
import re

_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE = re.compile(r"\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b")
_CARD = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b")


def mask_pii(text: str) -> str:
    """Replace PII with typed placeholders. Order matters (card before phone)."""
    if not text:
        return text
    text = _EMAIL.sub("[EMAIL]", text)
    text = _SSN.sub("[SSN]", text)
    text = _IBAN.sub("[BANK]", text)
    text = _CARD.sub("[CARD]", text)
    text = _PHONE.sub("[PHONE]", text)
    return text
