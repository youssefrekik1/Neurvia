from pathlib import Path
from secrets import token_urlsafe
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]
# Defaults published in compose.documents.yml. They are acceptable only on a developer machine.
LOCAL_SECRETS = ("neurvia-local-db", "neurvia-local-object-password")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT / "apps" / "api" / ".env"), extra="ignore")

    app_env: str = "development"
    database_url: str | None = None
    jwt_secret: SecretStr = Field(default_factory=lambda: SecretStr(token_urlsafe(48)))
    jwt_expire_minutes: int = Field(120, ge=1, le=1440)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    llm_enabled: bool = True
    llm_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "gemini-3.8-flash"
    llm_fallback_model: str | None = None
    llm_think: bool = False
    llm_temperature: float = Field(0.6, ge=0, le=2)
    llm_top_p: float = Field(0.9, gt=0, le=1)
    llm_top_k: int = Field(20, ge=1)
    llm_num_ctx: int = Field(8192, ge=512)
    llm_timeout_s: float = Field(120, gt=0, le=300)
    llm_max_retries: int = Field(1, ge=0, le=3)
    # `ollama` uses Ollama's native API; `openai` any OpenAI-compatible server such as vLLM.
    model_backend: Literal["gemini", "ollama", "openai"] = "gemini"
    gemini_api_key: SecretStr | None = None
    gemini_diagnosis_model: str = "gemini-3.5-flash-lite"
    llm_model_revision: str | None = None
    model_api_key: SecretStr | None = None
    embedding_revision: str | None = None

    confident_wrong_weight: float = Field(0.5, ge=0, le=5)
    group_similarity: float = Field(0.5, gt=0, le=1)
    group_min_size: int = Field(3, ge=2, le=20)

    document_s3_endpoint: str | None = None
    document_s3_bucket: str = "neurvia-documents"
    document_s3_access_key: SecretStr | None = None
    document_s3_secret_key: SecretStr | None = None
    document_s3_region: str = "us-east-1"
    document_max_upload_mb: int = Field(24, ge=1, le=64)
    document_max_pages: int = Field(120, ge=1, le=300)
    document_ocr_languages: str = "eng+fra+ara"
    document_tesseract: str = "tesseract"
    document_vision_enabled: bool = True
    document_vision_model: str = "gemini-3.8-flash"
    embedding_model: str = "gemini-embedding-2"
    rag_context_budget: int = Field(5500, ge=2000, le=30000)
    rag_rerank: bool = True
    document_job_retries: int = Field(3, ge=1, le=8)

    demo_mode: bool = False
    demo_admin_secret: SecretStr | None = None

    @model_validator(mode="after")
    def check_settings(self):
        if len(self.jwt_secret.get_secret_value().encode()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 bytes")
        if self.app_env == "production" and (
            self.demo_mode or "jwt_secret" not in self.model_fields_set
            or self.jwt_secret.get_secret_value() == "neurvia-compose-local-only-32-bytes"
        ):
            raise ValueError("Production requires an explicit JWT_SECRET and DEMO_MODE=false")
        if "*" in self.allowed_origins:
            raise ValueError("CORS_ORIGINS must enumerate allowed origins")
        if self.model_backend != "gemini":
            endpoint = urlsplit(self.llm_base_url)
            if endpoint.scheme not in {"http", "https"} or not endpoint.hostname or endpoint.username:
                raise ValueError("LLM_BASE_URL must be an HTTP(S) URL without credentials")
        if self.model_backend == "ollama":
            for field, default in {"llm_model": "qwen3.5:9b", "document_vision_model": "qwen3.5:9b",
                                   "embedding_model": "qwen3-embedding:0.6b"}.items():
                if field not in self.model_fields_set:
                    setattr(self, field, default)
        if self.document_s3_endpoint and (not self.document_s3_access_key or not self.document_s3_secret_key):
            raise ValueError("Configure both S3 credentials for the document bucket")
        if self.app_env == "production" and (
            (self.document_s3_secret_key and self.document_s3_secret_key.get_secret_value() in LOCAL_SECRETS)
            or any(secret in (self.database_url or "") for secret in LOCAL_SECRETS)
        ):
            raise ValueError("Production cannot use the local Compose database or object-storage credentials")
        return self

    @property
    def db_url(self) -> str:
        filename = "fahm-demo.db" if self.demo_mode else "fahm.db"
        if self.database_url and self.database_url.startswith('postgresql://'):
            return self.database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
        return self.database_url or f"sqlite:///{(ROOT / 'apps' / 'api' / filename).as_posix()}"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
