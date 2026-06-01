"""Section-aware, token-aware-ish chunking with overlap.

Word counts are a cheap token proxy for the MVP; swap in a tokenizer (tiktoken) behind the
same interface later. Each chunk remembers which section it came from so retrieval can cite
the section."""
from dataclasses import dataclass

from app.ingestion.extractor import Section


@dataclass
class Chunk:
    text: str
    section: str


def chunk_text(text: str, *, chunk_words: int = 220, overlap: int = 40) -> list[str]:
    words = text.split()
    if not words:
        return []
    if overlap >= chunk_words:
        overlap = chunk_words // 4
    chunks: list[str] = []
    step = chunk_words - overlap
    start = 0
    while start < len(words):
        piece = " ".join(words[start : start + chunk_words])
        if piece.strip():
            chunks.append(piece)
        start += step
    return chunks


def chunk_sections(
    sections: list[Section], *, chunk_words: int = 220, overlap: int = 40
) -> list[Chunk]:
    """Chunk within each section. The section title is prepended to the embedded text so
    retrieval has section context, and is also stored separately for citations."""
    out: list[Chunk] = []
    for section in sections:
        for piece in chunk_text(section.text, chunk_words=chunk_words, overlap=overlap):
            body = f"[{section.title}]\n{piece}" if section.title else piece
            out.append(Chunk(text=body, section=section.title))
    return out
