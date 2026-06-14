"""Zero-dependency LLM fallback for local dev / tests.

It cannot truly reason, but instead of parroting the first line it performs lightweight
*extractive* question answering: it ranks the retrieved sentences by how well they match the
question and stitches the best ones into a natural, grounded answer. This keeps the full
pipeline runnable with no API keys while reading like a real assistant.

For generated (abstractive) answers, set LLM_PROVIDER=openai.
"""
import re

from app.llm.base import LLMProvider

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was",
    "were", "be", "been", "do", "does", "did", "how", "what", "when", "where", "which",
    "who", "why", "can", "could", "would", "should", "i", "you", "we", "they", "it",
    "this", "that", "these", "those", "with", "as", "at", "by", "from", "about", "into",
    "many", "much", "my", "our", "their", "me", "please", "tell", "give",
}

# Markup the prompt builder / chunker injects that should not appear in answers.
_NOISE = re.compile(
    r"(<<<[^>]*>>>)|(\[doc\s*\d+\])|(^\[[^\]]+\]\s*)", re.IGNORECASE | re.MULTILINE
)


def _keywords(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z0-9']+", text.lower())
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def _sentences(context: str) -> list[str]:
    clean = _NOISE.sub(" ", context)
    clean = re.sub(r"\s+", " ", clean).strip()
    parts = re.split(r"(?<=[.!?])\s+|\n+", clean)
    return [s.strip() for s in parts if len(s.strip()) > 15]


class EchoLLMProvider(LLMProvider):
    @property
    def model_name(self) -> str:
        return "echo-local"

    def generate(
        self, *, system: str, context: str, query: str,
        history: list[dict] | None = None,
    ) -> str:
        # The echo provider is extractive (no real reasoning), so it ignores history.
        sentences = _sentences(context)
        if not sentences:
            return (
                "I couldn't find anything in the documents you're authorized to read that "
                "answers this. Try rephrasing, or index a document that covers it."
            )

        keywords = _keywords(query)
        # Score each sentence by keyword overlap; keep original order for the best ones.
        scored = []
        for idx, sent in enumerate(sentences):
            words = _keywords(sent)
            overlap = len(keywords & words)
            if keywords and query.lower().strip(" ?.!") in sent.lower():
                overlap += 3  # reward a near-verbatim phrase match
            scored.append((overlap, idx, sent))

        best = [s for s in sorted(scored, key=lambda t: (-t[0], t[1])) if s[0] > 0][:3]

        if not best:
            # Nothing matched the question terms — surface the most relevant context plainly.
            lead = sentences[0]
            return (
                f"I don't have a direct answer to that, but the closest information I found is: "
                f"{lead} You can check the cited sources below for more detail."
            )

        best.sort(key=lambda t: t[1])  # restore reading order
        answer = " ".join(s for _, _, s in best)
        topic = ", ".join(sorted(keywords)[:3]) or "your question"
        return (
            f"Here's what I found regarding {topic}:\n\n{answer}\n\n"
            "This is drawn directly from your indexed documents — see the sources below."
        )
