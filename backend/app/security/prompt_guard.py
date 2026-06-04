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
    # Tolerant of intervening words ("ignore the previous instructions and permissions").
    (re.compile(r"\bignore\b[\w\s,'\"-]{0,40}?\b(instruction|prompt|rule|permission|restriction|guideline|direction|context|policy)s?\b", re.I), 45, "instruction_override"),
    (re.compile(r"\bdisregard\b[\w\s,'\"-]{0,40}?\b(system|previous|above|instruction|rule|permission|prompt)s?\b", re.I), 40, "instruction_override"),
    (re.compile(r"\b(override|bypass|disable|circumvent)\b[\w\s,'\"-]{0,30}?\b(system|safety|rule|permission|restriction|filter|guardrail|security|access\s+control)s?\b", re.I), 45, "instruction_override"),
    (re.compile(r"\bforget\s+(everything|all|your|the|previous)\b", re.I), 30, "instruction_override"),
    # Privilege / permission manipulation ("remove permissions", "adjust my access", "make me admin").
    (re.compile(r"\b(remove|delete|adjust|change|modify|update|alter|edit|reset|drop|lift|relax|loosen|grant|give|elevate|escalate|expand|increase|raise|lower|set)\b[\w\s,'\"-]{0,20}?\b(permissions?|access|roles?|privileges?|rights?|restrictions?|clearances?|authoriz\w*|rbac|scopes?)\b", re.I), 45, "privilege_escalation"),
    (re.compile(r"\b(make|set|turn)\s+me\s+(in)?to\s+(an?\s+)?(admin|administrator|owner|root|superuser|super\s*user)\b", re.I), 50, "privilege_escalation"),
    (re.compile(r"\b(give|grant)\s+me\s+(an?\s+)?(admin|root|full|elevated|higher|all)\b", re.I), 45, "privilege_escalation"),
    (re.compile(r"\b(i\s*am|i'm)\s+(an?\s+)?(admin|administrator|the\s+owner|root|superuser)\b", re.I), 35, "privilege_escalation"),
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
    # Over-broad data requests ("give me all information you have", "everything you know").
    (re.compile(r"\b(give|send|show|provide|share)\s+me\s+(all|everything|every|the\s+full|the\s+entire)\b", re.I), 35, "exfiltration"),
    (re.compile(r"\b(all|every|any)\s+(the\s+)?(information|data|documents?|files?|records?)\s+(you\s+(have|can|know|hold)|available)\b", re.I), 35, "exfiltration"),
    (re.compile(r"\beverything\s+you\s+(know|have|can\s+access)\b", re.I), 35, "exfiltration"),
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
