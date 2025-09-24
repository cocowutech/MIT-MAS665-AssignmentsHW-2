from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
	gemini_api_key: str | None = Field(default=None, validation_alias="GEMINI_API_KEY")
	# Provider can be "vertex" (Vertex AI Express) or "ai_studio" (Generative Language API)
	gemini_provider: str = Field(default="ai_studio", validation_alias="GEMINI_PROVIDER")
	# Model to use, default to Gemini 2.5 Flash
	gemini_model: str = Field(default="gemini-2.5-flash", validation_alias="GEMINI_MODEL")
	# Optional: model override specifically for listening module
	gemini_model_listen: str | None = Field(default=None, validation_alias="GEMINI_MODEL_LISTEN")
	# Vertex configuration
	vertex_region: str = Field(default="us-central1", validation_alias="GEMINI_VERTEX_REGION")
	vertex_project: str | None = Field(default=None, validation_alias="GEMINI_VERTEX_PROJECT")

	# OpenRouter fallback configuration (optional)
	openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")
	openrouter_model: str = Field(default="x-ai/grok-4-fast:free", validation_alias="OPENROUTER_MODEL")
	openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1/chat/completions", validation_alias="OPENROUTER_BASE_URL")
	openrouter_referer: str = Field(default="https://localhost", validation_alias="OPENROUTER_HTTP_REFERER")
	openrouter_title: str = Field(default="Adaptive English Placement", validation_alias="OPENROUTER_TITLE")

	# Auth configuration (simple in-memory user store via env)
	jwt_secret_key: str = Field(default="change-me", validation_alias="JWT_SECRET_KEY")
	jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
	access_token_expire_minutes: int = Field(default=120, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES")
	# Seed user
	seed_username: str | None = Field(default=None, validation_alias="SEED_USERNAME")
	seed_password_plain: str | None = Field(default=None, validation_alias="SEED_PASSWORD")

	# Idle shutdown (disabled by default; set >0 to enable auto-exit after inactivity)
	idle_shutdown_seconds: int = Field(default=0, validation_alias="IDLE_SHUTDOWN_SECONDS")

	# Database
	database_url: str | None = Field(default=None, validation_alias="DATABASE_URL")

	# pydantic-settings v2 style config
	model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
