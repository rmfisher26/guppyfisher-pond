import json
import logging
from fastapi import APIRouter, HTTPException
from app.schemas import CompileRequest, CompileResponse, OutputLine
from app.services.compiler import compile_guppy
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/compile", response_model=CompileResponse)
async def compile_endpoint(req: CompileRequest) -> CompileResponse:
    logger.debug("POST /api/compile — code length: %d\n%s", len(req.code), req.code)
    if len(req.code) > settings.max_code_length:
        raise HTTPException(
            status_code=400,
            detail=f"Code exceeds {settings.max_code_length} character limit",
        )

    result = await compile_guppy(req.code, timeout=settings.execution_timeout, selene_shots=req.selene_shots)

    response = CompileResponse(
        success=result["success"],
        lines=[OutputLine(**line) for line in result["lines"]],
        hugr_json=result.get("hugr"),
        elapsed_ms=result.get("elapsed_ms"),
        selene=result.get("selene"),
        tket=result.get("tket"),
    )
    hugr_summary = f"{len(json.dumps(response.hugr_json))} bytes" if response.hugr_json else "None"
    selene_summary = (
        f"{len(response.selene.results)} outcomes, {response.selene.shots} shots"
        if response.selene else "None"
    )
    logger.debug("POST /api/compile — success: %s, elapsed_ms: %s, hugr: %s, selene: %s\n%s",
                 response.success, response.elapsed_ms, hugr_summary, selene_summary,
                 "\n".join(f"  [{l.t}] {l.text}" for l in response.lines))
    if response.tket:
        logger.debug("TKET response:\n%s", json.dumps(response.tket.model_dump(), indent=2))
    if response.selene:
        logger.debug("Selene response:\n%s", json.dumps(response.selene.model_dump(), indent=2))
    return response
