"""
tests/test_compile.py
---------------------
Run with:  pytest -v
These tests mock the compiler subprocess so they work without guppylang installed.
"""
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

GOOD_RESULT = {
    "lines": [
        {"t": "info",    "text": "guppylang 0.14.0"},
        {"t": "success", "text": "Compiled successfully"},
        {"t": "hugr",    "text": "  Node(0): FuncDefn"},
    ],
    "hugr": {"nodes": []},
    "success": True,
    "elapsed_ms": 120,
}

ERROR_RESULT = {
    "lines": [
        {"t": "error", "text": "LinearityError: qubit used twice"},
    ],
    "hugr": None,
    "success": False,
    "elapsed_ms": 50,
}


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@patch("app.routers.compile.compile_guppy", new_callable=AsyncMock, return_value=GOOD_RESULT)
def test_compile_success(mock_compile):
    r = client.post("/api/compile", json={"code": "module = GuppyModule('test')"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert any(l["t"] == "hugr" for l in body["lines"])


@patch("app.routers.compile.compile_guppy", new_callable=AsyncMock, return_value=ERROR_RESULT)
def test_compile_error(mock_compile):
    r = client.post("/api/compile", json={"code": "cx(q, q)"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert any(l["t"] == "error" for l in body["lines"])


def test_code_too_long():
    r = client.post("/api/compile", json={"code": "x" * 5000})
    assert r.status_code == 400
