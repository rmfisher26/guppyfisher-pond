from pydantic import BaseModel, Field
from typing import Literal


# ── Request ──────────────────────────────────────────────────────────────────

class CompileRequest(BaseModel):
    code: str = Field(..., description="Guppy Python source to compile")
    filename: str = Field(default="playground.py", description="Display name only")
    selene_shots: int = Field(default=200, ge=1, le=10000, description="Number of Selene emulation shots")


# ── Response ─────────────────────────────────────────────────────────────────

LineType = Literal["info", "success", "error", "hugr", "hint"]


class OutputLine(BaseModel):
    t: LineType
    text: str


class SeleneResult(BaseModel):
    state: str
    count: int
    correlated: bool


class TimelineStep(BaseModel):
    step: int
    label: str
    state: list[float]
    sup: bool = False
    entangled: bool = False
    classical: bool = False


class SeleneData(BaseModel):
    shots: int
    simulator: str
    results: list[SeleneResult]
    timeline: list[TimelineStep]


class CompileResponse(BaseModel):
    success: bool
    lines: list[OutputLine]
    hugr_json: dict | None = None   # Serialised HUGR, if compilation succeeded
    elapsed_ms: int | None = None
    selene: SeleneData | None = None
