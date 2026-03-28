from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    allowed_origins: list[str] = [
        "https://guppyfisher.dev", # Production blog
    ]
    max_code_length: int = 4000    # Characters
    execution_timeout: float = 10.0  # Seconds

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
