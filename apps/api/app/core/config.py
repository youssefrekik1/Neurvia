from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    app_env: str = "development"
    database_url: str | None = None
    jwt_secret: SecretStr = Field(default_factory=lambda: SecretStr(token_urlsafe(48)))
    jwt_expire_minutes: int = Field(120, ge=1, le=1440)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    llm_enabled: bool = False
    llm_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen3.5:9b"
    llm_fallback_model: str | None = None
    llm_think: bool = False
    llm_temperature: float = Field(0.6, ge=0, le=2)
    llm_top_p: float = Field(0.9, gt=0, le=1)
    llm_top_k: int = Field(20, ge=1)
    llm_num_ctx: int = Field(8192, ge=512)
    llm_timeout_s: float = Field(120, gt=0, le=300)
    llm_max_retries: int = Field(1, ge=0, le=3)

    confident_wrong_weight: float = Field(0.5, ge=0, le=5)
    group_similarity: float = Field(0.5, gt=0, le=1)
    group_min_size: int = Field(3, ge=2, le=20)

    demo_mode: bool = False
    demo_admin_secret: SecretStr | None = None

    @model_validator(mode="after")
    def check_settings(self):
        if len(self.jwt_secret.get_secret_value().encode()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 bytes")
        if self.app_env == "production" and (
            self.demo_mode or "jwt_secret" not in self.model_fields_set
        ):
            raise ValueError("Production requires an explicit JWT_SECRET and DEMO_MODE=false")
        if "*" in self.allowed_origins:
            raise ValueError("CORS_ORIGINS must enumerate allowed origins")
        endpoint = urlsplit(self.llm_base_url)
        if endpoint.scheme not in {"http", "https"} or not endpoint.hostname or endpoint.username:
            raise ValueError("LLM_BASE_URL must be an HTTP(S) Ollama URL without credentials")
        return self

    @property
    def sqlite_url(self) -> str:
        filename = "fahm-demo.db" if self.demo_mode else "fahm.db"
        return self.database_url or f"sqlite:///{(ROOT / 'apps' / 'api' / filename).as_posix()}"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
