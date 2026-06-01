"""Prompt-injection / jailbreak detection.

Scores a query 0-100 across weighted signal categories and returns a decision:
ALLOW / FLAG / BLOCK. This runs BEFORE retrieval. It is deliberately rule-based and
dependency-free for the MVP; swap in an ML classifier behind the same interface later."""
import re
from dataclasses import dataclass, field

from app.config import settings

# (compiled pattern, weight, category)
_SIGNALS: list[tuple[re.Pattern, int, str]] = [
    # Instruction override
    (re.compile(r"\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?)", re.I), 45, "instruction_override"),
    (re.compile(r"\bdisregard\s+(the\s+)?(system|previous|above)", re.I), 40, "instruction_override"),
    (re.compile(r"\boverride\s+(the\s+)?(system|safety|rules)", re.I), 40, "instruction_override"),
    (re.compile(r"\bforget\s+(everything|all|your)\b", re.I), 30, "instruction_override"),
    # Role manipulation
    (re.compile(r"\byou\s+are\s+now\b", re.I), 30, "role_manipulation"),
    (re.compile(r"\bact\s+as\s+(an?\s+)?(admin|root|developer|dan|system)", re.I), 35, "role_manipulation"),
    (re.compile(r"\bpretend\s+to\s+be\b", re.I), 25, "role_manipulation"),
    (re.compile(r"\bdeveloper\s+mode\b", re.I), 35, "jailbreak"),
    # Jailbreak patterns
    (re.compile(r"\bDAN\b"), 30, "jailbreak"),
    (re.compile(r"\bjailbreak\b", re.I), 40, "jailbreak"),
    (re.compile(r"\bno\s+(restrictions|filters|limitations|rules)\b", re.I), 30, "jailbreak"),
    (re.compile(r"\bunfiltered\b", re.I), 25, "jailbreak"),
    # Data exfiltration
    (re.compile(r"\b(reveal|show|print|repeat|expose)\s+(the\s+)?(system\s+prompt|instructions)", re.I), 50, "exfiltration"),
    (re.compile(r"\b(api[_\s-]?key|secret|password|credential|token)s?\b", re.I), 30, "exfiltration"),
    (re.compile(r"\bother\s+(tenant|company|organization|customer)('?s)?\b", re.I), 45, "exfiltration"),
    (re.compile(r"\b(dump|leak|exfiltrate)\b", re.I), 40, "exfiltration"),
    # Hidden / encoded instructions
    (re.compile(r"[​-‏‪-‮﻿]"), 35, "hidden"),  # zero-width / bidi
    (re.compile(r"\bbase64\b|\bdecode\b|\brot13\b", re.I), 20, "hidden"),
    (re.compile(r"<\s*system\s*>|\[\s*system\s*\]|###\s*system", re.I), 40, "hidden"),
]


@dataclass
class GuardResult:
    score: int
    decision: str  # ALLOW | FLAG | BLOCK
    categories: list[str] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        return self.decision == "BLOCK"


def scan_query(query: str) -> GuardResult:
    score = 0
    cats: set[str] = set()
    for pattern, weight, category in _SIGNALS:
        if pattern.search(query):
            score += weight
            cats.add(category)
    score = min(score, 100)

    if score >= settings.prompt_guard_block_threshold:
        decision = "BLOCK"
    elif score >= settings.prompt_guard_flag_threshold:
        decision = "FLAG"
    else:
        decision = "ALLOW"
    return GuardResult(score=score, decision=decision, categories=sorted(cats))
