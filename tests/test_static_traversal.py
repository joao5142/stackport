"""The SPA fallback must not serve files outside the UI build."""

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


# The ASGI server percent-decodes the path and does not normalize it, so each of
# these reaches the handler as `../`.
TRAVERSALS = [
    "/../../pyproject.toml",
    "/%2e%2e/%2e%2e/pyproject.toml",
    "/..%2f..%2fpyproject.toml",
    "/../../../../../../etc/passwd",
    "/assets/../../../pyproject.toml",
]


@pytest.mark.parametrize("path", TRAVERSALS)
def test_traversal_falls_back_to_index(client, path):
    resp = client.get(path)
    body = resp.text
    assert "[project]" not in body
    assert "root:" not in body
    assert "<!doctype html" in body.lower() or "<html" in body.lower()


def test_real_asset_is_still_served(client):
    resp = client.get("/favicon.svg")
    assert resp.status_code == 200
    assert "<svg" in resp.text.lower()


def test_unknown_route_returns_the_spa(client):
    resp = client.get("/some/client/side/route")
    assert resp.status_code == 200
    assert "<html" in resp.text.lower()
