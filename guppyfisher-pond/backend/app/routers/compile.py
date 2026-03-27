from fastapi import APIRouter, HTTPException
from app.schemas import CompileRequest, CompileResponse, OutputLine
from app.services.compiler import compile_guppy
from app.config import settings

router = APIRouter()


@router.post("/compile", response_model=CompileResponse)
async def compile_endpoint(req: CompileRequest) -> CompileResponse:
    if len(req.code) > settings.max_code_length:
        raise HTTPException(
            status_code=400,
            detail=f"Code exceeds {settings.max_code_length} character limit",
        )

    result = await compile_guppy(req.code, timeout=settings.execution_timeout)

    return CompileResponse(
        success=result["success"],
        lines=[OutputLine(**line) for line in result["lines"]],
        hugr_json=result.get("hugr"),
        elapsed_ms=result.get("elapsed_ms"),
    )
