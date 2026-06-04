"""Environment-driven settings. Provider selection is config-only (no code changes)."""
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the project-root .env regardless of the current working directory.
# (config.py -> app -> backend -> <project root>/.env)
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # Real environment variables (e.g. those injected by docker-compose) always take
    # precedence over the .env file, so the same code works locally and in containers.
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    app_env: str = "development"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    jwt_algorithm: str = "HS256"

    # Postgres
    postgres_user: str = "rag"
    postgres_password: str = "pass%4012345"
    postgres_db: str = "rag"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    # Qdrant
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "rag_chunks"

    # Embeddings (default model is 1024-dim)
    embedding_provider: str = "fastembed"  # fastembed | openai
    fastembed_model: str = "BAAI/bge-large-en-v1.5"  # 1024 dims
    openai_embedding_model: str = "text-embedding-3-small"

    # Document extraction / OCR (optional system tools)
    ocr_enabled: bool = True
    tesseract_cmd: str = ""   # absolute path to tesseract.exe if not on PATH
    poppler_path: str = ""    # path to poppler 'bin' dir if not on PATH (pdf2image)
    chunk_words: int = 220
    chunk_overlap: int = 40

    # LLM
    llm_provider: str = "echo"  # echo | openai | anthropic
    openai_model: str = "gpt-4o-mini"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    llm_max_tokens: int = 1024

    # Connectors
    composio_api_key: str = ""
    composio_base_url: str = "https://backend.composio.dev"
    # Per-toolkit Composio auth-config ids (developer-side; users never enter these).
    composio_authconfig_gdrive: str = ""
    composio_authconfig_onedrive: str = ""
    composio_authconfig_sharepoint: str = ""
    composio_authconfig_confluence: str = ""
    composio_authconfig_slack: str = ""

    def composio_auth_config_for(self, kind: str) -> str:
        return {
            "gdrive": self.composio_authconfig_gdrive,
            "onedrive": self.composio_authconfig_onedrive,
            "sharepoint": self.composio_authconfig_sharepoint,
            "confluence": self.composio_authconfig_confluence,
            "slack": self.composio_authconfig_slack,
        }.get(kind, "")

    # Prompt guard thresholds (0-100)
    prompt_guard_flag_threshold: int = 40
    prompt_guard_block_threshold: int = 70

    # Response PII masking (category + role aware; see security/pii.mask_for_role)
    pii_mask_in_response: bool = True

    # Retrieval
    retrieval_top_k: int = 6              # candidate chunks pulled from Qdrant
    retrieval_score_threshold: float = 0.3  # cosine score below this is treated as irrelevant
    retrieval_max_documents: int = 4     # max distinct documents cited

    @property
    def database_url(self) -> str:
        # URL-encode credentials so passwords with special chars (@, %, :, /) are safe.
        user = quote_plus(self.postgres_user)
        password = quote_plus(self.postgres_password)
        return (
            f"postgresql+psycopg2://{user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
