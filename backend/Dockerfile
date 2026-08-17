# Hugging Face Spaces builds the file named exactly `Dockerfile`, runs the container as
# uid 1000, and health-checks the port declared by `app_port` in README.md (7860).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# build-essential for native wheels; tesseract-ocr + poppler-utils power OCR/PDF extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential tesseract-ocr poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# uv for dependency management (build-time only)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Create uid 1000 and own its tree before switching, so the venv and the model cache are
# writable at runtime. (WORKDIR would create the directory root-owned.)
RUN useradd -m -u 1000 user && mkdir -p /home/user/app && chown -R user:user /home/user
USER user
ENV HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface \
    FASTEMBED_CACHE_PATH=/home/user/.cache/fastembed \
    PATH="/home/user/app/.venv/bin:$PATH"
WORKDIR /home/user/app

# Install dependencies into ./.venv. --no-cache keeps the image (and the layer) smaller.
COPY --chown=user pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-cache

# Bake the embedding + BM25 models into the image. FastEmbed otherwise downloads them on
# first use into a temp dir that is wiped on every restart, which alone can outlast the
# platform's startup window.
ARG FASTEMBED_MODEL=BAAI/bge-large-en-v1.5
RUN python -c "from fastembed import TextEmbedding, SparseTextEmbedding; TextEmbedding(model_name='$FASTEMBED_MODEL'); SparseTextEmbedding(model_name='Qdrant/bm25')"

COPY --chown=user app ./app

EXPOSE 7860
# Shell form so $PORT (set by Spaces/Render/Railway) wins when present.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
