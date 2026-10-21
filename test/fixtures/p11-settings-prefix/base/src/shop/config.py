class Settings:
    """Application settings (pydantic-settings style): defaults declared on the class, overridable at runtime."""

    API_V1_STR: str = "/api/v1"


settings = Settings()
