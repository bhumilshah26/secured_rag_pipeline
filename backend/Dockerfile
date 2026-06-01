FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# build-essential for native wheels; tesseract-ocr + poppler-utils power OCR/PDF extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential tesseract-ocr poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# uv for dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Install dependencies from the lockfile (reproducible, no project install).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY app ./app

EXPOSE 8000
# uv run executes inside the project's .venv
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
