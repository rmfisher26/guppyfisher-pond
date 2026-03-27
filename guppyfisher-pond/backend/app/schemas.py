from pydantic import BaseModel, Field
from typing import Literal


# ── Request ──────────────────────────────────────────────────────────────────

class CompileRequest(BaseModel):
    code: str = Field(..., description="Guppy Python source to compile")
    filename: str = Field(default="playground.py", description="Display name only")


# ── Response ─────────────────────────────────────────────────────────────────

LineType = Literal["info", "success", "error", "hugr", "hint"]


class OutputLine(BaseModel):
    t: LineType
    text: str


class CompileResponse(BaseModel):
    success: bool
    lines: list[OutputLine]
    hugr_json: dict | None = None   # Serialised HUGR, if compilation succeeded
    elapsed_ms: int | None = None
